// Minimal, dependency-free ".env" loader (equivalent to the common `dotenv`
// package) so the project has zero npm dependencies at runtime.
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function parseEnvFile(contents: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function loadEnv(rootDir: string): void {
  const envPath = resolve(rootDir, ".env");
  if (existsSync(envPath)) {
    const parsed = parseEnvFile(readFileSync(envPath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
  const examplePath = resolve(rootDir, ".env.example");
  if (!existsSync(envPath) && existsSync(examplePath)) {
    // Fall back to .env.example defaults so `npm run dev` works out of the
    // box for the demo, while still warning loudly that this is not safe
    // for a real deployment.
    const parsed = parseEnvFile(readFileSync(examplePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value;
    }
    // eslint-disable-next-line no-console
    console.warn(
      "[env] No .env file found — running with defaults from .env.example. " +
        "Copy .env.example to .env and set real secrets before deploying.",
    );
  }
}

export function required(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

export function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export function bool(name: string, fallback: boolean): boolean {
  const v = process.env[name];
  if (v === undefined) return fallback;
  return v.toLowerCase() === "true" || v === "1";
}

export function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (v === undefined) return fallback;
  const n = Number.parseInt(v, 10);
  return Number.isNaN(n) ? fallback : n;
}
