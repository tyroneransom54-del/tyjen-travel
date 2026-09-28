import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { money, field } from "../../views/components.ts";
import { assembleTrip, recheckAssembledTrip } from "./trip.ts";
import { runTyjenCheckout, recordProviderHandoff, type BookingItemInput } from "../../domain/bookings.ts";
import { sendEmail } from "../../domain/email.ts";
import { formatMoney } from "../../domain/pricing.ts";
import { newToken } from "../../domain/ids.ts";

function queryToHidden(entries: Iterable<[string, string]>, exclude: string[] = []): ReturnType<typeof html> {
  return joinHtml([...entries].filter(([k]) => !exclude.includes(k)).map(([k, v]) => html`<input type="hidden" name="${k}" value="${v}" />`));
}

function bodyToParams(body: Record<string, unknown>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(body)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, String(x)));
    else if (v !== undefined) p.set(k, String(v));
  }
  return p;
}

function tripToBookingItems(trip: ReturnType<typeof assembleTrip>, leadName: string): BookingItemInput[] {
  return trip.items.map((i) => ({
    itemType: i.itemType,
    refId: i.refId,
    description: i.description,
    quantity: i.quantity,
    unitPriceCents: i.unitPriceCents,
    totalCents: i.totalCents,
    travelerDetails: Array.from({ length: Math.max(1, trip.travelers) }, (_, idx) => ({ name: trip.travelers > 1 ? `${leadName} (Traveler ${idx + 1})` : leadName })),
  }));
}

export function registerCheckoutRoutes(router: Router) {
  router.get("/checkout", (ctx: Ctx) => {
    const q = ctx.query;
    const trip = assembleTrip(q);
    if (trip.items.length === 0) return ctx.redirect("/trip/review?" + q.toString());

    const simulate = q.get("simulate") as "sold_out" | "price_changed" | null;
    const recheck = recheckAssembledTrip(q, simulate);
    const canBookWithTyjen = trip.items.every((i) => i.bookingHandledBy === "tyjen");
    const idempotencyKey = newToken(12);

    if (!recheck.ok) {
      return ctx.html(
        200,
        page({ title: "This offer changed", user: ctx.user }, html`
          <div class="notice notice--warning">
            <h1>${recheck.reason === "sold_out" ? "This offer just sold out" : "The price just changed"}</h1>
            <p>We recheck price and availability with the supplier immediately before checkout, and something changed for <strong>${recheck.itemDescription}</strong>:</p>
            ${recheck.reason === "price_changed"
              ? html`<p>Previous total: ${formatMoney(recheck.previousTotalCents ?? 0)} → New total: <strong>${formatMoney(recheck.newTotalCents ?? 0)}</strong></p><p>Nothing has been charged. Please review the new price before continuing.</p>`
              : html`<p>Nothing has been charged. Please choose a different option.</p>`}
            <a class="btn btn--primary" href="/trip/review?${(() => { const p = new URLSearchParams(q); p.delete("simulate"); return p.toString(); })()}">Back to trip review</a>
          </div>
        `),
      );
    }

    ctx.html(
      200,
      page({ title: "Checkout", user: ctx.user }, html`
        <h1>Checkout</h1>
        <div class="trip-summary">
          ${joinHtml(trip.items.map((i) => html`<div class="trip-summary__item"><div>${i.description}</div><div>${money(i.totalCents)}</div></div>`))}
          <div class="trip-summary__total"><strong>Total due</strong><strong>${money(trip.totalCents, trip.currency)}</strong></div>
          <p class="field-help">Price and availability rechecked with the supplier just now.</p>
        </div>

        ${!canBookWithTyjen
          ? html`<div class="notice notice--info"><p>This trip includes at least one item whose supplier connection does not permit TyJen to process the booking. You'll continue with the supplier/provider to finish this booking; TyJen will not charge you.</p></div>`
          : html``}

        <div class="checkout-columns">
          <form method="post" action="/checkout/provider" class="checkout-form">
            ${queryToHidden(q.entries(), ["simulate"])}
            <input type="hidden" name="idempotencyKey" value="prov_${idempotencyKey}" />
            ${field({ label: "Your name", name: "leadName", required: true })}
            ${field({ label: "Email for your itinerary", name: "email", type: "email", required: true, value: ctx.user?.email })}
            <h2>Book with provider</h2>
            <p>You'll be handed off to <strong>${trip.items[0]?.supplier}</strong> to complete this booking and make payment. TyJen does not process payment for this path, and support for this trip is handled by that provider.</p>
            <button class="btn btn--secondary" type="submit">Continue with ${trip.items[0]?.supplier}</button>
          </form>

          ${canBookWithTyjen
            ? html`
                <form method="post" action="/checkout/tyjen" class="checkout-form">
                  ${queryToHidden(q.entries(), ["simulate"])}
                  <input type="hidden" name="idempotencyKey" value="tyj_${idempotencyKey}" />
                  <h2>Book with TyJen</h2>
                  ${field({ label: "Your name", name: "leadName", required: true })}
                  ${field({ label: "Email for confirmation", name: "email", type: "email", required: true, value: ctx.user?.email })}
                  <fieldset>
                    <legend>Payment (demo — no real charge)</legend>
                    ${field({ label: "Card number", name: "cardNumber", required: true, placeholder: "4242 4242 4242 4242", help: "Demo card: any 16 digits. End in 0002 to simulate a decline, or 0069 to simulate insufficient funds." })}
                    ${field({ label: "Name on card", name: "nameOnCard", required: true })}
                    ${field({ label: "Expiry (MM/YY)", name: "expiry", required: true, placeholder: "12/29" })}
                    ${field({ label: "CVC", name: "cvc", required: true, placeholder: "123" })}
                  </fieldset>
                  <fieldset>
                    <legend>Demonstration controls</legend>
                    <label class="checkbox"><input type="checkbox" name="simulateDecline" value="1" /> Force a declined payment</label>
                    <div class="field">
                      <label for="simulateSupplierFailure">Simulate supplier failure after payment is authorized</label>
                      <select id="simulateSupplierFailure" name="simulateSupplierFailure">
                        <option value="">None (normal confirmation)</option>
                        <option value="sold_out">Sold out during booking</option>
                        <option value="timeout">Supplier booking call times out</option>
                      </select>
                    </div>
                  </fieldset>
                  <p class="field-help">By continuing you authorize TyJen to charge the card above ${money(trip.totalCents, trip.currency)}. Full terms for each item are shown above. This is a demo payment provider — no real card is charged.</p>
                  <button class="btn btn--primary" type="submit">Pay and book with TyJen</button>
                </form>
              `
            : html``}
        </div>
      `),
    );
  });

  router.post("/checkout/tyjen", (ctx: Ctx) => {
    const params = bodyToParams(ctx.body);
    const trip = assembleTrip(params);
    if (trip.items.length === 0) return ctx.redirect("/");
    const canBookWithTyjen = trip.items.every((i) => i.bookingHandledBy === "tyjen");
    if (!canBookWithTyjen) return ctx.redirect("/checkout?" + params.toString());

    // Server-side recheck again, independent of what the form claimed.
    const recheck = recheckAssembledTrip(params, null);
    if (!recheck.ok) {
      const p = new URLSearchParams(params);
      p.set("simulate", recheck.reason);
      return ctx.redirect("/checkout?" + p.toString());
    }

    const leadName = String(ctx.body.leadName ?? "Guest traveler");
    const email = String(ctx.body.email ?? "");
    const idempotencyKey = String(ctx.body.idempotencyKey ?? newToken(12));
    const simulateSupplierFailure = ctx.body.simulateSupplierFailure === "sold_out" || ctx.body.simulateSupplierFailure === "timeout" ? (ctx.body.simulateSupplierFailure as "sold_out" | "timeout") : false;

    const agentId = ctx.user?.role === "agent" ? ctx.user.id : null;
    const outcome = runTyjenCheckout({
      customerUserId: ctx.user?.role === "traveler" ? ctx.user.id : null,
      agentId,
      supplier: trip.items[0]?.supplier ?? "TyJen Demo",
      totalCents: trip.totalCents,
      currency: trip.currency,
      items: tripToBookingItems(trip, leadName),
      card: { cardNumber: String(ctx.body.cardNumber ?? ""), expiry: String(ctx.body.expiry ?? ""), cvc: String(ctx.body.cvc ?? ""), nameOnCard: String(ctx.body.nameOnCard ?? leadName) },
      simulateDecline: ctx.body.simulateDecline === "1",
      simulateSupplierFailure,
      priceCheckSnapshot: { checkedAt: new Date().toISOString(), items: trip.items },
      idempotencyKey,
    });

    if (outcome.outcome === "confirmed") {
      sendEmail(email || "guest@example.com", `Your TyJen Travel confirmation ${outcome.booking.confirmation_number}`, `Hi ${leadName},\n\nYour trip is confirmed. Confirmation number: ${outcome.booking.confirmation_number}.\nTotal charged: ${formatMoney(outcome.booking.total_cents, outcome.booking.currency)}.\n\nThis is a demo booking — no real reservation was made with any real supplier.`, { type: "booking", id: outcome.booking.id });
    }
    return ctx.redirect(`/bookings/${outcome.booking.id}`);
  });

  router.post("/checkout/provider", (ctx: Ctx) => {
    const params = bodyToParams(ctx.body);
    const trip = assembleTrip(params);
    if (trip.items.length === 0) return ctx.redirect("/");
    const leadName = String(ctx.body.leadName ?? "Guest traveler");
    const email = String(ctx.body.email ?? "");
    const idempotencyKey = String(ctx.body.idempotencyKey ?? newToken(12));
    const supplier = trip.items[0]?.supplier ?? "the supplier";
    const demoHandoffUrl = `https://booking.example-provider.demo/redirect?ref=${idempotencyKey}`; // Placeholder: a live integration uses the approved partner's real deep link (see ADAPTERS.md).

    const booking = recordProviderHandoff({
      customerUserId: ctx.user?.role === "traveler" ? ctx.user.id : null,
      agentId: ctx.user?.role === "agent" ? ctx.user.id : null,
      supplier,
      totalCents: trip.totalCents,
      currency: trip.currency,
      items: tripToBookingItems(trip, leadName),
      providerHandoffUrl: demoHandoffUrl,
      idempotencyKey,
    });
    sendEmail(email || "guest@example.com", `Continue your booking with ${supplier}`, `Hi ${leadName},\n\nYou were handed off to ${supplier} to finish this booking. TyJen has not charged you and does not control this provider's checkout.`, { type: "booking", id: booking.id });
    return ctx.redirect(`/bookings/${booking.id}`);
  });
}
