// Thin wrapper around Node's built-in node:sqlite (stable in Node 22+, no
// npm dependency required). A single shared database file backs every
// authorized browser/device that talks to this one running server process,
// which is what keeps information consistent across desktops (per the
// product requirement of one central database, not per-device state).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { config, ROOT_DIR } from "../config.ts";

/**
 * node:sqlite's own types return `Record<string, SQLOutputValue>` from
 * statement.get()/.all(), which (correctly, in general) refuses a direct
 * cast to this app's specific row interfaces. Every call site in this
 * codebase already declares the exact shape it expects for a hand-written
 * query against our own schema, so we deliberately loosen the statement
 * return types to `any` at this one boundary rather than sprinkling
 * `as unknown as X` across ~40 call sites. Runtime behavior is unaffected;
 * only the static type-checking convenience changes.
 */
export interface LooseStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): any;
  all(...params: unknown[]): any[];
}
export interface LooseDb {
  prepare(sql: string): LooseStatement;
  exec(sql: string): void;
  close(): void;
}

let dbInstance: DatabaseSync | undefined;

export function getDb(): LooseDb {
  if (dbInstance) return dbInstance as unknown as LooseDb;
  const dir = dirname(config.databaseFile);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  dbInstance = new DatabaseSync(config.databaseFile);
  dbInstance.exec("PRAGMA foreign_keys = ON;");
  dbInstance.exec("PRAGMA journal_mode = WAL;");
  return dbInstance as unknown as LooseDb;
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = undefined;
  }
}

const MIGRATIONS_DIR = resolve(ROOT_DIR, "src/db/migrations");

/** Applies any migration .sql files that have not yet been recorded as run. */
export function runMigrations(db: LooseDb = getDb()): string[] {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
  `);
  const already = new Set(
    db.prepare("SELECT filename FROM schema_migrations").all().map((r) => (r as { filename: string }).filename),
  );
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const applied: string[] = [];
  for (const file of files) {
    if (already.has(file)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    db.exec("BEGIN");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (filename) VALUES (?)").run(file);
      db.exec("COMMIT");
      applied.push(file);
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
    }
  }
  return applied;
}

/** JSON helpers so callers don't sprinkle JSON.parse/stringify everywhere. */
export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}
export function fromJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
