import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import type { Ctx } from "./context.ts";
import { ROOT_DIR } from "../config.ts";

const PUBLIC_DIR = resolve(ROOT_DIR, "public");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".webmanifest": "application/manifest+json",
};

/** Serves a file from /public if the path resolves safely within it.
 * Returns true if the request was handled. */
export function tryServeStatic(ctx: Ctx): boolean {
  if (ctx.method !== "GET" && ctx.method !== "HEAD") return false;
  const safePath = normalize(ctx.pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  if (!filePath.startsWith(PUBLIC_DIR)) return false;
  if (!existsSync(filePath) || !statSync(filePath).isFile()) return false;
  const ext = extname(filePath);
  const mime = MIME[ext] ?? "application/octet-stream";
  ctx.res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=300" });
  if (ctx.method === "HEAD") {
    ctx.res.end();
  } else {
    createReadStream(filePath).pipe(ctx.res);
  }
  return true;
}
