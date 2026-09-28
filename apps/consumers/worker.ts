import { scenarios } from '../../src/shared/catalog';
import type { Auction, ScenarioId } from '../../src/shared/types';

type ConsumerEnv = {
  ASSETS: Fetcher;
  EXCHANGE?: Fetcher;
  SCENARIO: ScenarioId;
  EXCHANGE_URL: string;
  EXCHANGE_API_KEY: string;
  DEMO_WORKSPACE_ID: string;
  DEMO_PAYMENT_MODE: 'simulation' | 'sandbox';
};
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const json = (data: unknown, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

async function readBody(request: Request): Promise<Record<string, unknown>> {
  if (Number(request.headers.get('content-length') || 0) > 12000) throw new Error('Request is too large');
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader) {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 12000) { await reader.cancel(); throw new Error('Request is too large'); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  const result: unknown = JSON.parse(new TextDecoder().decode(bytes) || '{}');
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error('Expected a JSON object');
  return result as Record<string, unknown>;
}

async function exchange(env: ConsumerEnv, path: string, method = 'GET', value?: unknown): Promise<Response> {
  if (!env.EXCHANGE_API_KEY || !uuid.test(env.DEMO_WORKSPACE_ID)) throw new Error('Publisher connection is not configured');
  const destination = new URL(env.EXCHANGE_URL);
  if (destination.protocol !== 'https:' && !['127.0.0.1', 'localhost'].includes(destination.hostname)) throw new Error('Invalid exchange destination');
  const transport = env.EXCHANGE ? env.EXCHANGE.fetch.bind(env.EXCHANGE) : fetch;
  return transport(new URL(path, destination), {
    method,
    headers: {
      Authorization: `Bearer ${env.EXCHANGE_API_KEY}`,
      'X-Workspace-ID': env.DEMO_WORKSPACE_ID,
      'Content-Type': 'application/json',
    },
    body: value === undefined ? undefined : JSON.stringify(value),
    signal: AbortSignal.timeout(20000),
  });
}

function publicAuction(auction: Auction) {
  const { id, scenario, publisher_id, intent, preferences, mode, payment_mode, status, created_at, updated_at, end_reason, error, winner, placement, current_round, max_rounds } = auction;
  return { id, scenario, publisher_id, intent, preferences, mode, payment_mode, status, created_at, updated_at, end_reason, error, winner, placement, current_round, max_rounds };
}

async function readOwnedAuction(env: ConsumerEnv, id: string): Promise<Auction | Response> {
  const response = await exchange(env, `/v1/auctions/${id}`);
  const data = await response.json() as Auction | { error: string };
  if (!response.ok) return json(data, response.status);
  if (!('scenario' in data) || data.scenario !== env.SCENARIO) return json({ error: 'Auction does not belong to this consumer app' }, 404);
  return data;
}

export default {
  async fetch(request: Request, env: ConsumerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request);
    const scenario = scenarios.find(item => item.id === env.SCENARIO);
    if (!scenario) return json({ error: 'Consumer scenario is not configured' }, 503);
    try {
      if (request.method === 'GET' && url.pathname === '/api/context') {
        return json({
          scenario, exchange_url: env.EXCHANGE_URL, stage_id: env.DEMO_WORKSPACE_ID,
          payment_mode: env.DEMO_PAYMENT_MODE || 'simulation', agent_mode: 'live',
        });
      }
      if (request.method !== 'GET') {
        const origin = request.headers.get('origin');
        if (origin && origin !== url.origin) return json({ error: 'Cross-origin mutation is not allowed' }, 403);
        if (request.headers.get('sec-fetch-site') === 'cross-site') return json({ error: 'Cross-site mutation is not allowed' }, 403);
      }
      if (request.method === 'POST' && url.pathname === '/api/auctions') {
        const input = await readBody(request);
        const response = await exchange(env, '/v1/auctions', 'POST', {
          scenario: env.SCENARIO, publisher_id: scenario.publisher_id,
          intent: input.intent ?? scenario.prompt, preferences: input.preferences ?? scenario.preferences,
          mode: 'live', payment_mode: env.DEMO_PAYMENT_MODE || 'simulation', max_rounds: 5, target_score: 85,
        });
        const created = await response.json() as Auction;
        return json(response.ok ? publicAuction(created) : created, response.status);
      }
      const auction = url.pathname.match(/^\/api\/auctions\/([a-f0-9-]{36})$/i);
      if (request.method === 'GET' && auction && uuid.test(auction[1])) {
        const result = await readOwnedAuction(env, auction[1]);
        return result instanceof Response ? result : json(publicAuction(result));
      }
      const placement = url.pathname.match(/^\/api\/placements\/([a-f0-9-]{36})\/click$/i);
      if (request.method === 'POST' && placement && uuid.test(placement[1])) {
        const input = await readBody(request);
        if (typeof input.auction_id !== 'string' || !uuid.test(input.auction_id)) return json({ error: 'auction_id is required' }, 400);
        const result = await readOwnedAuction(env, input.auction_id);
        if (result instanceof Response) return result;
        if (result.placement?.id !== placement[1]) return json({ error: 'Placement does not belong to this auction' }, 404);
        const response = await exchange(env, `/v1/placements/${placement[1]}/click`, 'POST', {});
        return json(await response.json(), response.status);
      }
      return json({ error: 'Consumer API route not found' }, 404);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : 'Consumer request failed' }, 400);
    }
  },
} satisfies ExportedHandler<ConsumerEnv>;
