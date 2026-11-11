// Creates the database tables: `npm run db:setup`.
// Works on any Postgres; on Tiger Data (TimescaleDB) it also makes stat_history a hypertable.
// Safe to run more than once.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dbQuery } from "./memory.mjs";

const dir = dirname(fileURLToPath(import.meta.url));

const schema = (await readFile(join(dir, "schema.sql"), "utf8")).replace(/create table (?!if not exists)/gi, "create table if not exists ");
await dbQuery(schema);
console.log("choices and agent_replies are ready.");

const timescale = await dbQuery("select 1 from pg_available_extensions where name = 'timescaledb'");
if (timescale.rows.length === 0) {
  console.log("This database has no TimescaleDB, so stat history stays in the game's save file.");
  console.log("Point DATABASE_URL at a Tiger Data service to store it in the database.");
} else {
  await dbQuery("create extension if not exists timescaledb");
  await dbQuery(await readFile(join(dir, "tiger.sql"), "utf8"));
  console.log("stat_history is ready as a TimescaleDB hypertable.");
}
process.exit(0);
