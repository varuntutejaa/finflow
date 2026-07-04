// Runs a real local Postgres instance for development, without Docker —
// useful on machines that don't have Docker installed (the docker-compose.yml
// "postgres" service is the equivalent for machines that do). Data persists
// across restarts in ~/.finflow-postgres-data, outside the repo and outside
// any OS temp directory that could be cleared.
//
// Usage: node scripts/local-postgres.mjs
// Then:  DATABASE_URL=postgres://finflow:finflow@localhost:54329/finflow node src/server.js
import EmbeddedPostgres from "embedded-postgres";
import fs from "fs";
import os from "os";
import path from "path";

const dataDir = path.join(os.homedir(), ".finflow-postgres-data");
// PG_VERSION only exists once `initdb` has already populated the data
// directory — initialise() errors out if run again against a non-empty dir,
// so this must only run on a genuinely fresh data directory.
const alreadyInitialised = fs.existsSync(path.join(dataDir, "PG_VERSION"));

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "finflow",
  password: "finflow",
  port: 54329,
  persistent: true,
});

if (!alreadyInitialised) {
  await pg.initialise();
}
await pg.start();
await pg.createDatabase("finflow").catch(() => {}); // already exists after the first run

console.log(`Postgres ready at postgres://finflow:finflow@localhost:54329/finflow`);
console.log(`Data directory: ${dataDir}`);

process.on("SIGTERM", async () => {
  await pg.stop();
  process.exit(0);
});
process.on("SIGINT", async () => {
  await pg.stop();
  process.exit(0);
});
