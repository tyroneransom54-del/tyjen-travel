import type { Router } from "../router.ts";
import { html, joinHtml } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { getDb, fromJson } from "../../db/client.ts";
import { money } from "../../views/components.ts";

interface DestinationRow { id: string; name: string; teaser: string | null; image_url: string | null }
interface PackageRow { id: string; title: string; description: string | null; hero_image_url: string | null; nights: number; package_discount_cents: number; stay_room_id: string; outbound_flight_id: string; return_flight_id: string | null }

export function registerHomeRoutes(router: Router) {
  router.get("/", (ctx) => {
    const db = getDb();
    const destinations = db.prepare("SELECT * FROM featured_destinations WHERE active = 1 ORDER BY sort_order").all() as DestinationRow[];
    const packages = db.prepare("SELECT * FROM featured_packages").all() as PackageRow[];

    ctx.html(
      200,
      page(
        { title: "Your adventure awaits", user: ctx.user, activeNav: "home" },
        html`
          <section class="hero">
            <div class="hero__content">
              <h1>TyJen Travel</h1>
              <p class="hero__tagline">Your adventure awaits.</p>
              <p class="hero__sub">Search flights, stays, packages, and cruises — with a real independent travel agent ready to help when you want one.</p>
            </div>
          </section>

          <section class="search-panel" aria-labelledby="search-heading">
            <h2 id="search-heading" class="sr-only">Search for travel</h2>
            <form class="quick-search" method="get" action="/search/flights">
              <div class="quick-search__tabs">
                <a class="quick-search__tab quick-search__tab--active" href="#" aria-current="true">Flights</a>
                <a class="quick-search__tab" href="/search/stays">Stays</a>
                <a class="quick-search__tab" href="/search/packages">Flight + Stay</a>
                <a class="quick-search__tab" href="/search/cruises">Cruises</a>
              </div>
              <div class="quick-search__grid">
                <div class="field"><label for="qs-origin">From</label><input id="qs-origin" name="origin" placeholder="JFK — New York" required list="airport-list" /></div>
                <div class="field"><label for="qs-destination">To</label><input id="qs-destination" name="destination" placeholder="LAX — Los Angeles" required list="airport-list" /></div>
                <div class="field"><label for="qs-depart">Depart</label><input id="qs-depart" name="departDate" type="date" required /></div>
                <div class="field"><label for="qs-return">Return</label><input id="qs-return" name="returnDate" type="date" /></div>
                <div class="field"><label for="qs-adults">Travelers</label><input id="qs-adults" name="adults" type="number" min="1" value="1" /></div>
                <button class="btn btn--primary quick-search__submit" type="submit">Search flights</button>
              </div>
              <datalist id="airport-list">
                <option value="JFK — New York (JFK)"></option>
                <option value="LAX — Los Angeles (LAX)"></option>
                <option value="ORD — Chicago (ORD)"></option>
                <option value="MIA — Miami (MIA)"></option>
                <option value="SEA — Seattle (SEA)"></option>
              </datalist>
            </form>
          </section>

          <section class="destinations" aria-labelledby="destinations-heading">
            <h2 id="destinations-heading">Destination inspiration</h2>
            <div class="card-grid">
              ${joinHtml(
                destinations.map(
                  (d) => html`
                    <article class="destination-card">
                      <img src="${d.image_url ?? ""}" alt="" loading="lazy" />
                      <div class="destination-card__body">
                        <h3>${d.name}</h3>
                        <p>${d.teaser ?? ""}</p>
                      </div>
                    </article>
                  `,
                ),
              )}
            </div>
          </section>

          ${packages.length
            ? html`
              <section class="featured-offers" aria-labelledby="offers-heading">
                <h2 id="offers-heading">Featured offer <span class="badge badge--demo">Demo</span></h2>
                <div class="card-grid">
                  ${joinHtml(
                    packages.map(
                      (p) => html`
                        <article class="offer-card">
                          <img src="${p.hero_image_url ?? ""}" alt="" loading="lazy" />
                          <div class="offer-card__body">
                            <h3>${p.title}</h3>
                            <p>${p.description ?? ""}</p>
                            <p class="offer-card__meta">${p.nights} nights · Save ${money(p.package_discount_cents)} vs. booking separately (when prices are current)</p>
                            <a class="btn btn--secondary" href="/packages/${p.id}">View package</a>
                          </div>
                        </article>
                      `,
                    ),
                  )}
                </div>
              </section>
            `
            : html``}

          <section class="trust-photos" aria-label="Travelers enjoying their trips">
            <figure>
              <img src="https://picsum.photos/seed/tyjen-travelers-1/900/600" alt="Two travelers laughing while looking at a map on a scenic overlook." loading="lazy" />
              <figcaption>Placeholder photo (Lorem Picsum) — replace with a licensed image of travelers before production use. See /public/images/ATTRIBUTION.md.</figcaption>
            </figure>
            <figure>
              <img src="https://picsum.photos/seed/tyjen-travelers-2/900/600" alt="A family relaxing together on a beach at sunset." loading="lazy" />
              <figcaption>Placeholder photo (Lorem Picsum) — replace with a licensed image of travelers before production use. See /public/images/ATTRIBUTION.md.</figcaption>
            </figure>
          </section>

          <section class="cta-strip">
            <h2>Prefer a human touch?</h2>
            <p>Every search on TyJen Travel can be handed to an independent contractor agent affiliated with our host agency, who can build you a quote and help you book — no pressure, no obligation.</p>
            <a class="btn btn--secondary" href="/register?role=agent">Are you an agent? Apply for access</a>
          </section>
        `,
      ),
    );
  });

  router.get("/legal/demo-notice", (ctx) => {
    ctx.html(
      200,
      page(
        { title: "About this demo", user: ctx.user },
        html`
          <div class="prose">
            <h1>About this demo</h1>
            <p>TyJen Travel, as configured right now, runs entirely on seeded demonstration data for flights, stays, and cruises. Nothing shown as "Demo" is a real, bookable offer, and no real payment is ever collected by the mock checkout flow.</p>
            <p>See the project's <code>CAPABILITIES.md</code> and <code>LIMITATIONS.md</code> files (shipped alongside the source code) for a full breakdown of what is demo, sandbox, or live in this build.</p>
          </div>
        `,
      ),
    );
  });
}
