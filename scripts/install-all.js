// Installs dependencies for every service and creates .env from .env.example where missing.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const services = fs.readdirSync(path.join(ROOT, 'services'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';

for (const name of services) {
  const dir = path.join(ROOT, 'services', name);
  console.log(`\n== ${name}: npm install`);
  const result = spawnSync(npm, ['install', '--no-audit', '--no-fund'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) process.exit(result.status || 1);

  const env = path.join(dir, '.env');
  if (!fs.existsSync(env)) {
    fs.copyFileSync(path.join(dir, '.env.example'), env);
    console.log(`created ${path.relative(ROOT, env)} from .env.example`);
  }
}
