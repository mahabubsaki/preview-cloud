import { Context, Effect, Layer } from "effect";
import { createDbClient } from "../db/index";

export type DbClient = ReturnType<typeof createDbClient>;

export interface DatabaseService {
  readonly db: DbClient["db"];
  readonly pool: DbClient["pool"];
}

export const DatabaseService = Context.GenericTag<DatabaseService>("@github-app/core/DatabaseService");

export const DatabaseServiceLive = (url?: string) => 
  Layer.effect(
    DatabaseService,
    Effect.gen(function* () {
      const dbUrl = url || process.env.DATABASE_URL;
      if (!dbUrl) {
        return yield* Effect.die(new Error("DATABASE_URL is not defined"));
      }
      const client = createDbClient(dbUrl);
      yield* Effect.log("✅ Database service initialized");
      return client;
    })
  );
