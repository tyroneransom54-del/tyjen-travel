import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { money, statusBadge } from "../../views/components.ts";
import { assembleTrip } from "./trip.ts";
import { listClientsForAgent } from "../../domain/clients.ts";
import { getAgentProfile, assertAgentOwnsClient, ForbiddenError } from "../../domain/rbac.ts";
import { createQuote, addQuoteItem } from "../../domain/quotes.ts";
import { addToShortlist } from "../../domain/collections.ts";

function queryToHidden(q: URLSearchParams): ReturnType<typeof html> {
  return joinHtml([...q.entries()].map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`));
}

export function registerTripReviewRoutes(router: Router) {
  router.get("/trip/review", (ctx: Ctx) => {
    const trip = assembleTrip(ctx.query);
    const agentProfile = ctx.user?.role === "agent" ? getAgentProfile(ctx.user.id) : undefined;
    const clients = ctx.user?.role === "agent" && agentProfile?.authorized ? listClientsForAgent(ctx.user.id) : [];

    if (trip.items.length === 0 || (trip.missing && trip.missing.length)) {
      return ctx.html(
        200,
        page({ title: "Trip review", user: ctx.user }, html`
          <h1>We're missing part of this trip</h1>
          <p>Could not find: ${trip.missing?.join(", ") || "the selected item(s)"}. It may have been a stale link. Please search again.</p>
          <a class="btn btn--primary" href="/">Start a new search</a>
        `),
      );
    }

    return ctx.html(
      200,
      page({ title: "Review your trip", user: ctx.user }, html`
        <h1>Review your trip</h1>
        ${ctx.query.get("error") === "invalid_client"
          ? html`<div class="notice notice--error"><p>That client could no longer be matched to your account (it may have been reassigned or removed). Choose a client again before creating the quote.</p></div>`
          : html``}
        <div class="trip-summary">
          ${joinHtml(
            trip.items.map(
              (i) => html`
                <div class="trip-summary__item">
                  <div>
                    <strong>${i.description}</strong>
                    <div class="field-help">Supplier: ${i.supplier} · Handled by: ${i.bookingHandledBy === "tyjen" ? "TyJen Travel" : i.supplier} ${statusBadge(i.status)}</div>
                  </div>
                  <div>${money(i.totalCents, "USD")}</div>
                </div>
              `,
            ),
          )}
          ${trip.savings?.comparable
            ? html`<div class="trip-summary__savings">Package savings: ${money(trip.savings.savingsCents ?? 0)} vs. booking these separately at today's prices.</div>`
            : html``}
          <div class="trip-summary__total"><strong>Total</strong><strong>${money(trip.totalCents, trip.currency)}</strong></div>
          <p class="field-help">Prices last checked just now from our demo inventory. They are rechecked again immediately before you pay.</p>
        </div>

        <div class="trip-actions">
          <form method="get" action="/checkout">
            ${queryToHidden(ctx.query)}
            <button class="btn btn--primary" type="submit">Continue to checkout</button>
          </form>

          ${ctx.user?.role === "agent" && agentProfile?.authorized
            ? html`
                <form method="post" action="/trip/request-quote" class="trip-actions__quote-form">
                  ${queryToHidden(ctx.query)}
                  <label for="clientId">Save as a quote for client</label>
                  <select id="clientId" name="clientId" required>
                    <option value="">Choose a client…</option>
                    ${joinHtml(clients.map((c) => html`<option value="${c.id}">${c.full_name}</option>`))}
                  </select>
                  <button class="btn btn--secondary" type="submit">Create quote</button>
                </form>
              `
            : ctx.user?.role === "traveler"
              ? html`
                  <form method="post" action="/trip/request-quote">
                    ${queryToHidden(ctx.query)}
                    <button class="btn btn--secondary" type="submit">Save as a quote in My Trips</button>
                  </form>
                `
              : html`<a class="btn btn--secondary" href="/login?next=/trip/review">Sign in to save this as a quote</a>`}

          ${ctx.user
            ? html`
                <form method="post" action="/trip/shortlist">
                  ${queryToHidden(ctx.query)}
                  <button class="btn btn--tertiary" type="submit">Add to shortlist</button>
                </form>
              `
            : html``}
        </div>
      `),
    );
  });

  router.post("/trip/request-quote", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login");
    const trip = assembleTrip(new URLSearchParams(ctx.body as Record<string, string>));
    if (trip.items.length === 0) return ctx.redirect("/trip/review?" + new URLSearchParams(ctx.body as Record<string, string>).toString());

    const isAgent = ctx.user.role === "agent";
    const clientId = isAgent ? String(ctx.body.clientId ?? "") : undefined;
    if (isAgent && clientId) {
      // A clientId that doesn't belong to this agent (stale form, tampered
      // request, or a client reassigned/removed since the page loaded)
      // must not be allowed to hit the database as a raw foreign-key
      // violation — validate ownership (via the same centralized check
      // every other client-scoped route uses) and fail with an ordinary
      // redirect instead of an unhandled 500.
      try {
        assertAgentOwnsClient(ctx.user.id, clientId);
      } catch (err) {
        if (err instanceof ForbiddenError) {
          return ctx.redirect("/trip/review?" + new URLSearchParams(ctx.body as Record<string, string>).toString() + "&error=invalid_client");
        }
        throw err;
      }
    }
    const quote = createQuote({
      agentId: isAgent ? ctx.user.id : null,
      clientId: isAgent ? clientId || null : null,
      customerUserId: !isAgent ? ctx.user.id : null,
      title: trip.type === "package" ? "Flight + Stay package" : trip.type === "cruise" ? "Cruise quote" : trip.type === "stay" ? "Stay quote" : "Flight quote",
    });
    for (const item of trip.items) {
      addQuoteItem(quote.id, {
        itemType: item.itemType,
        refId: item.refId,
        description: item.description,
        supplier: item.supplier,
        unitPriceCents: item.unitPriceCents,
        taxesCents: item.taxesCents,
        feesCents: item.feesCents,
        quantity: item.quantity,
        terms: item.terms,
      });
    }
    if (isAgent) return ctx.redirect(`/agent/quotes/${quote.id}`);
    return ctx.redirect(`/quotes/mine/${quote.id}`);
  });

  router.post("/trip/shortlist", (ctx: Ctx) => {
    if (!ctx.user) return ctx.redirect("/login");
    const params = new URLSearchParams(ctx.body as Record<string, string>);
    const trip = assembleTrip(params);
    for (const item of trip.items) {
      addToShortlist({ ownerUserId: ctx.user.id, itemType: item.itemType, refId: item.refId, snapshot: item });
    }
    ctx.redirect(`/trip/review?${params.toString()}`);
  });
}
