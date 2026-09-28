import { getDb, toJson, fromJson } from "../db/client.ts";
import { newId } from "./ids.ts";
import { recordAudit } from "./audit.ts";

export interface ClientRow {
  id: string;
  agent_id: string;
  customer_user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  preferences: string | null;
  consent_status: "not_requested" | "requested" | "granted" | "declined";
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export function createClient(input: {
  agentId: string;
  fullName: string;
  email?: string;
  phone?: string;
  preferences?: Record<string, unknown>;
  notes?: string;
}): ClientRow {
  const db = getDb();
  const id = newId("client");
  db.prepare(
    `INSERT INTO clients (id, agent_id, full_name, email, phone, preferences, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.agentId, input.fullName, input.email ?? null, input.phone ?? null, input.preferences ? toJson(input.preferences) : null, input.notes ?? null);
  recordAudit({ actorUserId: input.agentId, actorRole: "agent", action: "client.created", targetType: "client", targetId: id });
  return getClient(id)!;
}

export function getClient(id: string): ClientRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(id) as ClientRow | undefined;
}

export function listClientsForAgent(agentId: string): ClientRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM clients WHERE agent_id = ? ORDER BY updated_at DESC").all(agentId) as ClientRow[];
}

export function updateClientConsent(id: string, status: ClientRow["consent_status"], actorUserId: string): void {
  const db = getDb();
  db.prepare("UPDATE clients SET consent_status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, id);
  recordAudit({ actorUserId, action: "client.consent_updated", targetType: "client", targetId: id, metadata: { status } });
}

export function preferencesOf(row: ClientRow): Record<string, unknown> {
  return fromJson(row.preferences, {});
}
