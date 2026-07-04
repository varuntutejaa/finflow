import pg from "pg";

const DEFAULT_DEV_DATABASE_URL = "postgres://finflow:finflow@localhost:54329/finflow";
const isProduction = process.env.NODE_ENV === "production";
const databaseUrl = process.env.DATABASE_URL || DEFAULT_DEV_DATABASE_URL;

if (isProduction && !process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL is required when NODE_ENV=production");
}

// A thin compatibility layer over node-postgres: named `@param` placeholders
// with a single options object, or positional `?` placeholders with plain
// arguments. Keeping that shape made the Postgres migration focused on SQL
// behavior instead of mechanical call-site churn.
export const pool = new pg.Pool({
  connectionString: databaseUrl,
});

// A reusable stand-in for SQLite's strftime('%Y-%m-%dT%H:%M:%fZ','now'),
// used as a column default/update expression across every config file's
// schema. Created here (rather than in database.js) because every config
// file imports from this module directly — ES modules only guarantee a
// dependency's top-level await finishes before a dependent's own top-level
// code runs when there's an actual import edge between them. database.js
// and investmentDatabase.js are siblings with no edge to each other (both
// just depend on this file), so creating it in database.js let the two
// modules' schema-init awaits race depending on network timing — this
// showed up as an intermittent "function iso_now() does not exist" error.
await pool.query(`
  CREATE OR REPLACE FUNCTION iso_now() RETURNS TEXT AS $$
    SELECT to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"');
  $$ LANGUAGE SQL VOLATILE;
`);

function normalizeQuery(sql, args) {
  const isNamedParams = args.length === 1 && args[0] !== null && typeof args[0] === "object" && !Array.isArray(args[0]);

  if (isNamedParams) {
    const paramOrder = [];
    const text = sql.replace(/@(\w+)/g, (_match, name) => {
      let index = paramOrder.indexOf(name);
      if (index === -1) {
        paramOrder.push(name);
        index = paramOrder.length - 1;
      }
      return `$${index + 1}`;
    });
    return { text, values: paramOrder.map((name) => args[0][name]) };
  }

  // Positional `?` style — called either as `.get(a, b)` (spread) or
  // `.get([a, b])` (array), both used interchangeably in the ported code.
  const values = args.length === 1 && Array.isArray(args[0]) ? args[0] : args;
  let i = 0;
  const text = sql.replace(/\?/g, () => `$${++i}`);
  return { text, values };
}

// Runs against the shared pool by default; `client` lets withTransaction
// scope a call to a single checked-out connection for BEGIN/COMMIT/ROLLBACK.
async function run(client, sql, args) {
  const { text, values } = normalizeQuery(sql, args);
  return (client ?? pool).query(text, values);
}

export async function dbGet(sql, ...args) {
  const result = await run(null, sql, args);
  return result.rows[0];
}

export async function dbAll(sql, ...args) {
  const result = await run(null, sql, args);
  return result.rows;
}

// Standard write helper with a small `changes` convenience for call sites that
// need to check whether a row was updated/deleted.
export async function dbRun(sql, ...args) {
  const result = await run(null, sql, args);
  return { changes: result.rowCount, rows: result.rows };
}

// Runs a callback inside a single checked-out Postgres connection so every
// query participates in the same BEGIN/COMMIT/ROLLBACK block.
export async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const scoped = {
      get: async (sql, ...args) => (await run(client, sql, args)).rows[0],
      all: async (sql, ...args) => (await run(client, sql, args)).rows,
      run: async (sql, ...args) => {
        const result = await run(client, sql, args);
        return { changes: result.rowCount, rows: result.rows };
      },
    };
    const result = await fn(scoped);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
