// Saved searches, shortlists (agent comparison lists), favorites, and price
// alerts. Grouped in one module since they are all small, similarly-shaped
// "user saved a reference to an offer" records.
import { getDb, toJson, fromJson } from "../db/client.ts";
import { newId } from "./ids.ts";

export interface SavedSearchRow {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  product_type: string;
  label: string | null;
  params: string;
  created_at: string;
}

export function saveSearch(input: { ownerUserId: string; clientId?: string | null; productType: string; label?: string; params: unknown }): SavedSearchRow {
  const db = getDb();
  const id = newId("search");
  db.prepare(`INSERT INTO saved_searches (id, owner_user_id, client_id, product_type, label, params) VALUES (?, ?, ?, ?, ?, ?)`).run(
    id,
    input.ownerUserId,
    input.clientId ?? null,
    input.productType,
    input.label ?? null,
    toJson(input.params),
  );
  return db.prepare("SELECT * FROM saved_searches WHERE id = ?").get(id) as SavedSearchRow;
}

export function listSavedSearches(ownerUserId: string): SavedSearchRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM saved_searches WHERE owner_user_id = ? ORDER BY created_at DESC").all(ownerUserId) as SavedSearchRow[];
}

export interface ShortlistItemRow {
  id: string;
  owner_user_id: string;
  client_id: string | null;
  item_type: "flight" | "stay_room" | "cruise_cabin" | "package";
  ref_id: string;
  snapshot: string;
  note: string | null;
  created_at: string;
}

export function addToShortlist(input: { ownerUserId: string; clientId?: string | null; itemType: ShortlistItemRow["item_type"]; refId: string; snapshot: unknown; note?: string }): ShortlistItemRow {
  const db = getDb();
  const id = newId("short");
  db.prepare(`INSERT INTO shortlist_items (id, owner_user_id, client_id, item_type, ref_id, snapshot, note) VALUES (?, ?, ?, ?, ?, ?, ?)`).run(
    id,
    input.ownerUserId,
    input.clientId ?? null,
    input.itemType,
    input.refId,
    toJson(input.snapshot),
    input.note ?? null,
  );
  return db.prepare("SELECT * FROM shortlist_items WHERE id = ?").get(id) as ShortlistItemRow;
}

export function listShortlist(ownerUserId: string, clientId?: string | null): ShortlistItemRow[] {
  const db = getDb();
  if (clientId) {
    return db.prepare("SELECT * FROM shortlist_items WHERE owner_user_id = ? AND client_id = ? ORDER BY created_at DESC").all(ownerUserId, clientId) as ShortlistItemRow[];
  }
  return db.prepare("SELECT * FROM shortlist_items WHERE owner_user_id = ? ORDER BY created_at DESC").all(ownerUserId) as ShortlistItemRow[];
}

export function removeFromShortlist(id: string, ownerUserId: string): void {
  const db = getDb();
  db.prepare("DELETE FROM shortlist_items WHERE id = ? AND owner_user_id = ?").run(id, ownerUserId);
}

export interface FavoriteRow {
  id: string;
  user_id: string;
  item_type: string;
  ref_id: string;
  snapshot: string;
  created_at: string;
}

export function toggleFavorite(userId: string, itemType: string, refId: string, snapshot: unknown): "added" | "removed" {
  const db = getDb();
  const existing = db.prepare("SELECT id FROM favorites WHERE user_id = ? AND item_type = ? AND ref_id = ?").get(userId, itemType, refId) as { id: string } | undefined;
  if (existing) {
    db.prepare("DELETE FROM favorites WHERE id = ?").run(existing.id);
    return "removed";
  }
  db.prepare("INSERT INTO favorites (id, user_id, item_type, ref_id, snapshot) VALUES (?, ?, ?, ?, ?)").run(newId("fav"), userId, itemType, refId, toJson(snapshot));
  return "added";
}

export function listFavorites(userId: string): FavoriteRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM favorites WHERE user_id = ? ORDER BY created_at DESC").all(userId) as FavoriteRow[];
}

export interface PriceAlertRow {
  id: string;
  user_id: string;
  item_type: string;
  ref_id: string;
  target_price_cents: number;
  currency: string;
  status: "active" | "triggered" | "cancelled";
  created_at: string;
  triggered_at: string | null;
}

export function createPriceAlert(userId: string, itemType: string, refId: string, targetPriceCents: number, currency = "USD"): PriceAlertRow {
  const db = getDb();
  const id = newId("alert");
  db.prepare("INSERT INTO price_alerts (id, user_id, item_type, ref_id, target_price_cents, currency) VALUES (?, ?, ?, ?, ?, ?)").run(id, userId, itemType, refId, targetPriceCents, currency);
  return db.prepare("SELECT * FROM price_alerts WHERE id = ?").get(id) as PriceAlertRow;
}

export function listPriceAlerts(userId: string): PriceAlertRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM price_alerts WHERE user_id = ? ORDER BY created_at DESC").all(userId) as PriceAlertRow[];
}

export function parseSnapshot<T>(row: { snapshot: string }): T {
  return fromJson<T>(row.snapshot, {} as T);
}
