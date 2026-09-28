import { DatabaseSync } from 'node:sqlite';
import { vi } from 'vitest';
import { ExchangeWorkspace } from '../src/server/workspace';
interface Job {id:string;deadline:number;round:number;phase:'assessment'|'round'}
interface Internal {processAuction(id:string):Promise<void>; commitRound(id:string,job:Job):void}
const clocks:DatabaseSync[]=[];
export function closeHarnesses(){for(const db of clocks.splice(0))db.close();}
export function harness(db=new DatabaseSync(':memory:'), overrides:Partial<Env>={}) {
  if(!clocks.includes(db))clocks.push(db);
  let alarm:number|null=null;
  const getAlarm=vi.fn(async()=>alarm);
  const storage={
    sql:{exec:(query:string,...params:(string|number)[])=>{
      const statement=db.prepare(query);
      if(query.startsWith('SELECT')){const rows=statement.all(...params);return {toArray:()=>rows};}
      statement.run(...params);return {toArray:()=>[]};
    }},
    transactionSync:<T>(fn:()=>T):T=>{db.exec('SAVEPOINT test_tx');try{const result=fn();db.exec('RELEASE test_tx');return result;}catch(e){db.exec('ROLLBACK TO test_tx');db.exec('RELEASE test_tx');throw e;}},
    getAlarm,
    setAlarm:vi.fn(async(at:number)=>{alarm=at;}),
  };
  const ctx={storage,blockConcurrencyWhile:(fn:()=>Promise<void>)=>fn()};
  const env={OPENAI_API_KEY:'test-key',OPENAI_MODEL:'test-model',STRIPE_SECRET_KEY:'',STRIPE_WEBHOOK_SECRET:'',...overrides};
  const workspace=new ExchangeWorkspace(ctx as unknown as DurableObjectState,env as Env);
  const internal=workspace as unknown as Internal;
  const put=(kind:string,id:string,data:unknown)=>storage.sql.exec('INSERT INTO documents(kind,id,data) VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data',kind,id,JSON.stringify(data));
  const get=<T>(kind:string,id:string):T|undefined=>{const row=db.prepare('SELECT data FROM documents WHERE kind=? AND id=?').get(kind,id);return row?JSON.parse(String(row.data)):undefined;};
  return {workspace,internal,db,storage,put,get};
}
