import { Effect, Context, Schedule, Fiber, Schema as S } from "effect";
import { eq } from "drizzle-orm";
import path from "path";
import fs from "node:fs";
import {
  deployments,
  type BuildJob,
  type NotifyJob,
  NOTIFY_QUEUE
} from "@github-app/core";
import { Queue } from "bullmq";
import {
  DatabaseService,
  RedisService,
  LogStreamService,
  ShellService,
  InternalApiService
} from "../services";
import { BuildError, DockerError } from "../errors";
import { detectMonorepo, detectFramework, type MonorepoInfo, type FrameworkInfo } from "../orchestrator/framework";
import { generateDockerfileContent } from "../orchestrator/dockerfile-gen";
import { findAndReservePort } from "../orchestrator/ports";

// --- Types ---

export interface BuildContextData {
  readonly data: BuildJob;
  readonly commitShaShort: string;
  readonly containerName: string;
  readonly repoDir: string;
  readonly envFile: string;
  readonly safeProjectId: string;
  readonly safeBranch: string;
  readonly startTime: number;
}

export class BuildContext extends Context.Tag("BuildContext")<BuildContext, BuildContextData>() { }

// --- Steps ---

export const updateDeploymentStatus = (status: "building" | "running" | "failed", url?: string) =>
  Effect.gen(function* () {
    const { data } = yield* BuildContext;
    const { db } = yield* DatabaseService;
    const redis = yield* RedisService;

    yield* Effect.tryPromise({
      try: () => db.update(deployments).set({ status, previewUrl: url }).where(eq(deployments.id, data.deploymentId)),
      catch: (err) => new BuildError({
        message: `Failed to update status to ${status}: ${err}`,
        phase: "status_update",
        commitSha: data.commitSha
      }),
    });

    // Only publish to Redis for the 'building' state.
    // Final states (running/failed) are handled by notifyCompletion to avoid double-notifications
    // and ensure all metadata (repo, branch, etc.) is included.
    if (status === "building") {
      const updateMessage = yield* S.encode(S.parseJson(S.Struct({
        deploymentId: S.String,
        repo: S.String,
        branch: S.String,
        commitSha: S.String,
        status: S.String,
        url: S.optional(S.String),
        discordMessageId: S.optional(S.String),
        discordChannelId: S.optional(S.String),
      })))({
        deploymentId: String(data.deploymentId),
        repo: String(data.repo),
        branch: String(data.branch),
        commitSha: String(data.commitSha),
        status,
        url,
        discordMessageId: data.discordMessageId,
        discordChannelId: data.discordChannelId,
      });

      yield* redis.publish("deployment-updates", updateMessage);
    }
  });

export const fetchEnvironmentVariables = Effect.gen(function* () {
  const { data } = yield* BuildContext;
  const api = yield* InternalApiService;
  const logs = yield* LogStreamService;

  yield* logs.streamLog(data.commitSha, "🔧 Fetching environment variables...");

  const dbEnvs = yield* api.fetchEnvs(data.projectId, data.branch).pipe(
    Effect.mapError((err) =>
      new BuildError({ message: err.message, phase: "env_fetch", commitSha: data.commitSha })
    )
  );

  return dbEnvs.reduce<Record<string, string>>((acc, env) => {
    acc[env.key] = env.value;
    return acc;
  }, {});
});

export const checkoutRepository = Effect.gen(function* () {
  const { data, repoDir } = yield* BuildContext;
  const shell = yield* ShellService;
  const logs = yield* LogStreamService;

  const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);

  if (!fs.existsSync("temp")) {
    fs.mkdirSync("temp", { recursive: true });
  }

  const dirExists = fs.existsSync(repoDir);

  const githubToken = process.env.GITHUB_TOKEN;
  const repoUrl = githubToken
    ? `https://x-access-token:${githubToken}@github.com/${data.repo}.git`
    : `https://github.com/${data.repo}.git`;

  if (dirExists) {
    const relativeDir = path.relative(process.cwd(), repoDir);
    yield* streamLog(`🔄 Directory exists, performing hard reset in ${relativeDir}...`);
    console.log(`[${data.commitSha}] Fetching and resetting ${data.repo} (${data.branch}) in ${relativeDir}`);
    // Use array-based execution for cross-platform reliability
    yield* shell.run(["git", "-C", repoDir, "remote", "set-url", "origin", repoUrl]).pipe(
      Effect.mapError((err) => new BuildError({ message: `Git set-url failed: ${err.message}`, phase: "clone", commitSha: data.commitSha }))
    );
    yield* shell.run(["git", "-C", repoDir, "fetch", "origin", data.branch]).pipe(
      Effect.mapError((err) => new BuildError({ message: `Git fetch failed: ${err.message}`, phase: "clone", commitSha: data.commitSha }))
    );
    yield* shell.run(["git", "-C", repoDir, "reset", "--hard", `origin/${data.branch}`]).pipe(
      Effect.mapError((err) => new BuildError({ message: `Git reset failed: ${err.message}`, phase: "clone", commitSha: data.commitSha }))
    );
  } else {
    const relativeDir = path.relative(process.cwd(), repoDir);
    yield* streamLog(`📥 Cloning repository into ${relativeDir}...`);
    console.log(`[${data.commitSha}] Cloning ${data.repo} (${data.branch}) into ${relativeDir}`);
    yield* shell.run(["git", "clone", "--depth", "1", "--branch", data.branch, repoUrl, repoDir]).pipe(
      Effect.mapError((err) => new BuildError({ message: `Git clone failed: ${err.message}`, phase: "clone", commitSha: data.commitSha }))
    );
  }
}).pipe(
  Effect.timeout("5 minutes"),
  Effect.catchTag("TimeoutException", () =>
    new BuildError({ message: "Git checkout timed out after 5m. Check your network.", phase: "clone", commitSha: "unknown" })
  )
);

export const detectProjectMetadata = Effect.gen(function* () {
  const { data, repoDir } = yield* BuildContext;
  const { db } = yield* DatabaseService;
  const logs = yield* LogStreamService;
  const redis = yield* RedisService;

  const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);
  yield* streamLog("✨ Detecting framework and generating Dockerfile...");

  const dockerfilePath = path.resolve(repoDir, "Dockerfile");
  const monorepo = yield* detectMonorepo(repoDir);
  const fw = yield* detectFramework(repoDir, monorepo);

  // Update DB with framework
  yield* Effect.tryPromise({
    try: () => db.update(deployments).set({ framework: fw.framework }).where(eq(deployments.id, data.deploymentId)),
    catch: (err) => new BuildError({ message: `Failed to update framework in DB: ${err}`, phase: "detect", commitSha: data.commitSha }),
  });

  const statusUpdate = yield* S.encode(S.parseJson(S.Struct({
    deploymentId: S.String,
    repo: S.String,
    branch: S.String,
    commitSha: S.String,
    status: S.String,
    framework: S.optional(S.String)
  })))({ 
    deploymentId: String(data.deploymentId),
    repo: String(data.repo),
    branch: String(data.branch),
    commitSha: String(data.commitSha), 
    status: "building", 
    framework: fw.framework 
  });

  yield* redis.publish("deployment-updates", statusUpdate);

  return { monorepo, fw, dockerfilePath };
});

export const buildDockerImage = (envs: Record<string, string>, monorepo: MonorepoInfo, fw: FrameworkInfo, dockerfilePath: string) =>
  Effect.gen(function* () {
    const { data, repoDir, containerName } = yield* BuildContext;
    const shell = yield* ShellService;
    const logs = yield* LogStreamService;

    const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);
    yield* streamLog("📦 Building Docker image...");

    // Write .env for build-time if needed
    if (Object.keys(envs).length > 0) {
      const dotEnvContent = Object.entries(envs).map(([k, v]) => `${k}=${v}`).join("\n");
      yield* Effect.tryPromise({
        try: () => Bun.write(path.resolve(repoDir, ".env"), dotEnvContent),
        catch: (err) => new BuildError({ message: `Failed to write .env: ${err}`, phase: "docker_build", commitSha: data.commitSha }),
      });
    }

    // Check for Dockerfile
    const hasDockerfile = yield* Effect.tryPromise({
      try: () => Bun.file(dockerfilePath).exists(),
      catch: (err) => new BuildError({ message: `Dockerfile check failed: ${err}`, phase: "detect", commitSha: data.commitSha }),
    });

    if (!hasDockerfile) {
      const content = yield* generateDockerfileContent(monorepo, fw);
      yield* Effect.tryPromise({
        try: () => Bun.write(dockerfilePath, content),
        catch: (err) => new BuildError({ message: `Failed to write Dockerfile: ${err}`, phase: "detect", commitSha: data.commitSha }),
      });
      yield* streamLog(`📝 Dockerfile generated [${fw.framework}]`);
    }

    const buildArgs = Object.entries(envs).flatMap(([k, v]) => ["--build-arg", `${k}=${v}`]);

    const buildProcess = shell.spawn(["docker", "build", ...buildArgs, "-t", containerName, "."], {
      cwd: repoDir,
      stdout: "pipe",
      stderr: "pipe",
      stdin: "ignore",
    });

    const streamLogs = (stream: ReadableStream<Uint8Array> | null | undefined | number) =>
      Effect.gen(function* () {
        if (!stream || typeof stream === "number") return;
        const reader = stream.getReader();
        yield* Effect.addFinalizer(() => Effect.sync(() => reader.releaseLock()));
        
        const decoder = new TextDecoder();
        while (true) {
          const { done, value } = yield* Effect.tryPromise({
            try: () => reader.read(),
            catch: (err) => new BuildError({ 
              message: `Log stream read failure: ${err}`, 
              phase: "docker_build", 
              commitSha: data.commitSha 
            }),
          });
          
          if (done) break;
          const chunk = decoder.decode(value);
          const lines = chunk.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
          for (const line of lines) {
            yield* streamLog(line);
          }
        }
      }).pipe(Effect.scoped);

    const stdoutFiber = yield* Effect.fork(streamLogs(buildProcess.stdout));
    const stderrFiber = yield* Effect.fork(streamLogs(buildProcess.stderr));

    const code = yield* Effect.promise(() => buildProcess.exited);
    
    // Ensure we finish reading logs before continuing
    yield* Fiber.join(stdoutFiber);
    yield* Fiber.join(stderrFiber);

    if (code !== 0) {
      return yield* new DockerError({ message: `Docker build failed with code ${code}`, command: "docker build" });
    }
  });

export const cleanupPreviousDeployments = Effect.gen(function* () {
  const { data, safeProjectId, safeBranch } = yield* BuildContext;
  const shell = yield* ShellService;
  const redis = yield* RedisService;
  const logs = yield* LogStreamService;

  const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);

  yield* streamLog(`🧹 Cleaning up previous deployments for ${data.branch}...`);

  // Use array-based run for cross-platform reliability
  const allContainers = yield* shell.run(["docker", "ps", "-a", "--format", "{{.ID}} {{.Label \"projectId\"}} {{.Label \"branch\"}}"]);
  const lines = allContainers.trim().split("\n").filter(l => l.trim().length > 0);

  const ids = lines
    .map(line => {
      const parts = line.split(" ");
      const id = parts[0];
      const projId = parts[1];
      const branch = parts[2];
      if (projId === safeProjectId && branch === safeBranch) return id;
      return null;
    })
    .filter((id): id is string => id !== null);

  if (ids.length > 0) {
    yield* streamLog(`🔍 Found ${ids.length} old containers to clear...`);
    for (const id of ids) {
      yield* streamLog(`🛑 Removing old container ${id.substring(0, 7)}...`);
      yield* shell.run(["docker", "inspect", "--format", "{{ index .Config.Labels \"port\" }}", id]).pipe(
        Effect.flatMap((portRes) => {
          const port = portRes.trim();
          if (port) {
            return redis.del(`port:reserved:${port}`).pipe(
              Effect.flatMap(() => streamLog(`🔓 Released port ${port}`))
            );
          }
          return Effect.void;
        }),
        Effect.catchAll((e) =>
          Effect.sync(() => console.warn(`Could not retrieve reserved port for container ${id}: ${e}`))
        )
      );
      // Force remove for instant cleanup
      yield* shell.run(["docker", "rm", "-f", id]).pipe(Effect.ignore);
    }
  }
});

export const launchContainer = (envs: Record<string, string>, remoteImage?: string) =>
  Effect.gen(function* () {
    const { data, containerName, envFile, commitShaShort, safeProjectId, safeBranch } = yield* BuildContext;
    const shell = yield* ShellService;
    const logs = yield* LogStreamService;
    const redis = yield* RedisService;

    const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);

    if (remoteImage) {
      yield* streamLog(`🔐 Authenticating with GHCR...`);
      // Use GITHUB_TOKEN for authentication (works for both local PAT and Action-provided tokens)
      const githubToken = process.env.GITHUB_TOKEN;
      if (githubToken) {
        // We use 'token' or github.actor, but token is safer for GHCR pull
        yield* shell.run(["docker", "login", "ghcr.io", "-u", "token", "-p", githubToken]).pipe(
          Effect.catchAll(() => streamLog("⚠️ Docker login failed, attempting pull anyway..."))
        );
      }

      yield* streamLog(`📥 Pulling image ${remoteImage}...`);

      yield* Effect.gen(function* () {
        const pullProcess = shell.spawn(["docker", "pull", remoteImage], {
          stdout: "pipe",
          stderr: "pipe",
          stdin: "ignore",
        });

        const streamLogs = (stream: ReadableStream<Uint8Array> | null | undefined | number) =>
          Effect.gen(function* () {
            if (!stream || typeof stream === "number") return;
            const reader = stream.getReader();
            yield* Effect.addFinalizer(() => Effect.sync(() => reader.releaseLock()));
            
            const decoder = new TextDecoder();
            while (true) {
              const { done, value } = yield* Effect.tryPromise({
                try: () => reader.read(),
                catch: (err) => new DockerError({ message: `Pull log read failure: ${err}`, command: "docker pull" }),
              });
              
              if (done) break;
              const chunk = decoder.decode(value);
              const lines = chunk.split(/[\r\n]+/).filter((l) => l.trim().length > 0);
              for (const line of lines) {
                yield* streamLog(line);
              }
            }
          }).pipe(Effect.scoped);

        const stdoutFiber = yield* Effect.fork(streamLogs(pullProcess.stdout));
        const stderrFiber = yield* Effect.fork(streamLogs(pullProcess.stderr));

        const code = yield* Effect.promise(() => pullProcess.exited);
        
        yield* Fiber.join(stdoutFiber);
        yield* Fiber.join(stderrFiber);

        if (code !== 0) {
          return yield* new DockerError({ message: `Docker pull failed with code ${code}`, command: "docker pull" });
        }
      }).pipe(
        Effect.retry({
          times: 5,
          schedule: Schedule.exponential("2 seconds")
        })
      );
      yield* streamLog(`✅ Image pulled successfully`);
    }

    const imageToRun = remoteImage || containerName;

    yield* streamLog("🚀 Launching container...");

    const envContent = Object.entries(envs).map(([k, v]) => `${k}=${v}`).join("\n");
    yield* Effect.tryPromise({
      try: () => Bun.write(envFile, envContent),
      catch: (err) => new BuildError({ message: `Failed to write runtime env file: ${err}`, phase: "docker_run", commitSha: data.commitSha }),
    });

    const isProduction = process.env.DEPLOYMENT_MODE === "production";
    const baseDomain = process.env.PREVIEW_DOMAIN || "preview.yourdomain.com";
    const branchSafe = safeBranch;
    const memoryLimit = process.env.PREVIEW_MEMORY_LIMIT || "256m";
    const cpuLimit = process.env.PREVIEW_CPU_LIMIT || "0.5";

    if (isProduction) {
      const routerName = `r-${commitShaShort}`;
      const prodHostname = `${safeProjectId}-${branchSafe}.${baseDomain}`;

      yield* shell.run([
        "docker", "run", "-d",
        "--name", containerName,
        "--network", "preview-net",
        "--memory", memoryLimit,
        "--cpus", cpuLimit,
        "--env-file", envFile,
        "-e", "PORT=3000",
        "--label", `projectId=${safeProjectId}`,
        "--label", `branch=${safeBranch}`,
        "--label", `imageTag=${remoteImage?.split(":")[1] || "local"}`,
        "--label", "traefik.enable=true",
        "--label", "traefik.docker.network=preview-net",
        "--label", `traefik.http.routers.${routerName}.rule=Host("${prodHostname}")`,
        "--label", `traefik.http.routers.${routerName}.entrypoints=web`,
        "--label", `traefik.http.services.${routerName}.loadbalancer.server.port=3000`,
        imageToRun
      ]).pipe(
        Effect.mapError((err) => new DockerError({ message: `Docker run failed: ${err.message}`, command: "docker run (prod)" }))
      );

      return `https://${prodHostname}`;
    } else {
      const hostPort = yield* findAndReservePort(data.commitSha);
      yield* streamLog(`🚀 Launching on port ${hostPort}...`);

      yield* shell.run([
        "docker", "run", "-d",
        "--name", containerName,
        "-p", `${hostPort}:3000`,
        "--memory", memoryLimit,
        "--cpus", cpuLimit,
        "-e", "PORT=3000",
        "--env-file", envFile,
        "--label", `projectId=${safeProjectId}`,
        "--label", `branch=${safeBranch}`,
        "--label", `port=${hostPort}`,
        "--label", `imageTag=${remoteImage?.split(":")[1] || "local"}`,
        imageToRun
      ]).pipe(
        Effect.mapError((err) => new DockerError({ message: `Docker run failed: ${err.message}`, command: "docker run (local)" }))
      );

      yield* redis.set(`port:reserved:${hostPort}`, data.commitSha);
      return `http://localhost:${hostPort}`;
    }
  });

export const notifyCompletion = (status: "success" | "failure", url: string, framework: string) =>
  Effect.gen(function* () {
    const { data, startTime } = yield* BuildContext;
    const redis = yield* RedisService;

    const buildTime = Math.floor((Date.now() - startTime) / 1000);
    const notifyQueue = new Queue(NOTIFY_QUEUE, { connection: redis.connection });

    yield* Effect.tryPromise({
      try: () => notifyQueue.add(`notify-${data.deploymentId}`, {
        deploymentId: data.deploymentId,
        repo: data.repo,
        branch: data.branch,
        commitSha: data.commitSha,
        previewUrl: url,
        status,
        discordMessageId: data.discordMessageId,
        discordChannelId: data.discordChannelId,
        buildTime,
        framework,
      } satisfies NotifyJob),
      catch: (cause) => new BuildError({
        message: "Notification failed",
        phase: "notification",
        cause,
        commitSha: data.commitSha
      }),
    }).pipe(Effect.ignore);
  });
