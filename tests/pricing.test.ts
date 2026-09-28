// Pure money-math tests: no database needed. All amounts are integer cents
// everywhere in the app except at the final display step, so these tests
// pin down the arithmetic that every quote/checkout/booking screen relies on.
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatMoney, sumItemized, comparePackageSavings } from "../src/domain/pricing.ts";

test("formatMoney renders integer cents as USD currency", () => {
  assert.equal(formatMoney(0), "$0.00");
  assert.equal(formatMoney(148700), "$1,487.00");
  assert.equal(formatMoney(99), "$0.99");
});

test("formatMoney falls back gracefully for an unrecognized currency code", () => {
  // Intl.NumberFormat throws on a bogus currency; the fallback must never
  // crash a page render.
  assert.equal(formatMoney(500, "NOTREAL"), "$5.00");
});

test("sumItemized multiplies unit price and per-item taxes by quantity, but not fees", () => {
  const result = sumItemized([
    { unitPriceCents: 20000, taxesCents: 3000, feesCents: 1200, quantity: 2 },
  ]);
  // subtotal: 20000*2 = 40000; taxes: 3000*2 = 6000; fees: 1200 (flat, not *2)
  assert.equal(result.subtotalCents, 40000);
  assert.equal(result.taxesCents, 6000);
  assert.equal(result.feesCents, 1200);
  assert.equal(result.totalCents, 47200);
});

test("sumItemized defaults quantity to 1 and missing taxes/fees to 0", () => {
  const result = sumItemized([{ unitPriceCents: 10000 }]);
  assert.deepEqual(result, { subtotalCents: 10000, taxesCents: 0, feesCents: 0, totalCents: 10000 });
});

test("sumItemized sums across multiple line items (e.g. outbound + return flight)", () => {
  const result = sumItemized([
    { unitPriceCents: 21800, taxesCents: 3400, feesCents: 1200, quantity: 1 },
    { unitPriceCents: 23800, taxesCents: 3500, feesCents: 1200, quantity: 1 },
  ]);
  assert.equal(result.totalCents, 21800 + 3400 + 1200 + 23800 + 3500 + 1200);
});

test("comparePackageSavings reports real savings only when the package is actually cheaper", () => {
  const result = comparePackageSavings(300000, 306000);
  assert.deepEqual(result, { comparable: true, savingsCents: 6000 });
});

test("comparePackageSavings refuses to claim savings when the package costs the same or more", () => {
  assert.deepEqual(comparePackageSavings(300000, 300000), { comparable: false });
  assert.deepEqual(comparePackageSavings(310000, 300000), { comparable: false });
});

test("comparePackageSavings refuses to claim savings against non-positive prices", () => {
  assert.deepEqual(comparePackageSavings(0, 100000), { comparable: false });
  assert.deepEqual(comparePackageSavings(100000, 0), { comparable: false });
  assert.deepEqual(comparePackageSavings(-100, 100000), { comparable: false });
});
