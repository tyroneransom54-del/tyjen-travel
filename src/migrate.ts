import { runMigrations, closeDb } from "./db/client.ts";
import { config } from "./config.ts";

const applied = runMigrations();
if (applied.length === 0) {
  console.log(`No new migrations to apply. Database is up to date at ${config.databaseFile}`);
} else {
  console.log(`Applied ${applied.length} migration(s) to ${config.databaseFile}:`);
  for (const f of applied) console.log(`  - ${f}`);
}
closeDb();
