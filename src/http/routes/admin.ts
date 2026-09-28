import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { field } from "../../views/components.ts";
import { requireRole } from "../../domain/rbac.ts";
import { getDb, toJson } from "../../db/client.ts";
import { listActiveSessions, revokeSession, revokeAllSessionsForUser } from "../../domain/auth.ts";
import { listAuditLog } from "../../domain/audit.ts";
import { listSupplierConnections, upsertConnection } from "../../adapters/registry.ts";
import { getAgencySettings, updateAgencySettings } from "../../domain/agency.ts";
import { listOpenSupportCases, updateSupportCaseStatus } from "../../domain/support.ts";
import { listAllBookings } from "../../domain/bookings.ts";
import { newId } from "../../domain/ids.ts";
import type { ProductType, SupplierStatus } from "../../adapters/types.ts";

interface AgentRow {
  user_id: string;
  agent_identifier: string;
  authorized: number;
  commission_rate_bps: number;
  bio: string | null;
  email: string;
  display_name: string;
  status: string;
}

export function registerAdminRoutes(router: Router) {
  router.get("/admin", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const db = getDb();
    const agentCount = (db.prepare("SELECT COUNT(*) c FROM agent_profiles").get() as { c: number }).c;
    const pendingCount = (db.prepare("SELECT COUNT(*) c FROM agent_profiles WHERE authorized = 0").get() as { c: number }).c;
    const bookings = listAllBookings();
    const confirmed = bookings.filter((b) => b.status === "confirmed").length;
    const failed = bookings.filter((b) => ["payment_failed", "supplier_failed", "voided"].includes(b.status)).length;
    const openSupport = listOpenSupportCases().length;

    ctx.html(
      200,
      page({ title: "Admin dashboard", user: ctx.user, activeNav: "dashboard" }, html`
        <h1>Agency administration</h1>
        <div class="stat-grid">
          <div class="stat-card"><strong>${agentCount}</strong><span>Agents</span></div>
          <div class="stat-card"><strong>${pendingCount}</strong><span>Pending authorization</span></div>
          <div class="stat-card"><strong>${confirmed}</strong><span>Confirmed bookings</span></div>
          <div class="stat-card"><strong>${failed}</strong><span>Failed/voided bookings</span></div>
          <div class="stat-card"><strong>${openSupport}</strong><span>Open support cases</span></div>
        </div>
        <p>Use the navigation above to manage agents, supplier connections, active sessions, the audit log, agency disclosures, and support.</p>
      `),
    );
  });

  router.get("/admin/agents", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const db = getDb();
    const agents = db
      .prepare(`SELECT ap.*, u.email, u.display_name, u.status FROM agent_profiles ap JOIN users u ON u.id = ap.user_id ORDER BY ap.authorized ASC, ap.created_at DESC`)
      .all() as AgentRow[];

    ctx.html(
      200,
      page({ title: "Agents", user: ctx.user, activeNav: "agents" }, html`
        <h1>Agents</h1>
        <table class="admin-table">
          <thead><tr><th>Name</th><th>Email</th><th>Agent ID</th><th>Commission</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>
            ${joinHtml(
              agents.map(
                (a) => html`
                  <tr>
                    <td>${a.display_name}</td>
                    <td>${a.email}</td>
                    <td>${a.agent_identifier}</td>
                    <td>${(a.commission_rate_bps / 100).toFixed(2)}%</td>
                    <td>${a.authorized ? "Authorized" : "Pending"} ${a.status === "disabled" ? "(account disabled)" : ""}</td>
                    <td>
                      ${a.authorized
                        ? html`<form method="post" action="/admin/agents/${a.user_id}/disable" style="display:inline"><button class="btn-link" type="submit">Revoke authorization</button></form>`
                        : html`<form method="post" action="/admin/agents/${a.user_id}/authorize" style="display:inline"><button class="btn-link" type="submit">Authorize</button></form>`}
                      ${a.status === "active" ? html`<form method="post" action="/admin/agents/${a.user_id}/deactivate" style="display:inline"><button class="btn-link" type="submit">Disable account</button></form>` : html`<form method="post" action="/admin/agents/${a.user_id}/activate" style="display:inline"><button class="btn-link" type="submit">Reactivate</button></form>`}
                    </td>
                  </tr>
                `,
              ),
            )}
          </tbody>
        </table>
      `),
    );
  });

  router.post("/admin/agents/:userId/authorize", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    const db = getDb();
    db.prepare("UPDATE agent_profiles SET authorized = 1, authorized_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), authorized_by_user_id = ? WHERE user_id = ?").run(admin.id, ctx.params.userId!);
    db.prepare("UPDATE users SET status = 'active' WHERE id = ? AND status = 'pending_approval'").run(ctx.params.userId!);
    logAdmin(admin.id, "agent.authorized", ctx.params.userId!);
    ctx.redirect("/admin/agents");
  });

  router.post("/admin/agents/:userId/disable", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    getDb().prepare("UPDATE agent_profiles SET authorized = 0 WHERE user_id = ?").run(ctx.params.userId!);
    revokeAllSessionsForUser(ctx.params.userId!);
    logAdmin(admin.id, "agent.authorization_revoked", ctx.params.userId!);
    ctx.redirect("/admin/agents");
  });

  router.post("/admin/agents/:userId/deactivate", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    getDb().prepare("UPDATE users SET status = 'disabled' WHERE id = ?").run(ctx.params.userId!);
    revokeAllSessionsForUser(ctx.params.userId!);
    logAdmin(admin.id, "agent.account_disabled", ctx.params.userId!);
    ctx.redirect("/admin/agents");
  });

  router.post("/admin/agents/:userId/activate", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    getDb().prepare("UPDATE users SET status = 'active' WHERE id = ?").run(ctx.params.userId!);
    logAdmin(admin.id, "agent.account_reactivated", ctx.params.userId!);
    ctx.redirect("/admin/agents");
  });

  router.get("/admin/sessions", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const sessions = listActiveSessions();
    ctx.html(
      200,
      page({ title: "Active sessions", user: ctx.user, activeNav: "sessions" }, html`
        <h1>Active sessions</h1>
        <p>Every signed-in browser/device currently holding a valid session, across every authorized desktop.</p>
        <table class="admin-table">
          <thead><tr><th>User</th><th>Role</th><th>Device</th><th>IP</th><th>Last seen</th><th></th></tr></thead>
          <tbody>
            ${joinHtml(
              sessions.map(
                (s) => html`
                  <tr>
                    <td>${s.display_name} (${s.email})</td>
                    <td>${s.role}</td>
                    <td>${s.device_label ?? "Unknown"}</td>
                    <td>${s.ip_address ?? "n/a"}</td>
                    <td>${new Date(s.last_seen_at).toLocaleString()}</td>
                    <td><form method="post" action="/admin/sessions/${s.id}/revoke"><button class="btn-link" type="submit">Revoke</button></form></td>
                  </tr>
                `,
              ),
            )}
          </tbody>
        </table>
      `),
    );
  });

  router.post("/admin/sessions/:id/revoke", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    revokeSession(ctx.params.id!);
    logAdmin(admin.id, "session.revoked", ctx.params.id!);
    ctx.redirect("/admin/sessions");
  });

  router.get("/admin/suppliers", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const connections = listSupplierConnections();
    const productTypes: ProductType[] = ["flights", "stays", "packages", "cruises", "cars", "activities", "rail"];
    ctx.html(
      200,
      page({ title: "Supplier connections", user: ctx.user, activeNav: "suppliers" }, html`
        <h1>Supplier connections</h1>
        <p>These settings honestly drive what the customer- and agent-facing search screens show. See ADAPTERS.md for what each live integration would require before flipping it to "live".</p>
        <table class="admin-table">
          <thead><tr><th>Product</th><th>Supplier</th><th>Status</th><th>Can book with TyJen</th><th>Notes</th></tr></thead>
          <tbody>
            ${joinHtml(
              connections.map((c) => {
                const statusOptions = ["not_connected", "demo", "sandbox", "live"]
                  .map((s) => html`<option value="${s}" ${s === c.status ? raw("selected") : raw("")}>${s}</option>`)
                  .reduce((a, b) => html`${a}${b}`, html``);
                return html`
                  <tr>
                    <td>${c.product_type}</td>
                    <td>${c.supplier_name}</td>
                    <td>
                      <form method="post" action="/admin/suppliers/${c.id}/update" class="inline-form">
                        <input type="hidden" name="productType" value="${c.product_type}" />
                        <input type="hidden" name="supplierName" value="${c.supplier_name}" />
                        <input type="hidden" name="canBookWithTyjen" value="${c.can_book_with_tyjen ? "1" : "0"}" />
                        <input type="hidden" name="notes" value="${c.notes ?? ""}" />
                        <select name="status" onchange="this.form.submit()">${statusOptions}</select>
                      </form>
                    </td>
                    <td>
                      <form method="post" action="/admin/suppliers/${c.id}/update" class="inline-form">
                        <input type="hidden" name="productType" value="${c.product_type}" />
                        <input type="hidden" name="supplierName" value="${c.supplier_name}" />
                        <input type="hidden" name="status" value="${c.status}" />
                        <input type="hidden" name="notes" value="${c.notes ?? ""}" />
                        <input type="checkbox" name="canBookWithTyjen" value="1" ${c.can_book_with_tyjen ? raw("checked") : raw("")} onchange="this.form.submit()" />
                      </form>
                    </td>
                    <td>
                      <form method="post" action="/admin/suppliers/${c.id}/update" class="inline-form">
                        <input type="hidden" name="productType" value="${c.product_type}" />
                        <input type="hidden" name="supplierName" value="${c.supplier_name}" />
                        <input type="hidden" name="status" value="${c.status}" />
                        <input type="hidden" name="canBookWithTyjen" value="${c.can_book_with_tyjen ? "1" : "0"}" />
                        <input type="text" name="notes" value="${c.notes ?? ""}" onblur="this.form.submit()" />
                      </form>
                    </td>
                  </tr>
                `;
              }),
            )}
          </tbody>
        </table>
        <p class="field-help">Product types with no row yet (rare) default to "not connected" automatically.</p>
      `),
    );
  });

  router.post("/admin/suppliers/:id/update", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    upsertConnection(
      ctx.body.productType as ProductType,
      String(ctx.body.supplierName ?? "Unnamed supplier"),
      (ctx.body.status as SupplierStatus) ?? "not_connected",
      ctx.body.canBookWithTyjen === "1",
      (ctx.body.notes as string) || null,
      admin.id,
    );
    logAdmin(admin.id, "supplier_connection.updated", ctx.params.id!, { productType: ctx.body.productType, status: ctx.body.status });
    ctx.redirect("/admin/suppliers");
  });

  router.get("/admin/audit-log", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const rows = listAuditLog(300);
    ctx.html(
      200,
      page({ title: "Audit log", user: ctx.user, activeNav: "audit" }, html`
        <h1>Audit log</h1>
        <table class="admin-table">
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            ${joinHtml(
              rows.map(
                (r) => html`
                  <tr>
                    <td>${new Date(r.created_at).toLocaleString()}</td>
                    <td>${r.actor_user_id ?? "system"} ${r.actor_role ? `(${r.actor_role})` : ""}</td>
                    <td>${r.action}</td>
                    <td>${r.target_type ?? ""} ${r.target_id ?? ""}</td>
                    <td><code>${r.metadata ?? ""}</code></td>
                  </tr>
                `,
              ),
            )}
          </tbody>
        </table>
      `),
    );
  });

  router.get("/admin/support", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const cases = listOpenSupportCases();
    ctx.html(
      200,
      page({ title: "Support queue", user: ctx.user, activeNav: "support" }, html`
        <h1>Support queue</h1>
        ${cases.length === 0
          ? html`<p>No open support cases.</p>`
          : html`
              <div class="booking-list">
                ${joinHtml(
                  cases.map(
                    (c) => html`
                      <div class="booking-list__item">
                        <div><strong>${c.subject}</strong><div class="field-help">${c.body}</div></div>
                        <form method="post" action="/admin/support/${c.id}/resolve"><button class="btn-link" type="submit">Mark resolved</button></form>
                      </div>
                    `,
                  ),
                )}
              </div>
            `}
      `),
    );
  });

  router.post("/admin/support/:id/resolve", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    updateSupportCaseStatus(ctx.params.id!, "resolved", admin.id);
    ctx.redirect("/admin/support");
  });

  router.get("/admin/agency-settings", (ctx: Ctx) => {
    requireRole(ctx.user, "admin");
    const settings = getAgencySettings();
    ctx.html(
      200,
      page({ title: "Agency settings", user: ctx.user, activeNav: "agency" }, html`
        <h1>Host agency settings</h1>
        <p>These values drive the disclosures shown across the customer- and agent-facing site. TyJen Travel does not assume ticketing authority unless explicitly enabled here.</p>
        <form method="post" action="/admin/agency-settings" class="stacked-form">
          ${field({ label: "Host agency name", name: "host_agency_name", value: settings.host_agency_name, required: true })}
          ${field({ label: "Host agency identifier (IATA/ARC/CLIA number)", name: "host_agency_identifier", value: settings.host_agency_identifier })}
          <label class="checkbox"><input type="checkbox" name="has_ticketing_authority" value="1" ${settings.has_ticketing_authority ? raw("checked") : raw("")} /> This agency holds ticketing authority for connected suppliers</label>
          ${field({ label: "Support phone", name: "support_phone", value: settings.support_phone ?? "" })}
          ${field({ label: "Support email", name: "support_email", value: settings.support_email ?? "" })}
          <div class="field"><label for="required_disclosures">Required disclosures (shown in the footer)</label><textarea id="required_disclosures" name="required_disclosures" rows="4">${settings.required_disclosures ?? ""}</textarea></div>
          <button class="btn btn--primary" type="submit">Save</button>
        </form>
      `),
    );
  });

  router.post("/admin/agency-settings", (ctx: Ctx) => {
    const admin = requireRole(ctx.user, "admin");
    updateAgencySettings({
      host_agency_name: String(ctx.body.host_agency_name ?? ""),
      host_agency_identifier: String(ctx.body.host_agency_identifier ?? ""),
      has_ticketing_authority: ctx.body.has_ticketing_authority === "1" ? 1 : 0,
      support_phone: (ctx.body.support_phone as string) || null,
      support_email: (ctx.body.support_email as string) || null,
      required_disclosures: (ctx.body.required_disclosures as string) || null,
    });
    logAdmin(admin.id, "agency_settings.updated", "agency_settings");
    ctx.redirect("/admin/agency-settings");
  });
}

function logAdmin(actorUserId: string, action: string, targetId: string, metadata?: unknown) {
  const db = getDb();
  db.prepare(`INSERT INTO audit_log (id, actor_user_id, actor_role, action, target_type, target_id, metadata) VALUES (?, ?, 'admin', ?, 'admin_action', ?, ?)`).run(
    newId("audit"),
    actorUserId,
    action,
    targetId,
    metadata !== undefined ? toJson(metadata) : null,
  );
}
