import type { IncomingMessage } from "node:http";

const MAX_BODY_BYTES = 2 * 1024 * 1024; // 2MB is plenty for this app's forms/JSON

export async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new Error("Request body too large");
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const method = req.method ?? "GET";
  if (method !== "POST" && method !== "PUT" && method !== "DELETE" && method !== "PATCH") return {};
  const contentType = req.headers["content-type"] ?? "";
  const raw = await readRawBody(req);
  if (!raw) return {};
  if (contentType.includes("application/json")) {
    try {
      const parsed = JSON.parse(raw);
      return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  if (contentType.includes("application/x-www-form-urlencoded")) {
    const params = new URLSearchParams(raw);
    const out: Record<string, unknown> = {};
    for (const key of new Set(params.keys())) {
      const values = params.getAll(key);
      out[key] = values.length > 1 ? values : values[0];
    }
    return out;
  }
  return {};
}
