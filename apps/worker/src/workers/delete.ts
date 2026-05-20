import { Effect, Runtime } from "effect";
import { Worker } from "bullmq";
import { $ } from "bun";
import { DELETE_QUEUE, DeleteJobSchema, type DeleteJob } from "@github-app/core";
import { RedisService, GitHubService } from "../services";
import { DockerError } from "../errors";

// --- Delete Worker ---

const processDeleteJob = (data: DeleteJob) =>
  Effect.gen(function* () {
    const redis = yield* RedisService;
    const github = yield* GitHubService;
    yield* Effect.log(`🗑️ Teardown Project: ${data.projectId}, Branch: ${data.branch}`);

    // Cancel any active GitHub Action builds for this branch first
    yield* github.cancelActiveRuns(data.branch).pipe(
      Effect.catchAll((err) => Effect.logWarning(`Could not cancel active builds: ${err.message}`))
    );

    const containerIds = yield* Effect.tryPromise({
      try: () => $`docker ps -a --filter "label=projectId=${data.projectId}" --filter "label=branch=${data.branch}" -q`.text(),
      catch: (err) => new DockerError({ message: `Failed to list containers: ${err}`, command: "docker ps" }),
    });

    if (containerIds.trim()) {
      const ids = containerIds.trim().split("\n");
      const tagsToDelete = new Set<string>();

      for (const id of ids) {
        yield* Effect.gen(function* () {
          // Extract port for Redis cleanup
          const portRes = yield* Effect.tryPromise(() => $`docker inspect --format '{{ index .Config.Labels "port" }}' ${id}`.text());
          const port = portRes.trim();
          if (port) {
            yield* redis.del(`port:reserved:${port}`);
          }

          // Extract image name for local cleanup
          const imageRes = yield* Effect.tryPromise(() => $`docker inspect --format '{{ .Image }}' ${id}`.text());
          const image = imageRes.trim();

          // Extract imageTag for GHCR cleanup
          const tagRes = yield* Effect.tryPromise(() => $`docker inspect --format '{{ index .Config.Labels "imageTag" }}' ${id}`.text());
          const tag = tagRes.trim();
          if (tag && tag !== "local" && tag !== "<no value>") {
            tagsToDelete.add(tag);
          }

          yield* Effect.tryPromise(() => $`docker stop ${id}`.quiet());
          yield* Effect.tryPromise(() => $`docker rm ${id}`.quiet());

          // Cleanup local image to save disk space
          if (image && image !== "<no value>") {
            console.log(`🧹 Removing local image ${image.substring(0, 12)}...`);
            yield* Effect.tryPromise(() => $`docker rmi ${image}`.quiet().nothrow());
          }
        }).pipe(
          Effect.catchAll((err) => 
            Effect.logWarning(`Failed to remove container/image ${id}: ${err}`)
          ),
          Effect.ignore
        );
      }

      // Cleanup GHCR package versions
      for (const tag of tagsToDelete) {
        yield* github.deletePackageVersion("preview-images", tag).pipe(
          Effect.catchAll((err) => Effect.logWarning(`Could not delete package version ${tag} from GHCR: ${err.message}`))
        );
      }
    }
    yield* Effect.log("✅ Teardown complete.");
  });

export const createDeleteWorker = Effect.gen(function* () {
  const redis = yield* RedisService;
  const runtime = yield* Effect.runtime<RedisService | GitHubService>();
  const runPromise = Runtime.runPromise(runtime);

  const worker = new Worker(
    DELETE_QUEUE,
    (job) => {
      const data = DeleteJobSchema.parse(job.data);
      return runPromise(processDeleteJob(data));
    },
    {
      connection: redis.connection,
      concurrency: Number(process.env.DELETE_CONCURRENCY) || 5,
    }
  );

  yield* Effect.addFinalizer(() =>
    Effect.promise(() => worker.close()).pipe(
      Effect.tap(() => Effect.log("🛑 Delete worker shut down gracefully"))
    )
  );

  yield* Effect.log("✅ Delete worker started (Idiomatic Effect-TS)");
  return worker;
});
