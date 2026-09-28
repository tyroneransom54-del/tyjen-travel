// DEMO stay adapter. Data comes from `stay_properties` / `stay_rooms` seeded
// with fictional contracted-looking inventory. Never fabricates a result to
// hit a minimum count — if fewer than 5 properties match, the caller (see
// src/http/routes/api.search.ts) returns the true count and the UI offers
// ways to broaden the search, per the product requirement.
import { getDb, fromJson } from "../db/client.ts";
import { getConnection } from "./registry.ts";
import type { NormalizedRoomRate, NormalizedStayProperty, StaySearchParams } from "./types.ts";

interface PropertyRow {
  id: string;
  name: string;
  property_type: string;
  city: string;
  region: string | null;
  country: string;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  star_rating: number | null;
  guest_rating: number | null;
  review_count: number;
  amenities: string;
  accessibility_features: string;
  photos: string;
  description: string | null;
  check_in_time: string;
  check_out_time: string;
  supplier: string;
}

interface RoomRow {
  id: string;
  property_id: string;
  name: string;
  max_adults: number;
  max_children: number;
  bed_config: string | null;
  included_services: string;
  nightly_rate_cents: number;
  currency: string;
  taxes_cents: number;
  fees_cents: number;
  pay_at_property_cents: number;
  payment_timing: NormalizedRoomRate["paymentTiming"];
  refundable: number;
  cancellation_deadline_hours_before: number;
  cancellation_terms: string;
  rooms_available: number;
}

function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(`${checkIn}T00:00:00Z`).getTime();
  const b = new Date(`${checkOut}T00:00:00Z`).getTime();
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

function toRoomRate(row: RoomRow, nights: number, checkIn: string): NormalizedRoomRate {
  const subtotal = row.nightly_rate_cents * nights;
  const taxes = row.taxes_cents * nights;
  const fees = row.fees_cents;
  const total = subtotal + taxes + fees + row.pay_at_property_cents;
  const dueNow = row.payment_timing === "pay_at_property" ? 0 : subtotal + taxes + fees;
  const cancelBy = new Date(new Date(`${checkIn}T00:00:00Z`).getTime() - row.cancellation_deadline_hours_before * 3_600_000);
  return {
    id: row.id,
    propertyId: row.property_id,
    name: row.name,
    maxAdults: row.max_adults,
    maxChildren: row.max_children,
    bedConfig: row.bed_config,
    includedServices: fromJson<string[]>(row.included_services, []),
    nights,
    nightlyRateCents: row.nightly_rate_cents,
    subtotalCents: subtotal,
    taxesCents: taxes,
    feesCents: fees,
    payAtPropertyCents: row.pay_at_property_cents,
    totalDueNowCents: dueNow,
    totalCents: total,
    paymentTiming: row.payment_timing,
    refundable: !!row.refundable,
    cancellationDeadline: cancelBy.toISOString(),
    currency: row.currency,
    roomsAvailable: row.rooms_available,
  };
}

export interface StaySearchResult {
  connection: ReturnType<typeof getConnection>;
  totalMatching: number;
  properties: NormalizedStayProperty[];
}

export async function searchStays(params: StaySearchParams): Promise<StaySearchResult> {
  const db = getDb();
  const connection = getConnection("stays");
  // Honor an admin's explicit "not_connected" setting (Admin > Supplier
  // Connections) by actually returning no properties, rather than quietly
  // continuing to serve the demo dataset regardless of that setting.
  if (connection.status === "not_connected") {
    return { connection, totalMatching: 0, properties: [] };
  }
  const nights = nightsBetween(params.checkIn, params.checkOut);
  const propertyRows = db
    .prepare(`SELECT * FROM stay_properties WHERE city LIKE ? ORDER BY guest_rating DESC`)
    .all(`%${params.city}%`) as PropertyRow[];

  const properties: NormalizedStayProperty[] = [];
  for (const p of propertyRows) {
    const roomRows = db
      .prepare(
        `SELECT * FROM stay_rooms WHERE property_id = ? AND max_adults >= ? AND rooms_available >= ? ORDER BY nightly_rate_cents ASC`,
      )
      .all(p.id, Math.min(params.adults, 8), params.rooms) as RoomRow[];
    if (roomRows.length === 0) continue;
    const rooms = roomRows.map((r) => toRoomRate(r, nights, params.checkIn));
    properties.push({
      id: p.id,
      supplier: p.supplier,
      status: connection.status === "not_connected" ? "demo" : connection.status,
      bookingHandledBy: connection.canBookWithTyjen ? "tyjen" : "provider",
      name: p.name,
      propertyType: p.property_type,
      city: p.city,
      region: p.region,
      country: p.country,
      neighborhood: p.neighborhood,
      lat: p.lat,
      lng: p.lng,
      starRating: p.star_rating,
      guestRating: p.guest_rating,
      reviewCount: p.review_count,
      amenities: fromJson<string[]>(p.amenities, []),
      accessibilityFeatures: fromJson<string[]>(p.accessibility_features, []),
      photos: fromJson(p.photos, []),
      description: p.description,
      checkInTime: p.check_in_time,
      checkOutTime: p.check_out_time,
      fromTotalCents: Math.min(...rooms.map((r) => r.totalCents)),
      currency: rooms[0]?.currency ?? "USD",
      rooms,
    });
  }
  return { connection, totalMatching: properties.length, properties };
}

export async function getStayProperty(id: string, checkIn: string, checkOut: string): Promise<NormalizedStayProperty | undefined> {
  const db = getDb();
  const connection = getConnection("stays");
  const p = db.prepare("SELECT * FROM stay_properties WHERE id = ?").get(id) as PropertyRow | undefined;
  if (!p) return undefined;
  const nights = nightsBetween(checkIn, checkOut);
  const roomRows = db.prepare("SELECT * FROM stay_rooms WHERE property_id = ? ORDER BY nightly_rate_cents ASC").all(id) as RoomRow[];
  const rooms = roomRows.map((r) => toRoomRate(r, nights, checkIn));
  return {
    id: p.id,
    supplier: p.supplier,
    status: connection.status === "not_connected" ? "demo" : connection.status,
    bookingHandledBy: connection.canBookWithTyjen ? "tyjen" : "provider",
    name: p.name,
    propertyType: p.property_type,
    city: p.city,
    region: p.region,
    country: p.country,
    neighborhood: p.neighborhood,
    lat: p.lat,
    lng: p.lng,
    starRating: p.star_rating,
    guestRating: p.guest_rating,
    reviewCount: p.review_count,
    amenities: fromJson<string[]>(p.amenities, []),
    accessibilityFeatures: fromJson<string[]>(p.accessibility_features, []),
    photos: fromJson(p.photos, []),
    description: p.description,
    checkInTime: p.check_in_time,
    checkOutTime: p.check_out_time,
    fromTotalCents: rooms.length ? Math.min(...rooms.map((r) => r.totalCents)) : 0,
    currency: rooms[0]?.currency ?? "USD",
    rooms,
  };
}

export function getRoomRateById(roomId: string, checkIn: string, checkOut: string): NormalizedRoomRate | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM stay_rooms WHERE id = ?").get(roomId) as RoomRow | undefined;
  if (!row) return undefined;
  return toRoomRate(row, nightsBetween(checkIn, checkOut), checkIn);
}

export interface RoomRecheckResult {
  ok: boolean;
  reason?: "price_changed" | "sold_out";
  previousTotalCents?: number;
  newTotalCents?: number;
  room?: NormalizedRoomRate;
}

export function recheckRoomRate(
  roomId: string,
  checkIn: string,
  checkOut: string,
  force?: "sold_out" | "price_changed",
): RoomRecheckResult {
  const room = getRoomRateById(roomId, checkIn, checkOut);
  if (!room) return { ok: false, reason: "sold_out" };
  if (force === "sold_out" || room.roomsAvailable <= 0) return { ok: false, reason: "sold_out" };
  if (force === "price_changed") {
    const bumped = Math.round(room.totalCents * 1.1);
    return { ok: false, reason: "price_changed", previousTotalCents: room.totalCents, newTotalCents: bumped, room: { ...room, totalCents: bumped } };
  }
  return { ok: true, room };
}
