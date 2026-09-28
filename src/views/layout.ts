import { html, raw, type SafeHtml } from "./html.ts";
import type { UserRecord } from "../domain/auth.ts";
import { getAgencySettings } from "../domain/agency.ts";

export interface LayoutOptions {
  title: string;
  user?: UserRecord;
  flash?: { kind: "success" | "error" | "info"; message: string } | null;
  activeNav?: string;
}

function navLink(href: string, label: string, active: boolean): SafeHtml {
  return html`<a class="nav-link${active ? " nav-link--active" : ""}" href="${href}"${active ? raw(' aria-current="page"') : raw("")}>${label}</a>`;
}

function navFor(user: UserRecord | undefined, activeNav: string | undefined): SafeHtml {
  if (!user) {
    return html`
      <a class="nav-link" href="/search/flights">Flights</a>
      <a class="nav-link" href="/search/stays">Stays</a>
      <a class="nav-link" href="/search/packages">Packages</a>
      <a class="nav-link" href="/search/cruises">Cruises</a>
      <a class="nav-link" href="/login">Sign in</a>
      <a class="nav-link nav-link--cta" href="/register">Create account</a>
    `;
  }
  if (user.role === "admin") {
    return html`
      ${navLink("/admin", "Dashboard", activeNav === "dashboard")}
      ${navLink("/admin/agents", "Agents", activeNav === "agents")}
      ${navLink("/admin/suppliers", "Suppliers", activeNav === "suppliers")}
      ${navLink("/admin/sessions", "Sessions", activeNav === "sessions")}
      ${navLink("/admin/audit-log", "Audit log", activeNav === "audit")}
      ${navLink("/admin/support", "Support", activeNav === "support")}
      ${navLink("/admin/agency-settings", "Agency settings", activeNav === "agency")}
      <a class="nav-link" href="/logout">Sign out</a>
    `;
  }
  if (user.role === "agent") {
    return html`
      ${navLink("/agent", "Dashboard", activeNav === "dashboard")}
      ${navLink("/agent/clients", "Clients", activeNav === "clients")}
      ${navLink("/agent/quotes", "Quotes", activeNav === "quotes")}
      ${navLink("/agent/bookings", "Bookings", activeNav === "bookings")}
      ${navLink("/agent/shortlist", "Shortlist", activeNav === "shortlist")}
      ${navLink("/search/flights", "Search", activeNav === "search")}
      <a class="nav-link" href="/logout">Sign out</a>
    `;
  }
  return html`
    ${navLink("/search/flights", "Flights", activeNav === "flights")}
    ${navLink("/search/stays", "Stays", activeNav === "stays")}
    ${navLink("/search/packages", "Packages", activeNav === "packages")}
    ${navLink("/search/cruises", "Cruises", activeNav === "cruises")}
    ${navLink("/my-trips", "My Trips", activeNav === "trips")}
    ${navLink("/account/favorites", "Favorites", activeNav === "favorites")}
    <a class="nav-link" href="/logout">Sign out</a>
  `;
}

export function page(opts: LayoutOptions, body: SafeHtml): string {
  const agency = getAgencySettings();
  const flash = opts.flash
    ? html`<div class="flash flash--${opts.flash.kind}" role="status">${opts.flash.message}</div>`
    : html``;
  return `<!doctype html>
${html`
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>${opts.title} | TyJen Travel</title>
  <meta name="description" content="TyJen Travel — Your adventure awaits. Flights, stays, packages, and cruises, with expert independent agent support." />
  <link rel="manifest" href="/manifest.webmanifest" />
  <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
  <meta name="theme-color" content="#0b5b62" />
  <link rel="stylesheet" href="/css/styles.css" />
</head>
<body>
  <a class="skip-link" href="#main-content">Skip to main content</a>
  <header class="site-header">
    <div class="site-header__inner">
      <a class="brand" href="/">
        <span class="brand__mark" aria-hidden="true">✈</span>
        <span class="brand__text">
          <span class="brand__name">TyJen Travel</span>
          <span class="brand__tagline">Your adventure awaits.</span>
        </span>
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="primary-nav" data-nav-toggle>
        <span class="sr-only">Menu</span>
        <span aria-hidden="true">≡</span>
      </button>
      <nav id="primary-nav" class="site-nav" aria-label="Primary">
        ${navFor(opts.user, opts.activeNav)}
      </nav>
    </div>
  </header>
  ${agency.host_agency_name ? html`<div class="disclosure-bar">Bookings on this site may be serviced by an independent contractor travel agent affiliated with <strong>${agency.host_agency_name}</strong>.${agency.has_ticketing_authority ? html`` : html` TyJen Travel does not hold ticketing authority for every supplier shown; see each offer for who handles booking.`}</div>` : html``}
  <main id="main-content" class="site-main">
    ${flash}
    ${body}
  </main>
  <footer class="site-footer">
    <div class="site-footer__inner">
      <div>
        <strong>TyJen Travel</strong> — Your adventure awaits.<br />
        Host agency: ${agency.host_agency_name} ${agency.host_agency_identifier !== "UNSET-CONTACT-YOUR-HOST-AGENCY" && agency.host_agency_identifier !== "UNSET" ? html`(ID: ${agency.host_agency_identifier})` : html``}
      </div>
      <div>
        Support: ${agency.support_phone ?? "n/a"} · ${agency.support_email ?? "n/a"}<br />
        <a href="/support">Contact support</a> · <a href="/legal/demo-notice">About this demo</a>
      </div>
    </div>
  </footer>
  <script src="/js/app.js" defer></script>
</body>
</html>`.value}`;
}

export function fragment(strings: TemplateStringsArray, ...values: unknown[]): SafeHtml {
  return html(strings, ...values);
}
