import { html, raw, joinHtml, type SafeHtml } from "./html.ts";
import { formatMoney } from "../domain/pricing.ts";
import type { SupplierStatus } from "../adapters/types.ts";

export function statusBadge(status: SupplierStatus): SafeHtml {
  const label: Record<SupplierStatus, string> = {
    demo: "Demo — not bookable with real payment",
    sandbox: "Sandbox — supplier test environment",
    live: "Live",
    not_connected: "Not connected",
  };
  return html`<span class="badge badge--${status}">${label[status]}</span>`;
}

export function money(cents: number, currency = "USD"): SafeHtml {
  return html`${formatMoney(cents, currency)}`;
}

export function errorBox(message: string | undefined | null): SafeHtml {
  if (!message) return html``;
  return html`<div class="form-error" role="alert">${message}</div>`;
}

export function field(opts: { label: string; name: string; type?: string; value?: string; required?: boolean; help?: string; min?: string; placeholder?: string; autocomplete?: string }): SafeHtml {
  const id = `f-${opts.name}`;
  return html`
    <div class="field">
      <label for="${id}">${opts.label}${opts.required ? html` <span aria-hidden="true">*</span>` : html``}</label>
      <input id="${id}" name="${opts.name}" type="${opts.type ?? "text"}" value="${opts.value ?? ""}" ${opts.required ? raw("required") : raw("")} ${opts.min ? html`min="${opts.min}"` : html``} placeholder="${opts.placeholder ?? ""}" autocomplete="${opts.autocomplete ?? "off"}" />
      ${opts.help ? html`<p class="field-help">${opts.help}</p>` : html``}
    </div>
  `;
}

export function selectField(opts: { label: string; name: string; options: { value: string; label: string }[]; selected?: string; required?: boolean }): SafeHtml {
  const id = `f-${opts.name}`;
  const options = opts.options.map((o) => html`<option value="${o.value}" ${o.value === opts.selected ? raw("selected") : raw("")}>${o.label}</option>`);
  return html`
    <div class="field">
      <label for="${id}">${opts.label}</label>
      <select id="${id}" name="${opts.name}" ${opts.required ? raw("required") : raw("")}>
        ${joinHtml(options)}
      </select>
    </div>
  `;
}

export function productTabs(active: string, carry: URLSearchParams): SafeHtml {
  const tabs: { key: string; label: string; href: string }[] = [
    { key: "flights", label: "Flights", href: "/search/flights" },
    { key: "stays", label: "Stays", href: "/search/stays" },
    { key: "packages", label: "Flight + Stay", href: "/search/packages" },
    { key: "cruises", label: "Cruises", href: "/search/cruises" },
    { key: "cars", label: "Cars", href: "/search/cars" },
    { key: "activities", label: "Activities", href: "/search/activities" },
    { key: "rail", label: "Rail", href: "/search/rail" },
  ];
  // Carry over the fields that make sense across product types so switching
  // tabs preserves what the traveler already entered.
  const carried = new URLSearchParams();
  for (const key of ["adults", "children", "rooms", "cabin", "checkIn", "checkOut", "departDate", "returnDate", "city", "destination"]) {
    const v = carry.get(key);
    if (v) carried.set(key, v);
  }
  const qs = carried.toString();
  return html`
    <nav class="product-tabs" aria-label="Travel product">
      ${joinHtml(
        tabs.map((t) => html`<a class="product-tab${t.key === active ? " product-tab--active" : ""}" href="${t.href}${qs ? `?${qs}` : ""}"${t.key === active ? raw(' aria-current="page"') : raw("")}>${t.label}</a>`),
      )}
    </nav>
  `;
}

export function emptyState(title: string, body: string, actionHref?: string, actionLabel?: string): SafeHtml {
  return html`
    <div class="empty-state">
      <h2>${title}</h2>
      <p>${body}</p>
      ${actionHref && actionLabel ? html`<a class="btn btn--primary" href="${actionHref}">${actionLabel}</a>` : html``}
    </div>
  `;
}

export function connectionNotice(supplierName: string, status: SupplierStatus, notes: string | null): SafeHtml {
  if (status === "live") return html``;
  return html`
    <div class="connection-notice connection-notice--${status}">
      <strong>${status === "not_connected" ? "No supplier connected yet." : status === "demo" ? "Showing demo data." : "Showing sandbox data."}</strong>
      <span> Supplier: ${supplierName}.</span>
      ${notes ? html` <span>${notes}</span>` : html``}
    </div>
  `;
}
