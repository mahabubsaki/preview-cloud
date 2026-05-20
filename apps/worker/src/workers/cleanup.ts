import { Effect, Schedule } from "effect";
import { Queue } from "bullmq";
import { lt, eq, and, or, isNull } from "drizzle-orm";
import { deployments, DELETE_QUEUE, type DeleteJob } from "@github-app/core";
import { DatabaseService, RedisService } from "../services";
import { CleanupError } from "../errors";

// --- Cleanup Logic ---

const performCleanup = Effect.gen(function* () {
  const { db } = yield* DatabaseService;
  const redis = yield* RedisService;

  yield* Effect.log("🧹 [CLEANUP] Starting periodic resource reclamation...");

  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000);

  const expired = yield* Effect.tryPromise({
    try: () =>
      db
        .select()
        .from(deployments)
        .where(
          or(
            // 1. Actually expired running deployments
            and(
              or(
                lt(deployments.expiresAt, new Date()),
                and(
                  isNull(deployments.expiresAt),
                  lt(deployments.createdAt, sevenDaysAgo)
                )
              ),
              eq(deployments.status, "running")
            ),
            // 2. Stuck builds (building/pending for > 30 mins)
            and(
              or(
                eq(deployments.status, "building"),
                eq(deployments.status, "pending")
              ),
              lt(deployments.createdAt, thirtyMinsAgo)
            )
          )
        ),
    catch: (err) => new CleanupError({ message: `Cleanup query failed: ${err}` }),
  });

  if (expired.length === 0) {
    yield* Effect.log("✨ [CLEANUP] No expired deployments found.");
    return;
  }

  yield* Effect.log(`🔎 [CLEANUP] Found ${expired.length} expired deployments.`);

  const deleteQueue = new Queue<DeleteJob>(DELETE_QUEUE, {
    connection: redis.connection,
  });

  for (const dep of expired) {
    yield* Effect.tryPromise({
      try: () =>
        deleteQueue.add(
          `auto-cleanup-${dep.id}-${Date.now()}`,
          { projectId: dep.projectId, branch: dep.branch },
          { removeOnComplete: true, attempts: 3 }
        ),
      catch: (err) => new CleanupError({ message: `Failed to queue cleanup: ${err}`, deploymentId: dep.id }),
    });
    yield* Effect.log(`✅ [CLEANUP] Queued teardown for: ${dep.id} [${dep.branch}]`);
  }
});

// --- Scheduled Cleanup using Effect.Schedule ---

export const createCleanupSchedule = Effect.gen(function* () {
  yield* Effect.log("🚀 [CLEANUP] Initializing cleanup schedule...");

  // Run once immediately on startup
  yield* performCleanup.pipe(
    Effect.catchAll((err) => Effect.log(`❌ [CLEANUP] Error: ${err}`))
  );

  // Schedule: run every 10 minutes (600_000ms)
  const scheduled = performCleanup.pipe(
    Effect.catchAll((err) => Effect.log(`❌ [CLEANUP] Error: ${err}`)),
    Effect.repeat(Schedule.spaced("10 minutes"))
  );

  // Fork to background — runs independently
  const fiber = yield* Effect.fork(scheduled);
  yield* Effect.log("📅 [CLEANUP] Schedule active: Running every 10 minutes.");

  return fiber;
});
