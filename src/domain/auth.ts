// Password hashing (scrypt, built into Node's crypto module — no bcrypt
// dependency needed) and session issuance/verification. Sessions are stored
// in the database (not just signed cookies) specifically so an admin can see
// and revoke a specific device's session (required for multi-desktop
// authorization control).
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";
import { getDb } from "../db/client.ts";
import { newId, newToken } from "./ids.ts";
import { config } from "../config.ts";

const SCRYPT_KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split(":");
  if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, salt, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token: string): string {
  return createHmac("sha256", config.sessionSecret).update(token).digest("hex");
}

export type Role = "traveler" | "agent" | "admin";

export interface UserRecord {
  id: string;
  email: string;
  password_hash: string;
  role: Role;
  display_name: string;
  phone: string | null;
  status: "active" | "disabled" | "pending_approval";
  created_at: string;
  updated_at: string;
}

export function findUserByEmail(email: string): UserRecord | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE email = ? COLLATE NOCASE").get(email) as
    | UserRecord
    | undefined;
}

export function findUserById(id: string): UserRecord | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRecord | undefined;
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: Role;
  displayName: string;
  phone?: string;
  status?: UserRecord["status"];
}

export function createUser(input: CreateUserInput): UserRecord {
  const db = getDb();
  const id = newId("user");
  db.prepare(
    `INSERT INTO users (id, email, password_hash, role, display_name, phone, status)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.email.toLowerCase(),
    hashPassword(input.password),
    input.role,
    input.displayName,
    input.phone ?? null,
    // The account itself is active immediately on signup for every role;
    // for agents, the separate `agent_profiles.authorized` flag (gated by
    // an admin) is what actually unlocks agent features. Keeping these two
    // concepts separate lets a pending agent still sign in and see a clear
    // "awaiting authorization" message instead of being unable to log in
    // at all.
    input.status ?? "active",
  );
  return findUserById(id)!;
}

export interface SessionRecord {
  id: string;
  user_id: string;
  token_hash: string;
  device_label: string | null;
  ip_address: string | null;
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function createSession(
  userId: string,
  meta: { deviceLabel?: string; ip?: string; userAgent?: string },
): { token: string; session: SessionRecord } {
  const db = getDb();
  const token = newToken();
  const id = newId("sess");
  const expiresAt = new Date(Date.now() + config.sessionTtlHours * 3600_000).toISOString();
  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, device_label, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, hashToken(token), meta.deviceLabel ?? null, meta.ip ?? null, meta.userAgent ?? null, expiresAt);
  const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRecord;
  return { token, session };
}

export function getSessionByToken(token: string): SessionRecord | undefined {
  const db = getDb();
  const hash = hashToken(token);
  const session = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(hash) as
    | SessionRecord
    | undefined;
  if (!session) return undefined;
  if (session.revoked_at) return undefined;
  if (new Date(session.expires_at).getTime() < Date.now()) return undefined;
  db.prepare("UPDATE sessions SET last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
    session.id,
  );
  return session;
}

export function revokeSession(sessionId: string): void {
  const db = getDb();
  db.prepare("UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(
    sessionId,
  );
}

export function revokeAllSessionsForUser(userId: string): void {
  const db = getDb();
  db.prepare(
    "UPDATE sessions SET revoked_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE user_id = ? AND revoked_at IS NULL",
  ).run(userId);
}

export function listSessionsForUser(userId: string): SessionRecord[] {
  const db = getDb();
  return db
    .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY last_seen_at DESC")
    .all(userId) as SessionRecord[];
}

export function listActiveSessions(): (SessionRecord & { email: string; display_name: string; role: Role })[] {
  const db = getDb();
  return db
    .prepare(
      `SELECT s.*, u.email, u.display_name, u.role FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.revoked_at IS NULL AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')
       ORDER BY s.last_seen_at DESC`,
    )
    .all() as (SessionRecord & { email: string; display_name: string; role: Role })[];
}
