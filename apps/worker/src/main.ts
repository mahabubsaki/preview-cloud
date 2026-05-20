import { Effect, Layer } from "effect";

import {
  DatabaseServiceLive,
  RedisServiceLive,
  LogStreamServiceLive,
  ShellServiceLive,
  InternalApiServiceLive,
  GitHubServiceLive
} from "./services";

import { createBuildWorker } from "./workers/build";
import { createDeleteWorker } from "./workers/delete";
import { createCleanupSchedule } from "./workers/cleanup";
import { createDiscordWorker } from "./workers/discord";

// --- Compose Layer ---
const MainLayer = Layer.mergeAll(
  DatabaseServiceLive(),
  RedisServiceLive,
  LogStreamServiceLive.pipe(Layer.provide(RedisServiceLive)),
  ShellServiceLive,
  InternalApiServiceLive,
  GitHubServiceLive.pipe(Layer.provide(RedisServiceLive))
);

// --- Main Program ---

const main = Effect.gen(function* () {
  yield* Effect.log("👷 Starting Unified Worker Service (Effect-TS)...");

  // Start all workers in parallel
  yield* Effect.all(
    [
      createBuildWorker.pipe(
        Effect.tap(() => Effect.log("🔨 Build worker ready"))
      ),
      createDeleteWorker.pipe(
        Effect.tap(() => Effect.log("🗑️ Delete worker ready"))
      ),
      createCleanupSchedule.pipe(
        Effect.tap(() => Effect.log("🧹 Cleanup scheduler ready"))
      ),
      createDiscordWorker.pipe(
        Effect.catchAll((err) =>
          Effect.log(`⚠️ Discord worker failed to start: ${err}`)
        ),
        Effect.tap(() => Effect.log("🤖 Discord worker ready"))
      ),
    ],
    { concurrency: "unbounded" }
  );

  yield* Effect.log("✅ All workers started successfully!");

  // --- Graceful Shutdown Handler ---
  const shutdown = yield* Effect.async<void>((resume) => {
    const handleSignal = (signal: string) => {
      console.log(`\n🛑 Received ${signal}, initiating graceful shutdown...`);
      resume(Effect.void);
    };

    process.on("SIGTERM", () => handleSignal("SIGTERM"));
    process.on("SIGINT", () => handleSignal("SIGINT"));
  });

  yield* Effect.log("🚪 Shutting down...");
  return shutdown;
});

// --- Run ---

Effect.runFork(
  main.pipe(
    Effect.provide(MainLayer),
    Effect.scoped,
    Effect.catchAllDefect((defect) => {
      console.error("💥 Fatal defect in worker:", defect);
      return Effect.void;
    })
  )
);
