import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

// Migrations are applied by the `predev`/`prebuild` npm hooks (`drizzle-kit
// migrate`), not here. Running them as a module-load side effect caused a
// race across Next's parallel build workers, each opening the same sqlite
// file and re-applying the same migration simultaneously.
const dbPath = path.join(process.cwd(), "db", "atlas.db");

declare global {
  var __atlasSqlite: Database.Database | undefined;
}

const sqlite = globalThis.__atlasSqlite ?? new Database(dbPath);
if (process.env.NODE_ENV !== "production") globalThis.__atlasSqlite = sqlite;

sqlite.pragma("journal_mode = WAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite, { schema });
