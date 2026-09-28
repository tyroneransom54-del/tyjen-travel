# Deployment

## Capability table (as of this build)

Live status is checked via the running database, not guessed — this is exactly what Admin → Supplier Connections shows.

| Product | Supplier connected | Status | Can book with TyJen | Referral-only (provider handoff)? |
|---|---|---|:---:|:---:|
| Flights | TyJen Demo Fares (fictional) | `demo` | Yes | No |
| Stays | TyJen Demo Stays (fictional) | `demo` | Yes | No |
| Packages | TyJen Demo Fares + TyJen Demo Stays | `demo` | Yes | No |
| Cruises | TyJen Demo Cruises (fictional) | `demo` | Yes | No |
| Cars | None | `not_connected` | — | — |
| Activities | None | `not_connected` | — | — |
| Rail | None | `not_connected` | — | — |

Nothing here is `sandbox` or `live` yet — that only happens once a real supplier contract and credentials exist (see ADAPTERS.md's checklist). Flipping any row to `not_connected` (even flights/stays/cruises, which do have demo data) makes that product's search honestly return zero results instead of continuing to show demo offers — verified during end-to-end testing of this build.

## Running locally (recap)

See README.md for the full walkthrough. Short version: `npm run migrate && npm run seed && npm start`, then open `http://localhost:3000`.

## Running on the internet

This app is a single Node.js process serving HTTP directly (no separate build step, no reverse-proxy requirement beyond normal TLS termination). To put it on the internet:

1. **Get a Linux (or Windows) host with Node.js 22+.** Any VPS, a small cloud VM, or a PaaS that runs an arbitrary Node process works (Render, Railway, Fly.io, a plain EC2/Droplet, etc.). This build has no framework-specific deploy target (no Next.js/Vercel dependency) — it's a plain `node src/server.ts` process.
2. **Copy the project** (or deploy from your own git repo) to that host.
3. **Set environment variables** for production — do not reuse the local demo defaults:
   - `NODE_ENV=production`
   - `SESSION_SECRET` — a real, long random value (see `.env.example` for how to generate one). This signs every session cookie; treat it like a password.
   - `COOKIE_SECURE=true` — requires the site to be served over HTTPS, which it should be in production.
   - `APP_BASE_URL` — the real public URL (used in emails and shareable quote links).
   - `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — change from the demo defaults before running `npm run seed` against a production database, or better, create the admin account through a one-time script instead of the demo seed.
   - Any live supplier credentials once you have them (see ADAPTERS.md).
4. **TLS**: terminate HTTPS in front of the Node process (a reverse proxy like nginx/Caddy, or your host's built-in TLS/load-balancer feature). The app itself speaks plain HTTP; `COOKIE_SECURE=true` assumes something in front of it is handling TLS.
5. **Run migrations**: `npm run migrate` once against the production database file before first start.
6. **Start the process** under a supervisor that restarts it on crash and on reboot — `systemd`, `pm2`, or your host's process manager. Example systemd unit sketch:
   ```ini
   [Service]
   WorkingDirectory=/opt/tyjen-travel
   ExecStart=/usr/bin/node --experimental-strip-types src/server.ts
   Restart=always
   EnvironmentFile=/opt/tyjen-travel/.env
   ```
7. **Backups**: the entire database is one file (`DATABASE_FILE`, default `./data/tyjen.db`). Back it up on a schedule appropriate to your data volume (a nightly copy is a reasonable starting point for a low-volume agency).

### Multiple authorized desktops against one internet deployment

Once the app is reachable at a real URL, every authorized desktop simply points its browser there — there is nothing else to configure per-desktop. Authorization is per-user-account (`agent_profiles.authorized`, gated by an admin) and per-session (visible and individually revocable at Admin → Sessions), not per-device configuration, so this "just works" the same way whether two desktops or twenty connect.

## Upgrading to PostgreSQL (optional, for higher-volume production use)

This build uses `node:sqlite` deliberately, so the whole app runs with zero services to install (see README.md for why). SQLite is genuinely fine for a single agency's volume — it's what a lot of real small-business tools run on. If you outgrow it (heavy concurrent write load, multiple app server instances behind a load balancer needing to share one database over the network instead of one file), the migration path is:

1. Stand up a PostgreSQL instance (managed, e.g. RDS/Cloud SQL/Supabase, or self-hosted).
2. Rewrite `src/db/client.ts`'s `getDb()`/`runMigrations()` to use a Postgres driver instead of `node:sqlite` (this is the one file that would need a real npm dependency — e.g. `pg` — since Postgres isn't a Node built-in the way SQLite now is).
3. Translate `src/db/migrations/0001_init.sql` to Postgres syntax (mostly compatible; watch for SQLite-specific bits like `strftime` defaults, which become `now()`/`CURRENT_TIMESTAMP` in Postgres, and `INTEGER PRIMARY KEY` autoincrement differences).
4. Every other file in the app (`domain/`, `http/routes/`) talks to the database only through the `LooseDb`/`LooseStatement` interface in `db/client.ts` — none of them would need to change.

This wasn't done in this build because it would have reintroduced the exact npm-install dependency that made local, verified, end-to-end testing possible in the first place (see README.md). It's a clean, contained follow-up whenever you have normal package-registry access and a reason to need it.

## Progressive Web App (PWA)

The app ships a `manifest.webmanifest` and a service worker (`public/service-worker.js`) that caches the static shell (CSS/JS/icons) and always goes to the network for pages and data, so content stays fresh while the app still installs as a PWA (desktop or mobile "Install app" prompt) for quick access. No offline booking capability is claimed or implied — that would require a much larger architecture change and isn't part of this build.
