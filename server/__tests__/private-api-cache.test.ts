import {afterEach,expect,it,vi} from 'vitest';
import type {FastifyReply,FastifyRequest} from 'fastify';
import Fastify from 'fastify';
import type {ConstraintStrategy,HTTPVersion} from 'find-my-way';
import {request as httpRequest} from 'node:http';
import {createConnection,createServer as createNetServer} from 'node:net';
import {mkdtemp,mkdir,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from '../index';
import {createModelConnections} from '../model-connections';
import {createMemoryGrantStore} from '../../packages/approvals/src/store';
import {createFileWorkflowWorkspaceStore} from '../workflow-workspace-store';
import {createFileSubappWorkspaceStore} from '../subapp-workspace-store';
import {ResourceRegistry} from '../../packages/resources/registry';
import {ResourceStore} from '../../packages/resources/store';

const operator={actor:'Cache Policy Development Operator',token:'public-cache-policy-development-only'};
const headers={authorization:'Bearer '+operator.token};
const roots:string[]=[],apps:ReturnType<typeof createServer>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();for(const root of roots.splice(0))await rm(root,{recursive:true,force:true});vi.restoreAllMocks();});
async function fixture(withAssets=false){
 const root=await mkdtemp(join(resolve(tmpdir()),'studio-private-cache-'));roots.push(root);await mkdir(join(root,'private'),{mode:0o700});
 const build=join(root,'build');
 if(withAssets){await mkdir(join(build,'assets'),{recursive:true});await writeFile(join(build,'index.html'),'<!doctype html><script type="module" src="/assets/cache-AbCd1234.js"></script><link rel="stylesheet" href="/assets/cache-EfGh5678.css"><div id="root"></div>');await writeFile(join(build,'assets/cache-AbCd1234.js'),'export const cacheFixture=true;');await writeFile(join(build,'assets/cache-EfGh5678.css'),'body{color:black}');await writeFile(join(build,'assets/cache-source.worker-AbCd1234.js'),'self.onmessage=()=>self.postMessage("fixture");');}
 const base=createModelConnections({env:{}}),denyModel=vi.fn(()=>{throw new Error('No model resolution in cache-policy fixtures');}),descriptorReads=vi.fn(()=>base.descriptors);
 const workflowStore=createFileWorkflowWorkspaceStore(join(root,'private','workflows.json'));
 const app=createServer({operator,...(withAssets?{productionAssetRoot:build}:{}),nativeAuthoringEnabled:false,anthropicSessionSetup:{enabled:false,env:{}},modelConnections:{...base,get descriptors(){return descriptorReads();},resolve:denyModel,resolveSelected:denyModel},store:createMemoryGrantStore(),projectSkillSource:async()=>[],workflowWorkspaceStore:workflowStore,subappWorkspaceStore:createFileSubappWorkspaceStore(join(root,'private','subapps.json')),workflowResources:{store:new ResourceStore(join(root,'private','resources')),registry:new ResourceRegistry([],{}),authorize:async(_actor,_project,action)=>action!=='execute'}});
 apps.push(app);return {app,root,denyModel,descriptorReads,workflowStore};
}
async function nativeGet(app:{server:Pick<import('node:net').Server,'address'>},path:string,auth=false){
 const address=app.server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw new Error('Owned loopback listener required');
 return new Promise<{status:number|undefined;headers:import('node:http').IncomingHttpHeaders;body:string;events:string[]}>((resolve,reject)=>{
  const events:string[]=[],chunks:Buffer[]=[];
  let received:{status:number|undefined;headers:import('node:http').IncomingHttpHeaders;body:string;events:string[]}|undefined,clientClosed=false;
  const finish=()=>{if(received&&clientClosed)resolve(received);};
  const client=httpRequest({hostname:'127.0.0.1',port:address.port,path,method:'GET',agent:false,headers:auth?headers:{}},response=>{
   events.push('response');response.on('data',chunk=>chunks.push(chunk));response.once('error',reject);response.once('aborted',()=>reject(new Error('Cache fixture response aborted')));
   response.once('end',()=>events.push('end'));response.once('close',()=>{events.push('close');if(!response.complete||!response.readableEnded)return reject(new Error('Cache fixture response closed before end'));received={status:response.statusCode,headers:response.headers,body:Buffer.concat(chunks).toString('utf8'),events};finish();});
  });
  client.setTimeout(3000,()=>client.destroy(new Error('Cache fixture transport deadline')));client.once('error',reject);client.once('close',()=>{clientClosed=true;finish();});client.end();
 });
}
it('marks native encoded Studio namespace not-found refusals no-store',async()=>{
 const {app,denyModel}=await fixture();await app.listen({host:'127.0.0.1',port:0});
 const response=await nativeGet(app,'/api/%73tudio/no-such-cache-fixture');
 expect(response.status).toBe(404);expect(response.events).toEqual(['response','end','close']);expect(denyModel).not.toHaveBeenCalled();expect(response.headers['cache-control']).toBe('no-store');
});
it('marks native absolute-form Studio namespace not-found refusals no-store',async()=>{
 const {app,denyModel}=await fixture();await app.listen({host:'127.0.0.1',port:0});
 const response=await nativeGet(app,'http://cache-fixture.invalid/api/studio/no-such-cache-fixture');
 expect(response.status).toBe(404);expect(response.events).toEqual(['response','end','close']);expect(denyModel).not.toHaveBeenCalled();expect(response.headers['cache-control']).toBe('no-store');
});
it('preserves installed default framework refusal wire serialization outside Studio',async()=>{
 const {app,denyModel}=await fixture(),baseline=Fastify({logger:false});apps.push(baseline);
 for(const server of [app,baseline]){server.get('/public/:id',async()=>({synthetic:true}));await server.listen({host:'127.0.0.1',port:0});}
 const path='/public/'+'x'.repeat(101),before=await nativeGet(baseline,path),after=await nativeGet(app,path);
 expect(after.status).toBe(414);expect(after.status).toBe(before.status);expect(after.body).toBe(before.body);expect(after.headers['content-type']).toBe(before.headers['content-type']);expect(after.headers['content-length']).toBe(before.headers['content-length']);expect(after.headers['cache-control']).toBeUndefined();expect(denyModel).not.toHaveBeenCalled();
 const injectedBefore=await baseline.inject(path),injectedAfter=await app.inject(path);expect(injectedAfter.body).toBe(injectedBefore.body);expect(injectedAfter.headers['content-type']).toBe(injectedBefore.headers['content-type']);expect(injectedAfter.headers['cache-control']).toBeUndefined();
});
it('preserves the installed async-constraint framework refusal without relabeling or adding body fields',async()=>{
 const {app,denyModel}=await fixture(),baseline=Fastify({logger:false});apps.push(baseline);
 // Installed find-my-way supports callback arity 3; its declaration exposes only the synchronous overload.
 const deriveConstraint=((_request:unknown,_context:unknown,done:(error:Error)=>void)=>done(new Error('Owned async constraint refusal'))) as unknown as ConstraintStrategy<HTTPVersion.V1,unknown>['deriveConstraint'];
 for(const server of [app,baseline]){
  server.addConstraintStrategy({name:'cacheAsync',storage:()=>({get:()=>null,set:()=>{}}),deriveConstraint});
  server.get('/api/studio/async-cache-fixture',{constraints:{cacheAsync:'owned'}},async()=>({synthetic:true}));await server.listen({host:'127.0.0.1',port:0});
 }
 const path='/api/studio/async-cache-fixture',before=await nativeGet(baseline,path),after=await nativeGet(app,path);
 expect(before.status).toBe(500);expect(after.status).toBe(before.status);expect(after.body).toBe(before.body);expect(after.headers['content-type']).toBe(before.headers['content-type']);expect(after.headers['content-length']).toBe(before.headers['content-length']);expect(after.headers['cache-control']).toBe('no-store');expect(denyModel).not.toHaveBeenCalled();
 const injectedBefore=await baseline.inject(path),injectedAfter=await app.inject(path);expect(injectedAfter.body).toBe(injectedBefore.body);expect(injectedAfter.headers['content-type']).toBe(injectedBefore.headers['content-type']);expect(injectedAfter.headers['cache-control']).toBe('no-store');
});
async function nativeDrain(app:ReturnType<typeof createServer>,target:string){
 let entered!:()=>void,release!:()=>void,closing!:()=>void,seen!:()=>void;
 const inHandler=new Promise<void>(resolve=>entered=resolve),hold=new Promise<void>(resolve=>release=resolve),inClose=new Promise<void>(resolve=>closing=resolve),secondRequest=new Promise<void>(resolve=>seen=resolve);
 app.get('/api/studio/cache-drain-hold',async()=>{entered();await hold;return {synthetic:true};});
 app.addHook('preClose',async()=>{closing();}); // Observer only: no barrier or altered drain timing.
 const observe=(request:import('node:http').IncomingMessage)=>{if(request.url===target)seen();};app.server.on('request',observe);
 await app.listen({host:'127.0.0.1',port:0});const address=app.server.address();if(!address||typeof address==='string'||address.address!=='127.0.0.1')throw new Error('Owned loopback listener required');
 const socket=createConnection({host:'127.0.0.1',port:address.port}),wire:Buffer[]=[],events:string[]=[];
 let closed:Promise<void>|undefined,timer:ReturnType<typeof setTimeout>|undefined,ended=false;
 const socketClosed=new Promise<void>(resolve=>socket.once('close',()=>resolve()));
 const transport=new Promise<void>((resolve,reject)=>{socket.on('data',chunk=>wire.push(chunk));socket.once('error',reject);socket.once('end',()=>{ended=true;events.push('end');});socket.once('close',hadError=>{events.push('close');if(hadError||!ended)reject(new Error('Drain fixture closed without complete response transport'));else resolve();});});
 socket.setTimeout(3000,()=>socket.destroy(new Error('Drain fixture transport deadline')));
 try{
  const exercise=async()=>{
   await new Promise<void>((resolve,reject)=>{socket.once('connect',resolve);socket.once('error',reject);});
   socket.write('GET /api/studio/cache-drain-hold HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n');await inHandler;
   closed=app.close();await inClose;
   socket.write('GET '+target+' HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\nAuthorization: Bearer '+operator.token+'\r\n\r\n');await secondRequest;release();await transport;await closed;
   const frames=Buffer.concat(wire).toString('utf8').split(/(?=HTTP\/1\.1 )/).filter(Boolean);
   const responses=frames.map(frame=>{const boundary=frame.indexOf('\r\n\r\n'),head=frame.slice(0,boundary),body=frame.slice(boundary+4);expect(Buffer.byteLength(body)).toBe(Number(/content-length: (\d+)/i.exec(head)?.[1]));return {status:Number(/^HTTP\/1\.1 (\d+)/.exec(head)?.[1]),head,body};});
   expect(responses).toHaveLength(2);expect(events).toEqual(['end','close']);return responses;
  };
  const deadline=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('Drain fixture overall deadline')),4000);});
  return await Promise.race([exercise(),deadline]);
 }finally{if(timer)clearTimeout(timer);release();socket.destroy();await socketClosed;app.server.removeListener('request',observe);if(closed)await closed;else await app.close();expect(app.server.listening).toBe(false);expect(socket.destroyed).toBe(true);}
}
it('marks the actual default-timing native closing 503 no-store without reaching handlers',async()=>{
 const {app,denyModel,descriptorReads,workflowStore}=await fixture(),onRequest=vi.fn(),list=vi.spyOn(workflowStore,'list');descriptorReads.mockClear();
 app.addHook('onRequest',async (request:FastifyRequest)=>{if(request.raw.url==='/api/studio/model-connections')onRequest();});
 const responses=await nativeDrain(app,'/api/studio/model-connections');
 expect(responses.map(response=>response.status)).toEqual([200,503]);expect(responses[0]!.head).toMatch(/cache-control: no-store/i);expect(responses[1]!.body).toBe('{"error":"Service Unavailable","message":"Service Unavailable","statusCode":503}');
 expect(onRequest).not.toHaveBeenCalled();expect(descriptorReads).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();expect(denyModel).not.toHaveBeenCalled();expect(responses[1]!.head).toMatch(/cache-control: no-store/i);
});
it('marks authenticated model descriptor responses no-store through the real composition root',async()=>{
 const {app,denyModel}=await fixture();const response=await app.inject({method:'GET',url:'/api/studio/model-connections',headers});
 expect(response.statusCode).toBe(200);expect(response.json().connections).toHaveLength(4);expect(response.json().selectedId).toBeNull();expect(denyModel).not.toHaveBeenCalled();
 expect(response.headers['cache-control']).toBe('no-store');
});
it('marks framework-level malformed Studio API URL refusals no-store before route hooks',async()=>{
 const {app,denyModel}=await fixture();const response=await app.inject({method:'GET',url:'/api/studio/workspaces/%zz/workflows',headers});
 expect(response.statusCode).toBe(400);expect(response.json().code).toBe('FST_ERR_BAD_URL');expect(denyModel).not.toHaveBeenCalled();
 expect(response.headers['cache-control']).toBe('no-store');
});

const readCases=[
 {name:'unauthenticated descriptors',url:'/api/studio/model-connections',auth:false,status:401},
 {name:'workflow list',url:'/api/studio/workspaces/cache-project/workflows',auth:true,status:200},
 {name:'unauthenticated workflow list',url:'/api/studio/workspaces/cache-project/workflows',auth:false,status:401},
 {name:'resource list',url:'/api/studio/workspaces/cache-project/resources',auth:true,status:200},
 {name:'project skills',url:'/api/studio/projects/cache-project/skills',auth:true,status:200},
 {name:'unavailable reviewer runtime',url:'/api/studio/workspaces/cache-project/approvals',auth:true,status:503},
 {name:'unauthenticated reviewer refusal',url:'/api/studio/workspaces/cache-project/approvals',auth:false,status:401},
 {name:'subapp positive control',url:'/api/studio/workspaces/cache-project/subapps',auth:true,status:200},
 {name:'public liveness',url:'/api/studio/health',auth:false,status:200},
 {name:'authenticated liveness',url:'/api/studio/health',auth:true,status:200},
 {name:'readiness',url:'/api/studio/ready',auth:false,status:200},
 {name:'unknown API route',url:'/api/studio/no-such-cache-fixture',auth:true,status:404},
 {name:'namespace root with query',url:'/api/studio?cache-fixture=1',auth:false,status:404},
 {name:'framework parameter limit',url:'/api/studio/workspaces/'+('x'.repeat(101))+'/workflows',auth:true,status:414},
];
it.each(readCases)('sets no-store on $name without probing providers',async({url,auth,status})=>{
 const {app,denyModel}=await fixture();const response=await app.inject({method:'GET',url,headers:auth?headers:{}});
 expect(response.statusCode).toBe(status);expect(response.headers['cache-control']).toBe('no-store');expect(denyModel).not.toHaveBeenCalled();
});
const writeCases=[
 {name:'malformed JSON',url:'/api/studio/create',auth:true,type:'application/json',body:'{"',status:400},
 {name:'auth before malformed JSON',url:'/api/studio/create',auth:false,type:'application/json',body:'{"',status:401},
 {name:'invalid create body',url:'/api/studio/create',auth:true,type:'application/json',body:'{}',status:400},
 {name:'unsupported media type',url:'/api/studio/create',auth:true,type:'application/x-cache-fixture',body:'fixture',status:415},
 {name:'oversized JSON',url:'/api/studio/create',auth:true,type:'application/json',body:JSON.stringify({prompt:'x'.repeat(1000001)}),status:413},
 {name:'unselected create model',url:'/api/studio/create',auth:true,type:'application/json',body:JSON.stringify({prompt:'Prepare a bounded queue proposal'}),status:409},
 {name:'unselected block model',url:'/api/studio/blocks/propose',auth:true,type:'application/json',body:JSON.stringify({prompt:'Prepare a bounded block proposal'}),status:409},
];
it.each(writeCases)('sets no-store on $name without model admission',async({url,auth,type,body,status})=>{
 const {app,denyModel}=await fixture();const response=await app.inject({method:'POST',url,headers:{...(auth?headers:{}),'content-type':type},payload:body});
 expect(response.statusCode).toBe(status);expect(response.headers['cache-control']).toBe('no-store');expect(denyModel).not.toHaveBeenCalled();
});
it('protects populated workflow and run payloads while preserving their semantics',async()=>{
 const {app,denyModel}=await fixture(),base='/api/studio/workspaces/cache-project/workflows';
 const graph={version:1,id:'cache-fixture',name:'Cache policy synthetic workflow',customBlocks:[],nodes:[{id:'start',type:'manual',label:'Start',position:{x:0,y:0},config:{}},{id:'out',type:'output',label:'Output',position:{x:100,y:0},config:{}}],edges:[{id:'e1',source:'start',target:'out'}]};
 const created=await app.inject({method:'POST',url:base,headers,payload:{graph}});expect(created.statusCode).toBe(201);expect(created.headers['cache-control']).toBe('no-store');const draft=created.json().draft;
 const document=await app.inject({method:'GET',url:base+'/'+draft.id,headers});expect(document.statusCode).toBe(200);expect(document.json().draft).toEqual(draft);expect(document.headers['cache-control']).toBe('no-store');
 const run=await app.inject({method:'POST',url:base+'/'+draft.id+'/runs',headers,payload:{revision:draft.revision,input:{syntheticCacheFixture:true}}});expect(run.statusCode).toBe(201);expect(run.headers['cache-control']).toBe('no-store');
 const saved=run.json().run;expect(saved.state).toBe('completed');const readback=await app.inject({method:'GET',url:base+'/'+draft.id+'/runs/'+saved.id,headers});expect(readback.json().run).toEqual(saved);expect(readback.headers['cache-control']).toBe('no-store');
 const head=await app.inject({method:'HEAD',url:'/api/studio/model-connections',headers});expect(head.statusCode).toBe(200);expect(head.body).toBe('');expect(head.headers['cache-control']).toBe('no-store');expect(denyModel).not.toHaveBeenCalled();
});
it('enforces final no-store over a handler override and rewritten raw URL',async()=>{
 const {app}=await fixture();app.get('/api/studio/cache-policy-fixture',{preHandler:async (request:FastifyRequest)=>{request.raw.url='/public-cache-fixture';}},async(_request:FastifyRequest,reply:FastifyReply)=>reply.header('Cache-Control','public, max-age=86400').send({synthetic:true}));
 const response=await app.inject('/api/studio/cache-policy-fixture');expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).toEqual({synthetic:true});
});
it('sets no-store on an unexpected API exception without hiding its status',async()=>{
 const {app}=await fixture();app.get('/api/studio/cache-error-fixture',async()=>{throw new Error('Synthetic cache-policy error');});const response=await app.inject('/api/studio/cache-error-fixture');expect(response.statusCode).toBe(500);expect(response.headers['cache-control']).toBe('no-store');
});
it.each([{path:'/',cache:'no-cache'},{path:'/demo',cache:'no-cache'},{path:'/assets/cache-AbCd1234.js',cache:'public, max-age=31536000, immutable'},{path:'/assets/cache-EfGh5678.css',cache:'public, max-age=31536000, immutable'},{path:'/assets/cache-source.worker-AbCd1234.js',cache:'public, max-age=31536000, immutable'}])('preserves independent production asset cache policy for $path',async({path,cache})=>{
 const {app}=await fixture(true);for(const method of ['GET','HEAD'] as const){const response=await app.inject({method,url:path});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe(cache);expect(response.headers['content-security-policy']).toContain("script-src 'self'");if(method==='HEAD')expect(response.body).toBe('');}
});
it('keeps lookalike public namespaces and unrelated framework errors outside the private policy',async()=>{
 const {app}=await fixture();app.get('/api/studio-public/cache-fixture',async(_request:FastifyRequest,reply:FastifyReply)=>reply.header('Cache-Control','public, max-age=60').send({synthetic:true}));const response=await app.inject('/api/studio-public/cache-fixture');expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('public, max-age=60');const badUrl=await app.inject('/public/%zz');expect(badUrl.statusCode).toBe(400);expect(badUrl.json().code).toBe('FST_ERR_BAD_URL');expect(badUrl.headers['cache-control']).toBeUndefined();
});
it('emits the policy over native loopback HTTP for authorized data, auth refusals and bad URL parsing',async()=>{
 const {app,denyModel}=await fixture();await app.listen({host:'127.0.0.1',port:0});
 for(const row of [{url:'/api/studio/model-connections',auth:true,status:200},{url:'/api/studio/model-connections',auth:false,status:401},{url:'/api/studio/workspaces/%zz/workflows',auth:true,status:400}]){
  const received=await nativeGet(app,row.url,row.auth);
  expect(received.status).toBe(row.status);expect(received.headers['cache-control']).toBe('no-store');expect(received.events).toEqual(['response','end','close']);
 }
 expect(denyModel).not.toHaveBeenCalled();
});

// Later coverage, added after the isolated vertical RED→GREEN regressions above.
it('later coverage: native collector rejects a reset without an HTTP response',async()=>{
 const server=createNetServer(socket=>socket.resetAndDestroy());
 try{await new Promise<void>((resolve,reject)=>{server.once('error',reject);server.listen({host:'127.0.0.1',port:0},resolve);});await expect(nativeGet({server},'/api/studio/model-connections')).rejects.toMatchObject({code:'ECONNRESET'});}
 finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));expect(server.listening).toBe(false);}
});
const alternateTargets=['/api/studio','/api/%73tudio','/%61pi/studio','/%61%70%69/%73%74%75%64%69%6f','http://cache-fixture.invalid/api/studio','https://cache-fixture.invalid/%61pi/%73tudio'];
const alternateCases=alternateTargets.flatMap(base=>[
 {url:base,status:404,auth:false},
 {url:base+'/no-such-cache-fixture',status:404,auth:true},
 {url:base+'/workspaces/%zz/workflows',status:400,auth:true},
 {url:base+'/workspaces/'+'x'.repeat(101)+'/workflows',status:414,auth:true},
 {url:base+'/model-connections',status:200,auth:true},
 {url:base+'/model-connections',status:401,auth:false},
]);
it.each(alternateCases)('later coverage: native and inject preserve $status and no-store for $url (auth=$auth)',async({url,status,auth})=>{
 const {app,denyModel,workflowStore}=await fixture(),list=vi.spyOn(workflowStore,'list');await app.listen({host:'127.0.0.1',port:0});
 const native=await nativeGet(app,url,auth),injected=await app.inject({method:'GET',url,headers:auth?headers:{}});
 expect(native.status).toBe(status);expect(injected.statusCode).toBe(status);expect(native.events).toEqual(['response','end','close']);
 expect(native.headers['cache-control']).toBe('no-store');expect(injected.headers['cache-control']).toBe('no-store');
 if(status===200){const canonical=await app.inject({method:'GET',url:'/api/studio/model-connections',headers});expect(native.body).toBe(canonical.body);expect(injected.body).toBe(canonical.body);}
 if(status===401){expect(native.body).toBe('{"error":"operator token required"}');expect(injected.body).toBe(native.body);}
 if(status===400||status===414){expect(JSON.parse(native.body).code).toBe(status===400?'FST_ERR_BAD_URL':'FST_ERR_MAX_PARAM_LENGTH');expect(native.headers['content-type']).toBe('application/json');expect(injected.headers['content-type']).toBe('application/json');}
 expect(list).not.toHaveBeenCalled();expect(denyModel).not.toHaveBeenCalled();
});
it.each(['/api/studio/workspaces/%zz/workflows','/api/studio/workspaces/'+'x'.repeat(101)+'/workflows','/public/%zz','/public/'+'x'.repeat(101)])('later coverage: exact default framework wire differential for %s',async path=>{
 const {app,denyModel}=await fixture(),baseline=Fastify({logger:false});apps.push(baseline);
 baseline.get('/api/studio/workspaces/:project/workflows',async()=>({synthetic:true}));for(const server of [app,baseline]){server.get('/public/:id',async()=>({synthetic:true}));await server.listen({host:'127.0.0.1',port:0});}
 const before=await nativeGet(baseline,path),after=await nativeGet(app,path),injectedBefore=await baseline.inject(path),injectedAfter=await app.inject(path);
 expect(after.status).toBe(before.status);expect(after.body).toBe(before.body);expect(injectedAfter.statusCode).toBe(injectedBefore.statusCode);expect(injectedAfter.body).toBe(injectedBefore.body);
 for(const key of ['content-type','content-length']){expect(after.headers[key]).toBe(before.headers[key]);expect(injectedAfter.headers[key]).toBe(injectedBefore.headers[key]);}
 expect(after.headers['cache-control']).toBe(path.startsWith('/api/studio/')?'no-store':undefined);expect(injectedAfter.headers['cache-control']).toBe(after.headers['cache-control']);expect(denyModel).not.toHaveBeenCalled();
});
it('later coverage: public async framework refusal matches the default without private cache policy',async()=>{
 const {app,denyModel}=await fixture(),baseline=Fastify({logger:false});apps.push(baseline);
 const deriveConstraint=((_request:unknown,_context:unknown,done:(error:Error)=>void)=>done(new Error('Owned async constraint refusal'))) as unknown as ConstraintStrategy<HTTPVersion.V1,unknown>['deriveConstraint'];
 for(const server of [app,baseline]){server.addConstraintStrategy({name:'cacheAsync',storage:()=>({get:()=>null,set:()=>{}}),deriveConstraint});server.get('/public/async-cache-fixture',{constraints:{cacheAsync:'owned'}},async()=>({synthetic:true}));await server.listen({host:'127.0.0.1',port:0});}
 const path='/public/async-cache-fixture',before=await nativeGet(baseline,path),after=await nativeGet(app,path),injectedBefore=await baseline.inject(path),injectedAfter=await app.inject(path);
 expect(before.status).toBe(500);expect(after.status).toBe(before.status);expect(after.body).toBe(before.body);expect(injectedAfter.statusCode).toBe(injectedBefore.statusCode);expect(injectedAfter.body).toBe(injectedBefore.body);
 for(const key of ['content-type','content-length']){expect(after.headers[key]).toBe(before.headers[key]);expect(injectedAfter.headers[key]).toBe(injectedBefore.headers[key]);}
 expect(after.headers['cache-control']).toBeUndefined();expect(injectedAfter.headers['cache-control']).toBeUndefined();expect(denyModel).not.toHaveBeenCalled();
});
const publicLookalikes=['/api/studio-public','/api/%73tudio-public','/%61pi/studio-public','http://cache-fixture.invalid/api/%73tudio-public'];
it.each(publicLookalikes)('later coverage: native and inject keep public lookalike %s public',async base=>{
 const {app,denyModel}=await fixture();app.get('/api/studio-public/:id',async(_request:FastifyRequest,reply:FastifyReply)=>reply.header('Cache-Control','public, max-age=60').send({synthetic:true}));await app.listen({host:'127.0.0.1',port:0});
 const native=await nativeGet(app,base+'/cache-fixture'),injected=await app.inject(base+'/cache-fixture');expect(native.status).toBe(200);expect(injected.statusCode).toBe(200);expect(native.headers['cache-control']).toBe('public, max-age=60');expect(injected.headers['cache-control']).toBe('public, max-age=60');expect(native.body).toBe(injected.body);
 const malformed=await nativeGet(app,base+'/%zz'),badInject=await app.inject(base+'/%zz');expect(malformed.status).toBe(400);expect(badInject.statusCode).toBe(400);expect(malformed.headers['cache-control']).toBeUndefined();expect(badInject.headers['cache-control']).toBeUndefined();expect(denyModel).not.toHaveBeenCalled();
});
it.each(['/api%2Fstudio/no-such-cache-fixture','/api/studio%2Fno-such-cache-fixture','/api/%2573tudio/no-such-cache-fixture','/api/Studio/no-such-cache-fixture','http://cache-fixture.invalid/public/../api/studio/no-such-cache-fixture','http://cache-fixture.invalid?redirect=/api/studio/no-such-cache-fixture','/public?redirect=/api/studio/no-such-cache-fixture'])('later coverage: native public non-alias %s is not classified as Studio',async path=>{
 const {app,denyModel}=await fixture();await app.listen({host:'127.0.0.1',port:0});const response=await nativeGet(app,path);expect(response.status).toBe(404);expect(response.headers['cache-control']).toBeUndefined();expect(denyModel).not.toHaveBeenCalled();
});
const drainCases=[
 {target:'/api/studio/health',cache:true},
 {target:'/api/studio/no-such-cache-fixture',cache:true},
 {target:'/api/studio/workspaces/cache-project/workflows',cache:true},
 {target:'/api/%73tudio/model-connections',cache:true},
 {target:'http://cache-fixture.invalid/api/%73tudio/model-connections',cache:true},
 {target:'/api/studio-public/cache-fixture',cache:false},
 {target:'/api/%73tudio-public/cache-fixture',cache:false},
];
it.each(drainCases)('later coverage: default-timing native drain refuses $target before application work',async({target,cache})=>{
 const {app,denyModel,descriptorReads,workflowStore}=await fixture(),onRequest=vi.fn(),handler=vi.fn(),list=vi.spyOn(workflowStore,'list');descriptorReads.mockClear();
 app.addHook('onRequest',async(request:FastifyRequest)=>{if(request.raw.url===target)onRequest();});app.get('/api/studio-public/cache-fixture',async()=>{handler();return {synthetic:true};});
 const responses=await nativeDrain(app,target);expect(responses.map(response=>response.status)).toEqual([200,503]);expect(responses[1]!.body).toBe('{"error":"Service Unavailable","message":"Service Unavailable","statusCode":503}');
 if(cache)expect(responses[1]!.head).toMatch(/cache-control: no-store/i);else expect(responses[1]!.head).not.toMatch(/cache-control:/i);
 expect(onRequest).not.toHaveBeenCalled();expect(handler).not.toHaveBeenCalled();expect(list).not.toHaveBeenCalled();expect(descriptorReads).not.toHaveBeenCalled();expect(denyModel).not.toHaveBeenCalled();
});
