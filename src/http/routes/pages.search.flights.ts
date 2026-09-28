import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { productTabs, connectionNotice, money, statusBadge } from "../../views/components.ts";
import { searchFlights } from "../../adapters/flights.demo.ts";
import { parseAirportCode, formatClockTime, formatDateLabel, formatDuration, sortFlights, type FlightSort } from "./search.helpers.ts";
import type { NormalizedFlightOffer, TripType } from "../../adapters/types.ts";

function flightCard(o: NormalizedFlightOffer, selectHref: string): ReturnType<typeof html> {
  return html`
    <article class="offer-row" aria-label="${o.marketingAirline} ${o.flightNumber}">
      <div class="offer-row__main">
        <div class="offer-row__times">
          <div class="offer-row__time">
            <strong>${formatClockTime(o.departAt)}</strong>
            <span>${o.origin}</span>
          </div>
          <div class="offer-row__path" aria-hidden="true">
            <span>${formatDuration(o.durationMinutes)}</span>
            <div class="offer-row__line"></div>
            <span>${o.stops === 0 ? "Nonstop" : o.stops === 1 ? "1 stop" : `${o.stops} stops`}</span>
          </div>
          <div class="offer-row__time">
            <strong>${formatClockTime(o.arriveAt)}</strong>
            <span>${o.destination}</span>
          </div>
        </div>
        <div class="offer-row__meta">
          <span>${o.marketingAirline} ${o.flightNumber}${o.operatingAirline !== o.marketingAirline ? html` (operated by ${o.operatingAirline})` : html``}</span>
          <span>${formatDateLabel(o.departAt)}</span>
          <span>${o.fareType}</span>
          ${o.layovers.length ? html`<span>Layover: ${joinHtml(o.layovers.map((l) => html`${l.airport} (${formatDuration(l.minutes)})`), ", ")}</span>` : html``}
        </div>
        <details class="offer-row__terms">
          <summary>Bags, changes &amp; refunds</summary>
          <ul>
            <li><strong>Carry-on:</strong> ${o.carryOnPolicy}</li>
            <li><strong>Checked bags:</strong> ${o.checkedBagPolicy}</li>
            <li><strong>Changes:</strong> ${o.changePolicy}</li>
            <li><strong>Refunds:</strong> ${o.refundPolicy}</li>
          </ul>
        </details>
      </div>
      <div class="offer-row__price">
        ${statusBadge(o.status)}
        <div class="offer-row__total">${money(o.totalCents, o.currency)}</div>
        <div class="offer-row__perperson">per traveler, total incl. taxes &amp; fees</div>
        <div class="offer-row__seats">${o.seatsAvailable} seat${o.seatsAvailable === 1 ? "" : "s"} left at this fare</div>
        <a class="btn btn--primary" href="${selectHref}">Select</a>
      </div>
    </article>
  `;
}

/**
 * Decides where to go once flight leg(s) are chosen. Plain flight search
 * always goes to the trip review page. When building a flight+stay package
 * (packageMode=1), progress must not be lost regardless of which leg the
 * traveler started with: if a stay/room was already chosen (roomId present,
 * meaning "stay first"), go straight to the combined review; otherwise
 * ("flights first"), hand off to the stay search carrying the chosen
 * flights forward so the traveler picks their room next.
 */
function finalizeFlightSelection(q: URLSearchParams, outboundFlightId: string, returnFlightId: string | undefined, adults: number, children: number): string {
  const packageMode = q.get("packageMode") === "1";
  const roomId = q.get("roomId");
  if (!packageMode) {
    const p = new URLSearchParams({ type: "flight", outboundFlightId, adults: String(adults), children: String(children) });
    if (returnFlightId) p.set("returnFlightId", returnFlightId);
    return `/trip/review?${p.toString()}`;
  }
  if (roomId) {
    const p = new URLSearchParams({ type: "package", outboundFlightId, roomId, adults: String(adults), children: String(children) });
    if (returnFlightId) p.set("returnFlightId", returnFlightId);
    for (const key of ["checkIn", "checkOut", "rooms"]) {
      const v = q.get(key);
      if (v) p.set(key, v);
    }
    return `/trip/review?${p.toString()}`;
  }
  const cityForStay = q.get("cityForStay") ?? "";
  const p = new URLSearchParams({ city: cityForStay, checkIn: q.get("departDate") ?? "", checkOut: q.get("returnDate") ?? "", adults: String(adults), children: String(children), rooms: q.get("rooms") ?? "1", packageMode: "1", outboundFlightId });
  if (returnFlightId) p.set("returnFlightId", returnFlightId);
  return `/search/stays?${p.toString()}`;
}

export function registerFlightSearchRoute(router: Router) {
  router.get("/search/flights", async (ctx: Ctx) => {
    const q = ctx.query;
    const origin = parseAirportCode(q.get("origin"));
    const destination = parseAirportCode(q.get("destination"));
    const departDate = q.get("departDate") ?? "";
    const returnDate = q.get("returnDate") ?? "";
    const adults = Math.max(1, Number.parseInt(q.get("adults") ?? "1", 10) || 1);
    const children = Math.max(0, Number.parseInt(q.get("children") ?? "0", 10) || 0);
    const cabin = (q.get("cabin") as NormalizedFlightOffer["cabin"]) || "economy";
    const tripType: TripType = q.get("tripType") === "one_way" ? "one_way" : returnDate ? "round_trip" : "one_way";
    const sort = (q.get("sort") as FlightSort) || "best";
    const maxStopsParam = q.get("maxStops");
    const maxStops = maxStopsParam ? Number.parseInt(maxStopsParam, 10) : undefined;
    const airlineFilter = q.getAll("airline");
    const outboundFlightId = q.get("outboundFlightId") ?? "";

    const hasSearch = origin.length === 3 && destination.length === 3 && !!departDate;

    function carryParams(extra: Record<string, string | undefined>): string {
      const p = new URLSearchParams(q);
      for (const [k, v] of Object.entries(extra)) {
        if (v === undefined) p.delete(k);
        else p.set(k, v);
      }
      return p.toString();
    }

    const searchForm = html`
      <form class="search-form" method="get" action="/search/flights" novalidate>
        <div class="search-form__grid">
          <div class="field"><label for="ff-origin">From</label><input id="ff-origin" name="origin" value="${q.get("origin") ?? "JFK"}" list="airport-list" required /></div>
          <div class="field"><label for="ff-destination">To</label><input id="ff-destination" name="destination" value="${q.get("destination") ?? "LAX"}" list="airport-list" required /></div>
          <div class="field"><label for="ff-trip">Trip type</label>
            <select id="ff-trip" name="tripType">
              <option value="round_trip" ${tripType === "round_trip" ? raw("selected") : raw("")}>Round trip</option>
              <option value="one_way" ${tripType === "one_way" ? raw("selected") : raw("")}>One way</option>
            </select>
          </div>
          <div class="field"><label for="ff-depart">Depart</label><input id="ff-depart" type="date" name="departDate" value="${departDate}" required /></div>
          <div class="field"><label for="ff-return">Return</label><input id="ff-return" type="date" name="returnDate" value="${returnDate}" ${tripType === "one_way" ? raw("disabled") : raw("")} /></div>
          <div class="field"><label for="ff-adults">Adults</label><input id="ff-adults" type="number" name="adults" min="1" value="${adults}" /></div>
          <div class="field"><label for="ff-children">Children</label><input id="ff-children" type="number" name="children" min="0" value="${children}" /></div>
          <div class="field"><label for="ff-cabin">Cabin</label>
            <select id="ff-cabin" name="cabin">
              <option value="economy" ${cabin === "economy" ? raw("selected") : raw("")}>Economy</option>
              <option value="premium_economy" ${cabin === "premium_economy" ? raw("selected") : raw("")}>Premium Economy</option>
              <option value="business" ${cabin === "business" ? raw("selected") : raw("")}>Business</option>
              <option value="first" ${cabin === "first" ? raw("selected") : raw("")}>First</option>
            </select>
          </div>
        </div>
        <datalist id="airport-list">
          <option value="JFK — New York (JFK)"></option>
          <option value="LAX — Los Angeles (LAX)"></option>
        </datalist>
        <button class="btn btn--primary" type="submit">Search flights</button>
        <p class="field-help">Multi-city search is supported by the underlying data model (each leg is searched independently); this build's UI covers one-way and round trip end to end — see LIMITATIONS.md.</p>
      </form>
    `;

    if (!hasSearch) {
      return ctx.html(200, page({ title: "Search flights", user: ctx.user, activeNav: "search" }, html`
        ${productTabs("flights", q)}
        <h1>Search flights</h1>
        ${searchForm}
      `));
    }

    const result = await searchFlights({ tripType, legs: [{ origin, destination, date: departDate }], travelers: { adults, children, infants: 0 }, cabin, maxStops });
    let outboundOffers = sortFlights(result.legs[0]!.offers, sort);
    if (airlineFilter.length) outboundOffers = outboundOffers.filter((o) => airlineFilter.includes(o.marketingAirline));
    const airlines = [...new Set(result.legs[0]!.offers.map((o) => o.marketingAirline))].sort();

    function filterBar(): ReturnType<typeof html> {
      return html`
        <form class="filter-bar" method="get" action="/search/flights">
          ${hiddenCarry(q, ["airline", "sort", "maxStops"])}
          <div class="field"><label for="sort">Sort</label>
            <select id="sort" name="sort" onchange="this.form.submit()">
              <option value="best" ${sort === "best" ? raw("selected") : raw("")}>Best overall</option>
              <option value="price" ${sort === "price" ? raw("selected") : raw("")}>Lowest price</option>
              <option value="fastest" ${sort === "fastest" ? raw("selected") : raw("")}>Fastest</option>
              <option value="earliest" ${sort === "earliest" ? raw("selected") : raw("")}>Earliest departure</option>
              <option value="airline" ${sort === "airline" ? raw("selected") : raw("")}>Airline</option>
              <option value="layover" ${sort === "layover" ? raw("selected") : raw("")}>Shortest layover</option>
            </select>
          </div>
          <div class="field"><label for="maxStops">Stops</label>
            <select id="maxStops" name="maxStops" onchange="this.form.submit()">
              <option value="" ${maxStops === undefined ? raw("selected") : raw("")}>Any</option>
              <option value="0" ${maxStops === 0 ? raw("selected") : raw("")}>Nonstop only</option>
              <option value="1" ${maxStops === 1 ? raw("selected") : raw("")}>1 stop or fewer</option>
            </select>
          </div>
          <fieldset class="filter-bar__airlines">
            <legend>Airlines</legend>
            ${joinHtml(
              airlines.map((a) => html`<label class="checkbox"><input type="checkbox" name="airline" value="${a}" ${airlineFilter.includes(a) ? raw("checked") : raw("")} onchange="this.form.submit()" /> ${a}</label>`),
            )}
          </fieldset>
          <p class="field-help">"Best overall" balances price (50%), total trip time (30%), and number of stops (20%) across today's results.</p>
        </form>
      `;
    }

    function hiddenCarry(params: URLSearchParams, exclude: string[]): ReturnType<typeof html> {
      const items: ReturnType<typeof html>[] = [];
      for (const [k, v] of params.entries()) {
        if (exclude.includes(k)) continue;
        items.push(html`<input type="hidden" name="${k}" value="${v}" />`);
      }
      return joinHtml(items);
    }

    // Selecting the outbound leg (or one-way): move to return-leg search or trip review.
    if (tripType === "round_trip" && !outboundFlightId) {
      return ctx.html(
        200,
        page({ title: "Select outbound flight", user: ctx.user, activeNav: "search" }, html`
          ${productTabs("flights", q)}
          <h1>${origin} → ${destination} <span class="muted">${formatDateLabel(`${departDate}T00:00:00`)}</span></h1>
          ${connectionNotice(result.connection.supplierName, result.connection.status, result.connection.notes)}
          <details class="search-form-collapsed"><summary>Edit search</summary>${searchForm}</details>
          ${filterBar()}
          <p class="result-count">${outboundOffers.length} matching outbound flight${outboundOffers.length === 1 ? "" : "s"}</p>
          <div class="offer-list">
            ${outboundOffers.length ? joinHtml(outboundOffers.map((o) => flightCard(o, `/search/flights?${carryParams({ outboundFlightId: o.id })}`))) : html`<p>No outbound flights matched. Try different dates or airports.</p>`}
          </div>
        `),
      );
    }

    if (tripType === "round_trip" && outboundFlightId) {
      const returnResult = await searchFlights({ tripType, legs: [{ origin: destination, destination: origin, date: returnDate }], travelers: { adults, children, infants: 0 }, cabin, maxStops });
      let returnOffers = sortFlights(returnResult.legs[0]!.offers, sort);
      if (airlineFilter.length) returnOffers = returnOffers.filter((o) => airlineFilter.includes(o.marketingAirline));
      const chosenOutbound = result.legs[0]!.offers.find((o) => o.id === outboundFlightId);
      const returnFlightId = q.get("returnFlightId") ?? "";
      if (!returnFlightId) {
        return ctx.html(
          200,
          page({ title: "Select return flight", user: ctx.user, activeNav: "search" }, html`
            ${productTabs("flights", q)}
            <h1>${destination} → ${origin} <span class="muted">${formatDateLabel(`${returnDate}T00:00:00`)}</span></h1>
            ${chosenOutbound ? html`<p class="selection-pill">Outbound selected: ${chosenOutbound.marketingAirline} ${chosenOutbound.flightNumber}, ${formatClockTime(chosenOutbound.departAt)} — ${money(chosenOutbound.totalCents)} <a href="/search/flights?${carryParams({ outboundFlightId: undefined })}">Change</a></p>` : html``}
            <p class="result-count">${returnOffers.length} matching return flight${returnOffers.length === 1 ? "" : "s"}</p>
            <div class="offer-list">
              ${returnOffers.length ? joinHtml(returnOffers.map((o) => flightCard(o, `/search/flights?${carryParams({ returnFlightId: o.id })}`))) : html`<p>No return flights matched. Try different dates.</p>`}
            </div>
          `),
        );
      }
      // Both legs chosen -> continue the trip (package continuation or review).
      return ctx.redirect(finalizeFlightSelection(q, outboundFlightId, returnFlightId, adults, children));
    }

    if (tripType === "one_way" && outboundFlightId) {
      return ctx.redirect(finalizeFlightSelection(q, outboundFlightId, undefined, adults, children));
    }

    // One-way, no selection yet.
    return ctx.html(
      200,
      page({ title: "Select flight", user: ctx.user, activeNav: "search" }, html`
        ${productTabs("flights", q)}
        <h1>${origin} → ${destination} <span class="muted">${formatDateLabel(`${departDate}T00:00:00`)}</span></h1>
        ${connectionNotice(result.connection.supplierName, result.connection.status, result.connection.notes)}
        <details class="search-form-collapsed"><summary>Edit search</summary>${searchForm}</details>
        ${filterBar()}
        <p class="result-count">${outboundOffers.length} matching flight${outboundOffers.length === 1 ? "" : "s"}</p>
        <div class="offer-list">
          ${outboundOffers.length ? joinHtml(outboundOffers.map((o) => flightCard(o, `/search/flights?${carryParams({ outboundFlightId: o.id })}`))) : html`<p>No flights matched. Try different dates or airports.</p>`}
        </div>
      `),
    );
  });
}
