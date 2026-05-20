import { Context, Effect, Layer } from "effect";
import { RedisService, RedisError } from "@github-app/core";

// --- Log Streaming Service ---

export interface LogStreamService {
  readonly streamLog: (commitSha: string, message: string) => Effect.Effect<void, RedisError>;
  readonly getHistory: (commitSha: string) => Effect.Effect<string[], RedisError>;
}

export const LogStreamService = Context.GenericTag<LogStreamService>("@github-app/worker/LogStreamService");

export const LogStreamServiceLive = Layer.effect(
  LogStreamService,
  Effect.gen(function* () {
    const redis = yield* RedisService;

    yield* Effect.log("✅ [Worker] Log stream service initialized");

    const service: LogStreamService = {
      streamLog: (commitSha: string, message: string) =>
        Effect.gen(function* () {
          console.log(`[${commitSha.substring(0, 7)}] ${message.trim()}`);
          const channelFull = `logs:${commitSha}`;
          const channelShort = `logs:${commitSha.substring(0, 7)}`;
          yield* redis.publish(channelFull, message);
          yield* redis.publish(channelShort, message);
          yield* redis.rpush(`logs:history:${commitSha}`, message);
          yield* redis.expire(`logs:history:${commitSha}`, 3600);
        }),
      getHistory: (commitSha: string) =>
        redis.lrange(`logs:history:${commitSha}`, 0, -1),
    };

    return service;
  })
);
