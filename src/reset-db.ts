// Deletes the local database file (and its WAL/SHM companions) so the demo
// can be reset to a clean state. Only ever touches the file configured by
// DATABASE_FILE, never anything else on disk.
import { existsSync, unlinkSync } from "node:fs";
import { config } from "./config.ts";

for (const suffix of ["", "-wal", "-shm"]) {
  const path = config.databaseFile + suffix;
  if (existsSync(path)) {
    unlinkSync(path);
    console.log(`Deleted ${path}`);
  }
}
console.log('Database reset. Run "npm run migrate" then "npm run seed" to rebuild the demo data.');
