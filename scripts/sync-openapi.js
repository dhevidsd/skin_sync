// Copies each service's openapi.yaml (the source of truth) into docs/openapi/ for the report.
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const target = path.join(ROOT, 'docs', 'openapi');
fs.mkdirSync(target, { recursive: true });

for (const name of fs.readdirSync(path.join(ROOT, 'services'))) {
  const source = path.join(ROOT, 'services', name, 'openapi.yaml');
  if (!fs.existsSync(source)) continue;
  fs.copyFileSync(source, path.join(target, `${name}.yaml`));
  console.log(`docs/openapi/${name}.yaml`);
}
