// Assembles a "trip in progress" purely from query-string parameters (no
// server-side cart table needed): a flight, a stay room, a cruise cabin, or
// a flight+stay package. This same assembly function is reused by the
// review page and by the checkout page's mandatory pre-checkout recheck, so
// there is exactly one place that turns "what the traveler picked" into
// priced line items.
import { getFlightOfferById, recheckFlightOffer } from "../../adapters/flights.demo.ts";
import { getRoomRateById, recheckRoomRate } from "../../adapters/stays.demo.ts";
import { getCruiseSailingById } from "../../adapters/cruises.demo.ts";
import { comparePackageSavings } from "../../domain/pricing.ts";
import type { NormalizedFlightOffer, NormalizedRoomRate, SupplierStatus } from "../../adapters/types.ts";

export type TripType = "flight" | "stay" | "package" | "cruise";

export interface TripLineItem {
  itemType: "flight" | "stay_room" | "cruise_cabin";
  refId: string;
  description: string;
  supplier: string;
  quantity: number;
  unitPriceCents: number;
  taxesCents: number;
  feesCents: number;
  totalCents: number;
  terms: Record<string, unknown>;
  bookingHandledBy: "tyjen" | "provider";
  status: SupplierStatus;
}

export interface AssembledTrip {
  type: TripType;
  travelers: number;
  items: TripLineItem[];
  totalCents: number;
  currency: string;
  savings?: { comparable: boolean; savingsCents?: number };
  missing?: string[];
}

export function assembleTrip(q: URLSearchParams): AssembledTrip {
  const type = (q.get("type") as TripType) || "flight";
  const adults = Math.max(1, Number.parseInt(q.get("adults") ?? "1", 10) || 1);
  const children = Math.max(0, Number.parseInt(q.get("children") ?? "0", 10) || 0);
  const travelers = adults + children;
  const rooms = Math.max(1, Number.parseInt(q.get("rooms") ?? "1", 10) || 1);
  const items: TripLineItem[] = [];
  const missing: string[] = [];

  function addFlight(offer: NormalizedFlightOffer | undefined, label: string) {
    if (!offer) {
      missing.push(label);
      return;
    }
    items.push({
      itemType: "flight",
      refId: offer.id,
      description: `${offer.marketingAirline} ${offer.flightNumber} — ${offer.origin} to ${offer.destination}`,
      supplier: offer.supplier,
      quantity: travelers,
      unitPriceCents: offer.baseFareCents,
      taxesCents: offer.taxesCents,
      feesCents: offer.feesCents,
      totalCents: offer.totalCents * travelers,
      terms: { carryOn: offer.carryOnPolicy, checked: offer.checkedBagPolicy, change: offer.changePolicy, refund: offer.refundPolicy },
      bookingHandledBy: offer.bookingHandledBy,
      status: offer.status,
    });
  }

  function addRoom(room: NormalizedRoomRate | undefined, propertyLabel: string) {
    if (!room) {
      missing.push("stay room");
      return;
    }
    items.push({
      itemType: "stay_room",
      refId: room.id,
      description: `${room.name}${propertyLabel ? ` at ${propertyLabel}` : ""} — ${room.nights} night${room.nights === 1 ? "" : "s"}`,
      supplier: "TyJen Demo Stays",
      quantity: rooms,
      unitPriceCents: room.nightlyRateCents * room.nights,
      taxesCents: room.taxesCents,
      feesCents: room.feesCents + room.payAtPropertyCents,
      totalCents: room.totalCents * rooms,
      terms: { cancellationDeadline: room.cancellationDeadline, refundable: room.refundable, paymentTiming: room.paymentTiming },
      bookingHandledBy: "tyjen",
      status: "demo",
    });
  }

  if (type === "flight" || type === "package") {
    const outbound = getFlightOfferById(q.get("outboundFlightId") ?? "");
    addFlight(outbound, "outbound flight");
    const returnId = q.get("returnFlightId");
    if (returnId) addFlight(getFlightOfferById(returnId), "return flight");
  }
  if (type === "stay" || type === "package") {
    const checkIn = q.get("checkIn") ?? "";
    const checkOut = q.get("checkOut") ?? "";
    const room = getRoomRateById(q.get("roomId") ?? "", checkIn, checkOut);
    addRoom(room, "");
  }
  if (type === "cruise") {
    const sailing = getCruiseSailingById(q.get("sailingId") ?? "");
    const cabinCode = q.get("cabinCode") ?? "";
    if (!sailing) {
      missing.push("cruise sailing");
    } else {
      const cabin = sailing.cabinCategories.find((c) => c.code === cabinCode);
      if (!cabin) {
        missing.push("cabin category");
      } else {
        items.push({
          itemType: "cruise_cabin",
          refId: `${sailing.id}:${cabin.code}`,
          description: `${sailing.itineraryName} (${sailing.shipName}) — ${cabin.name} cabin`,
          supplier: sailing.lineName,
          quantity: travelers,
          unitPriceCents: cabin.priceCents,
          taxesCents: Math.round(sailing.taxesPortFeesCents / travelers),
          feesCents: 0,
          totalCents: cabin.priceCents * travelers + sailing.taxesPortFeesCents,
          terms: { paymentSchedule: sailing.paymentSchedule, cancellation: sailing.cancellationTerms, deposit: sailing.depositCents },
          bookingHandledBy: sailing.bookingHandledBy,
          status: sailing.status,
        });
      }
    }
  }

  const separateTotalCents = items.reduce((s, i) => s + i.totalCents, 0);
  let totalCents = separateTotalCents;
  let savings: AssembledTrip["savings"];
  const featuredDiscount = Number.parseInt(q.get("featuredDiscountCents") ?? "", 10);
  if (type === "package" && items.length === 2 && Number.isFinite(featuredDiscount) && featuredDiscount > 0) {
    // A featured package (see /packages/:id) advertises a fixed discount off
    // booking the same two items separately. We only ever show a savings
    // figure computed against the CURRENT separate total fetched in this
    // same request — never a cached/stale number — per domain/pricing.ts.
    totalCents = Math.max(0, separateTotalCents - featuredDiscount);
    savings = comparePackageSavings(totalCents, separateTotalCents);
  }
  const currency = "USD";

  return { type, travelers, items, totalCents, currency, savings, missing };
}

/** Re-runs the mandatory pre-checkout recheck against every item in an
 * assembled trip. Returns the first problem found, if any. */
export function recheckAssembledTrip(q: URLSearchParams, simulate: "sold_out" | "price_changed" | null): { ok: true } | { ok: false; reason: "sold_out" | "price_changed"; itemDescription: string; previousTotalCents?: number; newTotalCents?: number } {
  const type = (q.get("type") as TripType) || "flight";
  if (type === "flight" || type === "package") {
    const outboundId = q.get("outboundFlightId") ?? "";
    const outbound = getFlightOfferById(outboundId);
    const r = recheckFlightOffer(outboundId, simulate ?? undefined);
    if (!r.ok) return { ok: false, reason: r.reason!, itemDescription: outbound ? `${outbound.marketingAirline} ${outbound.flightNumber}` : "outbound flight", previousTotalCents: r.previousTotalCents, newTotalCents: r.newTotalCents };
    const returnId = q.get("returnFlightId");
    if (returnId) {
      const ret = getFlightOfferById(returnId);
      const r2 = recheckFlightOffer(returnId);
      if (!r2.ok) return { ok: false, reason: r2.reason!, itemDescription: ret ? `${ret.marketingAirline} ${ret.flightNumber}` : "return flight" };
    }
  }
  if (type === "stay" || type === "package") {
    const roomId = q.get("roomId") ?? "";
    const checkIn = q.get("checkIn") ?? "";
    const checkOut = q.get("checkOut") ?? "";
    const room = getRoomRateById(roomId, checkIn, checkOut);
    const r = recheckRoomRate(roomId, checkIn, checkOut, type === "stay" ? simulate ?? undefined : undefined);
    if (!r.ok) return { ok: false, reason: r.reason!, itemDescription: room ? room.name : "room rate", previousTotalCents: r.previousTotalCents, newTotalCents: r.newTotalCents };
  }
  if (type === "cruise" && simulate) {
    // Demo-only simulation hook for cruises, mirroring the flight/stay one.
    if (simulate === "sold_out") return { ok: false, reason: "sold_out", itemDescription: "cabin category" };
    if (simulate === "price_changed") return { ok: false, reason: "price_changed", itemDescription: "cabin category" };
  }
  return { ok: true };
}
