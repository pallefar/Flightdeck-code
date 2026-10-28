import {z} from 'zod';
import {readFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {runtimeImportClosure} from '../../test-helpers/runtime-import-closure';
import {it,expect,vi} from 'vitest';
import {builtinRegistry,configSchemas} from '../../packages/workflow/graph';
import {PROCESS_TEMPLATES} from '../process-studio/plan';
import {createPublicReuseCatalog,bundledCatalogSource,isMetadataList,isReuseDetail,reviewedDetailStillMatches,boundedUtf8Bytes,admitSerializedJson} from './catalog';

it('C01 lists the exact twelve actual typed native IDs without detail data',async()=>{
 const rows=await createPublicReuseCatalog().list('{}');
 const expected=[...builtinRegistry.map(b=>`workflow-builtin:${b.type}`),...PROCESS_TEMPLATES.map(t=>`process-template:${t.id}`)].sort();
 expect(rows.map(r=>`${r.kind}:${r.id}`).sort()).toEqual(expected);
 expect(rows).toHaveLength(12);
 const wire=JSON.stringify(rows);for(const forbidden of ['defaults','schema','requiredScopes','files','buildPrompt','prd'])expect(wire).not.toContain(`"${forbidden}"`);
});

it('C02 refuses unknown native inputs and byte overflow before parse or reflection',async()=>{
 const api=createPublicReuseCatalog();let traps=0;
 const proxy=new Proxy({}, {ownKeys(){traps++;throw Error('inspect');},get(){traps++;throw Error('read');},getPrototypeOf(){traps++;throw Error('prototype');}});
 const getter=Object.defineProperty({},'query',{get(){traps++;throw Error('getter');}});
 for(const input of [proxy,getter,new String('{}'),{},[],null,1,true,undefined,Symbol('x'),()=>{},'[]','null','true','{"kind":"private"}','{"extra":1}','{"query":2}','{"__proto__":{}}','{"constructor":{}}','{',' '.repeat(4097),'"'+'😀'.repeat(1024)+'"'])await expect(api.list(input)).rejects.toThrow('catalog-input');
 expect(traps).toBe(0);
 const parse=vi.spyOn(JSON,'parse');
 await expect(api.list(' '.repeat(4097))).rejects.toThrow('catalog-input');
 expect(parse).not.toHaveBeenCalled();parse.mockRestore();
 expect(await api.list(' '.repeat(4094)+'{}')).toHaveLength(12);
});

it('C03 literal search ranks exact IDs then fixed ASCII typed IDs regardless of source order',async()=>{
 const api=createPublicReuseCatalog();
 expect((await api.list('{"query":"http"}')).map(r=>r.id)).toEqual(['http']);
 expect((await api.list('{"kind":"process-template"}')).map(r=>r.id)).toEqual(['analytical-report','case-workspace','operations-queue']);
 expect(await api.list('{"query":".*"}')).toEqual([]);
 const ids=(await api.list('{}')).map(r=>`${r.kind}:${r.id}`);expect(ids).toEqual([...ids].sort());
 expect((await api.list('{"query":"  ReAd-OnLy  "}')).map(r=>r.id)).toEqual(['analytical-report','resource']);
});

it('C04 fingerprints the exact named metadata projection with Web Crypto and closes returned state',async()=>{
 const rows=await createPublicReuseCatalog().list('{}');
 const row=rows.find(r=>r.id==='http')!;
 expect(typeof row.metadataDigest).toBe('string');expect(row.metadataDigest).toMatch(/^[a-f0-9]{64}$/);
 const projection=JSON.stringify(['flightdeck-reuse-metadata/1',row.kind,row.id,row.label,row.description,row.templateVersion,'source-static-not-probed',null,null,null,null]);
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(projection)))).map(b=>b.toString(16).padStart(2,'0')).join('');
 expect(row.metadataDigest).toBe(digest);
 expect(row).toMatchObject({availability:'source-static-not-probed',executableVersion:null,license:null,independentApproval:null,canonicalOwner:null});
 expect(Object.isFrozen(rows)).toBe(true);expect(Object.isFrozen(row)).toBe(true);
 const original=globalThis.crypto;vi.stubGlobal('crypto',undefined);
 try{await expect(createPublicReuseCatalog().list('{}')).rejects.toThrow('crypto-unavailable');}finally{vi.stubGlobal('crypto',original);}
});

it('C05 reads only the selected actual schema/defaults and returns separate detail fingerprints',async()=>{
 const schema=vi.fn(bundledCatalogSource.schema);
 const builtins=builtinRegistry.map(b=>({...b,get defaults(){if(b.type!=='http')throw Error('eager defaults');return b.defaults;}}));
 const api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>[...builtins].reverse(),templates:()=>[...PROCESS_TEMPLATES].reverse(),schema});
 const rows=await api.list('{}');expect(schema).not.toHaveBeenCalled();
 expect(rows.map(r=>`${r.kind}:${r.id}`)).toEqual((await createPublicReuseCatalog().list('{}')).map(r=>`${r.kind}:${r.id}`));
 const row=rows.find(r=>r.id==='http')!;
 const d=await api.detail(JSON.stringify({kind:row.kind,id:row.id,metadataDigest:row.metadataDigest,templateVersion:row.templateVersion})) as any;
 expect(d).not.toBeNull();expect(schema.mock.calls).toEqual([['http'],['http']]);
 expect(d.schemaFields.map((f:any)=>f.name)).toEqual(Object.keys(configSchemas.http.shape).sort());
 for(const field of ['detailDigest','schemaDigest','defaultsDigest'])expect(d[field]).toMatch(/^[a-f0-9]{64}$/);
 expect(d.schemaFields.find((f:any)=>f.name==='method')).toMatchObject({type:'ZodEnum',optional:true,hasDefault:true});
 expect(d).not.toHaveProperty('defaults');expect(Object.isFrozen(d.schemaFields)).toBe(true);
 const t=rows.find(r=>r.id===PROCESS_TEMPLATES[0]!.id)!;
 const td=await api.detail(JSON.stringify({kind:t.kind,id:t.id,metadataDigest:t.metadataDigest,templateVersion:t.templateVersion})) as any;
 expect(td.boundary).toBe(PROCESS_TEMPLATES[0]!.boundary);expect(td.requiredScopes).toEqual(PROCESS_TEMPLATES[0]!.requiredScopes);expect(schema).toHaveBeenCalledTimes(2);
});

it('C06 refuses malformed, unknown, stale, deleted and wrong-version selected detail without repair',async()=>{
 let builtins=builtinRegistry.map(b=>structuredClone(b));let templates=PROCESS_TEMPLATES.map(t=>structuredClone(t));
 const schema=vi.fn(bundledCatalogSource.schema),api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>builtins,templates:()=>templates,schema});
 const rows=await api.list('{}'),r=rows.find(r=>r.id==='http')!;
 const q={kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion};
 await expect(api.detail(JSON.stringify({...q,metadataDigest:'0'.repeat(64)}))).rejects.toThrow('catalog-stale');
 for(const input of [null,{},new String('{}'),new Proxy({}, {get(){throw Error('native-read');}}),'null','[]','{}',JSON.stringify({...q,extra:true}),JSON.stringify({...q,id:' http'}),JSON.stringify({...q,id:'HTTP'}),JSON.stringify({...q,kind:'private'}),JSON.stringify({...q,templateVersion:'1.0.0'}),' '.repeat(4097)])await expect(api.detail(input)).rejects.toThrow();
 expect(schema).not.toHaveBeenCalled();
 builtins=builtins.map(b=>b.type==='http'?{...b,label:b.label+' changed'}:b);
 await expect(api.detail(JSON.stringify(q))).rejects.toThrow('catalog-stale');
 builtins=builtins.filter(b=>b.type!=='http');await expect(api.detail(JSON.stringify(q))).rejects.toThrow('catalog-missing');
 const t=rows.find(r=>r.kind==='process-template')!,tq={kind:t.kind,id:t.id,metadataDigest:t.metadataDigest,templateVersion:t.templateVersion};
 templates=templates.map(r=>r.id===t.id?{...r,version:'1.0.1'}:r);
 await expect(api.detail(JSON.stringify(tq))).rejects.toThrow('catalog-stale');
});

it('C07 only accepts closed bounded DTO provenance from the actual catalog factory',async()=>{
 const api=createPublicReuseCatalog(),list=await api.list('{}'),r=list[0]!;
 const detail=await api.detail(JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion}));
 expect(isMetadataList(list)).toBe(true);expect(isReuseDetail(detail)).toBe(true);
 let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error();},ownKeys(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 for(const forged of [proxy,structuredClone(list),structuredClone(detail),null,{},'[]',new String('{}')]){expect(isMetadataList(forged)).toBe(false);expect(isReuseDetail(forged)).toBe(false);}
 expect(traps).toBe(0);
 const duplicate=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>[...builtinRegistry,builtinRegistry[0]!]});
 await expect(duplicate.list('{}')).rejects.toThrow('catalog-source');
 const huge=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>Array(1000).fill(builtinRegistry[0]!)});
 await expect(huge.list('{}')).rejects.toThrow('catalog-source');
});

it('C08 binds selected default and schema checks separately without claiming executable hashes',async()=>{
 let schema=configSchemas.http.extend({url:z.string().regex(/a/i).optional()}),builtins=builtinRegistry.map(b=>structuredClone(b));
 const api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>builtins,schema:id=>id==='http'?schema:configSchemas[id]});
 const row=(await api.list('{}')).find(r=>r.id==='http')!,q=JSON.stringify({kind:row.kind,id:row.id,metadataDigest:row.metadataDigest,templateVersion:row.templateVersion});
 const before=await api.detail(q);schema=configSchemas.http.extend({url:z.string().regex(/b/i).optional()});const after=await api.detail(q);
 expect(after.schemaDigest).not.toBe(before.schemaDigest);expect(after.metadataDigest).toBe(before.metadataDigest);expect(after.defaultsDigest).toBe(before.defaultsDigest);expect(after.detailDigest).not.toBe(before.detailDigest);
 builtins=builtins.map(b=>b.type==='http'?{...b,defaults:{...b.defaults,method:'POST'}}:b);const defaults=await api.detail(q);
 expect(defaults.defaultsDigest).not.toBe(after.defaultsDigest);expect(defaults.schemaDigest).toBe(after.schemaDigest);expect(defaults.detailDigest).not.toBe(after.detailDigest);
 const all=await createPublicReuseCatalog().list('{}');for(const r of all){const d=await createPublicReuseCatalog().detail(JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion}));expect(d.id).toBe(r.id);expect(d.templateVersion).toBe(r.templateVersion);}
});

it('C09 refuses selected source drift during asynchronous hashing instead of returning a mixed detail',async()=>{
 let builtins=builtinRegistry.map(b=>structuredClone(b));const api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>builtins});
 const r=(await api.list('{}')).find(r=>r.id==='http')!,q=JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion});
 const real=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void,entered!:()=>void;
 const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);let calls=0;
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{if(++calls===2){entered();await hold;}return real(...args);});
 const pending=api.detail(q);await started;builtins=builtins.map(b=>b.type==='http'?{...b,defaults:{method:'POST'}}:b);release();
 try{await expect(pending).rejects.toThrow('catalog-stale');}finally{spy.mockRestore();}
});

it.each(['replacement','unchanged'] as const)('L001 catalog detail at the selected-schema digest barrier: %s identity',async mode=>{
 const old=configSchemas.http.extend({url:z.string().refine(()=>true).optional()});
 const replacement=configSchemas.http.extend({url:z.string().refine(()=>false).optional()});
 expect(replacement).not.toBe(old);expect(old.safeParse({url:'x'}).success).toBe(true);expect(replacement.safeParse({url:'x'}).success).toBe(false);
 let schema=old;const schemaSource=vi.fn((id:keyof typeof configSchemas)=>id==='http'?schema:configSchemas[id]);
 const api=createPublicReuseCatalog({...bundledCatalogSource,schema:schemaSource});
 const row=(await api.list('{}')).find(r=>r.id==='http')!,query=JSON.stringify({kind:row.kind,id:row.id,metadataDigest:row.metadataDigest,templateVersion:row.templateVersion});
 const reviewed=await api.detail(query),other=await createPublicReuseCatalog({...bundledCatalogSource,schema:id=>id==='http'?replacement:configSchemas[id]}).detail(query);
 expect(other.schemaDigest).toBe(reviewed.schemaDigest);expect(other.detailDigest).toBe(reviewed.detailDigest);expect(JSON.stringify(other)).toBe(JSON.stringify(reviewed));expect(reviewedDetailStillMatches(reviewed,other)).toBe(false);
 const real=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void,entered!:()=>void,calls=0,projection='';
 const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);schemaSource.mockClear();
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{if(++calls===2){projection=new TextDecoder().decode(args[1]);entered();await hold;}return real(...args);});
 const settled=api.detail(query).then(detail=>({detail,error:null}),(error:unknown)=>({detail:null,error:error instanceof Error?error.message:'unknown-error'}));
 try{
  await started;expect(calls).toBe(2);expect(JSON.parse(projection)[0]).toBe('flightdeck-reuse-schema-structure/1');expect(schemaSource.mock.calls).toEqual([['http']]);
  if(mode==='replacement')schema=replacement;release();const result=await settled;
  expect.soft(result.error).toBe(mode==='replacement'?'catalog-stale':null);
  if(mode==='replacement')expect.soft(result.detail).toBeNull();
  else{expect(isReuseDetail(result.detail)).toBe(true);expect(reviewedDetailStillMatches(reviewed,result.detail)).toBe(true);expect(result.detail).toEqual(reviewed);}
  expect(schemaSource.mock.calls).toEqual([['http'],['http']]);
 }finally{release();await settled;spy.mockRestore();}
});

it('C10 refuses in-place metadata drift while the first selected hash is pending',async()=>{
 const builtins=builtinRegistry.map(b=>structuredClone(b)),api=createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>builtins});
 const r=(await api.list('{}')).find(r=>r.id==='http')!,q=JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion});
 const real=crypto.subtle.digest.bind(crypto.subtle);let release!:()=>void,entered!:()=>void;
 const started=new Promise<void>(r=>entered=r),hold=new Promise<void>(r=>release=r);let calls=0;
 const spy=vi.spyOn(crypto.subtle,'digest').mockImplementation(async(...args)=>{if(++calls===1){entered();await hold;}return real(...args);});
 const pending=api.detail(q);await started;builtins.find(b=>b.type==='http')!.label+=' changed';release();
 try{await expect(pending).rejects.toThrow('catalog-stale');}finally{spy.mockRestore();}
});

it('C11 exported serialized admission cannot disable its bound with nonfinite, excessive or native ceilings',()=>{
 let traps=0;const proxy=new Proxy({}, {get(){traps++;throw Error();},getPrototypeOf(){traps++;throw Error();}});
 for(const ceiling of [Infinity,NaN,-1,1.5,Number.MAX_SAFE_INTEGER,new Number(4096),proxy]){expect(()=>admitSerializedJson('{}',ceiling as number)).toThrow('catalog-input');expect(boundedUtf8Bytes('{}',ceiling as number)).toBeNull();}
 expect(traps).toBe(0);
 for(const text of ['', 'a','字','🙂','\ud800','\udc00','\udc00\ud800','e\u0301','\r\n']){const bytes=new TextEncoder().encode(text).length;expect(boundedUtf8Bytes(text,bytes)).toBe(bytes);if(bytes)expect(boundedUtf8Bytes(text,bytes-1)).toBeNull();}
});

it('S10 metadata exact-ID ranking precedes label matches under detached actual-entry permutations',async()=>{
 const builtins=builtinRegistry.map(b=>b.type==='http'?{...b,label:'manual'}:b);
 for(const entries of [builtins,[...builtins].reverse()]){
  const rows=await createPublicReuseCatalog({...bundledCatalogSource,builtins:()=>entries}).list('{"query":"manual"}');expect(rows.map(r=>r.id)).toEqual(['manual','http']);
 }
});

it('S11 detail/default fingerprints match their named exact JSON UTF-8 projections',async()=>{
 const api=createPublicReuseCatalog(),r=(await api.list('{}')).find(r=>r.id==='http')!,d=await api.detail(JSON.stringify({kind:r.kind,id:r.id,metadataDigest:r.metadataDigest,templateVersion:r.templateVersion}));
 const hash=async(value:unknown)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)))),b=>b.toString(16).padStart(2,'0')).join('');
 expect(d.defaultsDigest).toBe(await hash(['flightdeck-reuse-defaults/1',{method:'GET',service:'generic'}]));
 expect(d.detailDigest).toBe(await hash(['flightdeck-reuse-detail/1',d.metadataDigest,d.boundary,d.requiredScopes,d.schemaFields,d.schemaDigest,d.defaultsDigest,d.schemaBoundary]));
});

it('S12 browser runtime import closure has only zod bare imports and no server, Node, dependency mutation or storage root',()=>{
 const own=dirname(fileURLToPath(import.meta.url));
 const {seen,bare}=runtimeImportClosure(resolve(own,'../..'),[resolve(own,'catalog.ts'),resolve(own,'controller.ts')]);
 expect([...bare].sort()).toEqual(['zod']);
 for(const file of seen){expect(file).not.toContain('/server/');expect(file).not.toContain('/authoring-harness/');expect(file).not.toContain('/node_modules/');}
 const production=[resolve(own,'catalog.ts'),resolve(own,'controller.ts')].map(p=>readFileSync(p,'utf8')).join('\n');
 expect(production).not.toMatch(/\b(?:fetch|localStorage|sessionStorage|indexedDB|WebSocket|XMLHttpRequest|console)\s*[.(]/);
 expect(production).not.toMatch(/\b(?:submit|approveSkillSend|buildProcessDraft|createDraft|proposeBlock)\s*\(/);
});
