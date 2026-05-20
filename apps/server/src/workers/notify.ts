import { Effect, Runtime, Schema as S } from "effect";
import { deployments, NOTIFY_QUEUE, type NotifyJob } from "@github-app/core";
import { Worker } from "bullmq";
import { eq } from "drizzle-orm";
import { DatabaseService, RedisService } from "../services";
import { DatabaseError } from "../errors";

// --- Notification Worker Effect ---

export const createNotifyWorker = Effect.gen(function* () {
  const { db } = yield* DatabaseService;
  const redis = yield* RedisService;
  const runtime = yield* Effect.runtime<never>();
  const run = Runtime.runPromise(runtime);

  const worker = new Worker(
    NOTIFY_QUEUE,
    (job) =>
      run(
        Effect.gen(function* () {
          const data: NotifyJob = job.data;
          yield* Effect.log(
            `📢 Processing Notification: ${data.status} for ${data.commitSha}`
          );

          const dbStatus =
            data.status === "success"
              ? "running"
              : data.status === "failure"
                ? "failed"
                : data.status;

          yield* Effect.tryPromise({
            try: () =>
              db
                .update(deployments)
                .set({
                  status: dbStatus,
                  previewUrl: data.previewUrl,
                })
                .where(eq(deployments.id, data.deploymentId)),
            catch: (error) => new DatabaseError({ message: `DB Update Failed: ${error}`, operation: "update_status" }),
          });

          yield* Effect.log(`✅ Database updated to: ${dbStatus}`);

          const DeploymentUpdate = S.Struct({
            deploymentId: S.String,
            repo: S.String,
            branch: S.String,
            commitSha: S.String,
            status: S.String,
            url: S.String,
            discordMessageId: S.optional(S.String),
            discordChannelId: S.optional(S.String),
            buildTime: S.optional(S.Number),
            framework: S.optional(S.String),
          });

          const jsonString = yield* S.encode(S.parseJson(DeploymentUpdate))({
            deploymentId: data.deploymentId,
            repo: data.repo,
            branch: data.branch,
            commitSha: data.commitSha,
            status: dbStatus,
            url: data.previewUrl,
            discordMessageId: data.discordMessageId,
            discordChannelId: data.discordChannelId,
            buildTime: data.buildTime,
            framework: data.framework,
          });

          // Publish update for SSE subscribers using shared Redis service
          const publishCount = yield* redis.publish("deployment-updates", jsonString);

          yield* Effect.log(`📡 Broadcasted to ${publishCount} subscribers`);
        }).pipe(
          Effect.tapError((error) =>
            Effect.logError(`❌ Notification Worker Error: ${error}`)
          )
        )
      ),
    { connection: redis.connection }
  );

  yield* Effect.log("✅ Notification worker started");

  return worker;
});
