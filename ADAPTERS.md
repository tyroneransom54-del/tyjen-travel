# Supplier adapters

## The interface

Every travel product (flights, stays, cruises, cars, activities, rail) is reached through a small adapter module under `src/adapters/`. The rest of the app — search UI, sort/filter, quote engine, booking engine — only ever touches the **normalized types** defined in `src/adapters/types.ts` (`NormalizedFlightOffer`, `NormalizedStayProperty`/`NormalizedRoomRate`, `NormalizedCruiseSailing`, plus the shared `ConnectionStatusInfo`). Adding or replacing a supplier means implementing that interface and registering it — no UI or booking-engine code needs to change, because it never sees a supplier's raw response shape.

Every normalized offer carries an honest `status`:

| Status | Meaning | May be booked with real money? |
|---|---|---|
| `not_connected` | No supplier wired up. Search still works and says so. | No — there's nothing to book. |
| `demo` | Realistic fictional data for exploring the product/UI. | No — labeled "Demo" everywhere it appears, and the booking engine never treats a demo item as real. |
| `sandbox` | A real supplier's test environment is connected. | No — looks real, books against nothing. |
| `live` | A contracted, production supplier is connected. | Yes — the only status the app should ever let stand as a real, chargeable booking. |

An admin sets each product's status and supplier name at **Admin → Supplier Connections** (`src/http/routes/admin.ts`), backed by the `supplier_connections` table. This is a real, functioning switch: setting a product to `not_connected` makes its search adapter return zero results (with the honest explanation), even for the products that ship with demo data — an admin can turn "flights" off entirely without touching code, and the search screen reflects that immediately. This was a real bug during my own end-to-end testing (the connection setting only changed the label, not whether results appeared) — it's fixed now and covered by manual verification; see LIMITATIONS.md.

## What's implemented today

| Product | Adapter file | Status shipped | What it does |
|---|---|---|---|
| Flights | `src/adapters/flights.demo.ts` | `demo` | Realistic fictional fares seeded by `seed.ts` (5 fictional airlines, JFK↔LAX). Full fields: cabin, fare type, stops/layovers, duration, bag/change/refund policy text, per-traveler total. |
| Stays | `src/adapters/stays.demo.ts` | `demo` | 5 fictional Los Angeles properties with multiple room rates each: nightly rate, taxes/fees, pay-now vs. pay-at-property, cancellation deadline. |
| Packages | Composes the flights + stays demo adapters | `demo` | No separate adapter — a package is a flight selection + a room selection assembled together (`src/http/routes/trip.ts`). |
| Cruises | `src/adapters/cruises.demo.ts` | `demo` | 4 fictional cruise lines/sailings: itinerary/ports, multiple cabin categories, taxes & port fees, deposit, payment schedule, cancellation terms. |
| Cars | `src/adapters/unconnected.ts` | `not_connected` | Full search UI exists; adapter always returns zero results with an honest "no supplier connected" notice. Never fabricates a car rental result. |
| Activities | `src/adapters/unconnected.ts` | `not_connected` | Same as Cars. |
| Rail | `src/adapters/unconnected.ts` | `not_connected` | Same as Cars. |

Every demo/sandbox result also carries `bookingHandledBy: "tyjen" | "provider"`, driven by the connection's `canBookWithTyjen` flag — this is what decides whether checkout offers "Book with TyJen" at all for that item, or only "Book with provider" (handoff, no payment taken by TyJen).

## Going live: what each product needs

None of this is guesswork about "some API somewhere" — this is the concrete checklist for what a real integration needs before its status can honestly move to `sandbox` or `live`.

### Flights

- **A GDS/NDC aggregator contract** — e.g. Amadeus for Developers (Self-Service or Enterprise), Sabre Dev Studio, Travelport, or a consolidator that already holds airline agreements (typical for independent contractor agents working under a host agency's ARC/IATA number).
- Credentials: API key + secret (`FLIGHTS_LIVE_API_KEY` / `FLIGHTS_LIVE_API_SECRET` in `.env.example`), environment flag (`FLIGHTS_LIVE_ENV=sandbox|production`).
- **Ticketing authority**: confirm with your host agency whether *they* hold the ARC/IATA number tickets are issued under, or whether you have your own. `HOST_AGENCY_TICKETING_AUTHORITY` in Admin → Agency Settings must reflect the true answer — the app never assumes TyJen itself holds ticketing authority (see LIMITATIONS.md).
- Replace `src/adapters/flights.demo.ts`'s `searchFlights`/`getFlightOfferById`/`recheckFlightOffer` with real calls; keep the same return shapes.
- The pre-checkout price/availability recheck (`recheckFlightOffer`) must become a real live-price call — this is not optional; it's what prevents charging a customer for a fare that changed or sold out between search and checkout.

### Stays

- **A stays API** — Expedia Rapid (formerly EPS Rapid), Booking.com Partner/Affiliate API, or a GDS's hotel module your host agency already has access to.
- Credentials: API key + secret, sandbox vs. production flag (`STAYS_LIVE_*` in `.env.example`).
- Replace `src/adapters/stays.demo.ts`. Same recheck requirement as flights (`recheckRoomRate`).
- Confirm whether the contract lets TyJen take payment directly (`canBookWithTyjen`) or requires customers to complete payment on the supplier's own checkout (provider handoff) — this determines the `canBookWithTyjen` setting per connection, which the UI and booking engine already fully respect.

### Cruises

- **A cruise-line or cruise-aggregator API/contract.** Cruise distribution is more fragmented than flights/stays — expect either individual line agreements (through your host agency) or an aggregator. The project's target is coverage across roughly 6 major lines; this build's demo data uses 4 fictional lines as placeholders for that shape.
- Credentials: `CRUISES_LIVE_*` in `.env.example`.
- Replace `src/adapters/cruises.demo.ts`. **Do not** substitute scraped/estimated cruise prices for real bookable inventory — if a real contract isn't in place yet, leave the connection at `not_connected` or `demo` rather than presenting unverified numbers as bookable.

### Cars, Activities, Rail

- No adapter exists yet — these are "designed but not connected" by requirement. Building one means: (1) implement the same normalized-type pattern as flights/stays/cruises in a new `src/adapters/<product>.<supplier>.ts` file, (2) register it in `src/adapters/registry.ts`, (3) the existing search route/UI for that product (`src/http/routes/pages.search.unconnected.ts` currently) needs to call the new adapter instead of `searchUnconnected`.
- Candidate integrations: cars — a rental aggregator (e.g. a GDS car module, or a direct supplier API); activities — Viator/GetYourGuide partner APIs; rail — a regional rail API (e.g. Amtrak, Eurail, or a country-specific rail API), which varies enormously by geography.

## Credential checklist (copy this before contacting any supplier)

For each product you intend to connect:

1. **Contract type**: direct supplier agreement, or GDS/aggregator that already covers it?
2. **Sandbox availability**: can you get sandbox/test credentials before a production contract is signed? (Strongly recommended — connect at `sandbox` status first.)
3. **Credentials**: API key, secret, account/agency ID, and whichever of these map to the `.env.example` placeholders for that product.
4. **Who holds ticketing/booking authority**: your host agency, a consolidator, or (rare for an independent contractor) you directly? This must match what's configured in Admin → Agency Settings.
5. **Can the integration take payment on TyJen's checkout**, or does it require redirecting to the supplier's own payment page? This decides the `canBookWithTyjen` setting.
6. **Rate limits / caching requirements** the supplier's terms impose on search results (many suppliers prohibit caching prices for more than a few minutes — relevant to how aggressively you can pre-fetch or cache).
7. **Webhook/callback requirements** for booking confirmation or cancellation notifications, if any.
8. **Commission or net-rate structure**, so `agent_profiles.commission_rate_bps` and quote pricing reflect it correctly.

Once you have real credentials: fill in the matching `.env` variables, implement the adapter against the interface in `types.ts`, and flip the connection's status at Admin → Supplier Connections from `not_connected`/`demo` to `sandbox` (test first!) and finally `live`. Nothing else in the app needs to change.
