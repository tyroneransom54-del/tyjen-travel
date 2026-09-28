import type { IncomingMessage, ServerResponse } from "node:http";
import { config } from "../config.ts";
import type { SessionRecord, UserRecord } from "../domain/auth.ts";

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  method: string;
  pathname: string;
  query: URLSearchParams;
  params: Record<string, string>;
  cookies: Record<string, string>;
  body: Record<string, unknown>;
  user?: UserRecord;
  session?: SessionRecord;
  flash?: string;
  ip: string;

  html(status: number, body: string): void;
  json(status: number, body: unknown): void;
  redirect(location: string, status?: number): void;
  setCookie(name: string, value: string, opts?: { maxAgeSeconds?: number; httpOnly?: boolean }): void;
  clearCookie(name: string): void;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function buildCtx(req: IncomingMessage, res: ServerResponse): Ctx {
  const url = new URL(req.url ?? "/", "http://internal");
  const cookies = parseCookies(req.headers.cookie);
  const cookieHeaders: string[] = [];
  const ip = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress || "unknown";

  const ctx: Ctx = {
    req,
    res,
    method: req.method ?? "GET",
    pathname: url.pathname,
    query: url.searchParams,
    params: {},
    cookies,
    body: {},
    ip,
    html(status, body) {
      applyCookies();
      res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    },
    json(status, body) {
      applyCookies();
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      res.end(JSON.stringify(body));
    },
    redirect(location, status = 303) {
      applyCookies();
      res.writeHead(status, { Location: location });
      res.end();
    },
    setCookie(name, value, opts) {
      const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", "SameSite=Lax"];
      if (opts?.httpOnly !== false) parts.push("HttpOnly");
      if (config.cookieSecure) parts.push("Secure");
      if (opts?.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
      cookieHeaders.push(parts.join("; "));
    },
    clearCookie(name) {
      cookieHeaders.push(`${name}=; Path=/; Max-Age=0`);
    },
  };

  function applyCookies() {
    if (cookieHeaders.length > 0) {
      res.setHeader("Set-Cookie", cookieHeaders);
    }
  }

  return ctx;
}
