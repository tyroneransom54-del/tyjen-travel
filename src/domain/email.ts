// No SMTP is configured in this demo build (see .env.example). Rather than
// silently doing nothing, every "email" is written to the email_outbox table
// so the admin panel and tests can verify a confirmation was actually
// generated with the right content — swap sendEmail's body for a real SMTP
// or transactional-email API call when credentials are available.
import { getDb } from "../db/client.ts";
import { newId } from "./ids.ts";
import { config } from "../config.ts";

export function sendEmail(to: string, subject: string, body: string, related?: { type: string; id: string }): void {
  const db = getDb();
  db.prepare(`INSERT INTO email_outbox (id, to_email, subject, body, related_type, related_id) VALUES (?, ?, ?, ?, ?, ?)`).run(
    newId("email"),
    to,
    subject,
    body,
    related?.type ?? null,
    related?.id ?? null,
  );
  if (!config.isProduction) {
    // eslint-disable-next-line no-console
    console.log(`[email:outbox] To: ${to} | Subject: ${subject}`);
  }
}

export function listOutbox(limit = 100) {
  const db = getDb();
  return db.prepare("SELECT * FROM email_outbox ORDER BY sent_at DESC LIMIT ?").all(limit);
}
