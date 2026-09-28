// ---------------------------------------------------------------------------
// Supplier adapter architecture
//
// Every travel product (flights, stays, cruises, cars, activities, rail) is
// reached through a small adapter interface that returns data already
// normalized into the shapes below. The UI, quote engine, and booking engine
// only ever deal with these normalized types — never with a supplier's raw
// response shape. That is what "adding another supplier without rewriting
// the UI" means in practice: implement the interface, register the adapter,
// and results from multiple suppliers of the same product type can be merged
// and sorted together because they already share one shape.
//
// `status` on every adapter is the honest truth shown in the UI:
//   - "not_connected": no supplier is wired up. The search screen still
//     works and explains this rather than returning fake "live" offers.
//   - "demo": realistic fictional data for exploring the product/UI. Always
//     labeled "Demo" wherever it is displayed, and never bookable with real
//     money or real inventory.
//   - "sandbox": a real supplier's test/sandbox environment is connected.
//     Data may look real but nothing is booked against live inventory.
//   - "live": a contracted, production supplier is connected. Only this
//     status may ever be presented as a real, bookable offer.
// ---------------------------------------------------------------------------

export type SupplierStatus = "not_connected" | "demo" | "sandbox" | "live";
export type ProductType = "flights" | "stays" | "packages" | "cruises" | "cars" | "activities" | "rail";
export type CabinClass = "economy" | "premium_economy" | "business" | "first";
export type TripType = "one_way" | "round_trip" | "multi_city";

export interface TravelerCounts {
  adults: number;
  children: number;
  infants: number;
}

export interface FlightLegRequest {
  origin: string;
  destination: string;
  date: string; // YYYY-MM-DD
}

export interface FlightSearchParams {
  tripType: TripType;
  legs: FlightLegRequest[]; // 1 leg for one-way, 2 for round trip (outbound+return), 2+ for multi-city
  travelers: TravelerCounts;
  cabin: CabinClass;
  flexibleDates?: boolean;
  maxStops?: number;
}

export interface Layover {
  airport: string;
  minutes: number;
}

export interface NormalizedFlightOffer {
  id: string;
  legIndex: number; // which requested leg this offer satisfies (0-based)
  supplier: string;
  status: SupplierStatus;
  bookingHandledBy: "tyjen" | "provider";
  marketingAirline: string;
  operatingAirline: string;
  flightNumber: string;
  origin: string;
  destination: string;
  departAt: string; // ISO with offset (local time at origin)
  arriveAt: string; // ISO with offset (local time at destination)
  stops: number;
  layovers: Layover[];
  durationMinutes: number;
  cabin: CabinClass;
  fareType: string;
  baseFareCents: number;
  taxesCents: number;
  feesCents: number;
  totalCents: number;
  currency: string;
  carryOnPolicy: string;
  checkedBagPolicy: string;
  changePolicy: string;
  refundPolicy: string;
  seatsAvailable: number;
  lastCheckedAt: string;
}

export interface StaySearchParams {
  city: string;
  checkIn: string; // YYYY-MM-DD
  checkOut: string; // YYYY-MM-DD
  adults: number;
  children: number;
  rooms: number;
}

export interface NormalizedRoomRate {
  id: string;
  propertyId: string;
  name: string;
  maxAdults: number;
  maxChildren: number;
  bedConfig: string | null;
  includedServices: string[];
  nights: number;
  nightlyRateCents: number;
  subtotalCents: number;
  taxesCents: number;
  feesCents: number;
  payAtPropertyCents: number;
  totalDueNowCents: number;
  totalCents: number;
  paymentTiming: "pay_now" | "pay_at_property" | "deposit_then_balance";
  refundable: boolean;
  cancellationDeadline: string; // ISO date/time
  currency: string;
  roomsAvailable: number;
}

export interface NormalizedStayProperty {
  id: string;
  supplier: string;
  status: SupplierStatus;
  bookingHandledBy: "tyjen" | "provider";
  name: string;
  propertyType: string;
  city: string;
  region: string | null;
  country: string;
  neighborhood: string | null;
  lat: number | null;
  lng: number | null;
  starRating: number | null;
  guestRating: number | null;
  reviewCount: number;
  amenities: string[];
  accessibilityFeatures: string[];
  photos: { url: string; alt: string; credit?: string }[];
  description: string | null;
  checkInTime: string;
  checkOutTime: string;
  fromTotalCents: number; // cheapest room total, for list sorting
  currency: string;
  rooms: NormalizedRoomRate[];
}

export interface CruiseSearchParams {
  departurePort?: string;
  dateFrom: string;
  dateTo: string;
  nightsMin?: number;
  nightsMax?: number;
  line?: string;
  adults: number;
  children: number;
}

export interface NormalizedCabinCategory {
  code: string;
  name: string;
  priceCents: number;
  occupancy: number;
}

export interface NormalizedCruiseSailing {
  id: string;
  supplier: string;
  status: SupplierStatus;
  bookingHandledBy: "tyjen" | "provider";
  lineName: string;
  shipName: string;
  itineraryName: string;
  departurePort: string;
  ports: { port: string; arrive: string | null; depart: string | null }[];
  departDate: string;
  returnDate: string;
  nights: number;
  cabinCategories: NormalizedCabinCategory[];
  inclusions: string[];
  taxesPortFeesCents: number;
  depositCents: number;
  paymentSchedule: string;
  cancellationTerms: string;
  currency: string;
  fromTotalCents: number;
}

export interface ConnectionStatusInfo {
  productType: ProductType;
  supplierName: string;
  status: SupplierStatus;
  canBookWithTyjen: boolean;
  notes: string | null;
}

/** Cars/Activities/Rail don't have a working demo dataset in this build, but
 * they still expose a real, honest interface: a search always returns an
 * empty result set plus a `connection` object the UI uses to explain status,
 * rather than ever inventing a "live" looking result. */
export interface UnconnectedSearchResult<TParams> {
  connection: ConnectionStatusInfo;
  params: TParams;
  results: [];
}
