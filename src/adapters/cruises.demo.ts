// DEMO cruise adapter. Backed by seeded `cruise_sailings`, never scraped
// prices — see project requirement 7 ("do not substitute scraped cruise
// prices for bookable inventory"). Designed for adapters per cruise line to
// be added later (a target of major lines is documented in ADAPTERS.md);
// this build ships one demo dataset spanning several fictional lines so the
// comparison UI has something real to compare.
import { getDb, fromJson } from "../db/client.ts";
import { getConnection } from "./registry.ts";
import type { CruiseSearchParams, NormalizedCabinCategory, NormalizedCruiseSailing } from "./types.ts";

interface SailingRow {
  id: string;
  line_name: string;
  ship_name: string;
  itinerary_name: string;
  departure_port: string;
  ports: string;
  depart_date: string;
  return_date: string;
  nights: number;
  cabin_categories: string;
  inclusions: string;
  taxes_port_fees_cents: number;
  deposit_cents: number;
  payment_schedule: string;
  cancellation_terms: string;
  supplier: string;
  currency: string;
}

function toNormalized(row: SailingRow): NormalizedCruiseSailing {
  const connection = getConnection("cruises");
  const cabins = fromJson<NormalizedCabinCategory[]>(row.cabin_categories, []);
  return {
    id: row.id,
    supplier: row.supplier,
    status: connection.status === "not_connected" ? "demo" : connection.status,
    bookingHandledBy: connection.canBookWithTyjen ? "tyjen" : "provider",
    lineName: row.line_name,
    shipName: row.ship_name,
    itineraryName: row.itinerary_name,
    departurePort: row.departure_port,
    ports: fromJson(row.ports, []),
    departDate: row.depart_date,
    returnDate: row.return_date,
    nights: row.nights,
    cabinCategories: cabins,
    inclusions: fromJson<string[]>(row.inclusions, []),
    taxesPortFeesCents: row.taxes_port_fees_cents,
    depositCents: row.deposit_cents,
    paymentSchedule: row.payment_schedule,
    cancellationTerms: row.cancellation_terms,
    currency: row.currency,
    fromTotalCents: Math.min(...cabins.map((c) => c.priceCents)) + row.taxes_port_fees_cents,
  };
}

export interface CruiseSearchResult {
  connection: ReturnType<typeof getConnection>;
  sailings: NormalizedCruiseSailing[];
}

export async function searchCruises(params: CruiseSearchParams): Promise<CruiseSearchResult> {
  const db = getDb();
  const connection = getConnection("cruises");
  // Honor an admin's explicit "not_connected" setting (Admin > Supplier
  // Connections) by actually returning no sailings, rather than quietly
  // continuing to serve the demo dataset regardless of that setting.
  if (connection.status === "not_connected") {
    return { connection, sailings: [] };
  }
  let sql = `SELECT * FROM cruise_sailings WHERE depart_date >= ? AND depart_date <= ?`;
  const args: unknown[] = [params.dateFrom, params.dateTo];
  if (params.departurePort) {
    sql += ` AND departure_port LIKE ?`;
    args.push(`%${params.departurePort}%`);
  }
  if (params.line) {
    sql += ` AND line_name LIKE ?`;
    args.push(`%${params.line}%`);
  }
  if (params.nightsMin !== undefined) {
    sql += ` AND nights >= ?`;
    args.push(params.nightsMin);
  }
  if (params.nightsMax !== undefined) {
    sql += ` AND nights <= ?`;
    args.push(params.nightsMax);
  }
  sql += ` ORDER BY depart_date ASC`;
  const rows = db.prepare(sql).all(...(args as [])) as SailingRow[];
  return { connection, sailings: rows.map(toNormalized) };
}

export function getCruiseSailingById(id: string): NormalizedCruiseSailing | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM cruise_sailings WHERE id = ?").get(id) as SailingRow | undefined;
  return row ? toNormalized(row) : undefined;
}
