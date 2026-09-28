// All money is handled as integer cents everywhere except at the very edge
// (formatting for display). This one module is the only place that does
// currency-locale formatting so every screen is consistent.

export function formatMoney(cents: number, currency = "USD"): string {
  const amount = cents / 100;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount);
  } catch {
    return `$${amount.toFixed(2)}`;
  }
}

export interface Itemized {
  subtotalCents: number;
  taxesCents: number;
  feesCents: number;
  totalCents: number;
}

export function sumItemized(items: { unitPriceCents: number; taxesCents?: number; feesCents?: number; quantity?: number }[]): Itemized {
  let subtotalCents = 0;
  let taxesCents = 0;
  let feesCents = 0;
  for (const item of items) {
    const qty = item.quantity ?? 1;
    subtotalCents += item.unitPriceCents * qty;
    taxesCents += (item.taxesCents ?? 0) * qty;
    feesCents += item.feesCents ?? 0;
  }
  return { subtotalCents, taxesCents, feesCents, totalCents: subtotalCents + taxesCents + feesCents };
}

/**
 * Compares a package total against the sum of separately bookable component
 * totals. Per the project requirement, a savings figure is only ever shown
 * when both prices are current (checked within `maxAgeMinutes`) and for the
 * same date/traveler configuration — callers must pass in prices they just
 * fetched in the same request, never cached/stale ones.
 */
export function comparePackageSavings(
  packageTotalCents: number,
  separateTotalCents: number,
): { comparable: true; savingsCents: number } | { comparable: false } {
  if (packageTotalCents <= 0 || separateTotalCents <= 0) return { comparable: false };
  const savings = separateTotalCents - packageTotalCents;
  if (savings <= 0) return { comparable: false };
  return { comparable: true, savingsCents: savings };
}
