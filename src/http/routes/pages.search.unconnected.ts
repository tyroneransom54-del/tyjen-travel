import type { Router } from "../router.ts";
import { html } from "../../views/html.ts";
import { page } from "../../views/layout.ts";
import { productTabs, connectionNotice } from "../../views/components.ts";
import { searchUnconnected } from "../../adapters/unconnected.ts";
import type { ProductType } from "../../adapters/types.ts";

const CONFIG: Record<string, { productType: ProductType; title: string; fields: { name: string; label: string; type?: string }[] }> = {
  cars: {
    productType: "cars",
    title: "Search cars",
    fields: [
      { name: "pickupLocation", label: "Pick-up location" },
      { name: "dropoffLocation", label: "Drop-off location (optional)" },
      { name: "pickupDate", label: "Pick-up date", type: "date" },
      { name: "dropoffDate", label: "Drop-off date", type: "date" },
      { name: "driverAge", label: "Driver age", type: "number" },
    ],
  },
  activities: {
    productType: "activities",
    title: "Search activities",
    fields: [
      { name: "destination", label: "Destination" },
      { name: "date", label: "Date", type: "date" },
      { name: "participants", label: "Participants", type: "number" },
    ],
  },
  rail: {
    productType: "rail",
    title: "Search rail",
    fields: [
      { name: "originStation", label: "From station" },
      { name: "destinationStation", label: "To station" },
      { name: "date", label: "Date", type: "date" },
      { name: "passengers", label: "Passengers", type: "number" },
    ],
  },
};

export function registerUnconnectedSearchRoutes(router: Router) {
  for (const [path, cfg] of Object.entries(CONFIG)) {
    router.get(`/search/${path}`, (ctx) => {
      const q = ctx.query;
      const params: Record<string, string> = {};
      for (const f of cfg.fields) params[f.name] = q.get(f.name) ?? "";
      const searched = Object.values(params).some((v) => v);
      const result = searchUnconnected(cfg.productType, params);

      ctx.html(
        200,
        page({ title: cfg.title, user: ctx.user, activeNav: "search" }, html`
          ${productTabs(path, q)}
          <h1>${cfg.title}</h1>
          ${connectionNotice(result.connection.supplierName, result.connection.status, result.connection.notes)}
          <form class="search-form" method="get" action="/search/${path}" novalidate>
            <div class="search-form__grid">
              ${cfg.fields
                .map((f) => html`<div class="field"><label for="uc-${f.name}">${f.label}</label><input id="uc-${f.name}" name="${f.name}" type="${f.type ?? "text"}" value="${params[f.name] ?? ""}" /></div>`)
                .reduce((acc, cur) => html`${acc}${cur}`, html``)}
            </div>
            <button class="btn btn--primary" type="submit">Search</button>
          </form>
          ${searched
            ? html`
                <div class="empty-state">
                  <h2>No ${cfg.title.replace("Search ", "").toLowerCase()} supplier is connected yet</h2>
                  <p>This screen and its adapter interface are fully designed (see ADAPTERS.md), but no contracted data source is wired up in this build, so we are showing you that honestly instead of inventing results. An administrator can connect a supplier from Admin &gt; Supplier Connections once credentials and a contract are in place.</p>
                </div>
              `
            : html`<p>Enter your search above. This product is ready for a supplier connection but has none configured in this demo.</p>`}
        `),
      );
    });
  }
}
