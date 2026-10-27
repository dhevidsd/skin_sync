// Helpers shared by the root scripts (seed, e2e, challenge scripts). Not used by any service.
const fs = require('node:fs');
const path = require('node:path');
const { Client } = require('pg');

const ROOT = path.resolve(__dirname, '..', '..');

// Scripts are API clients, so localhost defaults are fine here; override via env (e.g. for Minikube).
const URLS = {
  catalog: process.env.CATALOG_URL || 'http://localhost:3001',
  quiz: process.env.QUIZ_URL || 'http://localhost:3002',
  order: process.env.ORDER_URL || 'http://localhost:3003',
  payment: process.env.PAYMENT_URL || 'http://localhost:3004',
  notification: process.env.NOTIFICATION_URL || 'http://localhost:3005',
};

// Used only to print evidence of the final database state.
const DB_URLS = {
  catalog: process.env.CATALOG_DATABASE_URL || 'postgres://catalog_user:catalog_pass@localhost:5432/catalog_db',
  order: process.env.ORDER_DATABASE_URL || 'postgres://order_user:order_pass@localhost:5432/order_db',
  payment: process.env.PAYMENT_DATABASE_URL || 'postgres://payment_user:payment_pass@localhost:5432/payment_db',
  notification: process.env.NOTIFICATION_DATABASE_URL || 'postgres://notification_user:notification_pass@localhost:5432/notification_db',
};

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://guest:guest@localhost:5672';

async function api(method, url, { body, headers = {} } = {}) {
  const started = Date.now();
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  return { status: res.status, body: json, headers: res.headers, ms: Date.now() - started };
}

async function query(dbUrl, sql, params = []) {
  const client = new Client({ connectionString: dbUrl });
  await client.connect();
  try {
    return (await client.query(sql, params)).rows;
  } finally {
    await client.end();
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, { timeoutMs = 15000, intervalMs = 500 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await fn();
    if (value) return value;
    if (Date.now() > deadline) return null;
    await sleep(intervalMs);
  }
}

function runId() {
  return new Date().toISOString().replace(/[-:T.Z]/g, '').slice(4, 14);
}

// Writes everything printed to the console into evidence/<folder>/<name>-<timestamp>.txt as well.
function createEvidence(folder, name) {
  const dir = path.join(ROOT, 'evidence', folder);
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '');
  const file = path.join(dir, `${name}-${stamp}.txt`);
  const write = (text) => {
    const line = `[${new Date().toISOString()}] ${text}`;
    console.log(line);
    fs.appendFileSync(file, `${line}\n`);
  };
  write(`$ node ${path.relative(ROOT, process.argv[1])} ${process.argv.slice(2).join(' ')}`.trim());
  let passed = 0;
  let failed = 0;
  return {
    file,
    log: (...parts) => write(parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')),
    section: (title) => write(`\n==== ${title} ====`),
    table: (rows) => write(`\n${formatTable(rows)}`),
    check(condition, description) {
      if (condition) passed++;
      else failed++;
      write(`${condition ? 'PASS' : 'FAIL'}  ${description}`);
      return condition;
    },
    finish() {
      write(`\nRESULT: ${passed} passed, ${failed} failed`);
      write(`Evidence written to ${path.relative(ROOT, file)}`);
      return failed === 0;
    },
  };
}

function formatTable(rows) {
  if (!rows || rows.length === 0) return '(no rows)';
  const cols = Object.keys(rows[0]);
  const cell = (v) => (v instanceof Date ? v.toISOString() : v === null || v === undefined ? 'NULL' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => cell(r[c]).length)));
  const line = (vals) => vals.map((v, i) => v.padEnd(widths[i])).join(' | ');
  return [line(cols), widths.map((w) => '-'.repeat(w)).join('-+-'), ...rows.map((r) => line(cols.map((c) => cell(r[c]))))].join('\n');
}

// Picks the lines of a service log file that contain any of the given strings.
function grepServiceLog(service, needles) {
  const file = path.join(ROOT, '.data', 'logs', `${service}.log`);
  if (!fs.existsSync(file)) return [`(no log file ${path.relative(ROOT, file)}; start services with "npm run start:all" to capture logs)`];
  return fs.readFileSync(file, 'utf8').split('\n').filter((l) => needles.some((n) => l.includes(n)));
}

module.exports = { ROOT, URLS, DB_URLS, RABBITMQ_URL, api, query, sleep, waitFor, runId, createEvidence, formatTable, grepServiceLog };
