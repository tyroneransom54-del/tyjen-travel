// Centralized authorization checks. Every route handler that touches
// sensitive data calls one of these instead of re-implementing the logic,
// so the access rules live in exactly one place and are unit-testable.
import { getDb } from "../db/client.ts";
import type { UserRecord, Role } from "./auth.ts";

export class ForbiddenError extends Error {
  status = 403;
}
export class UnauthorizedError extends Error {
  status = 401;
}

export function requireUser(user: UserRecord | undefined): UserRecord {
  if (!user) throw new UnauthorizedError("Sign in required");
  if (user.status !== "active") throw new ForbiddenError("Account is not active");
  return user;
}

export function requireRole(user: UserRecord | undefined, ...roles: Role[]): UserRecord {
  const u = requireUser(user);
  if (!roles.includes(u.role)) throw new ForbiddenError(`Requires role: ${roles.join(" or ")}`);
  return u;
}

export interface AgentProfileRow {
  user_id: string;
  agent_identifier: string;
  authorized: number;
  booking_permissions: string;
  commission_rate_bps: number;
  bio: string | null;
  authorized_at: string | null;
  authorized_by_user_id: string | null;
  created_at: string;
}

export function getAgentProfile(userId: string): AgentProfileRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM agent_profiles WHERE user_id = ?").get(userId) as
    | AgentProfileRow
    | undefined;
}

/** An agent must be explicitly authorized by an admin before they can act as
 * an agent anywhere in the app (search on behalf of clients, build quotes,
 * touch bookings). Pending/disabled agents are blocked here, centrally. */
export function requireAuthorizedAgent(user: UserRecord | undefined): {
  user: UserRecord;
  profile: AgentProfileRow;
} {
  const u = requireRole(user, "agent");
  const profile = getAgentProfile(u.id);
  if (!profile || !profile.authorized) {
    throw new ForbiddenError("Your agent account is awaiting authorization from an agency administrator.");
  }
  return { user: u, profile };
}

/** Agents may only access client records they created / are assigned to. */
export function assertAgentOwnsClient(agentId: string, clientId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT agent_id FROM clients WHERE id = ?").get(clientId) as
    | { agent_id: string }
    | undefined;
  if (!row || row.agent_id !== agentId) {
    throw new ForbiddenError("You are not authorized to access this client record.");
  }
}

/** A customer may only see their own quotes/bookings. */
export function assertCustomerOwnsQuote(customerUserId: string, quoteId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT customer_user_id FROM quotes WHERE id = ?").get(quoteId) as
    | { customer_user_id: string | null }
    | undefined;
  if (!row || row.customer_user_id !== customerUserId) {
    throw new ForbiddenError("You are not authorized to access this quote.");
  }
}

export function assertCustomerOwnsBooking(customerUserId: string, bookingId: string): void {
  const db = getDb();
  const row = db.prepare("SELECT customer_user_id FROM bookings WHERE id = ?").get(bookingId) as
    | { customer_user_id: string | null }
    | undefined;
  if (!row || row.customer_user_id !== customerUserId) {
    throw new ForbiddenError("You are not authorized to access this booking.");
  }
}
