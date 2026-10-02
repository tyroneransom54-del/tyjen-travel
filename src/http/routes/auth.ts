import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { field, errorBox } from "../../views/components.ts";
import { findUserByEmail, verifyPassword, createUser, createSession, revokeSession } from "../../domain/auth.ts";
import { SESSION_COOKIE } from "../middleware.ts";
import { recordAudit } from "../../domain/audit.ts";
import { config } from "../../config.ts";
import { getDb, toJson } from "../../db/client.ts";

function homeFor(role: string): string {
  if (role === "admin") return "/admin";
  if (role === "agent") return "/agent";
  return "/";
}

export function registerAuthRoutes(router: Router) {
  router.get("/login", (ctx) => {
    if (ctx.user) return ctx.redirect(homeFor(ctx.user.role));
    const error = ctx.query.get("error");
    ctx.html(
      200,
      page(
        { title: "Sign in" },
        html`
          <div class="auth-page">
            <h1>Sign in</h1>
            <p>Use one of the seeded demo accounts, or an account you registered.</p>
            <form method="post" action="/login" class="stacked-form" novalidate>
              ${field({ label: "Email", name: "email", type: "email", required: true, autocomplete: "email" })}
              ${field({ label: "Password", name: "password", type: "password", required: true, autocomplete: "current-password" })}
              ${errorBox(error === "1" ? "That email and password don't match an active account." : null)}
              <button class="btn btn--primary" type="submit">Sign in</button>
            </form>
            <p class="auth-alt">No account? <a href="/register">Create one</a></p>
            ${config.isProduction ? "" : html`
            <details class="demo-creds">
              <summary>Demo login credentials</summary>
              <ul>
                <li><strong>Admin:</strong> ${config.seedAdminEmail} / ${config.seedAdminPassword}</li>
                <li><strong>Authorized agent:</strong> ava.agent@tyjentravel.demo / AgentDemo123!</li>
                <li><strong>Pending agent (for the approval demo):</strong> marcus.pending@tyjentravel.demo / AgentDemo123!</li>
                <li><strong>Traveler:</strong> jordan.traveler@example.com / TravelerDemo123!</li>
              </ul>
            </details>
            `}
          </div>
        `,
      ),
    );
  });

  router.post("/login", async (ctx: Ctx) => {
    const email = String(ctx.body.email ?? "").trim();
    const password = String(ctx.body.password ?? "");
    const user = findUserByEmail(email);
    if (!user || user.status !== "active" || !verifyPassword(password, user.password_hash)) {
      recordAudit({ action: "auth.login_failed", metadata: { email }, ip: ctx.ip });
      return ctx.redirect("/login?error=1");
    }
    const { token } = createSession(user.id, { ip: ctx.ip, userAgent: ctx.req.headers["user-agent"] as string | undefined, deviceLabel: guessDeviceLabel(ctx.req.headers["user-agent"] as string | undefined) });
    ctx.setCookie(SESSION_COOKIE, token, { maxAgeSeconds: config.sessionTtlHours * 3600 });
    recordAudit({ actorUserId: user.id, actorRole: user.role, action: "auth.login_succeeded", ip: ctx.ip });
    ctx.redirect(homeFor(user.role));
  });

  router.post("/logout", (ctx: Ctx) => {
    if (ctx.session) {
      revokeSession(ctx.session.id);
      recordAudit({ actorUserId: ctx.user?.id, action: "auth.logout", ip: ctx.ip });
    }
    ctx.clearCookie(SESSION_COOKIE);
    ctx.redirect("/login");
  });
  // Convenience: also accept GET for the nav link without needing a JS-submitted form.
  router.get("/logout", (ctx: Ctx) => {
    if (ctx.session) revokeSession(ctx.session.id);
    ctx.clearCookie(SESSION_COOKIE);
    ctx.redirect("/login");
  });

  router.get("/register", (ctx) => {
    if (ctx.user) return ctx.redirect(homeFor(ctx.user.role));
    const error = ctx.query.get("error");
    const role = ctx.query.get("role") === "agent" ? "agent" : "traveler";
    ctx.html(
      200,
      page(
        { title: "Create account" },
        html`
          <div class="auth-page">
            <h1>Create your account</h1>
            <div class="role-toggle" role="tablist" aria-label="Account type">
              <a role="tab" aria-selected="${role === "traveler" ? "true" : "false"}" class="role-toggle__option${role === "traveler" ? " role-toggle__option--active" : ""}" href="/register?role=traveler">I'm a traveler</a>
              <a role="tab" aria-selected="${role === "agent" ? "true" : "false"}" class="role-toggle__option${role === "agent" ? " role-toggle__option--active" : ""}" href="/register?role=agent">I'm an independent contractor agent</a>
            </div>
            <form method="post" action="/register" class="stacked-form" novalidate>
              <input type="hidden" name="role" value="${role}" />
              ${field({ label: "Full name", name: "displayName", required: true, autocomplete: "name" })}
              ${field({ label: "Email", name: "email", type: "email", required: true, autocomplete: "email" })}
              ${field({ label: "Password", name: "password", type: "password", required: true, autocomplete: "new-password", help: "At least 8 characters." })}
              ${role === "agent" ? html`<p class="field-help">Agent accounts require authorization from an agency administrator before you can search on behalf of clients or create quotes. You'll be able to sign in immediately, but most agent features stay locked until approved.</p>` : html``}
              ${errorBox(error === "exists" ? "An account with that email already exists." : error === "weak" ? "Please use a password with at least 8 characters." : null)}
              <button class="btn btn--primary" type="submit">Create account</button>
            </form>
          </div>
        `,
      ),
    );
  });

  router.post("/register", async (ctx: Ctx) => {
    const email = String(ctx.body.email ?? "").trim().toLowerCase();
    const password = String(ctx.body.password ?? "");
    const displayName = String(ctx.body.displayName ?? "").trim();
    const role = ctx.body.role === "agent" ? "agent" : "traveler";
    if (!email || !displayName) return ctx.redirect(`/register?role=${role}&error=1`);
    if (password.length < 8) return ctx.redirect(`/register?role=${role}&error=weak`);
    if (findUserByEmail(email)) return ctx.redirect(`/register?role=${role}&error=exists`);
    const user = createUser({ email, password, displayName, role });
    if (role === "agent") {
      getDb()
        .prepare(
          `INSERT INTO agent_profiles (user_id, agent_identifier, authorized, booking_permissions, commission_rate_bps) VALUES (?, ?, 0, ?, 0)`,
        )
        .run(user.id, `AGT-${Math.floor(1000 + Math.random() * 9000)}`, toJson({ canBookWithTyJen: false, canCreateQuotes: true }));
    }
    recordAudit({ actorUserId: user.id, actorRole: user.role, action: "auth.registered", ip: ctx.ip });
    const { token } = createSession(user.id, { ip: ctx.ip, userAgent: ctx.req.headers["user-agent"] as string | undefined });
    ctx.setCookie(SESSION_COOKIE, token, { maxAgeSeconds: config.sessionTtlHours * 3600 });
    ctx.redirect(homeFor(user.role));
  });
}

function guessDeviceLabel(ua: string | undefined): string {
  if (!ua) return "Unknown device";
  if (/Windows/i.test(ua)) return "Windows desktop";
  if (/Macintosh/i.test(ua)) return "Mac desktop";
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/Android/i.test(ua)) return "Android device";
  return "Browser";
}
