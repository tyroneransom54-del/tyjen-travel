import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { field, money } from "../../views/components.ts";
import { requireRole, requireAuthorizedAgent, assertAgentOwnsClient } from "../../domain/rbac.ts";
import { createClient, listClientsForAgent, getClient, updateClientConsent } from "../../domain/clients.ts";
import { listQuotesForAgent, getQuote, listQuoteItems, transitionQuote, effectiveStatus, removeQuoteItem } from "../../domain/quotes.ts";
import { listAgentTasks, createAgentTask, completeAgentTask } from "../../domain/agent-tasks.ts";
import { listBookingsForAgent, type BookingRow } from "../../domain/bookings.ts";
import { listShortlist, removeFromShortlist, parseSnapshot } from "../../domain/collections.ts";
import type { TripLineItem } from "./trip.ts";
import { getDb } from "../../db/client.ts";

function pendingAgentPage(ctx: Ctx) {
  ctx.html(
    200,
    page({ title: "Awaiting authorization", user: ctx.user }, html`
      <div class="notice notice--info">
        <h1>Your agent account is awaiting authorization</h1>
        <p>An agency administrator needs to review and authorize your account before you can search on behalf of clients, build quotes, or process bookings. This is required so client access always stays scoped to authorized agents (see Admin &gt; Agents).</p>
      </div>
    `),
  );
}

export function registerAgentRoutes(router: Router) {
  router.get("/agent", (ctx: Ctx) => {
    requireRole(ctx.user, "agent");
    let authz;
    try {
      authz = requireAuthorizedAgent(ctx.user);
    } catch {
      return pendingAgentPage(ctx);
    }
    const { user } = authz;
    const clients = listClientsForAgent(user.id);
    const quotes = listQuotesForAgent(user.id);
    const tasks = listAgentTasks(user.id).filter((t) => t.status === "open").slice(0, 8);
    const bookings = listBookingsForAgent(user.id);

    ctx.html(
      200,
      page({ title: "Agent dashboard", user: ctx.user, activeNav: "dashboard" }, html`
        <h1>Welcome back, ${user.display_name}</h1>
        <div class="stat-grid">
          <div class="stat-card"><strong>${clients.length}</strong><span>Clients</span></div>
          <div class="stat-card"><strong>${quotes.filter((q) => ["draft", "sent", "viewed"].includes(effectiveStatus(q))).length}</strong><span>Open quotes</span></div>
          <div class="stat-card"><strong>${bookings.filter((b) => b.status === "confirmed").length}</strong><span>Confirmed bookings</span></div>
          <div class="stat-card"><strong>${tasks.length}</strong><span>Open tasks</span></div>
        </div>

        <h2>Open tasks &amp; follow-ups</h2>
        ${tasks.length === 0 ? html`<p>Nothing due. Add a task from a client's page.</p>` : html`<ul class="task-list">${joinHtml(tasks.map((t) => html`<li>${t.title}${t.due_at ? ` — due ${new Date(t.due_at).toLocaleDateString()}` : ""}<form method="post" action="/agent/tasks/${t.id}/complete" style="display:inline"><button class="btn-link" type="submit">Mark done</button></form></li>`))}</ul>`}

        <h2>Recent quotes</h2>
        ${quotes.length === 0 ? html`<p>No quotes yet. Search for flights, stays, or cruises and choose "Create quote".</p>` : html`<div class="booking-list">${joinHtml(quotes.slice(0, 6).map((q) => html`<a class="booking-list__item" href="/agent/quotes/${q.id}"><div><strong>${q.title}</strong><div class="field-help">${effectiveStatus(q)}</div></div><div>${money(q.total_cents, q.currency)}</div></a>`))}</div>`}

        <h2>Recent bookings</h2>
        ${bookings.length === 0 ? html`<p>No bookings yet.</p>` : html`<div class="booking-list">${joinHtml(bookings.slice(0, 6).map((b) => html`<a class="booking-list__item" href="/bookings/${b.id}"><div><strong>${b.status}</strong><div class="field-help">${b.supplier}</div></div><div>${money(b.total_cents, b.currency)}</div></a>`))}</div>`}
      `),
    );
  });

  router.get("/agent/clients", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgentOrPending(ctx);
    if (!user) return;
    const clients = listClientsForAgent(user.id);
    ctx.html(
      200,
      page({ title: "Clients", user: ctx.user, activeNav: "clients" }, html`
        <h1>Clients</h1>
        <details class="search-form-collapsed"><summary>Add a new client</summary>
          <form method="post" action="/agent/clients" class="stacked-form">
            ${field({ label: "Full name", name: "fullName", required: true })}
            ${field({ label: "Email", name: "email", type: "email" })}
            ${field({ label: "Phone", name: "phone" })}
            <button class="btn btn--primary" type="submit">Add client</button>
          </form>
        </details>
        <div class="client-list">
          ${joinHtml(clients.map((c) => html`<a class="booking-list__item" href="/agent/clients/${c.id}"><div><strong>${c.full_name}</strong><div class="field-help">${c.email ?? "no email"} · consent: ${c.consent_status}</div></div></a>`))}
        </div>
      `),
    );
  });

  router.post("/agent/clients", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    createClient({ agentId: user.id, fullName: String(ctx.body.fullName ?? "").trim() || "Unnamed client", email: (ctx.body.email as string) || undefined, phone: (ctx.body.phone as string) || undefined });
    ctx.redirect("/agent/clients");
  });

  router.get("/agent/clients/:id", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    assertAgentOwnsClient(user.id, ctx.params.id!);
    const client = getClient(ctx.params.id!)!;
    const quotes = listQuotesForAgent(user.id).filter((q) => q.client_id === client.id);
    const shortlist = listShortlist(user.id, client.id);
    const tasks = listAgentTasks(user.id).filter((t) => t.client_id === client.id);

    ctx.html(
      200,
      page({ title: client.full_name, user: ctx.user, activeNav: "clients" }, html`
        <nav class="breadcrumb"><a href="/agent/clients">Clients</a> / ${client.full_name}</nav>
        <h1>${client.full_name}</h1>
        <p>${client.email ?? "No email"} · ${client.phone ?? "No phone"}</p>
        <form method="post" action="/agent/clients/${client.id}/consent" class="inline-form">
          <label for="consent">Consent status</label>
          <select id="consent" name="consent_status" onchange="this.form.submit()">
            ${["not_requested", "requested", "granted", "declined"].map((s) => html`<option value="${s}" ${s === client.consent_status ? raw("selected") : raw("")}>${s}</option>`).reduce((a, b) => html`${a}${b}`, html``)}
          </select>
        </form>

        <h2>Shortlisted options</h2>
        ${shortlist.length === 0 ? html`<p>Nothing shortlisted for this client yet.</p>` : html`<div class="trip-summary">${joinHtml(shortlist.map((s) => { const item = parseSnapshot<TripLineItem>(s); return html`<div class="trip-summary__item"><div>${item.description}</div><div>${money(item.totalCents)}</div></div>`; }))}</div>`}

        <h2>Quotes</h2>
        ${quotes.length === 0 ? html`<p>No quotes yet for this client.</p>` : html`<div class="booking-list">${joinHtml(quotes.map((q) => html`<a class="booking-list__item" href="/agent/quotes/${q.id}"><div><strong>${q.title}</strong></div><div>${effectiveStatus(q)}</div></a>`))}</div>`}

        <h2>Notes &amp; tasks</h2>
        <form method="post" action="/agent/clients/${client.id}/tasks" class="stacked-form">
          <div class="field"><label for="kind">Type</label><select id="kind" name="kind"><option value="note">Note</option><option value="task">Follow-up task</option></select></div>
          ${field({ label: "Title", name: "title", required: true })}
          ${field({ label: "Details", name: "body" })}
          ${field({ label: "Due date (for tasks)", name: "dueAt", type: "date" })}
          <button class="btn btn--secondary" type="submit">Add</button>
        </form>
        <ul class="task-list">${joinHtml(tasks.map((t) => html`<li>[${t.kind}] ${t.title} ${t.status === "done" ? "✓" : ""}</li>`))}</ul>
      `),
    );
  });

  router.post("/agent/clients/:id/consent", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    assertAgentOwnsClient(user.id, ctx.params.id!);
    updateClientConsent(ctx.params.id!, ctx.body.consent_status as never, user.id);
    ctx.redirect(`/agent/clients/${ctx.params.id}`);
  });

  router.post("/agent/clients/:id/tasks", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    assertAgentOwnsClient(user.id, ctx.params.id!);
    createAgentTask({ agentId: user.id, clientId: ctx.params.id, kind: ctx.body.kind === "task" ? "task" : "note", title: String(ctx.body.title ?? "Untitled"), body: (ctx.body.body as string) || undefined, dueAt: (ctx.body.dueAt as string) || null });
    ctx.redirect(`/agent/clients/${ctx.params.id}`);
  });

  router.post("/agent/tasks/:id/complete", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    completeAgentTask(ctx.params.id!, user.id);
    ctx.redirect(ctx.req.headers.referer ?? "/agent");
  });

  router.get("/agent/quotes", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const quotes = listQuotesForAgent(user.id);
    ctx.html(
      200,
      page({ title: "Quotes", user: ctx.user, activeNav: "quotes" }, html`
        <h1>Quotes</h1>
        <div class="booking-list">
          ${joinHtml(quotes.map((q) => html`<a class="booking-list__item" href="/agent/quotes/${q.id}"><div><strong>${q.title}</strong><div class="field-help">${effectiveStatus(q)}</div></div><div>${money(q.total_cents, q.currency)}</div></a>`))}
        </div>
      `),
    );
  });

  router.get("/agent/quotes/:id", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const quote = getQuote(ctx.params.id!);
    if (!quote || quote.agent_id !== user.id) return ctx.html(404, page({ title: "Not found", user: ctx.user }, html`<h1>Quote not found</h1>`));
    const items = listQuoteItems(quote.id);
    const status = effectiveStatus(quote);
    const client = quote.client_id ? getClient(quote.client_id) : undefined;

    ctx.html(
      200,
      page({ title: quote.title, user: ctx.user, activeNav: "quotes" }, html`
        <h1>${quote.title}</h1>
        <p>Client: ${client ? html`<a href="/agent/clients/${client.id}">${client.full_name}</a>` : "None"} · Status: <strong>${status}</strong> · Valid until ${new Date(quote.valid_until).toLocaleString()}</p>
        <div class="trip-summary">
          ${joinHtml(items.map((i) => html`<div class="trip-summary__item"><div>${i.description}<div class="field-help">${i.supplier}</div></div><div>${money(i.total_cents, quote.currency)} <form method="post" action="/agent/quotes/${quote.id}/items/${i.id}/remove" style="display:inline"><button class="btn-link" type="submit">Remove</button></form></div></div>`))}
          <div class="trip-summary__total"><strong>Total</strong><strong>${money(quote.total_cents, quote.currency)}</strong></div>
        </div>
        <form method="post" action="/agent/quotes/${quote.id}/notes" class="stacked-form">
          ${field({ label: "Notes shown to the client", name: "agent_notes", value: quote.agent_notes ?? "" })}
          <button class="btn btn--secondary" type="submit">Save notes</button>
        </form>
        <div class="trip-actions">
          ${status === "draft" ? html`<form method="post" action="/agent/quotes/${quote.id}/status"><input type="hidden" name="status" value="sent" /><button class="btn btn--primary" type="submit">Send to client</button></form>` : html``}
          ${quote.customer_user_id === null ? html`<p class="field-help">This quote isn't linked to a customer account yet, so it can only be shared via the link below.</p>` : html``}
        </div>
        <p>Shareable link: <code>/quotes/shared/${quote.share_token}</code></p>
        <a class="btn btn--tertiary" href="/quotes/shared/${quote.share_token}">Preview as the client would see it</a>
      `),
    );
  });

  router.post("/agent/quotes/:id/notes", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const quote = getQuote(ctx.params.id!);
    if (!quote || quote.agent_id !== user.id) return ctx.redirect("/agent/quotes");
    getDb().prepare("UPDATE quotes SET agent_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run((ctx.body.agent_notes as string) ?? null, quote.id);
    ctx.redirect(`/agent/quotes/${quote.id}`);
  });

  router.post("/agent/quotes/:id/status", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const quote = getQuote(ctx.params.id!);
    if (!quote || quote.agent_id !== user.id) return ctx.redirect("/agent/quotes");
    transitionQuote(quote.id, ctx.body.status as never);
    ctx.redirect(`/agent/quotes/${quote.id}`);
  });

  router.post("/agent/quotes/:id/items/:itemId/remove", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const quote = getQuote(ctx.params.id!);
    if (!quote || quote.agent_id !== user.id) return ctx.redirect("/agent/quotes");
    removeQuoteItem(quote.id, ctx.params.itemId!);
    ctx.redirect(`/agent/quotes/${quote.id}`);
  });

  router.get("/agent/bookings", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const bookings = listBookingsForAgent(user.id);
    ctx.html(
      200,
      page({ title: "Bookings", user: ctx.user, activeNav: "bookings" }, html`
        <h1>Bookings</h1>
        <div class="booking-list">
          ${joinHtml(bookings.map((b: BookingRow) => html`<a class="booking-list__item" href="/bookings/${b.id}"><div><strong>${b.status}</strong><div class="field-help">${b.supplier} · ${new Date(b.created_at).toLocaleDateString()}</div></div><div>${money(b.total_cents, b.currency)}</div></a>`))}
        </div>
      `),
    );
  });

  router.get("/agent/shortlist", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    const items = listShortlist(user.id);
    ctx.html(
      200,
      page({ title: "Shortlist", user: ctx.user, activeNav: "shortlist" }, html`
        <h1>Shortlist</h1>
        <p>Compare options you've saved while researching, side by side.</p>
        <div class="card-grid">
          ${joinHtml(
            items.map((s) => {
              const item = parseSnapshot<TripLineItem>(s);
              return html`
                <article class="offer-card">
                  <div class="offer-card__body">
                    <h3>${item.description}</h3>
                    <p>${item.supplier}</p>
                    <p><strong>${money(item.totalCents)}</strong></p>
                    <form method="post" action="/agent/shortlist/${s.id}/remove"><button class="btn-link" type="submit">Remove</button></form>
                  </div>
                </article>
              `;
            }),
          )}
        </div>
      `),
    );
  });

  router.post("/agent/shortlist/:id/remove", (ctx: Ctx) => {
    const { user } = requireAuthorizedAgent(ctx.user);
    removeFromShortlist(ctx.params.id!, user.id);
    ctx.redirect("/agent/shortlist");
  });
}

function requireAuthorizedAgentOrPending(ctx: Ctx): { user: ReturnType<typeof requireAuthorizedAgent>["user"] | undefined } {
  requireRole(ctx.user, "agent");
  try {
    return { user: requireAuthorizedAgent(ctx.user).user };
  } catch {
    pendingAgentPage(ctx);
    return { user: undefined };
  }
}
