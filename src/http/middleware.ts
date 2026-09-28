import type { Ctx } from "./context.ts";
import { getSessionByToken, findUserById } from "../domain/auth.ts";

export const SESSION_COOKIE = "tyjen_session";

export function attachSession(ctx: Ctx): void {
  const token = ctx.cookies[SESSION_COOKIE];
  if (!token) return;
  const session = getSessionByToken(token);
  if (!session) return;
  const user = findUserById(session.user_id);
  if (!user || user.status !== "active") return;
  ctx.session = session;
  ctx.user = user;
}
