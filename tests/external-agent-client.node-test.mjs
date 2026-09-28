import assert from 'node:assert/strict';
import test from 'node:test';
import { decisionSchema, exchangeRequest, gptDecision, readConfig, rulesDecision, run, validateAction } from '../scripts/external-brand-agent.mjs';
const config = { base: 'https://exchange.example', token: 'INVITATION_SECRET', workspace: '00000000-0000-4000-8000-000000000001', apiKey: 'BRAND_OWNED_KEY', model: 'gpt-5.4-mini' };
const opportunity = () => ({ auction_id: 'auction-1', round: 1, round_token: 'ROUND_SECRET', deadline: new Date(Date.now() + 10000).toISOString(),
  intent: 'Coffee', preferences: [], own_catalog: { brand_id: 'cafe', base_price_cents: 1600 }, own_fit: { score: 90 },
  own_campaign: { max_cpc_cents: 120, max_discount_cents: 600, available_budget_cents: 10000, strategy: 'PRIVATE_STRATEGY' },
  previous_offer: null, public_board: [], feedback: '', reference_price_cents: 1800 });
const env = { ACCORD_AGENT_TOKEN: config.token, ACCORD_WORKSPACE_ID: config.workspace, OPENAI_API_KEY: config.apiKey };

test('requires encrypted remote transport and brand-owned credentials', () => {
  assert.throws(() => readConfig({ ...env, ACCORD_EXCHANGE_URL: 'http://example.com' }, []));
  assert.throws(() => readConfig({ ...env, ACCORD_EXCHANGE_URL: 'https://user:password@example.com' }, []));
  assert.throws(() => readConfig({ ...env, OPENAI_API_KEY: '' }, []));
  assert.equal(readConfig({ ...env, OPENAI_API_KEY: '' }, ['--once']).once, true);
  assert.equal(readConfig({ ...env, OPENAI_API_KEY: '' }, ['--rules']).rules, true);
  assert.equal(readConfig({ ...env, ACCORD_EXCHANGE_URL: 'http://127.0.0.1:8787' }, []).base, 'http://127.0.0.1:8787');
});

test('local validation enforces monotonic amounts, funds and campaign boundaries', () => {
  const o = opportunity(); o.previous_offer = { bid_cents: 70, discount_cents: 250 };
  const action = { action: 'submit', bid_cents: 80, discount_cents: 300, final: false, explanation: 'Better value.' };
  assert.equal(validateAction(action, o).bid_cents, 80);
  for (const invalid of [{ bid_cents: 69 }, { bid_cents: 121 }, { discount_cents: 249 }, { discount_cents: 601 }, { bid_cents: 70.5 }]) {
    assert.throws(() => validateAction({ ...action, ...invalid }, o));
  }
  o.own_campaign.available_budget_cents = 60;
  assert.deepEqual(decisionSchema(o).properties.action.enum, ['hold', 'finalize', 'withdraw']);
  assert.throws(() => validateAction(action, o));
});

test('deterministic mode respects protocol without claiming model intelligence', () => {
  const o = opportunity(); const first = rulesDecision(o);
  assert.equal(first.action, 'submit'); assert.match(first.explanation, /Deterministic test/);
  o.previous_offer = first; o.round = 2;
  assert.ok(rulesDecision(o).discount_cents > first.discount_cents);
  assert.throws(() => validateAction({ action: 'hold', explanation: 'Wait' }, opportunity()));
});

test('GPT call excludes exchange credentials and round tokens; structured result is bounded', async () => {
  let request;
  const action = { action: 'submit', bid_cents: 70, discount_cents: 200, final: false, explanation: 'A competitive offer.' };
  const result = await gptDecision(opportunity(), config, undefined, async (url, options) => {
    request = { url, options };
    return Response.json({ status: 'completed', output: [{ type: 'function_call', name: 'submit_action', arguments: JSON.stringify(action) }] });
  });
  assert.equal(request.url, 'https://api.openai.com/v1/responses');
  assert.equal(request.options.headers.Authorization, `Bearer ${config.apiKey}`);
  assert.equal(request.options.redirect, 'error');
  assert.ok(!request.options.body.includes(config.token));
  assert.ok(!request.options.body.includes('ROUND_SECRET'));
  assert.ok(request.options.body.includes('PRIVATE_STRATEGY'));
  assert.equal(JSON.parse(request.options.body).tools[0].strict, true);
  assert.deepEqual(result, action);
});

test('exchange requests do not transmit the brand model key and reject redirects', async () => {
  await exchangeRequest(config, '/v1/brand-agent/status', { fetcher: async (url, options) => {
    assert.equal(url.origin, config.base);
    assert.equal(options.headers.Authorization, `Bearer ${config.token}`);
    assert.equal(options.headers['X-Workspace-ID'], config.workspace);
    assert.equal(options.redirect, 'error');
    assert.ok(!JSON.stringify(options).includes(config.apiKey));
    return Response.json({ active: true });
  } });
});

test('--once checks status and never starts bidding', async () => {
  let calls = 0; const output = [];
  await run({ ...config, once: true }, { write: (...args) => output.push(args), fetcher: async url => {
    calls++; assert.equal(url.pathname, '/v1/brand-agent/status');
    return Response.json({ brand: { name: 'Cafe' }, active: true, revoked: false });
  } });
  assert.equal(calls, 1); assert.equal(output[0][1].mode, 'status_only');
});

test('lost acknowledgment retries the identical action; logs never expose credentials', async () => {
  const controller = new AbortController(), bodies = [], messages = [];
  const o = opportunity(); let submissions = 0;
  await run({ ...config, rules: true }, { signal: controller.signal, write: (...args) => {
    messages.push(args); if (args[0] === 'action_accepted') controller.abort();
  }, fetcher: async (url, options) => {
    if (url.pathname.endsWith('/status')) return Response.json({ brand: { name: 'Cafe' }, active: true });
    if (url.pathname.endsWith('/opportunities')) return Response.json({ brand: { id: 'cafe' }, opportunities: [o] });
    bodies.push(options.body); submissions++;
    if (submissions === 1) throw new Error('simulated lost ACK');
    return Response.json({ accepted: true, idempotent: true });
  } });
  assert.equal(submissions, 2); assert.equal(bodies[0], bodies[1]);
  assert.ok(messages.some(([event]) => event === 'action_accepted'));
  const logs = JSON.stringify(messages);
  for (const secret of [config.token, config.apiKey, 'ROUND_SECRET', 'PRIVATE_STRATEGY']) assert.ok(!logs.includes(secret));
});
