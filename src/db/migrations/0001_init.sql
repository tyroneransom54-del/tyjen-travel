-- TyJen Travel — initial schema
-- SQLite (via Node's built-in node:sqlite). Money is stored as integer cents
-- to avoid floating point error. Timestamps are ISO-8601 UTC strings.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Identity, roles, sessions, audit
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('traveler', 'agent', 'admin')),
  display_name TEXT NOT NULL,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'pending_approval')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Single-row table holding the host agency disclosure/config an admin can edit.
CREATE TABLE agency_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  host_agency_name TEXT NOT NULL,
  host_agency_identifier TEXT NOT NULL,
  has_ticketing_authority INTEGER NOT NULL DEFAULT 0,
  support_phone TEXT,
  support_email TEXT,
  required_disclosures TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- One row per agent user. Admin authorizes/disables via `authorized`.
CREATE TABLE agent_profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  agent_identifier TEXT NOT NULL UNIQUE,
  authorized INTEGER NOT NULL DEFAULT 0,
  booking_permissions TEXT NOT NULL DEFAULT '{"canBookWithTyJen":false,"canCreateQuotes":true}',
  commission_rate_bps INTEGER NOT NULL DEFAULT 0, -- basis points, e.g. 500 = 5%
  bio TEXT,
  authorized_at TEXT,
  authorized_by_user_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  device_label TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE audit_log (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT REFERENCES users(id),
  actor_role TEXT,
  action TEXT NOT NULL,
  target_type TEXT,
  target_id TEXT,
  metadata TEXT, -- JSON
  ip_address TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_audit_actor ON audit_log(actor_user_id);
CREATE INDEX idx_audit_target ON audit_log(target_type, target_id);

-- ---------------------------------------------------------------------------
-- Clients (agent's book of business). A client may or may not also have a
-- traveler user account (customer_user_id) that can log in to see their trips.
-- ---------------------------------------------------------------------------

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES users(id),
  customer_user_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  preferences TEXT, -- JSON: seat pref, dietary, loyalty numbers, etc.
  consent_status TEXT NOT NULL DEFAULT 'not_requested' CHECK (consent_status IN ('not_requested', 'requested', 'granted', 'declined')),
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_clients_agent ON clients(agent_id);

CREATE TABLE agent_tasks (
  id TEXT PRIMARY KEY,
  agent_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT REFERENCES clients(id),
  quote_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('note', 'task')),
  title TEXT NOT NULL,
  body TEXT,
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_tasks_agent ON agent_tasks(agent_id);

CREATE TABLE saved_searches (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT REFERENCES clients(id),
  product_type TEXT NOT NULL,
  label TEXT,
  params TEXT NOT NULL, -- JSON search params
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_saved_searches_owner ON saved_searches(owner_user_id);

CREATE TABLE shortlist_items (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id),
  client_id TEXT REFERENCES clients(id),
  item_type TEXT NOT NULL CHECK (item_type IN ('flight', 'stay_room', 'cruise_cabin', 'package')),
  ref_id TEXT NOT NULL,
  snapshot TEXT NOT NULL, -- JSON snapshot of the normalized offer at shortlist time
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_shortlist_owner ON shortlist_items(owner_user_id, client_id);

CREATE TABLE favorites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  snapshot TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE(user_id, item_type, ref_id)
);

CREATE TABLE price_alerts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  target_price_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'triggered', 'cancelled')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  triggered_at TEXT
);

-- ---------------------------------------------------------------------------
-- Supplier connection registry (admin-configurable; drives adapter status
-- shown honestly in the UI — demo / sandbox / not_connected / live)
-- ---------------------------------------------------------------------------

CREATE TABLE supplier_connections (
  id TEXT PRIMARY KEY,
  product_type TEXT NOT NULL CHECK (product_type IN ('flights', 'stays', 'packages', 'cruises', 'cars', 'activities', 'rail')),
  supplier_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'not_connected' CHECK (status IN ('not_connected', 'demo', 'sandbox', 'live')),
  can_book_with_tyjen INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_by_user_id TEXT REFERENCES users(id)
);

-- ---------------------------------------------------------------------------
-- Demo inventory: flights
-- ---------------------------------------------------------------------------

CREATE TABLE flight_offers (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,           -- IATA airport code
  destination TEXT NOT NULL,      -- IATA airport code
  depart_at TEXT NOT NULL,        -- ISO 8601 with offset, local departure time
  arrive_at TEXT NOT NULL,        -- ISO 8601 with offset, local arrival time
  marketing_airline TEXT NOT NULL,
  operating_airline TEXT NOT NULL,
  flight_number TEXT NOT NULL,
  cabin TEXT NOT NULL CHECK (cabin IN ('economy', 'premium_economy', 'business', 'first')),
  fare_type TEXT NOT NULL,
  stops INTEGER NOT NULL DEFAULT 0,
  layovers TEXT NOT NULL DEFAULT '[]', -- JSON [{airport, minutes}]
  duration_minutes INTEGER NOT NULL,
  base_fare_cents INTEGER NOT NULL,
  taxes_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  carry_on_policy TEXT NOT NULL,
  checked_bag_policy TEXT NOT NULL,
  change_policy TEXT NOT NULL,
  refund_policy TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT 'TyJen Demo Fares',
  seats_available INTEGER NOT NULL DEFAULT 9,
  last_checked_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_flights_route_date ON flight_offers(origin, destination, depart_at);

-- ---------------------------------------------------------------------------
-- Demo inventory: stays
-- ---------------------------------------------------------------------------

CREATE TABLE stay_properties (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  property_type TEXT NOT NULL CHECK (property_type IN ('hotel', 'resort', 'vacation_rental', 'condo')),
  city TEXT NOT NULL,
  region TEXT,
  country TEXT NOT NULL,
  neighborhood TEXT,
  lat REAL,
  lng REAL,
  star_rating REAL,
  guest_rating REAL,
  review_count INTEGER NOT NULL DEFAULT 0,
  amenities TEXT NOT NULL DEFAULT '[]',              -- JSON array
  accessibility_features TEXT NOT NULL DEFAULT '[]', -- JSON array
  photos TEXT NOT NULL DEFAULT '[]',                 -- JSON array of {url, alt, credit}
  description TEXT,
  check_in_time TEXT NOT NULL DEFAULT '15:00',
  check_out_time TEXT NOT NULL DEFAULT '11:00',
  supplier TEXT NOT NULL DEFAULT 'TyJen Demo Stays'
);
CREATE INDEX idx_stays_city ON stay_properties(city);

CREATE TABLE stay_rooms (
  id TEXT PRIMARY KEY,
  property_id TEXT NOT NULL REFERENCES stay_properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  max_adults INTEGER NOT NULL,
  max_children INTEGER NOT NULL DEFAULT 0,
  bed_config TEXT,
  included_services TEXT NOT NULL DEFAULT '[]', -- JSON array e.g. ["Breakfast", "Free WiFi"]
  nightly_rate_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  taxes_cents INTEGER NOT NULL,
  fees_cents INTEGER NOT NULL,
  pay_at_property_cents INTEGER NOT NULL DEFAULT 0,
  payment_timing TEXT NOT NULL DEFAULT 'pay_now' CHECK (payment_timing IN ('pay_now', 'pay_at_property', 'deposit_then_balance')),
  refundable INTEGER NOT NULL DEFAULT 1,
  cancellation_deadline_hours_before INTEGER NOT NULL DEFAULT 24,
  cancellation_terms TEXT NOT NULL,
  rooms_available INTEGER NOT NULL DEFAULT 3
);
CREATE INDEX idx_stayrooms_property ON stay_rooms(property_id);

-- ---------------------------------------------------------------------------
-- Demo inventory: cruises
-- ---------------------------------------------------------------------------

CREATE TABLE cruise_sailings (
  id TEXT PRIMARY KEY,
  line_name TEXT NOT NULL,
  ship_name TEXT NOT NULL,
  itinerary_name TEXT NOT NULL,
  departure_port TEXT NOT NULL,
  ports TEXT NOT NULL DEFAULT '[]', -- JSON array of {port, arrive, depart}
  depart_date TEXT NOT NULL,
  return_date TEXT NOT NULL,
  nights INTEGER NOT NULL,
  cabin_categories TEXT NOT NULL DEFAULT '[]', -- JSON [{code,name,price_cents,occupancy}]
  inclusions TEXT NOT NULL DEFAULT '[]',
  taxes_port_fees_cents INTEGER NOT NULL,
  deposit_cents INTEGER NOT NULL,
  payment_schedule TEXT NOT NULL,
  cancellation_terms TEXT NOT NULL,
  supplier TEXT NOT NULL DEFAULT 'TyJen Demo Cruises',
  currency TEXT NOT NULL DEFAULT 'USD'
);
CREATE INDEX idx_cruises_port_date ON cruise_sailings(departure_port, depart_date);

-- Featured flight+stay package callouts for the home page / packages search.
CREATE TABLE featured_packages (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  stay_room_id TEXT NOT NULL REFERENCES stay_rooms(id),
  outbound_flight_id TEXT NOT NULL REFERENCES flight_offers(id),
  return_flight_id TEXT REFERENCES flight_offers(id),
  nights INTEGER NOT NULL,
  package_discount_cents INTEGER NOT NULL DEFAULT 0,
  hero_image_url TEXT
);

-- ---------------------------------------------------------------------------
-- Quotes (agent- or self-service-prepared, non-binding, subject to
-- availability). Converting a quote to a booking is a distinct, explicit step.
-- ---------------------------------------------------------------------------

CREATE TABLE quotes (
  id TEXT PRIMARY KEY,
  share_token TEXT NOT NULL UNIQUE,
  agent_id TEXT REFERENCES users(id),
  client_id TEXT REFERENCES clients(id),
  customer_user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'viewed', 'accepted', 'expired', 'declined')),
  currency TEXT NOT NULL DEFAULT 'USD',
  subtotal_cents INTEGER NOT NULL DEFAULT 0,
  taxes_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  valid_until TEXT NOT NULL,
  agent_notes TEXT,
  customer_message TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  decided_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_quotes_agent ON quotes(agent_id);
CREATE INDEX idx_quotes_client ON quotes(client_id);
CREATE INDEX idx_quotes_customer ON quotes(customer_user_id);

CREATE TABLE quote_items (
  id TEXT PRIMARY KEY,
  quote_id TEXT NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL CHECK (item_type IN ('flight', 'stay_room', 'cruise_cabin', 'package')),
  ref_id TEXT NOT NULL,
  description TEXT NOT NULL,
  supplier TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  taxes_cents INTEGER NOT NULL DEFAULT 0,
  fees_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL,
  terms TEXT, -- JSON: cancellation/change terms captured at quote time
  sort_order INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_quoteitems_quote ON quote_items(quote_id);

-- ---------------------------------------------------------------------------
-- Bookings. `booking_path` distinguishes an authorized in-app TyJen booking
-- from a provider-handoff (where TyJen only records what happened elsewhere).
-- `idempotency_key` prevents double-charging on retries.
-- ---------------------------------------------------------------------------

CREATE TABLE bookings (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  quote_id TEXT REFERENCES quotes(id),
  customer_user_id TEXT REFERENCES users(id),
  client_id TEXT REFERENCES clients(id),
  agent_id TEXT REFERENCES users(id),
  booking_path TEXT NOT NULL CHECK (booking_path IN ('tyjen', 'provider')),
  status TEXT NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'pending_payment',       -- created, payment not yet attempted
    'payment_authorized',    -- card authorized, supplier booking not yet confirmed
    'confirming_with_supplier',
    'confirmed',             -- supplier returned a real confirmation
    'payment_failed',
    'supplier_failed',       -- payment was authorized but supplier booking failed -> must void/refund
    'voided',                -- authorization voided/refunded after supplier failure, no charge stands
    'cancelled',
    'handed_off_to_provider' -- "Book with provider": TyJen never charges or confirms this itself
  )),
  supplier TEXT NOT NULL,
  provider_handoff_url TEXT,
  confirmation_number TEXT,
  currency TEXT NOT NULL DEFAULT 'USD',
  total_cents INTEGER NOT NULL,
  failure_reason TEXT,
  price_check_snapshot TEXT, -- JSON of the last supplier recheck before checkout
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_bookings_customer ON bookings(customer_user_id);
CREATE INDEX idx_bookings_agent ON bookings(agent_id);

CREATE TABLE booking_items (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
  ref_id TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price_cents INTEGER NOT NULL,
  total_cents INTEGER NOT NULL,
  traveler_details TEXT -- JSON array of {name, age} minimal traveler info
);
CREATE INDEX idx_bookingitems_booking ON booking_items(booking_id);

CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  provider_ref TEXT,
  status TEXT NOT NULL CHECK (status IN ('authorized', 'captured', 'declined', 'voided', 'refunded', 'error')),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  failure_code TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_payments_booking ON payment_attempts(booking_id);

CREATE TABLE support_cases (
  id TEXT PRIMARY KEY,
  customer_user_id TEXT REFERENCES users(id),
  booking_id TEXT REFERENCES bookings(id),
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved')),
  assigned_agent_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_support_customer ON support_cases(customer_user_id);

CREATE TABLE email_outbox (
  id TEXT PRIMARY KEY,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  related_type TEXT,
  related_id TEXT,
  sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE TABLE featured_destinations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  teaser TEXT,
  image_url TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

