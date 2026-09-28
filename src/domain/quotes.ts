// Quote lifecycle: draft -> sent -> viewed -> accepted | declined | expired.
// An agent (or a customer building their own quote) can add/remove items and
// see live itemized totals without ever taking payment here — creating a
// quote never touches the payment provider or a supplier booking call.
import { getDb, toJson, fromJson } from "../db/client.ts";
import { newId, newToken } from "./ids.ts";
import { sumItemized } from "./pricing.ts";

export type QuoteStatus = "draft" | "sent" | "viewed" | "accepted" | "expired" | "declined";

export interface QuoteRow {
  id: string;
  share_token: string;
  agent_id: string | null;
  client_id: string | null;
  customer_user_id: string | null;
  title: string;
  status: QuoteStatus;
  currency: string;
  subtotal_cents: number;
  taxes_cents: number;
  fees_cents: number;
  total_cents: number;
  valid_until: string;
  agent_notes: string | null;
  customer_message: string | null;
  sent_at: string | null;
  viewed_at: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteItemRow {
  id: string;
  quote_id: string;
  item_type: "flight" | "stay_room" | "cruise_cabin" | "package";
  ref_id: string;
  description: string;
  supplier: string;
  quantity: number;
  unit_price_cents: number;
  taxes_cents: number;
  fees_cents: number;
  total_cents: number;
  terms: string | null;
  sort_order: number;
}

/** A quote is effectively expired once `valid_until` passes, even if nobody
 * has touched the row since. Read paths call this instead of trusting the
 * stored status blindly, and it lazily persists the transition. */
export function effectiveStatus(quote: QuoteRow): QuoteStatus {
  if (["draft", "sent", "viewed"].includes(quote.status) && new Date(quote.valid_until).getTime() < Date.now()) {
    return "expired";
  }
  return quote.status;
}

function touchExpiry(db: ReturnType<typeof getDb>, quote: QuoteRow): QuoteRow {
  const status = effectiveStatus(quote);
  if (status !== quote.status) {
    db.prepare("UPDATE quotes SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?").run(status, quote.id);
    return { ...quote, status };
  }
  return quote;
}

export function createQuote(input: {
  agentId?: string | null;
  clientId?: string | null;
  customerUserId?: string | null;
  title: string;
  validDays?: number;
  currency?: string;
}): QuoteRow {
  const db = getDb();
  const id = newId("quote");
  const validUntil = new Date(Date.now() + (input.validDays ?? 7) * 86_400_000).toISOString();
  db.prepare(
    `INSERT INTO quotes (id, share_token, agent_id, client_id, customer_user_id, title, valid_until, currency)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, newToken(16), input.agentId ?? null, input.clientId ?? null, input.customerUserId ?? null, input.title, validUntil, input.currency ?? "USD");
  return getQuote(id)!;
}

export function getQuote(id: string): QuoteRow | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM quotes WHERE id = ?").get(id) as QuoteRow | undefined;
  return row ? touchExpiry(db, row) : undefined;
}

export function getQuoteByShareToken(token: string): QuoteRow | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM quotes WHERE share_token = ?").get(token) as QuoteRow | undefined;
  return row ? touchExpiry(db, row) : undefined;
}

export function listQuoteItems(quoteId: string): QuoteItemRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM quote_items WHERE quote_id = ? ORDER BY sort_order ASC").all(quoteId) as QuoteItemRow[];
}

export function addQuoteItem(
  quoteId: string,
  item: {
    itemType: QuoteItemRow["item_type"];
    refId: string;
    description: string;
    supplier: string;
    unitPriceCents: number;
    taxesCents?: number;
    feesCents?: number;
    quantity?: number;
    terms?: unknown;
  },
): void {
  const db = getDb();
  const existingCount = (db.prepare("SELECT COUNT(*) as c FROM quote_items WHERE quote_id = ?").get(quoteId) as { c: number }).c;
  const qty = item.quantity ?? 1;
  const total = (item.unitPriceCents + (item.taxesCents ?? 0)) * qty + (item.feesCents ?? 0);
  db.prepare(
    `INSERT INTO quote_items (id, quote_id, item_type, ref_id, description, supplier, quantity, unit_price_cents, taxes_cents, fees_cents, total_cents, terms, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    newId("qi"),
    quoteId,
    item.itemType,
    item.refId,
    item.description,
    item.supplier,
    qty,
    item.unitPriceCents,
    item.taxesCents ?? 0,
    item.feesCents ?? 0,
    total,
    item.terms !== undefined ? toJson(item.terms) : null,
    existingCount,
  );
  recomputeQuoteTotals(quoteId);
}

export function removeQuoteItem(quoteId: string, itemId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM quote_items WHERE id = ? AND quote_id = ?").run(itemId, quoteId);
  recomputeQuoteTotals(quoteId);
}

export function recomputeQuoteTotals(quoteId: string): void {
  const db = getDb();
  const items = listQuoteItems(quoteId);
  const totals = sumItemized(items.map((i) => ({ unitPriceCents: i.unit_price_cents, taxesCents: i.taxes_cents, feesCents: i.fees_cents, quantity: i.quantity })));
  db.prepare(
    `UPDATE quotes SET subtotal_cents = ?, taxes_cents = ?, fees_cents = ?, total_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
  ).run(totals.subtotalCents, totals.taxesCents, totals.feesCents, totals.totalCents, quoteId);
}

const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["viewed", "accepted", "declined", "expired"],
  viewed: ["accepted", "declined", "expired"],
  accepted: [],
  declined: [],
  expired: [],
};

export class InvalidQuoteTransition extends Error {}

export function transitionQuote(quoteId: string, to: QuoteStatus): QuoteRow {
  const db = getDb();
  const quote = getQuote(quoteId);
  if (!quote) throw new Error("Quote not found");
  const from = quote.status;
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidQuoteTransition(`Cannot move quote from "${from}" to "${to}"`);
  }
  const now = new Date().toISOString();
  const fields: string[] = ["status = ?"];
  const args: unknown[] = [to];
  if (to === "sent") {
    fields.push("sent_at = ?");
    args.push(now);
  }
  if (to === "viewed" && !quote.viewed_at) {
    fields.push("viewed_at = ?");
    args.push(now);
  }
  if (to === "accepted" || to === "declined") {
    fields.push("decided_at = ?");
    args.push(now);
  }
  fields.push("updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')");
  args.push(quoteId);
  db.prepare(`UPDATE quotes SET ${fields.join(", ")} WHERE id = ?`).run(...(args as []));
  return getQuote(quoteId)!;
}

export function listQuotesForAgent(agentId: string): QuoteRow[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM quotes WHERE agent_id = ? ORDER BY updated_at DESC").all(agentId) as QuoteRow[];
  return rows.map((r) => touchExpiry(db, r));
}

export function listQuotesForCustomer(customerUserId: string): QuoteRow[] {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM quotes WHERE customer_user_id = ? ORDER BY updated_at DESC").all(customerUserId) as QuoteRow[];
  return rows.map((r) => touchExpiry(db, r));
}
