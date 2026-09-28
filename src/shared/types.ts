export type ScenarioId = 'dating' | 'fashion' | 'outings';
export type AgentMode = 'live' | 'simulation';
export interface Brand { id:string; name:string; initials:string; color:string; scenario:ScenarioId; item:string; description:string; base_price_cents:number; price_kind:'demo_quote'|'snapshot'; source_url:string; source_date:string; facts:string[]; tags:string[]; code:string; }
export interface Scenario { id:ScenarioId; name:string; publisher_id:string; app_name:string; subtitle:string; prompt:string; preferences:string[]; brand_ids:string[]; }
export interface Campaign { brand_id:string; version:number; active:boolean; max_cpc_cents:number; max_discount_cents:number; strategy:string; balance_cents:number; reserved_cents:number; spent_cents:number; agent_kind?:'managed'|'external'; }
export interface Fit { brand_id:string; score:number; explanation:string; }
export interface Offer { bid_cents:number; discount_cents:number; }
export type AgentAction = { action:'submit'; bid_cents:number; discount_cents:number; explanation:string; final?:boolean } | {action:'hold'|'finalize'|'withdraw'; explanation:string};
export interface Bidder { brand:Brand; campaign:Campaign; fit:Fit; offer:Offer|null; finalized:boolean; withdrawn:boolean; last_action:string; explanation:string; error?:string; }
export interface RankedOffer extends Offer { brand_id:string; brand_name:string; base_price_cents:number; effective_price_cents:number; fit_score:number; price_score:number; user_score:number; finalized:boolean; }
export interface Round { number:number; started_at:string; completed_at:string; offers:RankedOffer[]; actions:Record<string,AgentAction|string>; leader_id:string|null; cash_leader_id:string|null; feedback:string; changed:boolean; }
export type AuctionStatus = 'assessing'|'running'|'paused'|'completed'|'cancelled'|'failed';
export type EndReason = 'user_accepted'|'target_reached'|'all_final'|'no_change'|'max_rounds'|'no_offers'|'cancelled'|'insufficient_funds'|'assessment_failed';
export interface Placement { id:string; auction_id:string; publisher_id:string; brand_id:string; offer:RankedOffer; item:string; code:string; destination:string; description?:string; price_kind?:Brand['price_kind']; expires_at:string; status:'reserved'|'clicked'|'expired'; ledger_id?:string; }
// Every trace payload is a JSON-normalized object. Keep this opaque rather than
// recursively expanding JSON: Cloudflare's RPC serializer recursively maps RPC
// return types and an unbounded JSON union exceeds TypeScript's depth limit.
export type TraceJSON = object;
export interface AuditTrace { id:string; at:string; kind:string; actor:string; round?:number; correlation_id?:string; method?:string; url?:string; provider?:string; model?:string; status?:string; http_status?:number; duration_ms?:number; provider_request_id?:string; payload?:TraceJSON; redacted?:string[]; error?:string; }
export interface Auction { id:string; scenario:ScenarioId; publisher_id:string; intent:string; preferences:string[]; mode:AgentMode; payment_mode?:'sandbox'|'simulation'; status:AuctionStatus; created_at:string; updated_at:string; reference_price_cents:number; target_score:number; max_rounds:number; bidders:Bidder[]; rounds:Round[]; current_round:number; round_started_at?:string; round_deadline?:string; pause_requested:boolean; end_reason?:EndReason; error?:string; winner?:RankedOffer; placement?:Placement; events:{at:string;message:string;kind:string}[]; trace?:AuditTrace[]; }
export interface LedgerEntry {id:string; kind:'funding'|'click'|'transfer'|'processing_fee'; created_at:string; brand_id:string; publisher_id?:string; auction_id?:string; amount_cents:number; publisher_cents?:number; network_cents?:number; stripe_id?:string; mode:'sandbox'|'simulation'; status:'completed'|'pending'|'failed'; error?:string;}
export interface Capabilities { live_agents:boolean; stripe:boolean; model:string; demo_only:true; }
export interface Bootstrap { presentation?:{workspace_id:string;consumers:Partial<Record<ScenarioId,string>>}; brands:Brand[]; scenarios:Scenario[]; campaigns:Campaign[]; capabilities:Capabilities; auctions:Auction[]; ledger:LedgerEntry[]; }
