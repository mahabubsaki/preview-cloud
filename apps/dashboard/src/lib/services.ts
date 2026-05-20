import { Layer } from "effect";
import {
  DatabaseService,
  DatabaseServiceLive as CreateDatabaseServiceLive,
  type DbClient,
  RedisService,
  RedisServiceLive,
  QueueService,
  QueueServiceLive,
  CryptoService,
  CryptoServiceLive
} from "@github-app/core";

export {
  DatabaseService,
  type DbClient,
  RedisService,
  RedisServiceLive,
  QueueService,
  QueueServiceLive,
  CryptoService,
  CryptoServiceLive
};

const DATABASE_URL =
  process.env.DATABASE_URL ||
  "postgres://preview_user:preview_pass_99@localhost:15432/github_app_deployments";

export const DatabaseServiceLive = CreateDatabaseServiceLive(DATABASE_URL);

// ─── Composed Layer ──────────────────────────────────────────

export const DashboardLayer = Layer.mergeAll(
  DatabaseServiceLive,
  QueueServiceLive.pipe(Layer.provide(RedisServiceLive)),
  RedisServiceLive,
  CryptoServiceLive
);
