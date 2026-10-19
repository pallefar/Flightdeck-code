import {Buffer} from 'node:buffer';
import {z,type ZodTypeAny} from 'zod';
import {it,expect,vi} from 'vitest';
import {builtinRegistry,configSchemas} from '../../packages/workflow/graph';
import {PROCESS_TEMPLATES} from '../process-studio/plan';
import {createPublicReuseCatalog,bundledCatalogSource,type ReuseMetadata} from './catalog';
import {createReuseController,type ComposerSnapshot,type ComposerPort,type CatalogPort} from './controller';

function host(text='request'){
 let value:ComposerSnapshot={contextEpoch:1,revision:0,text};const order:string[]=[];
 const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
 // DECLARED DEVELOPMENT composer projections, not a provider/gate response.
 const composer:ComposerPort={read:()=>JSON.stringify(value),measure:next=>{const context={prompt:next};return JSON.stringify({requestBytes:bytes({connectionId:'local',prompt:next}),dynamicContextCodeUnits:JSON.stringify(context).length,envelopeBytes:bytes({task:'studio.spec.draft',facts:{workflow:{kind:'text',text:JSON.stringify(context)}}})});},compareAndSet:vi.fn((expected,next,isCurrent)=>{
  if(!isCurrent()||value.contextEpoch!==expected.contextEpoch||value.revision!==expected.revision||value.text!==expected.text)return null;
  order.push('invalidate-send-review');value={...value,revision:value.revision+1,text:next};order.push('editPrompt');return JSON.stringify(value);
 })};
 return {composer,read:()=>value,edit:(next:string)=>{value={...value,revision:value.revision+1,text:next};},context:()=>{value={...value,contextEpoch:value.contextEpoch+1};},order};
}
const selection=(r:ReuseMetadata)=>JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion});
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}

it('T01 browses actual metadata with closed immutable snapshots and subscriptions without composer writes',async()=>{
 const h=host(),c=createReuseController({composer:h.composer}),notify=vi.fn();const unsubscribe=c.subscribe(notify),before=c.getState();
 expect(await c.open('{}')).toBe(true);expect(c.getState().rows).toHaveLength(12);expect(c.getState()).not.toBe(before);
 expect(Object.isFrozen(c.getState())).toBe(true);expect(Object.isFrozen(c)).toBe(true);expect(notify).toHaveBeenCalled();
 expect(await c.query('{"kind":"process-template"}')).toBe(true);expect(c.getState().rows).toHaveLength(3);
 expect(h.composer.compareAndSet).not.toHaveBeenCalled();expect(h.read().text).toBe('request');
 unsubscribe();const count=notify.mock.calls.length;await c.query('{}');expect(notify).toHaveBeenCalledTimes(count);
});

it.each(['cancel','close','hide','dispose','context','editABA'] as const)('T02 pending list refuses late work after %s',async action=>{
 const h=host(),api=createPublicReuseCatalog(),held=deferred<unknown>();let signal!:AbortSignal;
 const c=createReuseController({composer:h.composer,catalog:{list:(_q,s)=>{signal=s;return held.promise;},detail:async()=>null}});
 const pending=c.open('{}');await Promise.resolve();
 if(action==='context'){h.context();c.sync();}else if(action==='editABA'){h.edit('other');h.edit('request');c.sync();}else c[action]();
 const aborted=signal?.aborted;held.resolve(await api.list('{}'));
 expect(await pending).toBe(false);expect(aborted).toBe(true);expect(c.getState().rows).toHaveLength(0);expect(c.getState().candidate).toBeNull();expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('T03 selected detail is explicit, exact, source-derived and inert',async()=>{
 const h=host(),api=createPublicReuseCatalog(),detail=vi.fn((q:unknown)=>api.detail(q)),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail}});
 await c.open('{}');expect(detail).not.toHaveBeenCalled();const row=c.getState().rows.find(r=>r.id==='http')!;
 expect(await c.select(selection(row))).toBe(true);expect(c.getState().detail?.id).toBe('http');expect(c.getState().selection?.metadataDigest).toBe(row.metadataDigest);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
 expect(await c.select(JSON.stringify({kind:row.kind,id:row.id,metadataDigest:'0'.repeat(64),templateVersion:null}))).toBe(false);expect(c.getState().detail).toBeNull();expect(detail).toHaveBeenCalledTimes(1);
});

it.each(['cancel','close','hide','dispose','context','editABA'] as const)('T03 pending detail refuses late work after %s',async action=>{
 const h=host(),api=createPublicReuseCatalog(),held=deferred<unknown>();let signal!:AbortSignal;
 const c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:(_q,s)=>{signal=s;return held.promise;}}});await c.open('{}');const r=c.getState().rows[0]!,actual=await api.detail(selection(r));
 const pending=c.select(selection(r));await Promise.resolve();
 if(action==='context'){h.context();c.sync();}else if(action==='editABA'){h.edit('other');h.edit('request');c.sync();}else c[action]();
 held.resolve(actual);expect(await pending).toBe(false);expect(signal?.aborted).toBe(true);expect(c.getState().detail).toBeNull();expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('T04 previews only the selected bounded inert reference and measures UTF-8 without editing CRLF or Unicode',async()=>{
 const original='\r\n中文 🛰 e\u0301\r\n',h=host(original),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='analytical-report')!));
 const p=c.getState().candidate;expect(p).not.toBeNull();if(!p)throw Error('preview missing');
 expect(p.before.text).toBe(original);expect(p.afterText).toBe(original+p.insertedText);expect(p.insertedText).toContain('untrusted request context');expect(p.insertedText).toContain('not an executable tool selection');
 expect(p.insertedText).not.toContain('@1.0.0');expect(p.insertedText).toContain('"templateVersion":"1.0.0"');
 const data=JSON.parse(p.insertedText.slice(p.insertedText.indexOf('{')));expect(data.id).toBe('analytical-report');expect(data.metadataDigest).toBe(p.detail.metadataDigest);expect(data.detailDigest).toBe(p.detail.detailDigest);
 for(const key of ['schemaFields','defaults','files','prd','buildPrompt'])expect(data).not.toHaveProperty(key);
 expect(p.insertedUtf8Bytes).toBe(Buffer.byteLength(p.insertedText));expect(p.promptUtf8Bytes).toBe(Buffer.byteLength(p.afterText));expect(p.promptJsonUtf8Bytes).toBe(Buffer.byteLength(JSON.stringify({prompt:p.afterText})));
 expect(Object.isFrozen(p)).toBe(true);expect(Object.isFrozen(p.before)).toBe(true);expect(c.getState().reviewId).toBeNull();expect(h.read().text).toBe(original);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it.each(['requestBytes','dynamicContextCodeUnits','envelopeBytes'] as const)('T05 refuses the applicable %s envelope overflow atomically',async field=>{
 const h=host(),measure=h.composer.measure;const maximum={requestBytes:1_000_000,dynamicContextCodeUnits:2000,envelopeBytes:32768};
 const c=createReuseController({composer:{...h.composer,measure:text=>JSON.stringify({...JSON.parse(measure(text) as string),[field]:maximum[field]+1})}});await c.open('{}');
 expect(await c.select(selection(c.getState().rows[0]!))).toBe(false);expect(c.getState().candidate).toBeNull();expect(c.getState().error).toBe('prompt-limit');expect(h.read().text).toBe('request');expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('T05 honors the exact 2000 dynamic JSON code-unit boundary without truncation, plus the existing 8000 composer limit',async()=>{
 const empty=host(''),c=createReuseController({composer:empty.composer});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));const suffix=c.getState().candidate!.insertedText;
 const budget=2000-JSON.stringify({prompt:suffix}).length;
 for(const extra of [0,1]){const h=host('字'.repeat(budget+extra)),x=createReuseController({composer:h.composer});await x.open('{}');expect(await x.select(selection(x.getState().rows.find(r=>r.id==='manual')!))).toBe(extra===0);expect(h.read().text).toBe('字'.repeat(budget+extra));if(extra===0){expect(x.getState().candidate!.dynamicContextCodeUnits).toBe(2000);expect(x.getState().candidate!.promptUtf8Bytes).toBeGreaterThan(2000);}}
 const long=host('x'.repeat(8000)),x=createReuseController({composer:long.composer});await x.open('{}');expect(await x.select(selection(x.getState().rows[0]!))).toBe(false);expect(long.read().text).toHaveLength(8000);
});

it('T05 admits only bounded primitive serialized numeric measurement responses',async()=>{
 let traps=0;const bad=new Proxy({}, {ownKeys(){traps++;throw Error();},get(){traps++;throw Error();}});
 for(const response of [bad,new String('{}'),' '.repeat(2049),'null','[]','{}','{"requestBytes":1,"dynamicContextCodeUnits":1,"envelopeBytes":1,"candidateId":99}','{"requestBytes":-1,"dynamicContextCodeUnits":1,"envelopeBytes":1}']){
  const h=host(),c=createReuseController({composer:{...h.composer,measure:()=>response}});await c.open('{}');expect(await c.select(selection(c.getState().rows[0]!))).toBe(false);expect(c.getState().candidate).toBeNull();
 }expect(traps).toBe(0);
});

it('T06 explicit human review binds the exact preview, context and monotonic composer revision',async()=>{
 const h=host(),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;
 expect(c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}))).toBe(true);expect(c.getState().phase).toBe('reviewed');expect(c.getState().reviewId).not.toBeNull();
 expect(c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText+'x',accepted:true}))).toBe(false);expect(c.getState().reviewId).toBeNull();
 expect(c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}))).toBe(true);
 h.edit('changed');h.edit('request');c.sync();expect(c.getState().reviewId).toBeNull();expect(c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}))).toBe(false);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('T06 malformed or false review cannot confer a receipt and native objects are not inspected',async()=>{
 const h=host(),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;let traps=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 for(const input of [proxy,new String('{}'),' '.repeat(8193),'null','[]','{}',JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:false}),JSON.stringify({candidateId:p.candidateId+1,exactText:p.insertedText,accepted:true}),JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:'true'}),JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true,extra:1})]){expect(c.review(input)).toBe(false);expect(c.getState().reviewId).toBeNull();}
 expect(traps).toBe(0);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('T07 inserts the exact human-reviewed reference once through synchronous CAS, never send',async()=>{
 const h=host('原始\r\nrequest 🛰'),api=createPublicReuseCatalog(),detail=vi.fn((q:unknown)=>api.detail(q)),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail}});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='http')!));const p=c.getState().candidate!;
 expect(await c.insert('{"reviewId":1}')).toBe(false);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
 expect(c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}))).toBe(true);const action=JSON.stringify({reviewId:c.getState().reviewId});
 const pending=c.insert(action),duplicate=c.insert(action);expect(await duplicate).toBe(false);expect(await pending).toBe(true);
 expect(h.read()).toEqual({contextEpoch:1,revision:1,text:p.afterText});expect(h.composer.compareAndSet).toHaveBeenCalledTimes(1);expect(h.composer.compareAndSet).toHaveBeenCalledWith(p.before,p.afterText,expect.any(Function));expect(h.order).toEqual(['invalidate-send-review','editPrompt']);expect(detail).toHaveBeenCalledTimes(2);
 expect(await c.insert(action)).toBe(false);expect(c.getState().reviewId).toBeNull();expect(c.getState().candidate).toBeNull();
});

async function inserted(text='request'){
 const h=host(text),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(true);return {h,c,p};
}

it('T08 one compare-and-restore undo survives dialog close and restores exact CRLF/Unicode once',async()=>{
 const {h,c,p}=await inserted('原\r\n🙂 e\u0301');const action=JSON.stringify({undoId:c.getState().undoId});c.close();
 expect(c.undo(action)).toBe(true);expect(h.read().text).toBe(p.before.text);expect(h.read().revision).toBe(2);expect(h.order).toEqual(['invalidate-send-review','editPrompt','invalidate-send-review','editPrompt']);expect(h.composer.compareAndSet).toHaveBeenCalledTimes(2);expect(c.undo(action)).toBe(false);expect(c.getState().undoId).toBeNull();expect(c.getState().open).toBe(false);
});

it.each(['edit','editABA','context','contextABA','dispose'] as const)('T08 stale undo never overwrites after %s',async action=>{
 const {h,c,p}=await inserted(),undo=JSON.stringify({undoId:c.getState().undoId});expect(c.getState().undoId).not.toBeNull();
 if(action==='edit'){h.edit('later human text');}else if(action==='editABA'){h.edit('later human text');h.edit(p.afterText);}else if(action==='context'||action==='contextABA'){h.context();if(action==='contextABA')h.context();}else c.dispose();
 const before=h.read();expect(c.undo(undo)).toBe(false);expect(h.read()).toEqual(before);expect(h.composer.compareAndSet).toHaveBeenCalledTimes(1);expect(c.getState().undoId).toBeNull();
});

it('T09 supports the app bridge synchronizing its own single edit before reentrant notifications',async()=>{
 const h=host('原始\r\nrequest'),base=h.composer.compareAndSet;let c!:ReturnType<typeof createReuseController>;
 const composer:ComposerPort={...h.composer,compareAndSet:(expected,next,isCurrent)=>{const receipt=base(expected,next,isCurrent);c.sync();return receipt;}};
 c=createReuseController({composer});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));
 expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(true);expect(h.read().text).toBe(p.afterText);expect(c.undo(JSON.stringify({undoId:c.getState().undoId}))).toBe(true);expect(h.read().text).toBe(p.before.text);expect(base).toHaveBeenCalledTimes(2);
});

it('T10 stale query callbacks cannot reopen a closed picker or outrun reentrant close from the read port',async()=>{
 const h=host(),read=h.composer.read;let closeDuringRead=false,c!:ReturnType<typeof createReuseController>;
 c=createReuseController({composer:{...h.composer,read:()=>{if(closeDuringRead){closeDuringRead=false;c.close();}return read();}}});await c.open('{}');c.close();
 expect(await c.query('{}')).toBe(false);expect(c.getState().open).toBe(false);expect(await c.open('{}')).toBe(true);
 closeDuringRead=true;expect(await c.query('{}')).toBe(false);expect(c.getState().open).toBe(false);expect(c.getState().selection).toBeNull();
 expect(await c.open('{}')).toBe(true);const row=c.getState().rows[0]!;closeDuringRead=true;expect(await c.select(selection(row))).toBe(false);expect(c.getState().selection).toBeNull();expect(c.getState().phase).toBe('idle');
});

it('T11 controller refuses unknown serialized query admission before a trusted port can inspect it',async()=>{
 const h=host(),api=createPublicReuseCatalog(),rows=await api.list('{}'),list=vi.fn(async()=>rows),detail=vi.fn(async()=>null),c=createReuseController({composer:h.composer,catalog:{list,detail}});let traps=0;
 const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 for(const input of [proxy,new String('{}'),{},[],null,' '.repeat(4097),'null','[]','{"kind":"private"}','{"query":"x","unknown":true}'])expect(await c.open(input)).toBe(false);
 expect(list).not.toHaveBeenCalled();expect(detail).not.toHaveBeenCalled();expect(traps).toBe(0);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it.each(['metadata','defaults','schema','deleted','templateVersion','templateBoundary'] as const)('S01 revalidation rejects detached actual-source %s drift under an old review',async mode=>{
 let builtins=builtinRegistry.map(b=>structuredClone(b)),templates=PROCESS_TEMPLATES.map(t=>structuredClone(t));let schema:ZodTypeAny=configSchemas.http;
 const api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>builtins,templates:()=>templates,schema:id=>id==='http'?schema:configSchemas[id]}),h=host(),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:q=>api.detail(q)}});
 await c.open('{}');const row=c.getState().rows.find(r=>r.id===(mode.startsWith('template')?'operations-queue':'http'))!;expect(await c.select(selection(row))).toBe(true);const p=c.getState().candidate!;
 c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const action=JSON.stringify({reviewId:c.getState().reviewId});
 if(mode==='metadata')builtins=builtins.map(b=>b.type==='http'?{...b,label:b.label+' changed'}:b);
 if(mode==='defaults')builtins=builtins.map(b=>b.type==='http'?{...b,defaults:{method:'POST'}}:b);
 if(mode==='schema')schema=configSchemas.http.extend({url:z.string().max(10).optional()});
 if(mode==='deleted')builtins=builtins.filter(b=>b.type!=='http');
 if(mode==='templateVersion')templates=templates.map(t=>t.id===row.id?{...t,version:'1.0.1'}:t);
 if(mode==='templateBoundary')templates=templates.map(t=>t.id===row.id?{...t,boundary:t.boundary+' changed'}:t);
 expect(await c.insert(action)).toBe(false);expect(c.getState().error).toBe('catalog-stale');expect(c.getState().candidate).toBeNull();expect(c.getState().reviewId).toBeNull();expect(h.read().text).toBe('request');expect(h.composer.compareAndSet).not.toHaveBeenCalled();expect(await c.insert(action)).toBe(false);
});

it.each(['cancel','close','hide','dispose','context','modelEpoch','editABA'] as const)('S02 pending commit refuses late selected detail after %s',async action=>{
 const api=createPublicReuseCatalog(),h=host(),held=deferred<unknown>();let calls=0,signal!:AbortSignal;
 const c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:(q,s)=>++calls===1?api.detail(q):(signal=s,held.promise)}});await c.open('{}');const row=c.getState().rows.find(r=>r.id==='http')!;await c.select(selection(row));const p=c.getState().candidate!;
 c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const pending=c.insert(JSON.stringify({reviewId:c.getState().reviewId}));await Promise.resolve();
 if(action==='context'||action==='modelEpoch'){h.context();if(action==='modelEpoch')h.context();c.sync();}else if(action==='editABA'){h.edit('other');h.edit('request');c.sync();}else c[action]();
 const before=h.read();held.resolve(await api.detail(selection(row)));expect(await pending).toBe(false);expect(signal.aborted).toBe(true);expect(h.read()).toEqual(before);expect(c.getState().candidate).toBeNull();expect(c.getState().reviewId).toBeNull();expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('S03 unobserved edit-then-revert still revokes review at the next explicit commit',async()=>{
 const h=host(),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const action=JSON.stringify({reviewId:c.getState().reviewId});h.edit('other');h.edit('request');
 expect(await c.insert(action)).toBe(false);expect(c.getState().candidate).toBeNull();expect(h.composer.compareAndSet).not.toHaveBeenCalled();
});

it('S04 stale rendered Insert and undo IDs cannot consume newer receipts',async()=>{
 const h=host(),c=createReuseController({composer:h.composer});await c.open('{}');await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));let p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const staleInsert=JSON.stringify({reviewId:c.getState().reviewId});
 await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const currentInsert=JSON.stringify({reviewId:c.getState().reviewId});expect(await c.insert(staleInsert)).toBe(false);expect(await c.insert(currentInsert)).toBe(true);const staleUndo=JSON.stringify({undoId:c.getState().undoId});
 await c.select(selection(c.getState().rows.find(r=>r.id==='manual')!));p=c.getState().candidate!;expect(p).not.toBeNull();c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(true);const latest=h.read(),currentUndo=JSON.stringify({undoId:c.getState().undoId});expect(c.undo(staleUndo)).toBe(false);expect(h.read()).toEqual(latest);expect(c.undo(currentUndo)).toBe(true);expect(h.composer.compareAndSet).toHaveBeenCalledTimes(3);
});

it('S05 browsing, reference insertion and undo have no network, persistence or other effect ports',async()=>{
 const forbidden=vi.fn(()=>{throw Error('forbidden effect');});let extraReads=0;
 for(const name of ['fetch','WebSocket','XMLHttpRequest'])vi.stubGlobal(name,forbidden);
 for(const name of ['localStorage','sessionStorage','indexedDB'])vi.stubGlobal(name,new Proxy({}, {get(){return forbidden;}}));
 try{
  const h=host(),ports=Object.defineProperty({composer:h.composer},'send',{get(){extraReads++;return forbidden;}}),c=createReuseController(ports);await c.open('{}');for(const r of c.getState().rows)expect(await c.select(selection(r))).toBe(true);
  const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(true);expect(c.undo(JSON.stringify({undoId:c.getState().undoId}))).toBe(true);c.close();c.dispose();expect(forbidden).not.toHaveBeenCalled();expect(extraReads).toBe(0);
 }finally{vi.unstubAllGlobals();}
});

it('S06 rejected or malformed synchronous CAS confirmations are consumed without automatic retries',async()=>{
 let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();}});
 for(const response of [null,proxy,new String('{}'),Promise.resolve('{}'),' '.repeat(65537),'{}']){
  const h=host(),write=vi.fn(()=>response),c=createReuseController({composer:{...h.composer,compareAndSet:write}});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const action=JSON.stringify({reviewId:c.getState().reviewId});expect(await c.insert(action)).toBe(false);expect(await c.insert(action)).toBe(false);expect(write).toHaveBeenCalledTimes(1);expect(c.getState().undoId).toBeNull();expect(c.getState().phase).toBe('idle');expect(h.read().text).toBe('request');
 }expect(traps).toBe(0);
});

it('S07 reentrant notification cannot replay Insert or revive an operation cancelled during notification',async()=>{
 const h=host(),api=createPublicReuseCatalog(),detail=vi.fn(q=>api.detail(q)),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail}});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const action=JSON.stringify({reviewId:c.getState().reviewId});let reentrant:Promise<boolean>|null=null;
 const unsubscribe=c.subscribe(()=>{if(c.getState().phase==='inserting'){reentrant=c.insert(action);c.close();}});expect(await c.insert(action)).toBe(false);expect(await reentrant).toBe(false);expect(h.composer.compareAndSet).not.toHaveBeenCalled();expect(detail).toHaveBeenCalledTimes(1);expect(c.getState().open).toBe(false);unsubscribe();
});

it('S08 superseded list work cannot replace the latest literal query results',async()=>{
 const api=createPublicReuseCatalog(),h=host(),held=deferred<unknown>();let calls=0;const c=createReuseController({composer:h.composer,catalog:{list:q=>++calls===1?held.promise:api.list(q),detail:q=>api.detail(q)}});const old=c.open('{}');expect(await c.query('{"query":"http"}')).toBe(true);held.resolve(await api.list('{}'));expect(await old).toBe(false);expect(c.getState().rows.map(r=>r.id)).toEqual(['http']);
});

it('S09 unknown native or cloned catalog replies lack provenance and are refused without inspection',async()=>{
 const api=createPublicReuseCatalog(),rows=await api.list('{}');let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 // A native Promise consults a resolved object's .then inside the trusted port.
 // Throw the proxy synchronously to test the controller's uninspected catch boundary;
 // cloned plain DTOs below test fulfilled-response provenance separately.
 const failed=createReuseController({composer:host().composer,catalog:{list:()=>{throw proxy;},detail:()=>{throw proxy;}}});expect(await failed.open('{}')).toBe(false);
 for(const response of [structuredClone(rows),JSON.stringify(rows),' '.repeat(65537)]){const h=host(),c=createReuseController({composer:h.composer,catalog:{list:async()=>response,detail:async()=>response}});expect(await c.open('{}')).toBe(false);expect(c.getState().rows).toHaveLength(0);}
 for(const response of [structuredClone(await api.detail(selection(rows[0]!)))]){const h=host(),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:async()=>response}});await c.open('{}');expect(await c.select(selection(c.getState().rows[0]!))).toBe(false);expect(c.getState().candidate).toBeNull();}
 expect(traps).toBe(0);
});

it('T12 revalidation refuses a replaced selected schema identity even when its partial structural fingerprint is unchanged',async()=>{
 let schema=configSchemas.http.extend({url:z.string().refine(()=>true).optional()});const h=host(),api=createPublicReuseCatalog({...bundledCatalogSource,schema:id=>id==='http'?schema:configSchemas[id]}),c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:q=>api.detail(q)}});
 await c.open('{}');const row=c.getState().rows.find(r=>r.id==='http')!;await c.select(selection(row));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const action=JSON.stringify({reviewId:c.getState().reviewId});
 schema=configSchemas.http.extend({url:z.string().refine(()=>false).optional()});const current=await api.detail(selection(row));expect(current.schemaDigest).toBe(p.detail.schemaDigest);expect(current.detailDigest).toBe(p.detail.detailDigest);
 expect(await c.insert(action)).toBe(false);expect(c.getState().error).toBe('catalog-stale');expect(h.composer.compareAndSet).not.toHaveBeenCalled();expect(h.read().text).toBe('request');
});

it.each(['replacement','unchanged'] as const)('L001 controller revalidation at the selected-schema digest barrier: %s identity',async mode=>{
 const old=configSchemas.http.extend({url:z.string().refine(()=>true).optional()});
 const replacement=configSchemas.http.extend({url:z.string().refine(()=>false).optional()});
 expect(replacement).not.toBe(old);expect(old.safeParse({url:'x'}).success).toBe(true);expect(replacement.safeParse({url:'x'}).success).toBe(false);
 let schema=old;const schemaSource=vi.fn((id:keyof typeof configSchemas)=>id==='http'?schema:configSchemas[id]);
 const api=createPublicReuseCatalog({...bundledCatalogSource,schema:schemaSource}),h=host('original\r\n原 🙂');
 const c=createReuseController({composer:h.composer,catalog:{list:q=>api.list(q),detail:q=>api.detail(q)}});
 expect(await c.open('{}')).toBe(true);const row=c.getState().rows.find(r=>r.id==='http')!;
 expect(await c.select(selection(row))).toBe(true);const candidate=c.getState().candidate!,before=h.read();
 const other=await createPublicReuseCatalog({...bundledCatalogSource,schema:id=>id==='http'?replacement:configSchemas[id]}).detail(selection(row));
 expect(other.schemaDigest).toBe(candidate.detail.schemaDigest);expect(other.detailDigest).toBe(candidate.detail.detailDigest);expect(JSON.stringify(other)).toBe(JSON.stringify(candidate.detail));
 expect(c.review(JSON.stringify({candidateId:candidate.candidateId,exactText:candidate.insertedText,accepted:true}))).toBe(true);
 const action=JSON.stringify({reviewId:c.getState().reviewId}),real=crypto.subtle.digest.bind(crypto.subtle);
 const started=deferred<void>(),hold=deferred<void>();let calls=0,projection='',pending:Promise<boolean>|null=null;schemaSource.mockClear();
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{if(++calls===2){projection=new TextDecoder().decode(args[1]);started.resolve();await hold.promise;}return real(...args);});
 try{
  pending=c.insert(action);await started.promise;
  expect(calls).toBe(2);expect(JSON.parse(projection)[0]).toBe('flightdeck-reuse-schema-structure/1');expect(schemaSource.mock.calls).toEqual([['http']]);
  expect(h.read()).toEqual(before);expect(h.composer.compareAndSet).not.toHaveBeenCalled();
  if(mode==='replacement')schema=replacement;hold.resolve();const inserted=await pending;
  expect.soft(inserted).toBe(mode==='unchanged');expect.soft(h.composer.compareAndSet).toHaveBeenCalledTimes(mode==='unchanged'?1:0);
  expect.soft(h.read()).toEqual(mode==='unchanged'?{...before,revision:before.revision+1,text:candidate.afterText}:before);
  expect.soft(c.getState().error).toBe(mode==='unchanged'?null:'catalog-stale');
  expect.soft(c.getState().candidate).toBeNull();expect.soft(c.getState().reviewId).toBeNull();
  if(mode==='replacement'){expect.soft(c.getState().undoId).toBeNull();expect(await c.insert(action)).toBe(false);expect.soft(h.composer.compareAndSet).not.toHaveBeenCalled();}
  else{expect(c.getState().undoId).not.toBeNull();expect(h.order).toEqual(['invalidate-send-review','editPrompt']);}
 }finally{hold.resolve();if(pending)await pending;spy.mockRestore();c.dispose();}
});

it('T13 the synchronous bridge can refuse cancellation reentered while invalidating the existing send review',async()=>{
 const h=host(),base=h.composer.compareAndSet;let c!:ReturnType<typeof createReuseController>;
 const composer:ComposerPort={...h.composer,compareAndSet:(expected,next,isCurrent)=>{c.close();if(!isCurrent())return null;return base(expected,next,isCurrent);}};
 c=createReuseController({composer});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));
 expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(false);expect(h.read().text).toBe('request');expect(base).not.toHaveBeenCalled();expect(c.getState().undoId).toBeNull();expect(c.getState().open).toBe(false);
});

it('S13 undo also checks its currentness lease across reentrant bridge notification',async()=>{
 const h=host(),base=h.composer.compareAndSet;let stop=false,c!:ReturnType<typeof createReuseController>;
 const composer:ComposerPort={...h.composer,compareAndSet:(expected,next,isCurrent)=>{if(stop)c.close();if(!isCurrent())return null;return base(expected,next,isCurrent);}};
 c=createReuseController({composer});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(true);stop=true;
 expect(c.undo(JSON.stringify({undoId:c.getState().undoId}))).toBe(false);expect(h.read().text).toBe(p.afterText);expect(base).toHaveBeenCalledTimes(1);expect(c.getState().undoId).toBeNull();
});

it('S14 port callables are pinned before awaits and write leases expire after synchronous return',async()=>{
 const h=host(),api=createPublicReuseCatalog(),held=deferred<unknown>();let calls=0,lease:(()=>boolean)|null=null;
 const composer={...h.composer,compareAndSet:(expected:ComposerSnapshot,next:string,isCurrent:()=>boolean)=>{lease=isCurrent;return h.composer.compareAndSet(expected,next,isCurrent);}};
 const catalog={list:(q:unknown)=>api.list(q),detail:(q:unknown)=>++calls===1?api.detail(q):held.promise};
 const c=createReuseController({composer,catalog});await c.open('{}');const row=c.getState().rows[0]!;await c.select(selection(row));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));const pending=c.insert(JSON.stringify({reviewId:c.getState().reviewId}));
 composer.compareAndSet=()=>{throw Error('replaced write must not run');};composer.measure=()=>{throw Error('replaced measure must not run');};catalog.detail=async()=>{throw Error('replaced detail must not run');};held.resolve(await api.detail(selection(row)));expect(await pending).toBe(true);expect(h.read().text).toBe(p.afterText);expect(lease).not.toBeNull();expect((lease as unknown as ()=>boolean)()).toBe(false);
});

it('S15 composer snapshot responses are primitive bounded JSON with exact opaque-integer tuple fields',async()=>{
 let traps=0;const native=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 for(const response of [native,new String('{}'),' '.repeat(65537),'null','[]','{}','{"contextEpoch":"credential","revision":0,"text":"request"}','{"contextEpoch":1,"revision":-1,"text":"request"}','{"contextEpoch":1,"revision":0,"text":"request","extra":true}']){
  const h=host(),api=createPublicReuseCatalog(),list=vi.fn(q=>api.list(q)),c=createReuseController({composer:{...h.composer,read:()=>response},catalog:{list,detail:q=>api.detail(q)}});expect(await c.open('{}')).toBe(false);expect(list).not.toHaveBeenCalled();expect(c.getState().error).toBe('composer-unavailable');expect(h.composer.compareAndSet).not.toHaveBeenCalled();
 }expect(traps).toBe(0);
});

it('S16 measurement drift within ceilings still cannot silently refresh an old reviewed preview',async()=>{
 const h=host(),measure=h.composer.measure;let calls=0;const c=createReuseController({composer:{...h.composer,measure:text=>{const v=JSON.parse(measure(text) as string);if(++calls>1)v.envelopeBytes++;return JSON.stringify(v);}}});await c.open('{}');await c.select(selection(c.getState().rows[0]!));const p=c.getState().candidate!;c.review(JSON.stringify({candidateId:p.candidateId,exactText:p.insertedText,accepted:true}));expect(await c.insert(JSON.stringify({reviewId:c.getState().reviewId}))).toBe(false);expect(c.getState().error).toBe('prompt-limit');expect(h.composer.compareAndSet).not.toHaveBeenCalled();expect(h.read().text).toBe('request');
});
