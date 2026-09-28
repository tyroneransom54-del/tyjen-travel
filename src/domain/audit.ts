import { getDb, toJson } from "../db/client.ts";
import { newId } from "./ids.ts";
import type { Role } from "./auth.ts";

export function recordAudit(entry: {
  actorUserId?: string | null;
  actorRole?: Role | "system" | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: unknown;
  ip?: string | null;
}): void {
  const db = getDb();
  db.prepare(
    `INSERT INTO audit_log (id, actor_user_id, actor_role, action, target_type, target_id, metadata, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("audit"),
    entry.actorUserId ?? null,
    entry.actorRole ?? null,
    entry.action,
    entry.targetType ?? null,
    entry.targetId ?? null,
    entry.metadata !== undefined ? toJson(entry.metadata) : null,
    entry.ip ?? null,
  );
}

export interface AuditRow {
  id: string;
  actor_user_id: string | null;
  actor_role: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  metadata: string | null;
  ip_address: string | null;
  created_at: string;
}

export function listAuditLog(limit = 200): AuditRow[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM audit_log ORDER BY created_at DESC LIMIT ?")
    .all(limit) as AuditRow[];
}
