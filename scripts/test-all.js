// Runs every service's unit tests and saves the combined output to evidence/tests/.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const services = fs.readdirSync(path.join(ROOT, 'services'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const outDir = path.join(ROOT, 'evidence', 'tests');
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `unit-tests-${new Date().toISOString().replace(/:/g, '-').replace(/\..+/, '')}.txt`);

let report = `$ npm test   (${new Date().toISOString()})\n`;
const summary = [];
for (const name of services) {
  // Output is not a TTY, so node:test prints TAP: every test name (BR1..BR6) with ok / not ok.
  const result = spawnSync(npm, ['test', '--silent'], {
    cwd: path.join(ROOT, 'services', name),
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  const output = `${result.stdout}${result.stderr}`;
  const pass = Number((output.match(/^# pass (\d+)/m) || [])[1] || 0);
  const fail = Number((output.match(/^# fail (\d+)/m) || [])[1] || 0);
  summary.push({ name, pass, fail, exit: result.status });
  const tests = output.split('\n').filter((l) => /^(not )?ok \d+/.test(l)).join('\n');
  report += `\n== ${name} (pass ${pass}, fail ${fail})\n${tests}\n`;
  if (result.status !== 0) report += output;
}

report += '\nSUMMARY\n';
for (const s of summary) report += `${s.name.padEnd(22)} pass ${String(s.pass).padStart(3)}  fail ${s.fail}\n`;
fs.writeFileSync(file, report);
console.log(report);
console.log(`Saved to ${path.relative(ROOT, file)}`);
process.exit(summary.every((s) => s.exit === 0) ? 0 : 1);
