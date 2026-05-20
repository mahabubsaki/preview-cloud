import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export * from "./schema";

export const createDbClient = (connectionString: string) => {
  const pool = new Pool({
    connectionString,
    max: 10, // Max 10 connections for local dev
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000, // Increased for better stability
  });
  
  return {
    db: drizzle(pool, { schema }),
    pool,
  };
};