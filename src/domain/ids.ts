import { randomUUID, randomBytes } from "node:crypto";

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

export function newToken(bytes = 32): string {
  return randomBytes(bytes).toString("hex");
}
