import { Context, Effect, Layer, Data } from "effect";
import IORedis from "ioredis";

export class RedisError extends Data.TaggedError("RedisError")<{
  readonly message: string;
  readonly operation?: string;
}> { }

export interface RedisService {
  readonly connection: IORedis;
  readonly publish: (channel: string, message: string) => Effect.Effect<number, RedisError>;
  readonly rpush: (key: string, value: string) => Effect.Effect<number, RedisError>;
  readonly expire: (key: string, seconds: number) => Effect.Effect<number, RedisError>;
  readonly lrange: (key: string, start: number, stop: number) => Effect.Effect<string[], RedisError>;
  readonly set: (key: string, value: string, ...args: any[]) => Effect.Effect<string | null, RedisError>;
  readonly del: (key: string) => Effect.Effect<number, RedisError>;
  readonly get: (key: string) => Effect.Effect<string | null, RedisError>;
}

export const RedisService = Context.GenericTag<RedisService>("@github-app/core/RedisService");

export const RedisServiceLive = Layer.scoped(
  RedisService,
  Effect.acquireRelease(
    Effect.gen(function* () {
      const url = process.env.REDIS_URL || "redis://127.0.0.1:6379";
      const connection = new IORedis(url, {
        maxRetriesPerRequest: null,
      });

      connection.on("error", (err) => console.error("🛑 Redis Error:", err));

      yield* Effect.log("✅ Redis service initialized");

      const service: RedisService = {
        connection,
        publish: (channel: string, message: string) => Effect.tryPromise({
          try: () => connection.publish(channel, message),
          catch: (err) => new RedisError({ message: String(err), operation: "publish" })
        }),
        rpush: (key: string, value: string) => Effect.tryPromise({
          try: () => connection.rpush(key, value),
          catch: (err) => new RedisError({ message: String(err), operation: "rpush" })
        }),
        expire: (key: string, seconds: number) => Effect.tryPromise({
          try: () => connection.expire(key, seconds),
          catch: (err) => new RedisError({ message: String(err), operation: "expire" })
        }),
        lrange: (key: string, start: number, stop: number) => Effect.tryPromise({
          try: () => connection.lrange(key, start, stop),
          catch: (err) => new RedisError({ message: String(err), operation: "lrange" })
        }),
        set: (key: string, value: string, ...args: any[]) => Effect.tryPromise({
          try: () => connection.set(key, value, ...args),
          catch: (err) => new RedisError({ message: String(err), operation: "set" })
        }),
        del: (key: string) => Effect.tryPromise({
          try: () => connection.del(key),
          catch: (err) => new RedisError({ message: String(err), operation: "del" })
        }),
        get: (key: string) => Effect.tryPromise({
          try: () => connection.get(key),
          catch: (err) => new RedisError({ message: String(err), operation: "get" })
        }),
      };

      return service;
    }),
    ({ connection }) => Effect.sync(() => connection.disconnect())
  )
);
