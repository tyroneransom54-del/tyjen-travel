# Known limitations

An honest list of what this build does not do yet, so nothing here is discovered by surprise.

## Supplier data

- **No real supplier is connected to anything.** Flights, stays, and cruises are realistic *fictional* demo data seeded by `npm run seed` — not real airline/hotel/cruise-line inventory or pricing, and not scraped from any real site. Cars, activities, and rail have complete search UIs but always return zero results, honestly labeled "no supplier connected" — see ADAPTERS.md for what connecting each would take.
- **Flight demo data covers one route** (JFK ↔ LAX) on fixed dates seeded by the seed script. Searching other routes will honestly return "no matching flights" rather than fabricating results for a route that isn't seeded.
- **The flight+stay package builder's demo inventory only pairs JFK↔LAX flights with Los Angeles stays**, for the same reason — there's demo data to actually match on that pairing. The UI says this on the package search page rather than hiding the constraint.
- **Multi-city flight search**: the underlying data model supports it (each leg is an independent search), but the search *form* in this build only exposes one-way and round-trip. Wiring a multi-leg input onto the existing multi-city-capable search function is a small, contained follow-up.

## Payments

- **Mock payment provider only.** `src/adapters/payments.mock.ts` simulates authorize/capture/void/decline deterministically (a card ending in "0002" always declines, "0069" simulates insufficient funds) so the required demonstrations are reproducible. No real payment processor (Stripe, etc.) is wired in, even though `.env.example` has placeholders for one. Connecting a real processor means implementing the same `authorize`/`capture`/`voidAuthorization`/`refund` shape against a real SDK — the booking state machine (`src/domain/bookings.ts`) already calls through that interface and does not need to change.
- No card numbers are ever stored, in either the mock or (by design) a future real integration — this was a hard requirement and is true in the current code.

## Email

- **No SMTP integration is wired up**, even though `.env.example` has SMTP placeholders. Every "email" (booking confirmation, quote-sent notice) is written to an `email_outbox` database table and logged to the console instead of actually sent. This is deliberate — see the comment in `src/domain/email.ts` — so the app is fully demoable and testable without needing a real email account, but it means **no customer will actually receive an email from this build until `sendEmail()` is pointed at a real SMTP/transactional-email API.**

## Auth / security hardening not yet built

These matter before accepting real customer traffic, and are not yet present:

- **No CSRF protection** on state-changing form submissions. Every POST route trusts the session cookie alone. Before a real deployment, add per-session CSRF tokens on forms (or same-site cookie policy plus custom-header checks on fetch-based writes).
- **No password-reset / "forgot password" flow.** An admin can currently help a locked-out user only by looking at the database directly. This is a real gap for a production login system.
- **No rate limiting** on login, registration, or search endpoints. A real deployment should add basic throttling (e.g. per-IP login attempt limits) to reduce credential-stuffing and scraping risk.
- **Session secret / admin password defaults**: `.env.example` ships an obviously-fake `SESSION_SECRET` and demo admin password. The app warns in the console if you run with the default secret, but it does not refuse to start — don't skip changing these before any non-local use (see DEPLOYMENT.md).

## Testing coverage

- The automated suite (`npm test`, `tests/*.test.ts`) covers password hashing/sessions, role-based access control, pricing math, and the full booking state machine (success, decline, post-authorization supplier failure, idempotent retry). It does **not** include browser-level UI tests (e.g. Playwright) — all UI verification for this build was done by manually driving the running server end-to-end (every scenario in the original spec: flight search and compare, stay search with room selection, a flight+stay package end to end, a cruise search and booking, an agent building and sending a quote, a customer viewing and accepting a shared quote, both booking paths, the price-changed/sold-out demo, the declined-payment and post-authorization-supplier-failure demos, and an admin granting and revoking agent access with the revoked session actually and immediately losing access).
- **`npm run typecheck` could not be run to completion in the sandbox this was built in**, because it depends on the `typescript`/`@types/node` devDependencies, and that sandbox's npm registry access was blocked (the same constraint that drove the zero-dependency architecture choice — see README.md). The app runs correctly under Node's own type-*stripping* (which doesn't type-check, just removes annotations), and every file that was touched during development was manually reviewed for type correctness, but a full `tsc --noEmit` pass has not been confirmed clean end-to-end. Run `npm run typecheck` yourself once you have normal npm access, and treat any errors it surfaces as real findings to fix.
- Two real bugs were found and fixed during this build's own end-to-end verification pass (not found by any external review): (1) cruise cabin prices displayed as "$NaN" due to a field-name mismatch between the seed data and the adapter's expected shape — fixed in `seed.ts`; (2) an admin setting a product's supplier connection to "not connected" had no actual effect on search results for flights/stays/cruises (only the demo dataset kept appearing) — fixed in all three demo adapters so that setting now honestly suppresses results, matching what the admin screen already claimed it did. A third issue — an agent submitting a stale/invalid client ID when creating a quote crashed the server with a raw database error instead of failing gracefully — was also found and fixed, using the existing `assertAgentOwnsClient` authorization check rather than a new one-off validation. All three are covered by either the automated tests or a repeated manual check after the fix.

## Scale

- SQLite (via `node:sqlite`) backs the whole app. This is genuinely fine for a single independent agent or small agency's real-world volume, but it is a single file on one server, not a horizontally-scaled database. See DEPLOYMENT.md's "Upgrading to PostgreSQL" section for the migration path if you outgrow it.

## Accessibility / responsive design

- Focus-visible states, a skip-to-content link, semantic form labels, and responsive breakpoints (down to mobile width) are all in place and were manually checked. No automated accessibility audit tool (e.g. Lighthouse/axe) was run against the live pages in this build — a worthwhile follow-up before a public launch.
