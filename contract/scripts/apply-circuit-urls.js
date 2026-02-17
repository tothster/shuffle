#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const urlsPath = path.join(repoRoot, 'build', 'pinata_urls.json');
const libPath = path.join(repoRoot, 'programs', 'shuffle_protocol', 'src', 'lib.rs');

if (!fs.existsSync(urlsPath)) {
  console.error(`Missing file: ${urlsPath}`);
  process.exit(1);
}

const raw = JSON.parse(fs.readFileSync(urlsPath, 'utf8'));
const circuits = [
  'add_together',
  'add_balance',
  'accumulate_order',
  'init_batch_state',
  'reveal_batch',
  'calculate_payout',
  'sub_balance',
  'transfer',
];

function normalizeUrl(value) {
  if (!value || typeof value !== 'string') {
    throw new Error(`Invalid URL/CID value: ${value}`);
  }

  if (value.startsWith('http://') || value.startsWith('https://')) {
    return value;
  }

  return `https://gateway.pinata.cloud/ipfs/${value}`;
}

const fnByCircuit = Object.fromEntries(
  circuits.map((name) => [name, `init_${name}_comp_def`]),
);

let content = fs.readFileSync(libPath, 'utf8');

for (const circuit of circuits) {
  if (!(circuit in raw)) {
    throw new Error(`Missing key '${circuit}' in ${urlsPath}`);
  }

  const fnName = fnByCircuit[circuit];
  const nextUrl = normalizeUrl(raw[circuit]);

  const re = new RegExp(
    `(pub fn ${fnName}\\([^)]*\\) -> Result<\\(\\)> \\{[\\s\\S]*?source: \")([^\"]+)(\"\\.to_string\\(\\),)`,
    'm',
  );

  if (!re.test(content)) {
    throw new Error(`Could not locate source URL in function ${fnName}`);
  }

  content = content.replace(re, `$1${nextUrl}$3`);
}

fs.writeFileSync(libPath, content);
console.log(`Updated circuit URLs in ${path.relative(process.cwd(), libPath)}`);
