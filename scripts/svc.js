// Starts/stops the services as background processes for local development.
// Logs go to .data/logs/<service>.log, PIDs to .data/run/<service>.pid.
// Usage: node scripts/svc.js start|stop|restart|status [service|all]
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LOG_DIR = path.join(ROOT, '.data', 'logs');
const RUN_DIR = path.join(ROOT, '.data', 'run');

// Start order: dependencies first. Ports must match each service's .env.
const SERVICES = {
  'catalog-service': 3001,
  'payment-service': 3004,
  'quiz-service': 3002,
  'order-service': 3003,
  'notification-service': 3005,
};

const pidFile = (name) => path.join(RUN_DIR, `${name}.pid`);

function readPid(name) {
  try {
    return Number(fs.readFileSync(pidFile(name), 'utf8'));
  } catch {
    return null;
  }
}

function isAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function health(name) {
  try {
    const res = await fetch(`http://localhost:${SERVICES[name]}/health`, { signal: AbortSignal.timeout(1000) });
    return await res.json();
  } catch {
    return null;
  }
}

async function start(name) {
  if (isAlive(readPid(name))) {
    console.log(`${name} already running (pid ${readPid(name)})`);
    return;
  }
  const dir = path.join(ROOT, 'services', name);
  if (!fs.existsSync(path.join(dir, 'node_modules'))) throw new Error(`${name}: dependencies missing, run "npm run install:all"`);
  fs.mkdirSync(LOG_DIR, { recursive: true });
  fs.mkdirSync(RUN_DIR, { recursive: true });
  const out = fs.openSync(path.join(LOG_DIR, `${name}.log`), 'a');
  const child = spawn(process.execPath, ['src/index.js'], { cwd: dir, detached: true, stdio: ['ignore', out, out] });
  child.unref();
  fs.writeFileSync(pidFile(name), String(child.pid));

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const h = await health(name);
    if (h) {
      console.log(`${name.padEnd(21)} started  pid ${child.pid}  port ${SERVICES[name]}  ${h.status}`);
      return;
    }
    if (!isAlive(child.pid)) throw new Error(`${name} exited during startup, see .data/logs/${name}.log`);
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${name} did not become healthy in time, see .data/logs/${name}.log`);
}

async function stop(name) {
  const pid = readPid(name);
  if (!isAlive(pid)) {
    console.log(`${name.padEnd(21)} not running`);
    fs.rmSync(pidFile(name), { force: true });
    return;
  }
  process.kill(pid, 'SIGTERM');
  const deadline = Date.now() + 15000;
  while (isAlive(pid) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 200));
  if (isAlive(pid)) process.kill(pid, 'SIGKILL');
  fs.rmSync(pidFile(name), { force: true });
  console.log(`${name.padEnd(21)} stopped  pid ${pid}`);
}

async function status(name) {
  const pid = readPid(name);
  const h = await health(name);
  const running = isAlive(pid) ? `pid ${pid}` : 'not running';
  console.log(`${name.padEnd(21)} ${running.padEnd(12)} port ${SERVICES[name]}  ${h ? JSON.stringify(h) : 'no response'}`);
}

async function main() {
  const [command, target = 'all'] = process.argv.slice(2);
  const names = target === 'all' ? Object.keys(SERVICES) : [target];
  for (const n of names) if (!SERVICES[n]) throw new Error(`Unknown service ${n}. Known: ${Object.keys(SERVICES).join(', ')}`);
  const actions = {
    start: async (n) => start(n),
    stop: async (n) => stop(n),
    restart: async (n) => {
      await stop(n);
      await start(n);
    },
    status: async (n) => status(n),
  };
  if (!actions[command]) throw new Error('Usage: node scripts/svc.js start|stop|restart|status [service|all]');
  const ordered = command === 'stop' ? [...names].reverse() : names;
  for (const n of ordered) await actions[command](n);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { start, stop, health, SERVICES };
