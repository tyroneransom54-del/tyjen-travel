// DEMO flight adapter. Data comes from the `flight_offers` table seeded by
// src/seed.ts with realistic fictional fares — never real airline
// inventory. Every offer returned here carries status "demo" so the UI can
// (and does) label it clearly and refuse to let it be booked with real
// payment. See ADAPTERS.md for what a live GDS/NDC integration would need to
// replace this file without changing any calling code.
import { getDb, fromJson } from "../db/client.ts";
import { getConnection } from "./registry.ts";
import type { FlightLegRequest, FlightSearchParams, NormalizedFlightOffer, Layover } from "./types.ts";

interface FlightOfferRow {
  id: string;
  origin: string;
  destination: string;
  depart_at: string;
  arrive_at: string;
  marketing_airline: string;
  operating_airline: string;
  flight_number: string;
  cabin: string;
  fare_type: string;
  stops: number;
  layovers: string;
  duration_minutes: number;
  base_fare_cents: number;
  taxes_cents: number;
  fees_cents: number;
  currency: string;
  carry_on_policy: string;
  checked_bag_policy: string;
  change_policy: string;
  refund_policy: string;
  supplier: string;
  seats_available: number;
  last_checked_at: string;
}

function toNormalized(row: FlightOfferRow, legIndex: number): NormalizedFlightOffer {
  const connection = getConnection("flights");
  return {
    id: row.id,
    legIndex,
    supplier: row.supplier,
    status: connection.status === "not_connected" ? "demo" : connection.status,
    bookingHandledBy: connection.canBookWithTyjen ? "tyjen" : "provider",
    marketingAirline: row.marketing_airline,
    operatingAirline: row.operating_airline,
    flightNumber: row.flight_number,
    origin: row.origin,
    destination: row.destination,
    departAt: row.depart_at,
    arriveAt: row.arrive_at,
    stops: row.stops,
    layovers: fromJson<Layover[]>(row.layovers, []),
    durationMinutes: row.duration_minutes,
    cabin: row.cabin as NormalizedFlightOffer["cabin"],
    fareType: row.fare_type,
    baseFareCents: row.base_fare_cents,
    taxesCents: row.taxes_cents,
    feesCents: row.fees_cents,
    totalCents: row.base_fare_cents + row.taxes_cents + row.fees_cents,
    currency: row.currency,
    carryOnPolicy: row.carry_on_policy,
    checkedBagPolicy: row.checked_bag_policy,
    changePolicy: row.change_policy,
    refundPolicy: row.refund_policy,
    seatsAvailable: row.seats_available,
    lastCheckedAt: row.last_checked_at,
  };
}

function searchLeg(leg: FlightLegRequest, cabin: string, legIndex: number): NormalizedFlightOffer[] {
  const db = getDb();
  const dayStart = `${leg.date}T00:00:00`;
  const dayEnd = `${leg.date}T23:59:59`;
  const rows = db
    .prepare(
      `SELECT * FROM flight_offers
       WHERE origin = ? AND destination = ? AND cabin = ?
         AND depart_at >= ? AND depart_at <= ?
       ORDER BY (base_fare_cents + taxes_cents + fees_cents) ASC`,
    )
    .all(leg.origin.toUpperCase(), leg.destination.toUpperCase(), cabin, dayStart, dayEnd) as FlightOfferRow[];
  return rows.map((r) => toNormalized(r, legIndex));
}

export interface FlightSearchResult {
  connection: ReturnType<typeof getConnection>;
  legs: { request: FlightLegRequest; offers: NormalizedFlightOffer[] }[];
}

export async function searchFlights(params: FlightSearchParams): Promise<FlightSearchResult> {
  const connection = getConnection("flights");
  // An admin who sets this connection to "not_connected" (Admin > Supplier
  // Connections) means it: search must honestly return no offers rather
  // than silently keep serving the demo dataset, otherwise the admin
  // control would have no real effect on what customers see.
  if (connection.status === "not_connected") {
    return { connection, legs: params.legs.map((leg) => ({ request: leg, offers: [] })) };
  }
  const legs = params.legs.map((leg, i) => ({
    request: leg,
    offers: searchLeg(leg, params.cabin, i).filter(
      (o) => params.maxStops === undefined || o.stops <= params.maxStops,
    ),
  }));
  return { connection, legs };
}

export function getFlightOfferById(id: string): NormalizedFlightOffer | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM flight_offers WHERE id = ?").get(id) as FlightOfferRow | undefined;
  return row ? toNormalized(row, 0) : undefined;
}

export interface RecheckResult {
  ok: boolean;
  reason?: "price_changed" | "sold_out";
  previousTotalCents?: number;
  newTotalCents?: number;
  offer?: NormalizedFlightOffer;
}

/**
 * Simulates the mandatory pre-checkout recheck against the supplier. In this
 * demo adapter the simulation is deterministic and controllable so the
 * required "price changed" / "sold out" demonstrations are reproducible:
 *   - An offer with 0 seats remaining (an agent/seed can set this) => sold out
 *   - Appending "?simulate=price_change" style flag via `force` => price bump
 * A live adapter would replace this body with a real supplier price/availability
 * call and return the same RecheckResult shape.
 */
export function recheckFlightOffer(id: string, force?: "sold_out" | "price_changed"): RecheckResult {
  const offer = getFlightOfferById(id);
  if (!offer) return { ok: false, reason: "sold_out" };
  if (force === "sold_out" || offer.seatsAvailable <= 0) {
    return { ok: false, reason: "sold_out" };
  }
  if (force === "price_changed") {
    const bumped = Math.round(offer.totalCents * 1.08);
    return {
      ok: false,
      reason: "price_changed",
      previousTotalCents: offer.totalCents,
      newTotalCents: bumped,
      offer: { ...offer, totalCents: bumped, baseFareCents: bumped - offer.taxesCents - offer.feesCents },
    };
  }
  return { ok: true, offer };
}
