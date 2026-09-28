// Auth + RBAC tests: password hashing, session issuance/expiry/revocation,
// and the authorization gates that decide who can act as an agent or touch
// another agent's client records. Uses a throwaway SQLite file per test
// file (node:test runs each file in its own process, so this does not
// collide with other test files or the app's real dev database).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "tyjen-test-auth-")), "test.db");
process.env.SESSION_SECRET = "test-only-secret";
process.env.NODE_ENV = "test";

// Dynamic imports: everything under src/ eventually imports src/config.ts,
// which reads process.env.DATABASE_FILE at import time. A static import
// here would be hoisted above the process.env assignment above, so the app
// would pick up the real dev database instead of this test's temp file.
const { runMigrations, getDb, toJson } = await import("../src/db/client.ts");
runMigrations();

const {
  hashPassword,
  verifyPassword,
  createUser,
  findUserByEmail,
  createSession,
  getSessionByToken,
  revokeSession,
  revokeAllSessionsForUser,
  listActiveSessions,
} = await import("../src/domain/auth.ts");

const { requireAuthorizedAgent, assertAgentOwnsClient, ForbiddenError, UnauthorizedError, requireUser } = await import(
  "../src/domain/rbac.ts"
);
const { createClient } = await import("../src/domain/clients.ts");

test("hashPassword/verifyPassword round-trip and reject wrong passwords", () => {
  const stored = hashPassword("correct horse battery staple");
  assert.equal(verifyPassword("correct horse battery staple", stored), true);
  assert.equal(verifyPassword("wrong password", stored), false);
});

test("verifyPassword rejects a malformed stored hash instead of throwing", () => {
  assert.equal(verifyPassword("anything", "not-a-real-hash"), false);
});

test("createUser defaults every role to an active account (agent gating is a separate flag)", () => {
  const traveler = createUser({ email: `traveler-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "T. Raveler" });
  assert.equal(traveler.status, "active");
  const agent = createUser({ email: `agent-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "A. Gent" });
  // A pending agent must still be able to log in at all -- it is
  // agent_profiles.authorized (tested below) that gates agent features,
  // not users.status. Regression test for the bug where new agents
  // defaulted to status "pending_approval" and could not sign in.
  assert.equal(agent.status, "active");
});

test("findUserByEmail is case-insensitive", () => {
  const email = `CaseTest-${Date.now()}@Example.com`;
  createUser({ email, password: "password123", role: "traveler", displayName: "Case Test" });
  const found = findUserByEmail(email.toLowerCase());
  assert.ok(found);
  const foundMixedCase = findUserByEmail(email.toUpperCase());
  assert.ok(foundMixedCase);
  assert.equal(found!.id, foundMixedCase!.id);
});

test("session lifecycle: issue, look up by token, expire on revoke", () => {
  const user = createUser({ email: `session-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "Sesh User" });
  const { token, session } = createSession(user.id, { deviceLabel: "Desktop #1", ip: "127.0.0.1" });

  const found = getSessionByToken(token);
  assert.ok(found, "a freshly created session must be found by its token");
  assert.equal(found!.id, session.id);

  revokeSession(session.id);
  assert.equal(getSessionByToken(token), undefined, "a revoked session must no longer authenticate");
});

test("revokeAllSessionsForUser kills every device session for that user at once (admin 'sign out everywhere')", () => {
  const user = createUser({ email: `multidesktop-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "Multi Desktop" });
  const s1 = createSession(user.id, { deviceLabel: "Desktop #1" });
  const s2 = createSession(user.id, { deviceLabel: "Desktop #2" });
  assert.ok(getSessionByToken(s1.token));
  assert.ok(getSessionByToken(s2.token));

  revokeAllSessionsForUser(user.id);

  assert.equal(getSessionByToken(s1.token), undefined);
  assert.equal(getSessionByToken(s2.token), undefined);
});

test("a session past its expiry is treated as invalid even without explicit revocation", () => {
  const user = createUser({ email: `expired-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "Expired User" });
  const { token, session } = createSession(user.id, {});
  // Backdate expires_at directly, simulating time having passed.
  getDb().prepare("UPDATE sessions SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = ?").run(session.id);
  assert.equal(getSessionByToken(token), undefined);
});

test("listActiveSessions excludes revoked and expired sessions", () => {
  const user = createUser({ email: `activelist-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "Active List" });
  const active = createSession(user.id, {});
  const revoked = createSession(user.id, {});
  revokeSession(revoked.session.id);

  const rows = listActiveSessions();
  const ids = rows.map((r) => r.id);
  assert.ok(ids.includes(active.session.id));
  assert.ok(!ids.includes(revoked.session.id));
});

test("requireUser rejects a disabled account even with an otherwise-valid session", () => {
  const user = createUser({ email: `disabled-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "Disabled User" });
  getDb().prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(user.id);
  const disabled = findUserByEmail(user.email)!;
  assert.throws(() => requireUser(disabled), ForbiddenError);
});

test("requireUser rejects when there is no signed-in user at all", () => {
  assert.throws(() => requireUser(undefined), UnauthorizedError);
});

test("requireAuthorizedAgent blocks a pending agent and allows an authorized one", () => {
  const pending = createUser({ email: `pending-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "Pending Agent" });
  getDb()
    .prepare(`INSERT INTO agent_profiles (user_id, agent_identifier, authorized, booking_permissions, commission_rate_bps) VALUES (?, ?, 0, ?, 0)`)
    .run(pending.id, `AGT-${pending.id.slice(0, 6)}`, toJson({ canBookWithTyJen: false, canCreateQuotes: true }));
  assert.throws(() => requireAuthorizedAgent(pending), ForbiddenError);

  const authorized = createUser({ email: `authorized-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "Authorized Agent" });
  getDb()
    .prepare(`INSERT INTO agent_profiles (user_id, agent_identifier, authorized, booking_permissions, commission_rate_bps) VALUES (?, ?, 1, ?, 0)`)
    .run(authorized.id, `AGT-${authorized.id.slice(0, 6)}`, toJson({ canBookWithTyJen: true, canCreateQuotes: true }));
  const { user } = requireAuthorizedAgent(authorized);
  assert.equal(user.id, authorized.id);
});

test("requireAuthorizedAgent blocks a non-agent role entirely", () => {
  const traveler = createUser({ email: `nonagent-${Date.now()}@example.com`, password: "password123", role: "traveler", displayName: "Not An Agent" });
  assert.throws(() => requireAuthorizedAgent(traveler), ForbiddenError);
});

test("assertAgentOwnsClient blocks an agent from touching another agent's client record", () => {
  const agentA = createUser({ email: `agenta-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "Agent A" });
  const agentB = createUser({ email: `agentb-${Date.now()}@example.com`, password: "password123", role: "agent", displayName: "Agent B" });
  const clientOfA = createClient({ agentId: agentA.id, fullName: "A's Client", email: "aclient@example.com" });

  // Owner can access their own client.
  assert.doesNotThrow(() => assertAgentOwnsClient(agentA.id, clientOfA.id));
  // A different agent, or a bogus/stale id, must be rejected -- this is
  // the exact scenario behind the fix in pages.trip-review.ts where an
  // unvalidated clientId from a stale form crashed with a raw SQL foreign
  // key error instead of a clean 403-equivalent rejection.
  assert.throws(() => assertAgentOwnsClient(agentB.id, clientOfA.id), ForbiddenError);
  assert.throws(() => assertAgentOwnsClient(agentA.id, "client_does_not_exist"), ForbiddenError);
});
