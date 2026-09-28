#!/usr/bin/env node
// Four independent HTTP servers. Publisher credentials stay in ignored local Worker config.
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { homedir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const candidates = [process.execPath,
  join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node'),
  join(homedir(), '.nvm/versions/node/v22.23.2/bin/node')];
const node = Number(process.versions.node.split('.')[0]) >= 22 ? process.execPath : candidates.slice(1).find(existsSync);
if (!node) throw new Error('Node.js 22 or newer is required. Install Node, then run npm run dev:all.');
const envFile = join(root, '.dev.vars');
const secrets = Object.fromEntries(readFileSync(envFile, 'utf8').split(/\r?\n/).flatMap(line => {
  const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (!match) return [];
  let value = match[2].trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  return [[match[1], value]];
}));
const publisherKeys=secrets.PUBLISHER_API_KEYS?JSON.parse(secrets.PUBLISHER_API_KEYS):{};
const publisherIds={dating:'wavelength',fashion:'wardrobe',outings:'cityguide'};
if (!secrets.PUBLISHER_API_KEY&&!Object.keys(publisherKeys).length) throw new Error('Configure publisher API credentials in .dev.vars.');
if (!existsSync(join(root, 'dist/index.html')) || !existsSync(join(root, 'apps/consumers/dist/index.html'))) {
  throw new Error('Build the exchange and consumer apps before starting: npm run build && npm run build:consumers');
}
const localPaymentMode = process.env.LOCAL_PAYMENT_MODE || 'simulation';
if (!['simulation', 'sandbox'].includes(localPaymentMode)) throw new Error('LOCAL_PAYMENT_MODE must be simulation or sandbox.');
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js');
const children = [];
function launch(name, config, port, inspector) {
  console.log(`${name}: http://127.0.0.1:${port}`);
  const child = spawn(node, [wrangler, 'dev', '--config', config, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspector), '--show-interactive-dev-session=false', '--log-level', 'warn'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PATH: `${dirname(node)}:${process.env.PATH || ''}` },
  });
  children.push(child);
  child.on('error', error => { console.error(`${name}: ${error.message}`); stop(1); });
  child.on('exit', code => { if (!stopping && code) stop(code); });
}
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 300).unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
launch('Accord exchange', join(root, 'wrangler.jsonc'), 8787, 9229);
for (const [index, scenario] of ['dating', 'fashion', 'outings'].entries()) {
  const config = JSON.parse(readFileSync(join(root, `wrangler.${scenario}.jsonc`), 'utf8'));
  const local = join(root, '.wrangler/local-consumers', scenario);
  mkdirSync(local, { recursive: true });
  config.main = join(root, 'apps/consumers/worker.ts');
  config.assets.directory = join(root, 'apps/consumers/dist');
  config.vars.EXCHANGE_URL = 'http://127.0.0.1:8787';
  // A fresh local exchange has no Stripe funding, even when deployed campaigns do.
  config.vars.DEMO_PAYMENT_MODE = localPaymentMode;
  delete config.$schema;
  delete config.services; // Local adapters use their own HTTP server on port 8787.
  const path = join(local, 'wrangler.json');
  writeFileSync(path, JSON.stringify(config, null, 2));
  writeFileSync(join(local, '.dev.vars'), `EXCHANGE_API_KEY=${JSON.stringify(publisherKeys[publisherIds[scenario]]||secrets.PUBLISHER_API_KEY)}\n`, { mode: 0o600 });
  launch(config.name, path, 8788 + index, 9230 + index);
}
