import { afterEach, describe, expect, it, vi } from 'vitest';
import { assessFits, decideOffer } from '../src/server/agents';
import { assignFits, createAuction } from '../src/shared/engine';
import { createCampaigns } from '../src/shared/catalog';
import type { AuditTrace } from '../src/shared/types';

function auction() {
  const a=createAuction({id:'trace-test',scenario:'dating',intent:'Quiet coffee',preferences:['quiet'],mode:'live',campaigns:createCampaigns()});
  return assignFits(a,a.bidders.map(b=>({brand_id:b.brand.id,score:80,explanation:'Coffee fits.'})));
}
const response=(name:string,args:unknown)=>Response.json({status:'completed',output:[{type:'function_call',name,arguments:JSON.stringify(args)}]},{headers:{'x-request-id':'req_verified'}});
afterEach(()=>vi.restoreAllMocks());
describe('live model audit trace',()=>{
  it('captures actual transport lifecycle and redacted commercial payload without private policy or credentials',async()=>{
    const a=auction(),b=a.bidders[0];b.campaign.strategy='NEVER_PUBLIC_PRIVATE_POLICY';
    const records:AuditTrace[]=[];
    const fetch=vi.spyOn(globalThis,'fetch').mockResolvedValue(response('submit_action',{action:'submit',bid_cents:50,discount_cents:50,final:false,explanation:'A customer offer.'}));
    await decideOffer(a,b,{apiKey:'NEVER_PUBLIC_SECRET',model:'gpt-test',actor:b.brand.id,round:1,onTrace:event=>records.push(event)});
    expect(records.map(r=>r.kind)).toEqual(['model.request','model.response']);
    expect(records[0]).toMatchObject({actor:b.brand.id,round:1,method:'POST',url:'https://api.openai.com/v1/responses',provider:'OpenAI',model:'gpt-test',status:'pending'});
    expect(records[1]).toMatchObject({status:'received',http_status:200,provider_request_id:'req_verified',correlation_id:records[0].correlation_id,payload:{tool:'submit_action',arguments:{action:'submit',bid_cents:50,discount_cents:50,final:false},validation:'pending'}});
    expect(records[1].duration_ms).toBeGreaterThanOrEqual(0);
    const serialized=JSON.stringify(records);
    expect(serialized).not.toContain('NEVER_PUBLIC');
    expect(serialized).not.toContain('available_budget_cents');
    expect(serialized).not.toContain('max_cpc_cents');
    expect(serialized).not.toContain('max_discount_cents');
    expect(serialized).not.toContain('A customer offer.');
    // The real provider request retains the private policy; only operator telemetry is redacted.
    expect(String(fetch.mock.calls[0][1]?.body)).toContain('NEVER_PUBLIC_PRIVATE_POLICY');
    expect(records[0].redacted).toContain('input.private_campaign');
  });
  it('records a sanitized HTTP error and never copies a provider error body',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response('PRIVATE_PROVIDER_ERROR',{status:429}));
    const records:AuditTrace[]=[];
    await expect(assessFits(auction(),{apiKey:'secret',model:'gpt-test',onTrace:event=>records.push(event)})).rejects.toThrow('HTTP 429');
    expect(records.map(r=>r.kind)).toEqual(['model.request','model.error']);
    expect(records[1]).toMatchObject({status:'failed',http_status:429});
    expect(JSON.stringify(records)).not.toContain('PRIVATE_PROVIDER_ERROR');
  });
  it('records a timeout from the actual aborted call signal',async()=>{
    const controller=new AbortController();controller.abort();
    vi.spyOn(globalThis,'fetch').mockRejectedValue(new Error('provider detail'));
    const records:AuditTrace[]=[];
    await expect(assessFits(auction(),{apiKey:'secret',model:'gpt-test',onTrace:event=>records.push(event)},controller.signal)).rejects.toThrow('deadline');
    expect(records[1]).toMatchObject({kind:'model.error',status:'timeout'});
    expect(JSON.stringify(records)).not.toContain('provider detail');
  });
  it('does not copy arbitrary unvalidated model objects into a public response trace',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response('submit_action',{action:{secret:'PRIVATE'},bid_cents:{private:'PRIVATE'},discount_cents:4,final:false,explanation:'private explanation'}));
    const a=auction(),records:AuditTrace[]=[];
    await expect(decideOffer(a,a.bidders[0],{apiKey:'secret',model:'gpt-test',onTrace:event=>records.push(event)})).rejects.toThrow('invalid structured');
    expect(JSON.stringify(records)).not.toContain('PRIVATE');
    expect(records[1].payload).toMatchObject({arguments:{action:'invalid',bid_cents:null}});
  });
  it('redacts unknown fit identities before structured validation rejects them',async()=>{
    vi.spyOn(globalThis,'fetch').mockResolvedValue(response('assess_fit',{fits:[{brand_id:'PRIVATE_UNVALIDATED_TEXT',score:80,explanation:'not for telemetry'}]}));
    const records:AuditTrace[]=[];
    await expect(assessFits(auction(),{apiKey:'secret',model:'gpt-test',onTrace:event=>records.push(event)})).rejects.toThrow('invalid structured');
    expect(JSON.stringify(records)).not.toContain('PRIVATE_UNVALIDATED_TEXT');
    expect(records[1].payload).toMatchObject({arguments:{fits:[{brand_id:null,score:80}]},validation:'pending'});
  });
});
