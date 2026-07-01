import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

/**
 * Drizzle client backed by node-postgres, configured from `DATABASE_URL`.
 * Consumed by adapters (e.g. `wyceny-drizzle.ts`) — never by `domain/` (F-10).
 */
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Copy .env.example to .env and start Postgres via `docker compose up -d`.",
  );
}

export const pool = new Pool({ connectionString });

export const db = drizzle(pool, { schema });
