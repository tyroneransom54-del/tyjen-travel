import type { Router } from "../router.ts";
import type { Ctx } from "../context.ts";
import { html, raw } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { productTabs } from "../../views/components.ts";
import { parseCityName } from "./search.helpers.ts";
import { getDb } from "../../db/client.ts";
import { getFlightOfferById } from "../../adapters/flights.demo.ts";

export function registerPackageSearchRoute(router: Router) {
  router.get("/search/packages", (ctx: Ctx) => {
    const q = ctx.query;
    ctx.html(
      200,
      page({ title: "Flight + Stay packages", user: ctx.user, activeNav: "search" }, html`
        ${productTabs("packages", q)}
        <h1>Build a flight + stay package</h1>
        <p>Choose whichever leg you'd like to start with — your progress carries forward either way, and you can change your mind before you check out.</p>
        <form class="search-form" method="get" action="/search/packages/start" novalidate>
          <div class="search-form__grid">
            <div class="field"><label for="pk-origin">From</label><input id="pk-origin" name="origin" placeholder="JFK — New York (JFK)" list="airport-list" required /></div>
            <div class="field"><label for="pk-destination">To</label><input id="pk-destination" name="destination" placeholder="LAX — Los Angeles (LAX)" list="airport-list" required /></div>
            <div class="field"><label for="pk-depart">Depart</label><input id="pk-depart" type="date" name="departDate" required /></div>
            <div class="field"><label for="pk-return">Return</label><input id="pk-return" type="date" name="returnDate" required /></div>
            <div class="field"><label for="pk-adults">Adults</label><input id="pk-adults" type="number" min="1" name="adults" value="2" /></div>
            <div class="field"><label for="pk-children">Children</label><input id="pk-children" type="number" min="0" name="children" value="0" /></div>
            <div class="field"><label for="pk-rooms">Rooms</label><input id="pk-rooms" type="number" min="1" name="rooms" value="1" /></div>
          </div>
          <datalist id="airport-list">
            <option value="JFK — New York (JFK)"></option>
            <option value="LAX — Los Angeles (LAX)"></option>
          </datalist>
          <fieldset class="role-toggle">
            <legend>Start with</legend>
            <label class="checkbox"><input type="radio" name="startWith" value="stay" checked /> Pick my stay first</label>
            <label class="checkbox"><input type="radio" name="startWith" value="flight" /> Pick my flights first</label>
          </fieldset>
          <button class="btn btn--primary" type="submit">Start building my package</button>
        </form>
        <p class="field-help">This build's demo inventory pairs JFK ↔ LAX flights with Los Angeles stays so there is real matching data to compare — see LIMITATIONS.md for other routes.</p>
      `),
    );
  });

  router.get("/search/packages/start", (ctx: Ctx) => {
    const q = ctx.query;
    const origin = q.get("origin") ?? "";
    const destination = q.get("destination") ?? "";
    const departDate = q.get("departDate") ?? "";
    const returnDate = q.get("returnDate") ?? "";
    const adults = q.get("adults") ?? "2";
    const children = q.get("children") ?? "0";
    const rooms = q.get("rooms") ?? "1";
    const cityForStay = parseCityName(destination);
    const startWith = q.get("startWith") === "flight" ? "flight" : "stay";

    if (startWith === "stay") {
      const p = new URLSearchParams({ city: cityForStay, checkIn: departDate, checkOut: returnDate, adults, children, rooms, packageMode: "1", origin, destination });
      return ctx.redirect(`/search/stays?${p.toString()}`);
    }
    const p = new URLSearchParams({ origin, destination, departDate, returnDate, adults, children, tripType: "round_trip", packageMode: "1", cityForStay, rooms });
    return ctx.redirect(`/search/flights?${p.toString()}`);
  });

  router.get("/packages/:id", (ctx: Ctx) => {
    const db = getDb();
    const row = db.prepare("SELECT * FROM featured_packages WHERE id = ?").get(ctx.params.id) as
      | { id: string; stay_room_id: string; outbound_flight_id: string; return_flight_id: string | null; nights: number; package_discount_cents: number }
      | undefined;
    if (!row) return ctx.redirect("/");
    const outbound = getFlightOfferById(row.outbound_flight_id);
    const ret = row.return_flight_id ? getFlightOfferById(row.return_flight_id) : undefined;
    if (!outbound) return ctx.redirect("/");
    const checkIn = outbound.arriveAt.slice(0, 10);
    const checkOut = ret ? ret.departAt.slice(0, 10) : new Date(new Date(checkIn).getTime() + row.nights * 86_400_000).toISOString().slice(0, 10);
    const p = new URLSearchParams({
      type: "package",
      outboundFlightId: row.outbound_flight_id,
      roomId: row.stay_room_id,
      checkIn,
      checkOut,
      adults: "2",
      children: "0",
      rooms: "1",
      featuredDiscountCents: String(row.package_discount_cents),
    });
    if (row.return_flight_id) p.set("returnFlightId", row.return_flight_id);
    return ctx.redirect(`/trip/review?${p.toString()}`);
  });
}
