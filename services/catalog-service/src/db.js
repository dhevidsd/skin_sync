const { Pool } = require('pg');
const config = require('./config');
const log = require('./logger');
const migrations = require('./migrations');

const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', (err) => log.error('idle database client error', { error: err.message }));

async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// Applies pending migrations in order. The advisory lock stops two replicas migrating at the same time.
async function migrate() {
  await withTransaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(4242)');
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.version));
    for (const m of migrations) {
      if (applied.has(m.version)) continue;
      await client.query(m.sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [m.version]);
      log.info('migration applied', { version: m.version, name: m.name });
    }
  });
}

async function waitForDatabase(attempts = 15, delayMs = 2000) {
  for (let i = 1; i <= attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (err) {
      log.warn('database not reachable yet', { attempt: i, error: err.message });
      if (i === attempts) throw err;
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
}

async function isHealthy() {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

module.exports = { pool, withTransaction, migrate, waitForDatabase, isHealthy };
