import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { productTabs, connectionNotice, money, statusBadge } from "../../views/components.ts";
import { searchCruises, getCruiseSailingById } from "../../adapters/cruises.demo.ts";
import type { NormalizedCruiseSailing } from "../../adapters/types.ts";

function sailingCard(s: NormalizedCruiseSailing) {
  return html`
    <article class="cruise-card">
      <div class="cruise-card__body">
        <h3><a href="/cruises/${s.id}">${s.itineraryName}</a> ${statusBadge(s.status)}</h3>
        <p>${s.lineName} · ${s.shipName}</p>
        <p>${s.nights} nights · Departs ${s.departurePort} on ${s.departDate}, returns ${s.returnDate}</p>
        <p>Ports: ${s.ports.map((p) => p.port).join(" → ")}</p>
        <p>${s.inclusions.join(", ")}</p>
      </div>
      <div class="cruise-card__price">
        <div>From <strong>${money(s.fromTotalCents, s.currency)}</strong> per person</div>
        <div class="field-help">+ ${money(s.taxesPortFeesCents, s.currency)} taxes &amp; port fees · deposit ${money(s.depositCents, s.currency)}</div>
        <a class="btn btn--primary" href="/cruises/${s.id}">View itinerary</a>
      </div>
    </article>
  `;
}

export function registerCruiseSearchRoutes(router: Router) {
  router.get("/search/cruises", async (ctx: Ctx) => {
    const q = ctx.query;
    const departurePort = q.get("departurePort") ?? "";
    const line = q.get("line") ?? "";
    const dateFrom = q.get("dateFrom") ?? new Date().toISOString().slice(0, 10);
    const dateTo = q.get("dateTo") ?? new Date(Date.now() + 400 * 86_400_000).toISOString().slice(0, 10);
    const nightsMin = q.get("nightsMin") ? Number.parseInt(q.get("nightsMin")!, 10) : undefined;
    const nightsMax = q.get("nightsMax") ? Number.parseInt(q.get("nightsMax")!, 10) : undefined;
    const adults = Math.max(1, Number.parseInt(q.get("adults") ?? "2", 10) || 2);
    const children = Math.max(0, Number.parseInt(q.get("children") ?? "0", 10) || 0);

    const searchForm = html`
      <form class="search-form" method="get" action="/search/cruises" novalidate>
        <div class="search-form__grid">
          <div class="field"><label for="cf-port">Departure port</label><input id="cf-port" name="departurePort" value="${departurePort}" placeholder="Miami, FL" /></div>
          <div class="field"><label for="cf-line">Cruise line</label><input id="cf-line" name="line" value="${line}" placeholder="Any" /></div>
          <div class="field"><label for="cf-from">Earliest departure</label><input id="cf-from" type="date" name="dateFrom" value="${dateFrom}" /></div>
          <div class="field"><label for="cf-to">Latest departure</label><input id="cf-to" type="date" name="dateTo" value="${dateTo}" /></div>
          <div class="field"><label for="cf-nmin">Min nights</label><input id="cf-nmin" type="number" min="1" name="nightsMin" value="${q.get("nightsMin") ?? ""}" /></div>
          <div class="field"><label for="cf-nmax">Max nights</label><input id="cf-nmax" type="number" min="1" name="nightsMax" value="${q.get("nightsMax") ?? ""}" /></div>
          <div class="field"><label for="cf-adults">Adults</label><input id="cf-adults" type="number" min="1" name="adults" value="${adults}" /></div>
          <div class="field"><label for="cf-children">Children</label><input id="cf-children" type="number" min="0" name="children" value="${children}" /></div>
        </div>
        <button class="btn btn--primary" type="submit">Search cruises</button>
      </form>
    `;

    const result = await searchCruises({ departurePort: departurePort || undefined, line: line || undefined, dateFrom, dateTo, nightsMin, nightsMax, adults, children });

    return ctx.html(
      200,
      page({ title: "Search cruises", user: ctx.user, activeNav: "search" }, html`
        ${productTabs("cruises", q)}
        <h1>Search cruises</h1>
        ${connectionNotice(result.connection.supplierName, result.connection.status, result.connection.notes)}
        <details class="search-form-collapsed" open><summary>Search</summary>${searchForm}</details>
        <p class="result-count">${result.sailings.length} matching sailing${result.sailings.length === 1 ? "" : "s"}</p>
        <div class="cruise-list">${joinHtml(result.sailings.map(sailingCard))}</div>
        <p class="field-help">This demo dataset includes 4 fictional cruise lines. See ADAPTERS.md for what connecting each of a target 6 major real cruise lines would require.</p>
      `),
    );
  });

  router.get("/cruises/:id", async (ctx: Ctx) => {
    const s = getCruiseSailingById(ctx.params.id!);
    if (!s) return ctx.html(404, page({ title: "Not found", user: ctx.user }, html`<h1>Sailing not found</h1>`));
    const adults = ctx.query.get("adults") ?? "2";
    const children = ctx.query.get("children") ?? "0";

    return ctx.html(
      200,
      page({ title: s.itineraryName, user: ctx.user, activeNav: "search" }, html`
        <nav class="breadcrumb"><a href="/search/cruises">Search results</a> / ${s.itineraryName}</nav>
        <h1>${s.itineraryName} ${statusBadge(s.status)}</h1>
        <p>${s.lineName} · ${s.shipName} · ${s.nights} nights</p>
        <p>Departs ${s.departurePort} on ${s.departDate}, returns ${s.returnDate}.</p>
        <h2>Itinerary</h2>
        <ol class="itinerary-list">
          ${joinHtml(s.ports.map((p) => html`<li>${p.port}${p.arrive ? ` — arrive ${p.arrive}` : ""}${p.depart ? `, depart ${p.depart}` : ""}</li>`))}
        </ol>
        <p><strong>Included:</strong> ${s.inclusions.join(", ")}</p>
        <p><strong>Payment schedule:</strong> ${s.paymentSchedule}</p>
        <p><strong>Cancellation terms:</strong> ${s.cancellationTerms}</p>
        <p><strong>Who processes this booking:</strong> ${s.bookingHandledBy === "tyjen" ? "TyJen Travel, on behalf of the host agency (demo only)." : `${s.supplier} directly — TyJen will hand you off to complete this booking.`}</p>

        <h2>Choose a cabin category</h2>
        <div class="cabin-list">
          ${joinHtml(
            s.cabinCategories.map(
              (c) => html`
                <article class="cabin-card">
                  <div>
                    <h3>${c.name}</h3>
                    <p>Double occupancy · ${money(c.priceCents, s.currency)} per person + ${money(s.taxesPortFeesCents, s.currency)} taxes &amp; port fees</p>
                  </div>
                  <a class="btn btn--primary" href="/trip/review?type=cruise&sailingId=${s.id}&cabinCode=${c.code}&adults=${adults}&children=${children}">Select cabin</a>
                </article>
              `,
            ),
          )}
        </div>
      `),
    );
  });
}
