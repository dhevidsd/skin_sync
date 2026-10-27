// Dev-only local PostgreSQL (embedded-postgres): one cluster in ./.data/pg with a
// separate database AND a separate login role per service. Services never import this;
// they only see DATABASE_URL.
// Usage: node scripts/db.js start | stop | status
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, '.data', 'pg');
const LOG_FILE = path.join(ROOT, '.data', 'postgres.log');
const PORT = Number(process.env.PGPORT || 5432);
const SUPERUSER = 'postgres';
const SUPERUSER_PASSWORD = process.env.PG_SUPERUSER_PASSWORD || 'postgres';

// Dev credentials only. They match each service's .env.example.
const SERVICE_DATABASES = [
  { service: 'catalog-service', database: 'catalog_db', user: 'catalog_user', password: 'catalog_pass' },
  { service: 'quiz-service', database: 'quiz_db', user: 'quiz_user', password: 'quiz_pass' },
  { service: 'order-service', database: 'order_db', user: 'order_user', password: 'order_pass' },
  { service: 'payment-service', database: 'payment_db', user: 'payment_user', password: 'payment_pass' },
  { service: 'notification-service', database: 'notification_db', user: 'notification_user', password: 'notification_pass' },
];

let pgCtlBinary;

// The platform package (e.g. @embedded-postgres/linux-x64) exports the absolute path of its binaries.
async function loadPgCtl() {
  const platform = process.platform === 'win32' ? 'windows' : process.platform;
  const binaries = await import(`@embedded-postgres/${platform}-${process.arch}`);
  pgCtlBinary = binaries.pg_ctl;
}

function pgCtl(args) {
  return spawnSync(pgCtlBinary, args, { encoding: 'utf8' });
}

function isRunning() {
  return fs.existsSync(path.join(DATA_DIR, 'PG_VERSION')) && pgCtl(['status', '-D', DATA_DIR]).status === 0;
}

async function initialiseCluster() {
  if (fs.existsSync(path.join(DATA_DIR, 'PG_VERSION'))) return;
  console.log(`Initialising new PostgreSQL cluster in ${DATA_DIR}`);
  fs.mkdirSync(path.dirname(DATA_DIR), { recursive: true });
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    port: PORT,
    user: SUPERUSER,
    password: SUPERUSER_PASSWORD,
    authMethod: 'scram-sha-256',
    persistent: true,
    onLog: () => {},
  });
  await pg.initialise();
}

// pg_ctl runs postgres as a background process, so it keeps running after this script exits.
function startServer() {
  const result = pgCtl([
    'start', '-D', DATA_DIR, '-l', LOG_FILE, '-w', '-t', '60',
    '-o', `-p ${PORT} -c listen_addresses=localhost`,
  ]);
  if (result.status !== 0) {
    throw new Error(`pg_ctl start failed:\n${result.stdout}\n${result.stderr}\nSee ${LOG_FILE}`);
  }
}

async function provisionServiceDatabases() {
  const admin = new Client({ host: 'localhost', port: PORT, user: SUPERUSER, password: SUPERUSER_PASSWORD, database: 'postgres' });
  await admin.connect();
  try {
    for (const s of SERVICE_DATABASES) {
      const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [s.user]);
      if (role.rowCount === 0) {
        await admin.query(`CREATE ROLE ${s.user} LOGIN PASSWORD '${s.password}'`);
      }
      const db = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [s.database]);
      if (db.rowCount === 0) {
        await admin.query(`CREATE DATABASE ${s.database} OWNER ${s.user}`);
      }
      // Only the owning service's role may connect to its database.
      await admin.query(`REVOKE ALL ON DATABASE ${s.database} FROM PUBLIC`);
    }
  } finally {
    await admin.end();
  }
}

function printUrls() {
  console.log('\nService databases (put these in each service .env as DATABASE_URL):');
  for (const s of SERVICE_DATABASES) {
    console.log(`  ${s.service.padEnd(21)} postgres://${s.user}:${s.password}@localhost:${PORT}/${s.database}`);
  }
}

async function start() {
  await initialiseCluster();
  if (isRunning()) {
    console.log(`PostgreSQL already running on port ${PORT}`);
  } else {
    startServer();
    console.log(`PostgreSQL started on port ${PORT} (log: ${path.relative(ROOT, LOG_FILE)})`);
  }
  await provisionServiceDatabases();
  printUrls();
}

function stop() {
  if (!isRunning()) {
    console.log('PostgreSQL is not running');
    return;
  }
  const result = pgCtl(['stop', '-D', DATA_DIR, '-m', 'fast', '-w']);
  if (result.status !== 0) throw new Error(`pg_ctl stop failed:\n${result.stdout}\n${result.stderr}`);
  console.log('PostgreSQL stopped');
}

function status() {
  console.log(isRunning() ? `PostgreSQL running on port ${PORT}` : 'PostgreSQL is not running');
  if (isRunning()) printUrls();
}

const commands = { start, stop, status };
const command = commands[process.argv[2]];
if (!command) {
  console.error('Usage: node scripts/db.js start|stop|status');
  process.exit(1);
}
loadPgCtl().then(command).catch((err) => {
  console.error(err.message);
  process.exit(1);
});
