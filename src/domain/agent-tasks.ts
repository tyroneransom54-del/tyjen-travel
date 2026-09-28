import { getDb } from "../db/client.ts";
import { newId } from "./ids.ts";

export interface AgentTaskRow {
  id: string;
  agent_id: string;
  client_id: string | null;
  quote_id: string | null;
  kind: "note" | "task";
  title: string;
  body: string | null;
  due_at: string | null;
  status: "open" | "done";
  created_at: string;
}

export function createAgentTask(input: {
  agentId: string;
  clientId?: string | null;
  quoteId?: string | null;
  kind: "note" | "task";
  title: string;
  body?: string;
  dueAt?: string | null;
}): AgentTaskRow {
  const db = getDb();
  const id = newId("task");
  db.prepare(
    `INSERT INTO agent_tasks (id, agent_id, client_id, quote_id, kind, title, body, due_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, input.agentId, input.clientId ?? null, input.quoteId ?? null, input.kind, input.title, input.body ?? null, input.dueAt ?? null);
  return db.prepare("SELECT * FROM agent_tasks WHERE id = ?").get(id) as AgentTaskRow;
}

export function listAgentTasks(agentId: string): AgentTaskRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM agent_tasks WHERE agent_id = ? ORDER BY (status = 'done'), due_at IS NULL, due_at ASC, created_at DESC").all(agentId) as AgentTaskRow[];
}

export function completeAgentTask(id: string, agentId: string): void {
  const db = getDb();
  db.prepare("UPDATE agent_tasks SET status = 'done' WHERE id = ? AND agent_id = ?").run(id, agentId);
}
