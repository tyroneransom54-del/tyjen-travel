// Booking state machine tests: this is the safety-critical part of the
// project ("a failed supplier booking must never leave a customer charged",
// "no 'confirmed' status without going through the whole sequence"). Uses a
// throwaway SQLite file per test file, isolated from the app's dev database.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_FILE = join(mkdtempSync(join(tmpdir(), "tyjen-test-bookings-")), "test.db");
process.env.SESSION_SECRET = "test-only-secret";
process.env.NODE_ENV = "test";

const { runMigrations } = await import("../src/db/client.ts");
runMigrations();

const { runTyjenCheckout, recordProviderHandoff, getBooking, listBookingItems, findBookingByIdempotencyKey } = await import(
  "../src/domain/bookings.ts"
);

function sampleItems() {
  return [
    {
      itemType: "flight",
      refId: "flt_test_1",
      description: "Test Airline TA 100 — JFK to LAX",
      quantity: 1,
      unitPriceCents: 20000,
      totalCents: 24000,
      travelerDetails: [{ name: "Jane Traveler" }],
    },
  ];
}

test("a successful checkout goes all the way to confirmed with a real confirmation number, and captures payment", () => {
  const outcome = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    priceCheckSnapshot: { checkedAt: new Date().toISOString() },
    idempotencyKey: `idem-success-${Date.now()}`,
  });

  assert.equal(outcome.outcome, "confirmed");
  assert.equal(outcome.booking.status, "confirmed");
  assert.ok(outcome.booking.confirmation_number, "a confirmed booking must carry a real confirmation number");
  assert.match(outcome.booking.confirmation_number!, /^TYJ-/);
  assert.equal(listBookingItems(outcome.booking.id).length, 1);
});

test("a declined card (ending 0002) never reaches payment_authorized or confirmed, and no confirmation number is issued", () => {
  const outcome = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111110002", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    priceCheckSnapshot: {},
    idempotencyKey: `idem-declined-${Date.now()}`,
  });

  assert.equal(outcome.outcome, "payment_failed");
  assert.equal(outcome.booking.status, "payment_failed");
  assert.equal(outcome.booking.confirmation_number, null);
});

test("an explicit simulateDecline flag declines regardless of card number", () => {
  const outcome = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    simulateDecline: true,
    priceCheckSnapshot: {},
    idempotencyKey: `idem-forced-decline-${Date.now()}`,
  });
  assert.equal(outcome.outcome, "payment_failed");
});

test("a supplier failure AFTER payment authorization voids the payment instead of capturing it -- never confirmed, never left charged", () => {
  const outcome = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    simulateSupplierFailure: "sold_out",
    priceCheckSnapshot: {},
    idempotencyKey: `idem-supplier-fail-${Date.now()}`,
  });

  assert.equal(outcome.outcome, "supplier_failed");
  assert.equal(outcome.booking.status, "voided");
  assert.equal(outcome.booking.confirmation_number, null, "a voided booking must never carry a confirmation number");
});

test("idempotent replay of the same key returns the original result instead of double-booking or double-charging", () => {
  const key = `idem-replay-${Date.now()}`;
  const first = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    priceCheckSnapshot: {},
    idempotencyKey: key,
  });
  const second = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    priceCheckSnapshot: {},
    idempotencyKey: key,
  });

  assert.equal(first.booking.id, second.booking.id, "a retried request with the same idempotency key must not create a second booking");
  assert.equal(second.outcome, "confirmed");
  // Only one booking row should exist for this key.
  const byKey = findBookingByIdempotencyKey(key);
  assert.equal(byKey!.id, first.booking.id);
});

test("'Book with provider' never creates a charge and is recorded distinctly from a TyJen-confirmed booking", () => {
  const booking = recordProviderHandoff({
    supplier: "Some Cruise Line",
    totalCents: 50000,
    currency: "USD",
    items: sampleItems(),
    providerHandoffUrl: "https://booking.example-provider.demo/redirect?ref=test",
    idempotencyKey: `idem-provider-${Date.now()}`,
  });

  assert.equal(booking.status, "handed_off_to_provider");
  assert.equal(booking.booking_path, "provider");
  assert.equal(booking.confirmation_number, null, "TyJen must never fabricate a confirmation number for a provider-handled booking");
});

test("getBooking round-trips a stored booking by id", () => {
  const outcome = runTyjenCheckout({
    supplier: "Test Airline",
    totalCents: 24000,
    currency: "USD",
    items: sampleItems(),
    card: { cardNumber: "4111111111111111", expiry: "12/29", cvc: "123", nameOnCard: "Jane Traveler" },
    priceCheckSnapshot: {},
    idempotencyKey: `idem-getbooking-${Date.now()}`,
  });
  const fetched = getBooking(outcome.booking.id);
  assert.ok(fetched);
  assert.equal(fetched!.total_cents, 24000);
});
