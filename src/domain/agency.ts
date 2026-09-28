import { getDb } from "../db/client.ts";

export interface AgencySettingsRow {
  id: number;
  host_agency_name: string;
  host_agency_identifier: string;
  has_ticketing_authority: number;
  support_phone: string | null;
  support_email: string | null;
  required_disclosures: string | null;
  updated_at: string;
}

export function getAgencySettings(): AgencySettingsRow {
  const db = getDb();
  const row = db.prepare("SELECT * FROM agency_settings WHERE id = 1").get() as AgencySettingsRow | undefined;
  if (row) return row;
  // Should always exist after seeding; this fallback keeps pages from crashing.
  return {
    id: 1,
    host_agency_name: "Not yet configured",
    host_agency_identifier: "UNSET",
    has_ticketing_authority: 0,
    support_phone: null,
    support_email: null,
    required_disclosures: null,
    updated_at: new Date().toISOString(),
  };
}

export function updateAgencySettings(input: Partial<Omit<AgencySettingsRow, "id" | "updated_at">>): void {
  const db = getDb();
  const current = getAgencySettings();
  const merged = { ...current, ...input };
  db.prepare(
    `INSERT INTO agency_settings (id, host_agency_name, host_agency_identifier, has_ticketing_authority, support_phone, support_email, required_disclosures, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
     ON CONFLICT(id) DO UPDATE SET
       host_agency_name = excluded.host_agency_name,
       host_agency_identifier = excluded.host_agency_identifier,
       has_ticketing_authority = excluded.has_ticketing_authority,
       support_phone = excluded.support_phone,
       support_email = excluded.support_email,
       required_disclosures = excluded.required_disclosures,
       updated_at = excluded.updated_at`,
  ).run(
    merged.host_agency_name,
    merged.host_agency_identifier,
    merged.has_ticketing_authority ? 1 : 0,
    merged.support_phone,
    merged.support_email,
    merged.required_disclosures,
  );
}
