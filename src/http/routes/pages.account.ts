import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { money } from "../../views/components.ts";
import { getBooking, listBookingItems, listBookingsForCustomer, type BookingRow } from "../../domain/bookings.ts";
import { listQuotesForCustomer, getQuote, getQuoteByShareToken, listQuoteItems, effectiveStatus, transitionQuote } from "../../domain/quotes.ts";
import { listFavorites, listPriceAlerts } from "../../domain/collections.ts";
import { createSupportCase, listSupportCasesForCustomer } from "../../domain/support.ts";
import { formatMoney } from "../../domain/pricing.ts";
import { ForbiddenError, UnauthorizedError } from "../../domain/rbac.ts";

const STATUS_LABEL: Record<BookingRow["status"], string> = {
  pending_payment: "Payment pending",
  payment_authorized: "Payment authorized — confirming with supplier",
  confirming_with_supplier: "Confirming with supplier",
  confirmed: "Confirmed",
  payment_failed: "Payment declined — not booked",
  supplier_failed: "Supplier could not confirm — not booked",
  voided: "Payment voided — not booked, not charged",
  cancelled: "Cancelled",
  handed_off_to_provider: "Handed off to provider",
};

export function registerAccountRoutes(router: Router) {
  router.get("/bookings/:id", (ctx: Ctx) => {
    const booking = getBooking(ctx.params.id!);
    if (!booking) return ctx.html(404, page({ title: "Not found", user: ctx.user }, html`<h1>Booking not found</h1>`));
    if (booking.customer_user_id) {
      if (!ctx.user) throw new UnauthorizedError("Sign in to view this booking");
      const allowed = ctx.user.id === booking.customer_user_id || ctx.user.id === booking.agent_id || ctx.user.role === "admin";
      if (!allowed) throw new ForbiddenError("You are not authorized to view this booking.");
    }
    const items = listBookingItems(booking.id) as { description: string; total_cents: number }[];

    const statusTone = booking.status === "confirmed" ? "success" : ["payment_failed", "supplier_failed", "voided"].includes(booking.status) ? "error" : "info";

    ctx.html(
      200,
      page({ title: "Booking", user: ctx.user }, html`
        <div class="notice notice--${statusTone}">
          <h1>${STATUS_LABEL[booking.status]}</h1>
          ${booking.status === "confirmed" ? html`<p>Confirmation number: <strong>${booking.confirmation_number}</strong></p>` : html``}
          ${booking.failure_reason ? html`<p>${booking.failure_reason}</p>` : html``}
          ${booking.status === "handed_off_to_provider" ? html`<p>You were handed off to <strong>${booking.supplier}</strong> to complete this booking (demo link: <code>${booking.provider_handoff_url}</code>). TyJen did not charge you and does not control that checkout.</p>` : html``}
        </div>
        <h2>Trip details</h2>
        <div class="trip-summary">
          ${joinHtml(items.map((i) => html`<div class="trip-summary__item"><div>${i.description}</div><div>${money(i.total_cents)}</div></div>`))}
          <div class="trip-summary__total"><strong>${booking.status === "confirmed" ? "Total charged" : "Total"}</strong><strong>${money(booking.total_cents, booking.currency)}</strong></div>
        </div>
        <p><strong>Booking path:</strong> ${booking.booking_path === "tyjen" ? "Booked with TyJen" : "Booked with provider"} · <strong>Supplier:</strong> ${booking.supplier}</p>
        <h2>Support</h2>
        <p>Questions about this trip? <a href="/support?bookingId=${booking.id}">Contact support</a>.</p>
      `),
    );
  });

  router.get("/my-trips", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login?next=/my-trips");
    const bookings = listBookingsForCustomer(ctx.user.id);
    ctx.html(
      200,
      page({ title: "My Trips", user: ctx.user, activeNav: "trips" }, html`
        <h1>My Trips</h1>
        ${bookings.length === 0
          ? html`<p>No trips yet. <a href="/search/flights">Start searching</a>.</p>`
          : html`
              <div class="booking-list">
                ${joinHtml(
                  bookings.map(
                    (b) => html`
                      <a class="booking-list__item" href="/bookings/${b.id}">
                        <div>
                          <strong>${STATUS_LABEL[b.status]}</strong>
                          <div class="field-help">${b.supplier} · ${new Date(b.created_at).toLocaleDateString()}</div>
                        </div>
                        <div>${money(b.total_cents, b.currency)}</div>
                      </a>
                    `,
                  ),
                )}
              </div>
            `}
      `),
    );
  });

  router.get("/quotes/mine", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login?next=/quotes/mine");
    const quotes = listQuotesForCustomer(ctx.user.id);
    ctx.html(
      200,
      page({ title: "My Quotes", user: ctx.user, activeNav: "trips" }, html`
        <h1>My Quotes</h1>
        ${quotes.length === 0
          ? html`<p>No quotes yet.</p>`
          : html`<div class="booking-list">${joinHtml(quotes.map((q) => html`<a class="booking-list__item" href="/quotes/mine/${q.id}"><div><strong>${q.title}</strong><div class="field-help">${q.status}</div></div><div>${money(q.total_cents, q.currency)}</div></a>`))}</div>`}
      `),
    );
  });

  router.get("/quotes/mine/:id", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login");
    const quote = getQuote(ctx.params.id!);
    if (!quote || quote.customer_user_id !== ctx.user.id) throw new ForbiddenError("Not your quote.");
    const items = listQuoteItems(quote.id);
    ctx.html(200, page({ title: quote.title, user: ctx.user }, renderQuoteDetail(quote, items, false)));
  });

  router.get("/quotes/shared/:token", (ctx: Ctx) => {
    const quote = getQuoteByShareToken(ctx.params.token!);
    if (!quote) return ctx.html(404, page({ title: "Quote not found", user: ctx.user }, html`<h1>Quote not found</h1>`));
    if (quote.status === "sent") transitionQuote(quote.id, "viewed");
    const items = listQuoteItems(quote.id);
    const fresh = getQuote(quote.id)!;
    ctx.html(200, page({ title: fresh.title, user: ctx.user }, renderQuoteDetail(fresh, items, true)));
  });

  router.post("/quotes/shared/:token/respond", (ctx: Ctx) => {
    const quote = getQuoteByShareToken(ctx.params.token!);
    if (!quote) return ctx.redirect("/");
    const decision = ctx.body.decision === "accept" ? "accepted" : "declined";
    try {
      transitionQuote(quote.id, decision);
    } catch {
      // Already decided or expired — fall through to show current state.
    }
    ctx.redirect(`/quotes/shared/${ctx.params.token}`);
  });

  router.get("/account/favorites", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login?next=/account/favorites");
    const favorites = listFavorites(ctx.user.id);
    const alerts = listPriceAlerts(ctx.user.id);
    ctx.html(
      200,
      page({ title: "Favorites", user: ctx.user, activeNav: "favorites" }, html`
        <h1>Favorites</h1>
        ${favorites.length === 0 ? html`<p>Nothing saved yet. Look for the "Add to shortlist" option while browsing.</p>` : html`<ul>${joinHtml(favorites.map((f) => html`<li>${f.item_type}: ${f.ref_id}</li>`))}</ul>`}
        <h2>Price alerts</h2>
        ${alerts.length === 0 ? html`<p>No active price alerts.</p>` : html`<ul>${joinHtml(alerts.map((a) => html`<li>${a.item_type} ${a.ref_id} — alert below ${money(a.target_price_cents, a.currency)} (${a.status})</li>`))}</ul>`}
      `),
    );
  });

  router.get("/support", (ctx: Ctx) => {
    const bookingId = ctx.query.get("bookingId") ?? "";
    ctx.html(
      200,
      page({ title: "Contact support", user: ctx.user }, html`
        <h1>Contact support</h1>
        <form method="post" action="/support" class="stacked-form">
          <input type="hidden" name="bookingId" value="${bookingId}" />
          <div class="field"><label for="subject">Subject</label><input id="subject" name="subject" required /></div>
          <div class="field"><label for="body">How can we help?</label><textarea id="body" name="body" rows="5" required></textarea></div>
          <button class="btn btn--primary" type="submit">Send</button>
        </form>
      `),
    );
  });

  router.post("/support", (ctx: Ctx) => {
    const sc = createSupportCase({
      customerUserId: ctx.user?.id ?? null,
      bookingId: (ctx.body.bookingId as string) || null,
      subject: String(ctx.body.subject ?? "Support request"),
      body: String(ctx.body.body ?? ""),
    });
    ctx.html(200, page({ title: "Support request sent", user: ctx.user }, html`<h1>Thanks — we've got it</h1><p>Reference: ${sc.id}. An agent or administrator will follow up.</p>`));
  });
}

function renderQuoteDetail(quote: ReturnType<typeof getQuote>, items: ReturnType<typeof listQuoteItems>, isSharedView: boolean) {
  if (!quote) return html`<p>Not found.</p>`;
  const status = effectiveStatus(quote);
  return html`
    <h1>${quote.title}</h1>
    <p>Status: <strong>${status}</strong> · Valid until ${new Date(quote.valid_until).toLocaleString()}</p>
    ${quote.agent_notes ? html`<p><em>${quote.agent_notes}</em></p>` : html``}
    <div class="trip-summary">
      ${joinHtml(items.map((i) => html`<div class="trip-summary__item"><div>${i.description}<div class="field-help">${i.supplier}</div></div><div>${money(i.total_cents, quote.currency)}</div></div>`))}
      <div class="trip-summary__total"><strong>Total</strong><strong>${money(quote.total_cents, quote.currency)}</strong></div>
    </div>
    <p class="field-help">This is a non-binding quote, subject to availability. Prices are not locked until you complete checkout.</p>
    ${isSharedView && (status === "sent" || status === "viewed")
      ? html`
          <form method="post" action="/quotes/shared/${quote.share_token}/respond" class="trip-actions">
            <button class="btn btn--primary" type="submit" name="decision" value="accept">Accept quote</button>
            <button class="btn btn--tertiary" type="submit" name="decision" value="decline">Decline</button>
          </form>
        `
      : html``}
    ${status === "accepted" ? html`<p>You accepted this quote. Your agent will follow up to complete booking, or you can proceed to checkout with the same items via search.</p>` : html``}
  `;
}
