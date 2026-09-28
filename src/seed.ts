// Seeds a fresh database with fictional demo data: an agency, an admin, two
// agents (one authorized, one pending — for the admin-approval demo), five
// clients, flight/stay/cruise inventory, a featured package, and supplier
// connection rows. Every airline/cruise-line/hotel brand name here is
// invented specifically to avoid implying an unlicensed partnership with any
// real supplier (see ADAPTERS.md). Safe to re-run: it clears demo rows first.
import { getDb, runMigrations, closeDb, toJson } from "./db/client.ts";
import { newId } from "./domain/ids.ts";
import { createUser } from "./domain/auth.ts";
import { config } from "./config.ts";
import { upsertConnection } from "./adapters/registry.ts";
import { updateAgencySettings } from "./domain/agency.ts";
import { createQuote, addQuoteItem, transitionQuote } from "./domain/quotes.ts";
import { getFlightOfferById } from "./adapters/flights.demo.ts";
import { getRoomRateById } from "./adapters/stays.demo.ts";

runMigrations();
const db = getDb();

console.log("Seeding TyJen Travel demo data...");

// --- Wipe existing demo rows (idempotent re-seed) --------------------------
const tables = [
  "email_outbox", "support_cases", "payment_attempts", "booking_items", "bookings",
  "quote_items", "quotes", "favorites", "price_alerts", "shortlist_items", "saved_searches",
  "agent_tasks", "clients", "featured_packages", "cruise_sailings", "stay_rooms",
  "stay_properties", "flight_offers", "featured_destinations", "supplier_connections",
  "sessions", "agent_profiles", "users",
];
for (const t of tables) db.exec(`DELETE FROM ${t};`);

// --- Agency settings ---------------------------------------------------------
updateAgencySettings({
  host_agency_name: config.hostAgency.name,
  host_agency_identifier: config.hostAgency.identifier,
  has_ticketing_authority: config.hostAgency.hasTicketingAuthority ? 1 : 0,
  support_phone: config.hostAgency.supportPhone,
  support_email: config.hostAgency.supportEmail,
  required_disclosures:
    "TyJen Travel is operated by an independent contractor travel agent affiliated with the host agency shown above. " +
    "Demo mode: nothing on this site is a real booking or a real charge unless explicitly stated otherwise.",
});

// --- Users -------------------------------------------------------------------
const admin = createUser({ email: config.seedAdminEmail, password: config.seedAdminPassword, role: "admin", displayName: "Ty Jenkins (Admin)", status: "active" });

const agentAva = createUser({ email: "ava.agent@tyjentravel.demo", password: "AgentDemo123!", role: "agent", displayName: "Ava Ramirez", status: "active" });
db.prepare(`INSERT INTO agent_profiles (user_id, agent_identifier, authorized, booking_permissions, commission_rate_bps, bio, authorized_at, authorized_by_user_id) VALUES (?, ?, 1, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), ?)`).run(
  agentAva.id,
  "AGT-1001",
  toJson({ canBookWithTyJen: true, canCreateQuotes: true }),
  800,
  "Independent contractor agent specializing in family resorts and cruises.",
  admin.id,
);

const agentPending = createUser({ email: "marcus.pending@tyjentravel.demo", password: "AgentDemo123!", role: "agent", displayName: "Marcus Lee", status: "active" });
db.prepare(`INSERT INTO agent_profiles (user_id, agent_identifier, authorized, booking_permissions, commission_rate_bps, bio) VALUES (?, ?, 0, ?, ?, ?)`).run(
  agentPending.id,
  "AGT-1002",
  toJson({ canBookWithTyJen: false, canCreateQuotes: true }),
  600,
  "Newly registered independent contractor agent, awaiting agency authorization.",
);

const customerJordan = createUser({ email: "jordan.traveler@example.com", password: "TravelerDemo123!", role: "traveler", displayName: "Jordan Kim" });
const customerPriya = createUser({ email: "priya.traveler@example.com", password: "TravelerDemo123!", role: "traveler", displayName: "Priya Shah" });

console.log(`  Admin login:    ${config.seedAdminEmail} / ${config.seedAdminPassword}`);
console.log(`  Agent login:    ava.agent@tyjentravel.demo / AgentDemo123! (authorized)`);
console.log(`  Agent login:    marcus.pending@tyjentravel.demo / AgentDemo123! (pending admin approval)`);
console.log(`  Traveler login: jordan.traveler@example.com / TravelerDemo123!`);

// --- Clients (Ava's book of business) ---------------------------------------
const clientNames: [string, string, string][] = [
  ["The Kim Family", "jordan.traveler@example.com", "212-555-0101"],
  ["Priya Shah", "priya.traveler@example.com", "917-555-0110"],
  ["Devon & Alex Ortiz", "dortiz@example.com", "305-555-0133"],
  ["Grace Whitfield", "gwhitfield@example.com", "702-555-0144"],
  ["The Nguyen Family", "nguyens@example.com", "415-555-0155"],
];
const clientIds: string[] = [];
for (const [name, email, phone] of clientNames) {
  const id = newId("client");
  const linkedUser = email === "jordan.traveler@example.com" ? customerJordan.id : email === "priya.traveler@example.com" ? customerPriya.id : null;
  db.prepare(`INSERT INTO clients (id, agent_id, customer_user_id, full_name, email, phone, consent_status) VALUES (?, ?, ?, ?, ?, ?, 'granted')`).run(id, agentAva.id, linkedUser, name, email, phone);
  clientIds.push(id);
}

// --- Supplier connections (demo, honestly labeled) --------------------------
upsertConnection("flights", "TyJen Demo Fares", "demo", true, "Fictional fare data for demonstration. No real GDS/NDC contract is connected.", admin.id);
upsertConnection("stays", "TyJen Demo Stays", "demo", true, "Fictional property/rate data for demonstration. No real supplier API is connected.", admin.id);
upsertConnection("packages", "TyJen Demo Fares + TyJen Demo Stays", "demo", true, "Composed from the demo flight and stay adapters.", admin.id);
upsertConnection("cruises", "TyJen Demo Cruises", "demo", true, "Fictional sailing data for demonstration. No real cruise-line contract is connected.", admin.id);
upsertConnection("cars", "None", "not_connected", false, "No car rental supplier is connected yet. See ADAPTERS.md for requirements.", admin.id);
upsertConnection("activities", "None", "not_connected", false, "No activities/tours supplier is connected yet. See ADAPTERS.md for requirements.", admin.id);
upsertConnection("rail", "None", "not_connected", false, "No rail supplier is connected yet. See ADAPTERS.md for requirements.", admin.id);

// --- Demo date window (relative to "today" so the demo always has valid,
// future-dated inventory no matter when it's run) --------------------------
function isoDate(daysFromNow: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}
const OUT_DATE = isoDate(60);
const BACK_DATE = isoDate(67);

// --- Flights: JFK <-> LAX, five+ distinct outbound and return options ------
type FlightSeed = {
  origin: string; destination: string; date: string; departTime: string; arriveTime: string; tzOut: string; tzIn: string;
  marketing: string; code: string; flightNumber: string; stops: number; layovers: { airport: string; minutes: number }[];
  durationMinutes: number; base: number; taxes: number; fees: number; cabin: string; fareType: string;
  carryOn: string; checked: string; change: string; refund: string; seats: number;
};

const AIRLINES: Record<string, string> = {
  LS: "Liberty Skyways",
  PC: "Pacific Crest Air",
  CH: "Continental Horizon",
  SW: "SunWay Airlines",
  RW: "Redwood Air",
};

function flight(seed: FlightSeed) {
  const id = newId("flt");
  db.prepare(
    `INSERT INTO flight_offers (id, origin, destination, depart_at, arrive_at, marketing_airline, operating_airline, flight_number, cabin, fare_type, stops, layovers, duration_minutes, base_fare_cents, taxes_cents, fees_cents, currency, carry_on_policy, checked_bag_policy, change_policy, refund_policy, supplier, seats_available)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'USD', ?, ?, ?, ?, 'TyJen Demo Fares', ?)`,
  ).run(
    id, seed.origin, seed.destination,
    `${seed.date}T${seed.departTime}:00${seed.tzOut}`,
    `${seed.date}T${seed.arriveTime}:00${seed.tzIn}`,
    seed.marketing, seed.marketing, seed.flightNumber, seed.cabin, seed.fareType, seed.stops, toJson(seed.layovers),
    seed.durationMinutes, seed.base, seed.taxes, seed.fees, seed.carryOn, seed.checked, seed.change, seed.refund, seed.seats,
  );
  return id;
}

const outboundIds: string[] = [];
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "07:15", arriveTime: "10:32", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.LS!, code: "LS", flightNumber: "LS 482", stops: 0, layovers: [], durationMinutes: 377, base: 21800, taxes: 3400, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $35", checked: "First checked bag $35, second $45", change: "Non-changeable", refund: "Non-refundable", seats: 6 }));
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "09:00", arriveTime: "12:28", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.PC!, code: "PC", flightNumber: "PC 117", stops: 0, layovers: [], durationMinutes: 388, base: 26900, taxes: 3600, fees: 1200, cabin: "economy", fareType: "Standard Economy", carryOn: "1 carry-on + 1 personal item included", checked: "First checked bag $30", change: "Changeable, $75 fee + fare difference", refund: "Non-refundable; travel credit if cancelled 24h+ before departure", seats: 9 }));
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "11:45", arriveTime: "16:52", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.CH!, code: "CH", flightNumber: "CH 2290", stops: 1, layovers: [{ airport: "ORD", minutes: 65 }], durationMinutes: 427, base: 19400, taxes: 3100, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $30", checked: "First checked bag $35", change: "Non-changeable", refund: "Non-refundable", seats: 4 }));
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "14:20", arriveTime: "17:41", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.SW!, code: "SW", flightNumber: "SW 3305", stops: 0, layovers: [], durationMinutes: 381, base: 31200, taxes: 3800, fees: 1200, cabin: "economy", fareType: "Comfort Economy", carryOn: "1 carry-on + 1 personal item included", checked: "First checked bag free", change: "Changeable, no fee, fare difference applies", refund: "Refundable within 24 hours of booking", seats: 9 }));
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "18:05", arriveTime: "23:59", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.RW!, code: "RW", flightNumber: "RW 810", stops: 1, layovers: [{ airport: "DEN", minutes: 80 }], durationMinutes: 414, base: 17900, taxes: 2900, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $35", checked: "First checked bag $40", change: "Non-changeable", refund: "Non-refundable", seats: 0 }));
outboundIds.push(flight({ origin: "JFK", destination: "LAX", date: OUT_DATE, departTime: "08:10", arriveTime: "11:05", tzOut: "-05:00", tzIn: "-08:00", marketing: AIRLINES.LS!, code: "LS", flightNumber: "LS 640", stops: 0, layovers: [], durationMinutes: 355, base: 68900, taxes: 5200, fees: 1200, cabin: "business", fareType: "Business Flex", carryOn: "2 carry-ons + 1 personal item included", checked: "2 checked bags free", change: "Fully changeable, no fee", refund: "Fully refundable", seats: 9 }));

const returnIds: string[] = [];
returnIds.push(flight({ origin: "LAX", destination: "JFK", date: BACK_DATE, departTime: "08:00", arriveTime: "16:22", tzOut: "-08:00", tzIn: "-05:00", marketing: AIRLINES.LS!, code: "LS", flightNumber: "LS 483", stops: 0, layovers: [], durationMinutes: 322, base: 23800, taxes: 3500, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $35", checked: "First checked bag $35", change: "Non-changeable", refund: "Non-refundable", seats: 7 }));
returnIds.push(flight({ origin: "LAX", destination: "JFK", date: BACK_DATE, departTime: "10:30", arriveTime: "18:47", tzOut: "-08:00", tzIn: "-05:00", marketing: AIRLINES.PC!, code: "PC", flightNumber: "PC 118", stops: 0, layovers: [], durationMinutes: 317, base: 27900, taxes: 3600, fees: 1200, cabin: "economy", fareType: "Standard Economy", carryOn: "1 carry-on + 1 personal item included", checked: "First checked bag $30", change: "Changeable, $75 fee + fare difference", refund: "Non-refundable; travel credit if cancelled 24h+ before departure", seats: 9 }));
returnIds.push(flight({ origin: "LAX", destination: "JFK", date: BACK_DATE, departTime: "13:15", arriveTime: "22:50", tzOut: "-08:00", tzIn: "-05:00", marketing: AIRLINES.CH!, code: "CH", flightNumber: "CH 2291", stops: 1, layovers: [{ airport: "ORD", minutes: 70 }], durationMinutes: 395, base: 20400, taxes: 3200, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $30", checked: "First checked bag $35", change: "Non-changeable", refund: "Non-refundable", seats: 5 }));
returnIds.push(flight({ origin: "LAX", destination: "JFK", date: BACK_DATE, departTime: "16:00", arriveTime: "00:05", tzOut: "-08:00", tzIn: "-05:00", marketing: AIRLINES.SW!, code: "SW", flightNumber: "SW 3306", stops: 0, layovers: [], durationMinutes: 305, base: 32900, taxes: 3900, fees: 1200, cabin: "economy", fareType: "Comfort Economy", carryOn: "1 carry-on + 1 personal item included", checked: "First checked bag free", change: "Changeable, no fee, fare difference applies", refund: "Refundable within 24 hours of booking", seats: 9 }));
returnIds.push(flight({ origin: "LAX", destination: "JFK", date: BACK_DATE, departTime: "19:40", arriveTime: "04:02", tzOut: "-08:00", tzIn: "-05:00", marketing: AIRLINES.RW!, code: "RW", flightNumber: "RW 811", stops: 1, layovers: [{ airport: "DEN", minutes: 75 }], durationMinutes: 382, base: 18400, taxes: 3000, fees: 1200, cabin: "economy", fareType: "Basic Economy", carryOn: "1 personal item included; carry-on bag $35", checked: "First checked bag $40", change: "Non-changeable", refund: "Non-refundable", seats: 8 }));

console.log(`  Seeded ${outboundIds.length} outbound + ${returnIds.length} return demo flight offers (JFK ↔ LAX, ${OUT_DATE} / ${BACK_DATE}).`);

// --- Stays: Los Angeles, five+ distinct properties --------------------------
function stayPhoto(seed: number, alt: string) {
  return [{ url: `https://picsum.photos/seed/tyjen-stay-${seed}/960/640`, alt, credit: "Placeholder photo (Lorem Picsum) — replace with a licensed property photo before production use." }];
}

function stay(input: {
  name: string; type: string; city: string; region: string; country: string; neighborhood: string;
  star: number; guestRating: number; reviews: number; amenities: string[]; accessibility: string[];
  description: string; photoSeed: number; rooms: { name: string; maxAdults: number; maxChildren: number; bed: string; services: string[]; nightly: number; taxes: number; fees: number; payAtProperty: number; timing: "pay_now" | "pay_at_property" | "deposit_then_balance"; refundable: boolean; cancelHours: number; cancelTerms: string; available: number }[];
}) {
  const propId = newId("stay");
  db.prepare(
    `INSERT INTO stay_properties (id, name, property_type, city, region, country, neighborhood, star_rating, guest_rating, review_count, amenities, accessibility_features, photos, description, supplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TyJen Demo Stays')`,
  ).run(propId, input.name, input.type, input.city, input.region, input.country, input.neighborhood, input.star, input.guestRating, input.reviews, toJson(input.amenities), toJson(input.accessibility), toJson(stayPhoto(input.photoSeed, input.name)), input.description);
  for (const r of input.rooms) {
    db.prepare(
      `INSERT INTO stay_rooms (id, property_id, name, max_adults, max_children, bed_config, included_services, nightly_rate_cents, taxes_cents, fees_cents, pay_at_property_cents, payment_timing, refundable, cancellation_deadline_hours_before, cancellation_terms, rooms_available)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("room"), propId, r.name, r.maxAdults, r.maxChildren, r.bed, toJson(r.services), r.nightly, r.taxes, r.fees, r.payAtProperty, r.timing, r.refundable ? 1 : 0, r.cancelHours, r.cancelTerms, r.available);
  }
  return propId;
}

const laDowntown = stay({
  name: "Meridian Downtown Hotel", type: "hotel", city: "Los Angeles", region: "CA", country: "USA", neighborhood: "Downtown",
  star: 4, guestRating: 4.3, reviews: 2140, amenities: ["Free WiFi", "Fitness center", "Rooftop pool", "Business center"], accessibility: ["Roll-in shower available", "Elevator access"],
  description: "A modern high-rise hotel steps from LA Live and the Convention Center.", photoSeed: 1,
  rooms: [
    { name: "Standard King", maxAdults: 2, maxChildren: 1, bed: "1 King bed", services: ["Free WiFi"], nightly: 18900, taxes: 2400, fees: 1500, payAtProperty: 0, timing: "pay_now", refundable: true, cancelHours: 48, cancelTerms: "Free cancellation up to 48 hours before check-in; first night charged after that.", available: 6 },
    { name: "Deluxe Double Queen", maxAdults: 4, maxChildren: 2, bed: "2 Queen beds", services: ["Free WiFi", "Breakfast for 2"], nightly: 22900, taxes: 2900, fees: 1500, payAtProperty: 0, timing: "pay_now", refundable: true, cancelHours: 48, cancelTerms: "Free cancellation up to 48 hours before check-in.", available: 4 },
  ],
});

const laBeach = stay({
  name: "Seabreeze Santa Monica Resort", type: "resort", city: "Los Angeles", region: "CA", country: "USA", neighborhood: "Santa Monica",
  star: 4.5, guestRating: 4.6, reviews: 3110, amenities: ["Beach access", "Pool", "Spa", "Free WiFi", "Parking"], accessibility: ["Accessible rooms available", "Beach wheelchair on request"],
  description: "Oceanfront resort two blocks from Santa Monica Pier with a full-service spa.", photoSeed: 2,
  rooms: [
    { name: "Ocean View Room", maxAdults: 2, maxChildren: 1, bed: "1 King bed", services: ["Free WiFi", "Resort fee included"], nightly: 32900, taxes: 4100, fees: 2500, payAtProperty: 0, timing: "pay_now", refundable: false, cancelHours: 168, cancelTerms: "Non-refundable rate; no changes or cancellations.", available: 3 },
    { name: "Family Suite", maxAdults: 4, maxChildren: 2, bed: "1 King + 1 Sofa bed", services: ["Free WiFi", "Breakfast for 4", "Parking included"], nightly: 41900, taxes: 5200, fees: 2500, payAtProperty: 5000, timing: "deposit_then_balance", refundable: true, cancelHours: 120, cancelTerms: "Free cancellation up to 5 days before check-in.", available: 2 },
  ],
});

const laBudget = stay({
  name: "Golden Gate Inn & Suites", type: "hotel", city: "Los Angeles", region: "CA", country: "USA", neighborhood: "LAX / Airport",
  star: 2.5, guestRating: 3.8, reviews: 980, amenities: ["Free WiFi", "Free airport shuttle", "Parking"], accessibility: ["Ground floor rooms available"],
  description: "Budget-friendly airport-area hotel with a free 24-hour shuttle.", photoSeed: 3,
  rooms: [
    { name: "Standard Queen", maxAdults: 2, maxChildren: 1, bed: "1 Queen bed", services: ["Free WiFi", "Free shuttle"], nightly: 10900, taxes: 1400, fees: 800, payAtProperty: 0, timing: "pay_now", refundable: true, cancelHours: 24, cancelTerms: "Free cancellation up to 24 hours before check-in.", available: 10 },
  ],
});

const laBoutique = stay({
  name: "Hotel Arcadia West Hollywood", type: "hotel", city: "Los Angeles", region: "CA", country: "USA", neighborhood: "West Hollywood",
  star: 4, guestRating: 4.4, reviews: 1540, amenities: ["Rooftop bar", "Free WiFi", "Valet parking", "Pet friendly"], accessibility: ["Accessible rooms available"],
  description: "A design-forward boutique hotel on the Sunset Strip.", photoSeed: 4,
  rooms: [
    { name: "Classic King", maxAdults: 2, maxChildren: 0, bed: "1 King bed", services: ["Free WiFi"], nightly: 26900, taxes: 3400, fees: 1800, payAtProperty: 0, timing: "pay_now", refundable: true, cancelHours: 72, cancelTerms: "Free cancellation up to 72 hours before check-in.", available: 5 },
  ],
});

const laCondo = stay({
  name: "Marina Sunset Condos", type: "vacation_rental", city: "Los Angeles", region: "CA", country: "USA", neighborhood: "Marina del Rey",
  star: 4, guestRating: 4.5, reviews: 410, amenities: ["Full kitchen", "In-unit laundry", "Free WiFi", "Marina view", "Parking"], accessibility: ["Elevator access"],
  description: "A two-bedroom condo rental overlooking Marina del Rey, ideal for families.", photoSeed: 5,
  rooms: [
    { name: "2-Bedroom Marina View Condo", maxAdults: 4, maxChildren: 3, bed: "1 King + 2 Twin beds", services: ["Free WiFi", "Full kitchen", "Weekly cleaning"], nightly: 29900, taxes: 3600, fees: 9500, payAtProperty: 0, timing: "pay_now", refundable: true, cancelHours: 240, cancelTerms: "Free cancellation up to 10 days before check-in; 50% refund within 10 days.", available: 2 },
  ],
});

console.log("  Seeded 5 demo Los Angeles stay properties with room rates.");

// --- Featured flight+stay package -------------------------------------------
const packageRoom = db.prepare("SELECT id FROM stay_rooms WHERE property_id = ? ORDER BY nightly_rate_cents ASC LIMIT 1").get(laBeach) as { id: string };
db.prepare(
  `INSERT INTO featured_packages (id, title, description, stay_room_id, outbound_flight_id, return_flight_id, nights, package_discount_cents, hero_image_url)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
).run(newId("pkg"), "LA Coastline Escape", "Round-trip flights from New York plus 7 nights oceanfront in Santa Monica.", packageRoom.id, outboundIds[0], returnIds[0], 7, 6000, "https://picsum.photos/seed/tyjen-package-1/1200/700");

// --- Cruises: fictional lines, Caribbean + Alaska ---------------------------
function cruise(input: {
  line: string; ship: string; itinerary: string; port: string; ports: { port: string; arrive: string | null; depart: string | null }[];
  departOffsetDays: number; nights: number; cabins: { code: string; name: string; price: number; occ: number }[];
  inclusions: string[]; taxes: number; deposit: number; schedule: string; cancellation: string;
}) {
  const depart = isoDate(input.departOffsetDays);
  const ret = isoDate(input.departOffsetDays + input.nights);
  const id = newId("cruise");
  db.prepare(
    `INSERT INTO cruise_sailings (id, line_name, ship_name, itinerary_name, departure_port, ports, depart_date, return_date, nights, cabin_categories, inclusions, taxes_port_fees_cents, deposit_cents, payment_schedule, cancellation_terms, supplier)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'TyJen Demo Cruises')`,
  ).run(
    id, input.line, input.ship, input.itinerary, input.port, toJson(input.ports), depart, ret, input.nights,
    // Stored shape must match the NormalizedCabinCategory contract
    // (priceCents/occupancy) that the adapter reads back out, not the
    // shorthand field names (price/occ) this seed helper's own input
    // takes for brevity.
    toJson(input.cabins.map((c) => ({ code: c.code, name: c.name, priceCents: c.price, occupancy: c.occ }))),
    toJson(input.inclusions), input.taxes, input.deposit, input.schedule, input.cancellation,
  );
  return id;
}

cruise({ line: "Aurora Cruise Line", ship: "Aurora Horizon", itinerary: "Western Caribbean", port: "Miami, FL", ports: [{ port: "Miami, FL", arrive: null, depart: "Day 1" }, { port: "Cozumel, Mexico", arrive: "Day 3", depart: "Day 3" }, { port: "George Town, Grand Cayman", arrive: "Day 4", depart: "Day 4" }, { port: "Miami, FL", arrive: "Day 7", depart: null }], departOffsetDays: 70, nights: 6, cabins: [{ code: "INT", name: "Interior", price: 64900, occ: 2 }, { code: "OV", name: "Ocean View", price: 84900, occ: 2 }, { code: "BAL", name: "Balcony", price: 114900, occ: 2 }, { code: "SUI", name: "Suite", price: 219900, occ: 2 }], inclusions: ["Main dining room meals", "Entertainment", "Kids club"], taxes: 18900, deposit: 25000, schedule: "Deposit due at booking; balance due 90 days before departure.", cancellation: "Full refund up to 90 days before departure; sliding scale penalties inside 90 days." });
cruise({ line: "Coral Seas Cruises", ship: "Coral Voyager", itinerary: "Eastern Caribbean", port: "Fort Lauderdale, FL", ports: [{ port: "Fort Lauderdale, FL", arrive: null, depart: "Day 1" }, { port: "San Juan, Puerto Rico", arrive: "Day 3", depart: "Day 3" }, { port: "St. Thomas, USVI", arrive: "Day 4", depart: "Day 4" }, { port: "Fort Lauderdale, FL", arrive: "Day 7", depart: null }], departOffsetDays: 85, nights: 6, cabins: [{ code: "INT", name: "Interior", price: 71900, occ: 2 }, { code: "OV", name: "Ocean View", price: 91900, occ: 2 }, { code: "BAL", name: "Balcony", price: 124900, occ: 2 }], inclusions: ["Main dining room meals", "Entertainment", "Fitness center"], taxes: 19900, deposit: 25000, schedule: "Deposit due at booking; balance due 75 days before departure.", cancellation: "Full refund up to 75 days before departure; sliding scale penalties inside 75 days." });
cruise({ line: "Northern Star Voyages", ship: "Northern Star", itinerary: "Alaska Inside Passage", port: "Seattle, WA", ports: [{ port: "Seattle, WA", arrive: null, depart: "Day 1" }, { port: "Juneau, AK", arrive: "Day 3", depart: "Day 3" }, { port: "Skagway, AK", arrive: "Day 4", depart: "Day 4" }, { port: "Victoria, BC", arrive: "Day 6", depart: "Day 6" }, { port: "Seattle, WA", arrive: "Day 7", depart: null }], departOffsetDays: 300, nights: 7, cabins: [{ code: "INT", name: "Interior", price: 94900, occ: 2 }, { code: "OV", name: "Ocean View", price: 124900, occ: 2 }, { code: "BAL", name: "Balcony", price: 164900, occ: 2 }, { code: "SUI", name: "Suite", price: 289900, occ: 2 }], inclusions: ["Main dining room meals", "Glacier viewing deck access", "Naturalist lectures"], taxes: 24900, deposit: 50000, schedule: "Deposit due at booking; balance due 120 days before departure.", cancellation: "Full refund up to 120 days before departure; sliding scale penalties inside 120 days." });
cruise({ line: "Meridian Cruise Co.", ship: "Meridian Star", itinerary: "Bahamas Weekender", port: "Miami, FL", ports: [{ port: "Miami, FL", arrive: null, depart: "Day 1" }, { port: "Nassau, Bahamas", arrive: "Day 2", depart: "Day 2" }, { port: "Miami, FL", arrive: "Day 4", depart: null }], departOffsetDays: 45, nights: 3, cabins: [{ code: "INT", name: "Interior", price: 38900, occ: 2 }, { code: "OV", name: "Ocean View", price: 48900, occ: 2 }, { code: "BAL", name: "Balcony", price: 64900, occ: 2 }], inclusions: ["Main dining room meals", "Entertainment"], taxes: 12900, deposit: 15000, schedule: "Deposit due at booking; balance due 60 days before departure.", cancellation: "Full refund up to 60 days before departure; sliding scale penalties inside 60 days." });

console.log("  Seeded 4 demo cruise lines with sailings (Horizon Ocean Cruises and Bluewave Cruises are contracted-but-not-yet-connected per ADAPTERS.md).");

// --- Featured destinations (home page inspiration) ---------------------------
db.exec("DELETE FROM featured_destinations;");
const dest = [
  { name: "Los Angeles, California", teaser: "Sun-soaked coastline, iconic neighborhoods, and easy flights from JFK.", seed: 11 },
  { name: "Caribbean Cruising", teaser: "Island-hop the Western and Eastern Caribbean on a 6-night sailing.", seed: 12 },
  { name: "Alaska's Inside Passage", teaser: "Glaciers, wildlife, and mountain fjords on a 7-night cruise from Seattle.", seed: 13 },
  { name: "Weekend in the Bahamas", teaser: "A quick 3-night getaway to Nassau, perfect for a long weekend.", seed: 14 },
];
for (let i = 0; i < dest.length; i++) {
  db.prepare(`INSERT INTO featured_destinations (id, name, teaser, image_url, sort_order) VALUES (?, ?, ?, ?, ?)`).run(
    newId("dest"), dest[i]!.name, dest[i]!.teaser, `https://picsum.photos/seed/tyjen-dest-${dest[i]!.seed}/800/600`, i,
  );
}

// --- A couple of already-in-flight demo artifacts for the agent dashboard ---
const room = getRoomRateById(packageRoom.id, OUT_DATE, BACK_DATE)!;
const outboundOffer = getFlightOfferById(outboundIds[0]!)!;
const returnOffer = getFlightOfferById(returnIds[0]!)!;

const demoQuote = createQuote({ agentId: agentAva.id, clientId: clientIds[0], title: "Kim Family — LA Coastline Escape", validDays: 7 });
addQuoteItem(demoQuote.id, { itemType: "flight", refId: outboundOffer.id, description: `${outboundOffer.marketingAirline} ${outboundOffer.flightNumber} — JFK to LAX, ${OUT_DATE}`, supplier: outboundOffer.supplier, unitPriceCents: outboundOffer.baseFareCents, taxesCents: outboundOffer.taxesCents, feesCents: outboundOffer.feesCents, terms: { changePolicy: outboundOffer.changePolicy, refundPolicy: outboundOffer.refundPolicy } });
addQuoteItem(demoQuote.id, { itemType: "flight", refId: returnOffer.id, description: `${returnOffer.marketingAirline} ${returnOffer.flightNumber} — LAX to JFK, ${BACK_DATE}`, supplier: returnOffer.supplier, unitPriceCents: returnOffer.baseFareCents, taxesCents: returnOffer.taxesCents, feesCents: returnOffer.feesCents, terms: { changePolicy: returnOffer.changePolicy, refundPolicy: returnOffer.refundPolicy } });
addQuoteItem(demoQuote.id, { itemType: "stay_room", refId: room.id, description: `${room.name} at Seabreeze Santa Monica Resort — ${room.nights} nights`, supplier: "TyJen Demo Stays", unitPriceCents: room.nightlyRateCents * room.nights, taxesCents: room.taxesCents, feesCents: room.feesCents + room.payAtPropertyCents, terms: { cancellationDeadline: room.cancellationDeadline, refundable: room.refundable } });
transitionQuote(demoQuote.id, "sent");

console.log(`  Seeded 1 demo quote (${demoQuote.id}) for The Kim Family, status "sent".`);
console.log(`  Share link: ${config.appBaseUrl}/quotes/shared/${demoQuote.share_token}`);

closeDb();
console.log("Seed complete.");
