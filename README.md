# TyJen Travel

*Your adventure awaits.*

A working travel agency platform: one web app with a customer-facing side and an agent/admin side, backed by a single shared database so every authorized desktop sees the same data. Search covers flights, stays, flight+stay packages, and cruises with real (fictional, clearly labeled) demo inventory; cars, activities, and rail have complete, honest search screens wired to a "not connected" adapter rather than fabricated results.

This README covers what the app is, how to run it locally (including on a second authorized desktop), and where the demo login credentials are. See also:

- **ADAPTERS.md** — the supplier adapter architecture, what each product's adapter would need to go live, and the credential checklist.
- **DEPLOYMENT.md** — running this on the internet instead of just locally, and the capability table (what's demo vs. sandbox vs. live per product).
- **LIMITATIONS.md** — an honest list of what this build does and does not do yet.

## Why this is plain Node instead of a framework stack

The original plan was Next.js + Prisma + PostgreSQL. While building this, every environment available to me (this sandbox, and the bridge to your Windows desktop) turned out to have package-registry access blocked at the network level — `npm install` cannot reach `registry.npmjs.org` from either place. Rather than hand you an unverified pile of code that assumes packages I could never actually install, I rebuilt this on **zero runtime dependencies**: Node.js 22's built-ins only —

- **`node:sqlite`** for the database (stable in Node 22+, no driver to install)
- **`node --experimental-strip-types`** to run the TypeScript source directly (no build step, no bundler)
- A small hand-written HTTP router and an HTML-templating helper, instead of Express/React

This let me actually run the app, click through every required scenario, find real bugs, and fix them — instead of just writing code I hoped would work. Everything about the product (auth, RBAC, the adapter architecture, the booking state machine, the UI) is exactly what was specified; only the implementation technology changed, and only because of a hard constraint outside the app itself. If you later get npm access restored in your environment, the adapter interfaces in `src/adapters/types.ts` are the same shape you'd want whether or not you migrate the web layer to a framework.

## Requirements

- **Node.js 22.6 or newer** (for built-in `node:sqlite` and TypeScript stripping). Check with `node -v`.
- No database server to install — SQLite lives in one file inside the project (`data/tyjen.db`).
- No other system dependencies.

## Windows setup (first time)

1. Install Node.js 22 LTS or newer from [nodejs.org](https://nodejs.org) if you don't have it. Confirm with `node -v` in a Command Prompt or PowerShell window.
2. Copy this project folder to your machine, e.g. `Documents\TyJenTravel`.
3. Open a terminal in that folder (in File Explorer: click the address bar, type `cmd`, press Enter).
4. Copy the environment template:
   ```
   copy .env.example .env
   ```
5. Open `.env` in Notepad and set a real `SESSION_SECRET` (a long random string — the file explains how to generate one) before doing anything beyond local demo use. The demo works with the placeholder value, but don't deploy with it.
6. Set up the database:
   ```
   npm run migrate
   npm run seed
   ```
   `seed` prints the demo login credentials to the terminal (also listed below) and seeds realistic fictional flights, stays, and cruises.
7. Start the server:
   ```
   npm start
   ```
8. Open **http://localhost:3000** in a browser.

To stop the server, press `Ctrl+C` in that terminal.

For day-to-day development (auto-restarts on file changes): `npm run dev` instead of `npm start`.

## Running on a second authorized desktop

The product requirement is that multiple desktops can use the app under one account system with one shared database — not that each desktop keeps its own separate data. Two ways to satisfy that, depending on what you want:

- **Point a second desktop's browser at the first desktop's server.** Run `npm start` on desktop A, then from desktop B's browser go to `http://<desktop-A's-LAN-IP>:3000` (find the IP with `ipconfig` on desktop A). Both desktops now hit the exact same database and the exact same sessions — an admin can see both sessions on the Admin → Sessions page and revoke either one independently. This requires both machines on the same network and `PORT` reachable through Windows Firewall.
- **Deploy the server to the internet** (see DEPLOYMENT.md) and have every desktop connect to that one URL. This is the right approach once you're not just demoing on a LAN.

What this build does **not** do is give each desktop its own private copy of the data — that would defeat the "one shared source of truth across authorized desktops" requirement, so there is deliberately no per-device database file.

## Demo login credentials

After `npm run seed`:

| Role | Email | Password | Notes |
|---|---|---|---|
| Admin | `admin@tyjentravel.demo` | `ChangeMe123!` | Full admin console: agents, sessions, suppliers, audit log, support, agency settings. |
| Agent (authorized) | `ava.agent@tyjentravel.demo` | `AgentDemo123!` | Can search on behalf of clients, build quotes, book. |
| Agent (pending) | `marcus.pending@tyjentravel.demo` | `AgentDemo123!` | Demonstrates the "awaiting authorization" state — can sign in, cannot yet act as an agent, until an admin authorizes the account at Admin → Agents. |
| Traveler | `jordan.traveler@example.com` | `TravelerDemo123!` | A customer account with a client profile already linked to Ava, so you can see the customer side of an agent-created quote. |
| Traveler | `priya.traveler@example.com` | `TravelerDemo123!` | Second demo traveler. |

Change or remove these before any non-local deployment (see DEPLOYMENT.md).

## What's demo data vs. real

Every screen that shows demo or sandbox data says so, out loud, right on the page — this was a hard requirement, not a nice-to-have. Flights, stays, and cruises are backed by realistic **fictional** inventory seeded by `npm run seed`: no real airline, hotel, or cruise line data or pricing is used or implied. Cars, activities, and rail have fully built search screens that honestly return zero results with a "no supplier connected" explanation, because building fake results for those would violate the project's core "never fabricate a result" rule. See the capability table in DEPLOYMENT.md for the exact status of every product today, and ADAPTERS.md for what connecting a real supplier to any of them would require.

## Common commands

```
npm start          # run the server (production-style, no auto-restart)
npm run dev         # run the server with auto-restart on file changes
npm run migrate      # apply any new database migrations
npm run seed         # wipe and reseed demo data (destructive — see below)
npm run reset-db      # delete the database file entirely
npm test           # run the automated test suite (node:test)
npm run typecheck     # run TypeScript's checker (requires `typescript`/`@types/node`
                     #   installed locally — see "A note on npm" below)
```

`npm run seed` is meant for demo/dev use: it clears existing rows in the demo-relevant tables and reinserts fresh seed data every time it's run. Do not run it against a database that has real customer data you want to keep.

### A note on npm

Because this project has zero runtime dependencies, `npm install` has nothing to fetch for running the app itself. The two `devDependencies` (`typescript`, `@types/node`) are optional and only used by `npm run typecheck` for extra editor/CI confidence — if your machine has normal npm registry access (most will; the block was specific to the sandboxed environment this was built in), `npm install` will fetch those two packages and `npm run typecheck` will work. If you don't have registry access either, everything else in this project — running the server, the whole demo, the automated tests — works without installing anything.

## Automated tests

`npm test` runs the `node:test`-based suite in `tests/`: password hashing and session lifecycle, role-based access control (including the exact bug class where an agent could act on another agent's client record), pricing/itemization math, and the full booking state machine (successful confirmation, declined card, a supplier failure *after* payment authorization correctly voiding instead of capturing, and idempotent retry safety). Each test file uses its own throwaway SQLite file, so running tests never touches your real `data/tyjen.db`.

## Project layout

```
src/
  config.ts, env.ts        # configuration + .env loading (no dotenv package needed)
  db/                     # node:sqlite client + hand-written migrations
  domain/                  # business logic: auth, RBAC, pricing, quotes, bookings, clients...
  adapters/                # supplier adapter interface + demo/unconnected adapters (see ADAPTERS.md)
  http/                    # router + all route handlers (customer, agent, admin)
  views/                   # HTML templating + shared page components
public/                    # static assets: CSS, client JS, PWA manifest/service worker, icons
tests/                    # node:test suite
```
