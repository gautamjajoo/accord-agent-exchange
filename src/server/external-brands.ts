import type { AgentAction, Bidder, Brand, Campaign, ScenarioId } from '../shared/types';

/** Persist the hash only. The bearer credential is returned exactly once on invitation. */
export interface ExternalBrandRecord {
  brand: Brand;
  token_hash: string;
  created_at: string;
  revoked_at?: string;
}

export interface ExternalBrandRegistration { brand: Brand; campaign: Campaign; }

function record(raw: unknown, label: string): Record<string, unknown> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error(`${label} must be an object.`);
  return raw as Record<string, unknown>;
}
function allowedKeys(raw: Record<string, unknown>, keys: readonly string[]): void {
  if (Object.keys(raw).some(key => !keys.includes(key))) throw new Error('Unexpected field in request.');
}
function text(raw: unknown, field: string, max: number, fallback?: string): string {
  if (raw === undefined && fallback !== undefined) return fallback;
  if (typeof raw !== 'string' || !raw.trim() || raw.trim().length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(raw)) {
    throw new Error(`${field} must be a nonempty string of at most ${max} characters.`);
  }
  return raw.trim();
}
function cents(raw: unknown, field: string, min: number, max: number): number {
  if (typeof raw !== 'number' || !Number.isSafeInteger(raw) || raw < min || raw > max) {
    throw new Error(`${field} must be integer USD cents from ${min} to ${max}.`);
  }
  return raw;
}
function strings(raw: unknown, field: string, maxItems: number, maxLength: number): string[] {
  if (!Array.isArray(raw) || raw.length > maxItems) throw new Error(`${field} must be an array of at most ${maxItems} strings.`);
  return [...new Set(raw.map(item => text(item, field, maxLength)))];
}

/** Merchant destinations must be public HTTPS hostnames, never local/IP-literal URLs. */
export function validateMerchantDestination(raw: unknown): string {
  const value = text(raw, 'source_url', 2048);
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('source_url must be a valid public HTTPS URL.'); }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const labels = hostname.split('.');
  const reserved = ['localhost', 'local', 'internal', 'lan', 'home', 'invalid', 'test', 'example', 'onion'];
  if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443') ||
      hostname.includes(':') || /^\d+(\.\d+){3}$/.test(hostname) || labels.length < 2 ||
      reserved.includes(labels.at(-1)!) || ['example.com', 'example.org', 'example.net'].includes(hostname) ||
      hostname.endsWith('.localhost') || labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
      /^\d+$/.test(labels.at(-1)!)) {
    throw new Error('source_url must use a public HTTPS merchant hostname without credentials or custom ports.');
  }
  return url.href;
}

/** The caller generates brandId; client-supplied identifiers and balances are rejected. */
export function validateRegistration(raw: unknown, brandId: string, now = new Date().toISOString()): ExternalBrandRegistration {
  if (!/^brand-[a-zA-Z0-9_-]{8,100}$/.test(brandId)) throw new Error('A server-generated external brand ID is required.');
  const input = record(raw, 'Registration');
  allowedKeys(input, ['name','initials','color','scenario','item','description','base_price_cents','price_kind','source_url','source_date','facts','tags','code','max_cpc_cents','max_discount_cents','strategy']);
  if (typeof input.scenario !== 'string' || !['dating','fashion','outings'].includes(input.scenario)) throw new Error('scenario must be dating, fashion, or outings.');
  const name = text(input.name, 'name', 100);
  const price = cents(input.base_price_cents, 'base_price_cents', 1, 1_000_000);
  const maxCpc = cents(input.max_cpc_cents, 'max_cpc_cents', 1, 10_000);
  const maxDiscount = cents(input.max_discount_cents, 'max_discount_cents', 0, price);
  const sourceDate = text(input.source_date, 'source_date', 10, now.slice(0, 10));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sourceDate) || !Number.isFinite(Date.parse(sourceDate)) || new Date(sourceDate).toISOString().slice(0,10) !== sourceDate) throw new Error('source_date must be a valid YYYY-MM-DD date.');
  const color = text(input.color, 'color', 7, '#a7d8c1');
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) throw new Error('color must be a six-digit hex color.');
  const priceKind = input.price_kind ?? 'demo_quote';
  if (priceKind !== 'snapshot' && priceKind !== 'demo_quote') throw new Error('price_kind must be snapshot or demo_quote.');
  const code = text(input.code, 'code', 64);
  if (!/^[A-Za-z0-9_-]+$/.test(code)) throw new Error('code must contain only letters, numbers, hyphens, and underscores.');
  const brand: Brand = {
    id: brandId, name, initials: text(input.initials, 'initials', 4, name.split(/\s+/).map(part => part[0]).slice(0,2).join('').toUpperCase()),
    color, scenario: input.scenario as ScenarioId, item: text(input.item, 'item', 160),
    description: text(input.description, 'description', 1500), base_price_cents: price, price_kind: priceKind,
    source_url: validateMerchantDestination(input.source_url), source_date: sourceDate,
    facts: strings(input.facts ?? [], 'facts', 12, 500), tags: strings(input.tags ?? [], 'tags', 12, 64), code,
  };
  const campaign: Campaign = {
    brand_id: brandId, version: 1, active: false, max_cpc_cents: maxCpc, max_discount_cents: maxDiscount,
    strategy: text(input.strategy, 'strategy', 2000, 'Offers are submitted by the external brand agent.'),
    balance_cents: 0, reserved_cents: 0, spent_cents: 0,
  };
  return { brand, campaign };
}

export function createAgentToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `accord_brand_${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
export async function hashAgentToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
export async function verifyAgentToken(token: string, expectedHash: string): Promise<boolean> {
  if (!/^accord_brand_[a-f0-9]{64}$/.test(token) || !/^[a-f0-9]{64}$/.test(expectedHash)) return false;
  const actualHash = await hashAgentToken(token);
  let difference = 0;
  for (let i = 0; i < actualHash.length; i++) difference |= actualHash.charCodeAt(i) ^ expectedHash.charCodeAt(i);
  return difference === 0;
}

/** Validate against the frozen bidder policy before writing a sealed submission. */
export function validateExternalAction(raw: unknown, bidder: Bidder): AgentAction {
  if (bidder.withdrawn || bidder.finalized) throw new Error('This bidder has closed its participation.');
  const input = record(raw, 'Action');
  if (typeof input.action !== 'string' || !['submit','hold','finalize','withdraw'].includes(input.action)) throw new Error('Unknown agent action.');
  const explanation = text(input.explanation, 'explanation', 500);
  if (input.action !== 'submit') {
    allowedKeys(input, ['action','explanation']);
    if ((input.action === 'hold' || input.action === 'finalize') && !bidder.offer) throw new Error('Cannot hold or finalize without a previous offer.');
    return { action: input.action as 'hold'|'finalize'|'withdraw', explanation };
  }
  allowedKeys(input, ['action','bid_cents','discount_cents','explanation','final']);
  const bid = cents(input.bid_cents, 'bid_cents', 1, bidder.campaign.max_cpc_cents);
  const discount = cents(input.discount_cents, 'discount_cents', 0, Math.min(bidder.campaign.max_discount_cents, bidder.brand.base_price_cents));
  if (bid > bidder.campaign.balance_cents - bidder.campaign.reserved_cents) throw new Error('CPC exceeds the campaign budget snapshot.');
  if (bidder.offer && (bid < bidder.offer.bid_cents || discount < bidder.offer.discount_cents)) throw new Error('Revisions cannot reduce the CPC or discount.');
  if (input.final !== undefined && typeof input.final !== 'boolean') throw new Error('final must be a boolean.');
  return { action: 'submit', bid_cents: bid, discount_cents: discount, explanation, ...(input.final === undefined ? {} : { final: input.final as boolean }) };
}
