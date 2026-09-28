import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadEnv, optional, bool, int } from "./env.ts";

export const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

loadEnv(ROOT_DIR);

export const config = {
  port: int("PORT", 3000),
  appBaseUrl: optional("APP_BASE_URL", "http://localhost:3000"),
  nodeEnv: optional("NODE_ENV", "development"),
  isProduction: optional("NODE_ENV", "development") === "production",
  databaseFile: resolve(ROOT_DIR, optional("DATABASE_FILE", "./data/tyjen.db")),
  sessionSecret: optional("SESSION_SECRET", "dev-only-insecure-secret-change-me"),
  sessionTtlHours: int("SESSION_TTL_HOURS", 720),
  cookieSecure: bool("COOKIE_SECURE", false),
  seedAdminEmail: optional("SEED_ADMIN_EMAIL", "admin@tyjentravel.demo"),
  seedAdminPassword: optional("SEED_ADMIN_PASSWORD", "ChangeMe123!"),
  hostAgency: {
    name: optional("HOST_AGENCY_NAME", "Sample Host Travel Group LLC"),
    identifier: optional("HOST_AGENCY_IATA_ARC_NUMBER", "UNSET-CONTACT-YOUR-HOST-AGENCY"),
    hasTicketingAuthority: bool("HOST_AGENCY_TICKETING_AUTHORITY", false),
    supportPhone: optional("HOST_AGENCY_SUPPORT_PHONE", "1-800-555-0100"),
    supportEmail: optional("HOST_AGENCY_SUPPORT_EMAIL", "support@example-host-agency.demo"),
  },
  payments: {
    provider: optional("PAYMENTS_PROVIDER", "mock"),
  },
  email: {
    from: optional("EMAIL_FROM", "TyJen Travel <no-reply@tyjentravel.demo>"),
    smtpHost: optional("SMTP_HOST", ""),
  },
} as const;

if (!config.isProduction && config.sessionSecret === "dev-only-insecure-secret-change-me") {
  // eslint-disable-next-line no-console
  console.warn(
    "[config] Using the default SESSION_SECRET. Fine for local demo use only — " +
      "set a real SESSION_SECRET before deploying.",
  );
}
