import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, joinHtml, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { productTabs, connectionNotice, money, statusBadge, emptyState } from "../../views/components.ts";
import { searchStays, getStayProperty } from "../../adapters/stays.demo.ts";
import type { NormalizedStayProperty } from "../../adapters/types.ts";

function stayCard(p: NormalizedStayProperty, href: string) {
  const photo = p.photos[0];
  return html`
    <article class="stay-card">
      <img src="${photo?.url ?? ""}" alt="${photo?.alt ?? p.name}" loading="lazy" />
      <div class="stay-card__body">
        <h3><a href="${href}">${p.name}</a></h3>
        <p class="stay-card__location">${p.neighborhood ? `${p.neighborhood}, ` : ""}${p.city} · ${p.propertyType.replace("_", " ")}</p>
        <p class="stay-card__rating">${p.starRating ? `${p.starRating}★ class` : ""} ${p.guestRating ? `· ${p.guestRating}/5 guest rating (${p.reviewCount} reviews)` : ""}</p>
        <p class="stay-card__amenities">${p.amenities.slice(0, 4).join(" · ")}</p>
        <div class="stay-card__footer">
          ${statusBadge(p.status)}
          <div class="stay-card__price"><strong>${money(p.fromTotalCents, p.currency)}</strong> total for stay</div>
          <a class="btn btn--primary" href="${href}">View rooms</a>
        </div>
      </div>
    </article>
  `;
}

export function registerStaySearchRoutes(router: Router) {
  router.get("/search/stays", async (ctx: Ctx) => {
    const q = ctx.query;
    const city = (q.get("city") ?? q.get("destination") ?? "").trim();
    const checkIn = q.get("checkIn") ?? q.get("departDate") ?? "";
    const checkOut = q.get("checkOut") ?? q.get("returnDate") ?? "";
    const adults = Math.max(1, Number.parseInt(q.get("adults") ?? "2", 10) || 2);
    const children = Math.max(0, Number.parseInt(q.get("children") ?? "0", 10) || 0);
    const rooms = Math.max(1, Number.parseInt(q.get("rooms") ?? "1", 10) || 1);
    const sort = q.get("sort") ?? "rating";
    const maxPrice = q.get("maxPrice") ? Number.parseInt(q.get("maxPrice")!, 10) * 100 : undefined;
    const propertyType = q.get("propertyType") ?? "";

    const searchForm = html`
      <form class="search-form" method="get" action="/search/stays" novalidate>
        <div class="search-form__grid">
          <div class="field"><label for="sf-city">Destination city</label><input id="sf-city" name="city" value="${city}" placeholder="Los Angeles" required /></div>
          <div class="field"><label for="sf-checkin">Check-in</label><input id="sf-checkin" type="date" name="checkIn" value="${checkIn}" required /></div>
          <div class="field"><label for="sf-checkout">Check-out</label><input id="sf-checkout" type="date" name="checkOut" value="${checkOut}" required /></div>
          <div class="field"><label for="sf-adults">Adults</label><input id="sf-adults" type="number" min="1" name="adults" value="${adults}" /></div>
          <div class="field"><label for="sf-children">Children</label><input id="sf-children" type="number" min="0" name="children" value="${children}" /></div>
          <div class="field"><label for="sf-rooms">Rooms</label><input id="sf-rooms" type="number" min="1" name="rooms" value="${rooms}" /></div>
        </div>
        <button class="btn btn--primary" type="submit">Search stays</button>
      </form>
    `;

    const hasSearch = city.length > 0 && !!checkIn && !!checkOut;
    if (!hasSearch) {
      return ctx.html(200, page({ title: "Search stays", user: ctx.user, activeNav: "search" }, html`
        ${productTabs("stays", q)}
        <h1>Search stays</h1>
        ${searchForm}
      `));
    }

    const result = await searchStays({ city, checkIn, checkOut, adults, children, rooms });
    let properties = result.properties;
    if (maxPrice !== undefined) properties = properties.filter((p) => p.fromTotalCents <= maxPrice);
    if (propertyType) properties = properties.filter((p) => p.propertyType === propertyType);
    if (sort === "price") properties = [...properties].sort((a, b) => a.fromTotalCents - b.fromTotalCents);
    else properties = [...properties].sort((a, b) => (b.guestRating ?? 0) - (a.guestRating ?? 0));

    function detailHref(id: string) {
      // Carry every current query param forward (packageMode, origin,
      // destination, outboundFlightId/returnFlightId when building a
      // package "flights first") in addition to the core stay params.
      const p = new URLSearchParams(q);
      p.set("checkIn", checkIn);
      p.set("checkOut", checkOut);
      p.set("adults", String(adults));
      p.set("children", String(children));
      p.set("rooms", String(rooms));
      return `/stays/${id}?${p.toString()}`;
    }

    const broadenTips = html`
      <ul>
        <li>Try nearby neighborhoods or a wider date range.</li>
        <li>Reduce the number of rooms or travelers per room.</li>
        <li>Remove the price or property-type filter below.</li>
      </ul>
    `;

    return ctx.html(
      200,
      page({ title: `Stays in ${city}`, user: ctx.user, activeNav: "search" }, html`
        ${productTabs("stays", q)}
        <h1>Stays in ${city}</h1>
        ${connectionNotice(result.connection.supplierName, result.connection.status, result.connection.notes)}
        <details class="search-form-collapsed"><summary>Edit search</summary>${searchForm}</details>
        <form class="filter-bar" method="get" action="/search/stays">
          <input type="hidden" name="city" value="${city}" /><input type="hidden" name="checkIn" value="${checkIn}" /><input type="hidden" name="checkOut" value="${checkOut}" />
          <input type="hidden" name="adults" value="${adults}" /><input type="hidden" name="children" value="${children}" /><input type="hidden" name="rooms" value="${rooms}" />
          <div class="field"><label for="sort">Sort</label>
            <select id="sort" name="sort" onchange="this.form.submit()">
              <option value="rating" ${sort === "rating" ? raw("selected") : raw("")}>Guest rating</option>
              <option value="price" ${sort === "price" ? raw("selected") : raw("")}>Total price</option>
            </select>
          </div>
          <div class="field"><label for="propertyType">Property type</label>
            <select id="propertyType" name="propertyType" onchange="this.form.submit()">
              <option value="">Any</option>
              <option value="hotel" ${propertyType === "hotel" ? raw("selected") : raw("")}>Hotel</option>
              <option value="resort" ${propertyType === "resort" ? raw("selected") : raw("")}>Resort</option>
              <option value="vacation_rental" ${propertyType === "vacation_rental" ? raw("selected") : raw("")}>Vacation rental / condo</option>
            </select>
          </div>
          <div class="field"><label for="maxPrice">Max total price ($)</label><input id="maxPrice" type="number" name="maxPrice" value="${q.get("maxPrice") ?? ""}" onchange="this.form.submit()" /></div>
        </form>
        <p class="result-count">${properties.length} of ${result.totalMatching} matching ${result.totalMatching === 1 ? "property" : "properties"}${properties.length < 5 ? " (fewer than 5 — try broadening your search)" : ""}</p>
        ${properties.length === 0 ? emptyState("No properties matched", "Try broadening your search:", undefined, undefined) : html``}
        ${properties.length === 0 ? broadenTips : html``}
        <div class="card-grid card-grid--stays">
          ${joinHtml(properties.map((p) => stayCard(p, detailHref(p.id))))}
        </div>
      `),
    );
  });

  router.get("/stays/:id", async (ctx: Ctx) => {
    const q = ctx.query;
    const checkIn = q.get("checkIn") ?? "";
    const checkOut = q.get("checkOut") ?? "";
    const adults = q.get("adults") ?? "2";
    const children = q.get("children") ?? "0";
    const rooms = q.get("rooms") ?? "1";
    if (!checkIn || !checkOut) return ctx.redirect("/search/stays");
    const property = await getStayProperty(ctx.params.id!, checkIn, checkOut);
    if (!property) return ctx.html(404, page({ title: "Not found", user: ctx.user }, html`<h1>Property not found</h1>`));

    function bookHref(roomId: string) {
      const packageMode = q.get("packageMode") === "1";
      const outboundFlightId = q.get("outboundFlightId");
      if (!packageMode) {
        const p = new URLSearchParams({ type: "stay", roomId, checkIn, checkOut, adults, children, rooms });
        return `/trip/review?${p.toString()}`;
      }
      if (outboundFlightId) {
        // "Flights first" package: flights were already chosen, so this
        // completes the package — go straight to the combined review.
        const p = new URLSearchParams({ type: "package", roomId, outboundFlightId, checkIn, checkOut, adults, children, rooms });
        const returnFlightId = q.get("returnFlightId");
        if (returnFlightId) p.set("returnFlightId", returnFlightId);
        return `/trip/review?${p.toString()}`;
      }
      // "Stay first" package: hand off to flight search carrying the chosen
      // room forward so progress isn't lost.
      const origin = q.get("origin") ?? "";
      const destination = q.get("destination") ?? "";
      const p = new URLSearchParams({ origin, destination, departDate: checkIn, returnDate: checkOut, adults, children, tripType: "round_trip", packageMode: "1", roomId, checkIn, checkOut, rooms });
      return `/search/flights?${p.toString()}`;
    }

    return ctx.html(
      200,
      page({ title: property.name, user: ctx.user, activeNav: "search" }, html`
        <nav class="breadcrumb"><a href="/search/stays">Search results</a> / ${property.name}</nav>
        <div class="property-header">
          <img src="${property.photos[0]?.url ?? ""}" alt="${property.photos[0]?.alt ?? property.name}" />
          <div>
            <h1>${property.name} ${statusBadge(property.status)}</h1>
            <p>${property.neighborhood ? `${property.neighborhood}, ` : ""}${property.city}, ${property.country}</p>
            <p>${property.starRating ? `${property.starRating}★ class · ` : ""}${property.guestRating ? `${property.guestRating}/5 guest rating (${property.reviewCount} reviews)` : "No guest reviews yet"}</p>
            <p>${property.description ?? ""}</p>
            <p><strong>Check-in:</strong> ${property.checkInTime} · <strong>Check-out:</strong> ${property.checkOutTime}</p>
            <p><strong>Amenities:</strong> ${property.amenities.join(", ") || "None listed"}</p>
            <p><strong>Accessibility:</strong> ${property.accessibilityFeatures.join(", ") || "Not specified — contact the property directly"}</p>
          </div>
        </div>

        <h2>Choose a room and rate</h2>
        <div class="room-list">
          ${property.rooms.length === 0
            ? html`<p>No rooms are available for these dates. Try a different date range.</p>`
            : joinHtml(
                property.rooms.map(
                  (r) => html`
                    <article class="room-card">
                      <div class="room-card__body">
                        <h3>${r.name}</h3>
                        <p>Sleeps up to ${r.maxAdults} adults${r.maxChildren ? ` + ${r.maxChildren} children` : ""}${r.bedConfig ? ` · ${r.bedConfig}` : ""}</p>
                        <p>${r.includedServices.join(", ") || "Room only"}</p>
                        <p>${r.nights} night${r.nights === 1 ? "" : "s"} × ${money(r.nightlyRateCents, r.currency)}/night</p>
                        <p class="room-card__cancel">${r.refundable ? `Free cancellation until ${new Date(r.cancellationDeadline).toLocaleString("en-US")}` : "Non-refundable rate"}</p>
                        <p class="room-card__availability">${r.roomsAvailable} room${r.roomsAvailable === 1 ? "" : "s"} left at this rate</p>
                      </div>
                      <div class="room-card__price">
                        <div class="price-breakdown">
                          <div>Room subtotal: ${money(r.subtotalCents, r.currency)}</div>
                          <div>Taxes: ${money(r.taxesCents, r.currency)}</div>
                          <div>Fees: ${money(r.feesCents, r.currency)}</div>
                          ${r.payAtPropertyCents ? html`<div>Due at property: ${money(r.payAtPropertyCents, r.currency)}</div>` : html``}
                          <div class="price-breakdown__total">Total: ${money(r.totalCents, r.currency)}</div>
                          <div class="field-help">Due now: ${money(r.totalDueNowCents, r.currency)}</div>
                        </div>
                        <a class="btn btn--primary" href="${bookHref(r.id)}">Select room</a>
                      </div>
                    </article>
                  `,
                ),
              )}
        </div>
      `),
    );
  });
}
