// The booking state machine. This is the safety-critical part of the app:
// the project requires that a failed supplier booking never leaves a
// customer charged for an unconfirmed trip, and that "confirmed" is only
// ever shown after a real supplier confirmation. Every transition here is
// explicit and logged to the audit log.
//
//   pending_payment
//        |  authorize()
//        v
//   payment_authorized  --(decline)-->  payment_failed  [terminal, no charge]
//        |  confirmWithSupplier()
//        v
//   confirming_with_supplier
//        |--- success: capture() ---> confirmed [terminal, charge stands]
//        \--- failure: void()    ---> voided    [terminal, no charge stands]
//
//   "Book with provider" bookings never enter this machine at all — they
//   are recorded as `handed_off_to_provider` and TyJen takes no payment.
import { getDb, toJson } from "../db/client.ts";
import { newId } from "./ids.ts";
import { recordAudit } from "./audit.ts";
import * as payments from "../adapters/payments.mock.ts";
import type { CardInput } from "../adapters/payments.mock.ts";

export type BookingStatus =
  | "pending_payment"
  | "payment_authorized"
  | "confirming_with_supplier"
  | "confirmed"
  | "payment_failed"
  | "supplier_failed"
  | "voided"
  | "cancelled"
  | "handed_off_to_provider";

export interface BookingRow {
  id: string;
  idempotency_key: string;
  quote_id: string | null;
  customer_user_id: string | null;
  client_id: string | null;
  agent_id: string | null;
  booking_path: "tyjen" | "provider";
  status: BookingStatus;
  supplier: string;
  provider_handoff_url: string | null;
  confirmation_number: string | null;
  currency: string;
  total_cents: number;
  failure_reason: string | null;
  price_check_snapshot: string | null;
  created_at: string;
  updated_at: string;
}

export interface BookingItemInput {
  itemType: string;
  refId: string;
  description: string;
  quantity: number;
  unitPriceCents: number;
  totalCents: number;
  travelerDetails: { name: string; age?: number }[];
}

function generateConfirmationNumber(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "TYJ-";
  for (let i = 0; i < 6; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}

export function findBookingByIdempotencyKey(key: string): BookingRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM bookings WHERE idempotency_key = ?").get(key) as BookingRow | undefined;
}

export function getBooking(id: string): BookingRow | undefined {
  const db = getDb();
  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(id) as BookingRow | undefined;
}

export function listBookingItems(bookingId: string) {
  const db = getDb();
  return db.prepare("SELECT * FROM booking_items WHERE booking_id = ?").all(bookingId);
}

export function listBookingsForCustomer(customerUserId: string): BookingRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM bookings WHERE customer_user_id = ? ORDER BY created_at DESC").all(customerUserId) as BookingRow[];
}

export function listBookingsForAgent(agentId: string): BookingRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM bookings WHERE agent_id = ? ORDER BY created_at DESC").all(agentId) as BookingRow[];
}

export function listAllBookings(): BookingRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM bookings ORDER BY created_at DESC").all() as BookingRow[];
}

function insertBookingItems(db: ReturnType<typeof getDb>, bookingId: string, items: BookingItemInput[]) {
  for (const item of items) {
    db.prepare(
      `INSERT INTO booking_items (id, booking_id, item_type, ref_id, description, quantity, unit_price_cents, total_cents, traveler_details)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("bi"), bookingId, item.itemType, item.refId, item.description, item.quantity, item.unitPriceCents, item.totalCents, toJson(item.travelerDetails));
  }
}

export interface ProviderHandoffInput {
  customerUserId?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  quoteId?: string | null;
  supplier: string;
  totalCents: number;
  currency: string;
  items: BookingItemInput[];
  providerHandoffUrl: string;
  idempotencyKey: string;
}

/** "Book with provider": TyJen never takes payment or confirms this itself.
 * We simply record that the customer was handed off, for the agent's / the
 * customer's own trip records, and send them onward. */
export function recordProviderHandoff(input: ProviderHandoffInput): BookingRow {
  const existing = findBookingByIdempotencyKey(input.idempotencyKey);
  if (existing) return existing;
  const db = getDb();
  const id = newId("book");
  db.prepare(
    `INSERT INTO bookings (id, idempotency_key, quote_id, customer_user_id, client_id, agent_id, booking_path, status, supplier, provider_handoff_url, currency, total_cents)
     VALUES (?, ?, ?, ?, ?, ?, 'provider', 'handed_off_to_provider', ?, ?, ?, ?)`,
  ).run(id, input.idempotencyKey, input.quoteId ?? null, input.customerUserId ?? null, input.clientId ?? null, input.agentId ?? null, input.supplier, input.providerHandoffUrl, input.currency, input.totalCents);
  insertBookingItems(db, id, input.items);
  recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.provider_handoff", targetType: "booking", targetId: id, metadata: { supplier: input.supplier } });
  return getBooking(id)!;
}

export interface TyjenCheckoutInput {
  customerUserId?: string | null;
  clientId?: string | null;
  agentId?: string | null;
  quoteId?: string | null;
  supplier: string;
  totalCents: number;
  currency: string;
  items: BookingItemInput[];
  card: CardInput;
  simulateDecline?: boolean;
  simulateSupplierFailure?: "sold_out" | "timeout" | false;
  priceCheckSnapshot: unknown;
  idempotencyKey: string;
}

export interface CheckoutOutcome {
  booking: BookingRow;
  outcome: "confirmed" | "payment_failed" | "supplier_failed";
  message: string;
}

/**
 * Runs the full "Book with TyJen" sequence. The caller (the checkout route)
 * is responsible for having just performed the mandatory pre-checkout
 * recheck (see adapters `recheck*` functions) and for confirming the
 * connection actually permits `canBookWithTyjen` — this function still
 * requires a `priceCheckSnapshot` be supplied so that fact is on the record.
 */
export function runTyjenCheckout(input: TyjenCheckoutInput): CheckoutOutcome {
  const existing = findBookingByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    // Idempotent replay: a retried request (double-click, network retry)
    // must never re-run payment or re-book with the supplier.
    return {
      booking: existing,
      outcome: existing.status === "confirmed" ? "confirmed" : existing.status === "voided" || existing.status === "supplier_failed" ? "supplier_failed" : "payment_failed",
      message: "This request was already processed; returning the existing result instead of processing it again.",
    };
  }

  const db = getDb();
  const bookingId = newId("book");
  db.prepare(
    `INSERT INTO bookings (id, idempotency_key, quote_id, customer_user_id, client_id, agent_id, booking_path, status, supplier, currency, total_cents, price_check_snapshot)
     VALUES (?, ?, ?, ?, ?, ?, 'tyjen', 'pending_payment', ?, ?, ?, ?)`,
  ).run(
    bookingId,
    input.idempotencyKey,
    input.quoteId ?? null,
    input.customerUserId ?? null,
    input.clientId ?? null,
    input.agentId ?? null,
    input.supplier,
    input.currency,
    input.totalCents,
    toJson(input.priceCheckSnapshot),
  );
  insertBookingItems(db, bookingId, input.items);
  recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.created", targetType: "booking", targetId: bookingId, metadata: { totalCents: input.totalCents } });

  function setStatus(status: BookingStatus, failureReason?: string) {
    db.prepare("UPDATE bookings SET status = ?, failure_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, failureReason ?? null, bookingId);
  }
  function recordPayment(status: "authorized" | "captured" | "declined" | "voided", providerRef: string, failureCode?: string) {
    db.prepare(
      `INSERT INTO payment_attempts (id, booking_id, provider, provider_ref, status, amount_cents, currency, failure_code)
       VALUES (?, ?, 'mock', ?, ?, ?, ?, ?)`,
    ).run(newId("pay"), bookingId, providerRef, status, input.totalCents, input.currency, failureCode ?? null);
  }

  // Step 1: authorize payment.
  const auth = payments.authorize(input.totalCents, input.currency, input.card, input.simulateDecline);
  if (!auth.ok) {
    recordPayment("declined", auth.providerRef, auth.failureCode);
    setStatus("payment_failed", auth.message);
    recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.payment_failed", targetType: "booking", targetId: bookingId, metadata: { failureCode: auth.failureCode } });
    return { booking: getBooking(bookingId)!, outcome: "payment_failed", message: auth.message };
  }
  recordPayment("authorized", auth.providerRef);
  setStatus("payment_authorized");
  recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.payment_authorized", targetType: "booking", targetId: bookingId });

  // Step 2: confirm with the supplier. In this demo build this is a
  // simulated call (see comment on TyjenCheckoutInput.simulateSupplierFailure)
  // standing in for a real create-reservation/OrderCreate call a live
  // adapter would make here.
  setStatus("confirming_with_supplier");
  const supplierFailed = Boolean(input.simulateSupplierFailure);
  if (supplierFailed) {
    const reason = input.simulateSupplierFailure === "sold_out" ? "The supplier reported this offer sold out during booking." : "The supplier booking call timed out.";
    voidBookingPayment(bookingId, auth.providerRef, reason);
    recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.supplier_failed", targetType: "booking", targetId: bookingId, metadata: { reason } });
    return { booking: getBooking(bookingId)!, outcome: "supplier_failed", message: reason };
  }

  // Step 3: supplier confirmed — capture payment and show a real confirmation.
  const capture = payments.capture(auth.providerRef);
  recordPayment("captured", capture.providerRef);
  const confirmationNumber = generateConfirmationNumber();
  db.prepare("UPDATE bookings SET status = 'confirmed', confirmation_number = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(confirmationNumber, bookingId);
  recordAudit({ actorUserId: input.customerUserId ?? input.agentId, action: "booking.confirmed", targetType: "booking", targetId: bookingId, metadata: { confirmationNumber } });

  return { booking: getBooking(bookingId)!, outcome: "confirmed", message: `Confirmed. Confirmation number ${confirmationNumber}.` };
}

function voidBookingPayment(bookingId: string, providerRef: string, reason: string): void {
  const db = getDb();
  const v = payments.voidAuthorization(providerRef);
  db.prepare(
    `INSERT INTO payment_attempts (id, booking_id, provider, provider_ref, status, amount_cents, currency)
     SELECT ?, id, 'mock', ?, 'voided', total_cents, currency FROM bookings WHERE id = ?`,
  ).run(newId("pay"), v.providerRef, bookingId);
  db.prepare("UPDATE bookings SET status = 'voided', failure_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(reason, bookingId);
}
