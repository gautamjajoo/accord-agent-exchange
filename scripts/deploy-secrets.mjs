import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const allowed = new Set(['OPENAI_API_KEY','STRIPE_SECRET_KEY','STRIPE_WEBHOOK_SECRET','STRIPE_PUBLISHERS','ADMIN_TOKEN','PUBLISHER_API_KEY']);
const secrets = {};
for (const line of readFileSync(new URL('../.dev.vars', import.meta.url), 'utf8').split('\n')) {
  const at = line.indexOf('=');
  if (at < 1) continue;
  const key = line.slice(0,at).trim();
  let value = line.slice(at+1).trim();
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
  if (allowed.has(key) && value) secrets[key] = value;
}
const publishersOnly=process.argv.includes('--publishers');
const targets=publishersOnly?['dating','fashion','outings']:[null];
let status=0;
for(const scenario of targets){
const args=['node_modules/wrangler/bin/wrangler.js','secret','bulk',...(scenario?['--config',`wrangler.${scenario}.jsonc`]:[])];
const payload=scenario?{EXCHANGE_API_KEY:secrets.PUBLISHER_API_KEY}:secrets;
if(scenario&&!payload.EXCHANGE_API_KEY)throw new Error('PUBLISHER_API_KEY is required');
const result=spawnSync(process.execPath,args,{input:JSON.stringify(payload),encoding:'utf8',stdio:['pipe','pipe','pipe']});
// Wrangler prints only secret names. Still redact literal values before forwarding output.
let output=(result.stdout||'')+(result.stderr||'');
for(const value of Object.values(secrets)) output=output.replaceAll(value,'[redacted]');
process.stdout.write(output);
status ||= result.status??1;
}
process.exit(status);
