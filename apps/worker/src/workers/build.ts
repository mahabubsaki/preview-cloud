import { Effect, Runtime } from "effect";
import { Worker } from "bullmq";
import { BuildError } from "../errors";
import { eq } from "drizzle-orm";
import path from "path";
import {
  BUILD_QUEUE,
  deployments,
  BuildJobSchema,
  type BuildJob,
} from "@github-app/core";
import {
  DatabaseService,
  RedisService,
  LogStreamService,
  ShellService,
  InternalApiService,
  GitHubService
} from "../services";
import {
  BuildContext,
  type BuildContextData,
  updateDeploymentStatus,
  fetchEnvironmentVariables,
  checkoutRepository,
  detectProjectMetadata,
  cleanupPreviousDeployments,
  launchContainer,
  notifyCompletion
} from "./build-steps";

// --- Build Worker ---

const processBuildJob = (data: BuildJob) =>
  Effect.gen(function* () {
    const logs = yield* LogStreamService;
    const { db } = yield* DatabaseService;

    const commitShaShort = data.commitSha.substring(0, 7);
    const clean = (str: string) => str.replace(/[^a-zA-Z0-9-]/g, "-").toLowerCase();
    const safeProjectId = clean(data.projectId);
    const safeBranch = clean(data.branch);

    const context: BuildContextData = {
      data,
      commitShaShort,
      containerName: `preview-${safeProjectId}-${commitShaShort}`,
      repoDir: path.resolve(process.cwd(), "temp", `${safeProjectId}-${data.commitSha}`),
      envFile: path.resolve(process.cwd(), "temp", `preview-${safeProjectId}-${commitShaShort}.env`),
      safeProjectId,
      safeBranch,
      startTime: Date.now(),
    };

    const streamLog = (msg: string) => logs.streamLog(data.commitSha, msg);

    return yield* Effect.gen(function* () {
      // 0. Update status to building
      yield* updateDeploymentStatus("building");
      const approvalInfo = data.approvedBy 
        ? `Approved by ${data.approvedBy}` 
        : data.author === "GitHub Actions" 
          ? "Build Farm Callback" 
          : "Direct Build (No Approval)";

      const startMsg = data.image 
        ? `🚀 Starting deployment for ${data.repo} [${data.branch}]... (${approvalInfo})`
        : `🚀 Starting build for ${data.repo} [${data.branch}]... (${approvalInfo})`;
      
      yield* streamLog(startMsg);
      console.log(`[${data.commitSha}] ${startMsg.replace("🚀 ", "")}`);

      let framework = "Unknown";
      let finalUrl = "";

      return yield* Effect.gen(function* () {
        // 1. Fetch envs
        console.log(`[${data.commitSha}] Step 1: Fetching envs...`);
        const envs = yield* fetchEnvironmentVariables;
        console.log(`[${data.commitSha}] Step 1 Complete: Found ${Object.keys(envs).length} envs`);

        if (data.image) {
          yield* streamLog(`📦 Build already complete. Using image: ${data.image}`);
          framework = data.framework || "Unknown";
          
          console.log(`[${data.commitSha}] Step 5: Launching...`);
          yield* cleanupPreviousDeployments;
          finalUrl = yield* launchContainer(envs, data.image);
          console.log(`[${data.commitSha}] Step 5 Complete: URL is ${finalUrl}`);

          yield* streamLog(`✅ Deployment successful! URL: ${finalUrl}`);
          yield* notifyCompletion("success", finalUrl, framework);
          return;
        }

        // 2. Checkout
        console.log(`[${data.commitSha}] Step 2: Checking out repository...`);
        yield* checkoutRepository;
        console.log(`[${data.commitSha}] Step 2 Complete: Repository checked out`);

        // 3. Detect
        console.log(`[${data.commitSha}] Step 3: Detecting metadata...`);
        const { fw } = yield* detectProjectMetadata;
        console.log(`[${data.commitSha}] Step 3 Complete: Framework detected as ${fw.framework}`);
        framework = fw.framework;

        // 4. Trigger GA Build
        console.log(`[${data.commitSha}] Step 4: Triggering GitHub Action build...`);

        const github = yield* GitHubService;
        const imageTag = `${safeProjectId}-${commitShaShort}`;

        yield* github.triggerBuild({
          repoUrl: data.repo,
          commitSha: data.commitSha,
          imageTag,
          buildArgs: envs,
          deploymentId: data.deploymentId,
          framework: framework
        });

        yield* updateDeploymentStatus("building");
        yield* streamLog("📦 Offloading build to GitHub Actions... logs will appear below.");
      }).pipe(
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const msg = error && typeof error === "object" && "message" in error ? String(error.message) : String(error);
            yield* streamLog(`❌ ERROR: ${msg}`);

            yield* Effect.tryPromise({
              try: () => db.update(deployments).set({ status: "failed" }).where(eq(deployments.id, data.deploymentId)),
              catch: (err) => new BuildError({ message: "DB failure during status update", phase: "notification", commitSha: data.commitSha, cause: err }),
            }).pipe(
              Effect.tapError((err) => Effect.log(`⚠️ DB update failed: ${err.message}`)),
              Effect.ignore
            );

            yield* notifyCompletion("failure", "", framework);
            return yield* Effect.fail(error);
          })
        ),
        Effect.ensuring(
          Effect.tryPromise({
            try: async () => {
              const { repoDir, envFile } = context;
              const fs = await import("node:fs");
              if (fs.existsSync(repoDir)) fs.rmSync(repoDir, { recursive: true, force: true });
              if (fs.existsSync(envFile)) fs.rmSync(envFile, { force: true });
            },
            catch: (err) => new BuildError({ message: "Cleanup failure", phase: "cleanup", commitSha: data.commitSha, cause: err }),
          }).pipe(
            Effect.tapError((err) => Effect.log(`⚠️ Final cleanup failed: ${err.message}`)),
            Effect.ignore
          )
        )
      );
    }).pipe(Effect.provideService(BuildContext, context));
  });

export const createBuildWorker = Effect.gen(function* () {
  const redis = yield* RedisService;
  const runtime = yield* Effect.runtime<
    DatabaseService | RedisService | LogStreamService | ShellService | InternalApiService | GitHubService
  >();

  const worker = new Worker(
    BUILD_QUEUE,
    async (job) => {
      const data = BuildJobSchema.parse(job.data);
      // Explicitly pipe through orDie to match the promise return expectation
      return Runtime.runPromise(runtime)(processBuildJob(data).pipe(Effect.orDie));
    },
    {
      connection: redis.connection,
      concurrency: Number(process.env.BUILD_CONCURRENCY) || 2,
    }
  );

  yield* Effect.addFinalizer(() =>
    Effect.promise(() => worker.close()).pipe(
      Effect.tap(() => Effect.log("🛑 Build worker shut down gracefully"))
    )
  );

  yield* Effect.log("✅ Build worker started (Modular & Idiomatic)");
  return worker;
});
