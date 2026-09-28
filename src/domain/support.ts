import { getDb } from "../db/client.ts";
import { newId } from "./ids.ts";
import { recordAudit } from "./audit.ts";

export interface SupportCaseRow {
  id: string;
  customer_user_id: string | null;
  booking_id: string | null;
  subject: string;
  body: string;
  status: "open" | "in_progress" | "resolved";
  assigned_agent_id: string | null;
  created_at: string;
  updated_at: string;
}

export function createSupportCase(input: {
  customerUserId?: string | null;
  bookingId?: string | null;
  subject: string;
  body: string;
}): SupportCaseRow {
  const db = getDb();
  const id = newId("case");
  db.prepare(
    `INSERT INTO support_cases (id, customer_user_id, booking_id, subject, body) VALUES (?, ?, ?, ?, ?)`,
  ).run(id, input.customerUserId ?? null, input.bookingId ?? null, input.subject, input.body);
  recordAudit({ actorUserId: input.customerUserId, action: "support_case.created", targetType: "support_case", targetId: id, metadata: { bookingId: input.bookingId } });
  return db.prepare("SELECT * FROM support_cases WHERE id = ?").get(id) as SupportCaseRow;
}

export function listSupportCasesForCustomer(customerUserId: string): SupportCaseRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM support_cases WHERE customer_user_id = ? ORDER BY created_at DESC").all(customerUserId) as SupportCaseRow[];
}

export function listOpenSupportCases(): SupportCaseRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM support_cases WHERE status != 'resolved' ORDER BY created_at ASC").all() as SupportCaseRow[];
}

export function updateSupportCaseStatus(id: string, status: SupportCaseRow["status"], agentId?: string): void {
  const db = getDb();
  db.prepare("UPDATE support_cases SET status = ?, assigned_agent_id = COALESCE(?, assigned_agent_id), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, agentId ?? null, id);
  recordAudit({ actorUserId: agentId, action: "support_case.status_changed", targetType: "support_case", targetId: id, metadata: { status } });
}
