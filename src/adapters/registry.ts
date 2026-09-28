import { getDb } from "../db/client.ts";
import { newId } from "../domain/ids.ts";
import type { ConnectionStatusInfo, ProductType, SupplierStatus } from "./types.ts";

interface SupplierConnectionRow {
  id: string;
  product_type: ProductType;
  supplier_name: string;
  status: SupplierStatus;
  can_book_with_tyjen: number;
  notes: string | null;
  updated_at: string;
}

export function listSupplierConnections(): SupplierConnectionRow[] {
  const db = getDb();
  return db.prepare("SELECT * FROM supplier_connections ORDER BY product_type").all() as SupplierConnectionRow[];
}

export function getConnection(productType: ProductType): ConnectionStatusInfo {
  const db = getDb();
  const row = db
    .prepare("SELECT * FROM supplier_connections WHERE product_type = ? ORDER BY updated_at DESC LIMIT 1")
    .get(productType) as SupplierConnectionRow | undefined;
  if (!row) {
    return { productType, supplierName: "None configured", status: "not_connected", canBookWithTyjen: false, notes: null };
  }
  return {
    productType,
    supplierName: row.supplier_name,
    status: row.status,
    canBookWithTyjen: !!row.can_book_with_tyjen,
    notes: row.notes,
  };
}

export function upsertConnection(
  productType: ProductType,
  supplierName: string,
  status: SupplierStatus,
  canBookWithTyjen: boolean,
  notes: string | null,
  updatedByUserId: string,
): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM supplier_connections WHERE product_type = ? AND supplier_name = ?")
    .get(productType, supplierName) as { id: string } | undefined;
  if (existing) {
    db.prepare(
      `UPDATE supplier_connections SET status = ?, can_book_with_tyjen = ?, notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_by_user_id = ? WHERE id = ?`,
    ).run(status, canBookWithTyjen ? 1 : 0, notes, updatedByUserId, existing.id);
  } else {
    db.prepare(
      `INSERT INTO supplier_connections (id, product_type, supplier_name, status, can_book_with_tyjen, notes, updated_by_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(newId("conn"), productType, supplierName, status, canBookWithTyjen ? 1 : 0, notes, updatedByUserId);
  }
}
