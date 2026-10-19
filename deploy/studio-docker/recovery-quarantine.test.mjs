import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp,realpath,rm,writeFile,lstat,readdir,readFile,mkdir,symlink,readlink,chmod} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const bootstrap=fileURLToPath(new URL('bootstrap.mjs',import.meta.url));
const refusal='studio: startup refused (check private configuration)\n';
const zero={loadSecrets:0,operatorFromEnv:0,createServer:0,listen:0};
const fixture=async()=>mkdtemp(join(await realpath(tmpdir()),'studio-quarantine-'));

// Real bootstrap/guard, fixture downstream imports, native lstat except for
// explicitly injected metadata failures. fd 3 carries private fixture evidence.
function countedBoot(state,metadataFailure) {
 const metadataSource=`import fs from 'node:fs';export async function lstat(path){
  globalThis.bootMetadata.push(path);const failure=${JSON.stringify(metadataFailure??null)};
  const matches=failure&&(failure.path===undefined||failure.path===path);
  if(matches&&!failure.metadata)throw Object.assign(new Error('synthetic-private-path-and-error'),{code:failure.code});
  const info=await fs.promises.lstat(path);
  return matches&&failure.metadata?Object.assign(info,failure.metadata):info;
 }`;
 const setup=`import {registerHooks} from 'node:module';
 import {writeSync} from 'node:fs';
 globalThis.bootCounts=${JSON.stringify(zero)};
 globalThis.bootMetadata=[];
 globalThis.bootOrder=[];
 process.on('exit',()=>writeSync(3,JSON.stringify({counts:globalThis.bootCounts,metadata:globalThis.bootMetadata,order:globalThis.bootOrder})));
 registerHooks({load(url,context,next){
  if(url==='node:fs/promises')return {format:'module',shortCircuit:true,source:${JSON.stringify(metadataSource)}};
  if(url.endsWith('/deploy/studio-docker/secrets.mjs'))return {format:'module',shortCircuit:true,source:
   'export async function loadSecrets(env){globalThis.bootCounts.loadSecrets++;globalThis.bootOrder.push("loadSecrets");return env}'};
  if(url.endsWith('/server/index.ts'))return {format:'module',shortCircuit:true,source:
   'export function operatorFromEnv(){globalThis.bootCounts.operatorFromEnv++;globalThis.bootOrder.push("operatorFromEnv");return {actor:"Fixture Human",token:"nonsecret-fixture"}};export function createServer(){globalThis.bootCounts.createServer++;globalThis.bootOrder.push("createServer");return {async listen(){globalThis.bootCounts.listen++;globalThis.bootOrder.push("listen")},async close(){}}}'};
  return next(url,context);
 }});`;
 const result=spawnSync(process.execPath,['--import','data:text/javascript,'+encodeURIComponent(setup),bootstrap],{
  encoding:'utf8',timeout:10000,stdio:['ignore','pipe','pipe','pipe'],env:{STUDIO_STATE_DIR:state},
 });
 assert.equal(result.error,undefined);
 return {...result,...JSON.parse(result.output[3])};
}

function realBoot(state,{preload,operator='service',token}={}) {
 const result=spawnSync(process.execPath,['--import',import.meta.resolve('tsx'),
  ...(preload?['--import','data:text/javascript,'+encodeURIComponent(preload)]:[]),bootstrap],{
  cwd:state,encoding:'utf8',timeout:15000,stdio:['ignore','pipe','pipe','pipe'],
  env:{STUDIO_STATE_DIR:state,STUDIO_OPERATOR:operator,...(token?{STUDIO_OPERATOR_TOKEN:token}:{}),
   STUDIO_WORKSPACE_FILE:join(state,'workflow-workspace.json'),STUDIO_GRANTS_FILE:join(state,'grants.json'),
   STUDIO_HOST:'127.0.0.1',PORT:'0',TSX_DISABLE_CACHE:'1',TMPDIR:tmpdir()},
 });
 assert.equal(result.error,undefined);
 return result;
}

async function snapshot(root) {
 const entries=[];
 async function visit(path,relative) {
  const info=await lstat(path);
  entries.push({path:relative,mode:info.mode,uid:info.uid,gid:info.gid,size:info.size,
   bytes:info.isFile()?(info.size===0?'':(await readFile(path)).toString('hex')):undefined,
   link:info.isSymbolicLink()?await readlink(path):undefined});
  if(info.isDirectory())for(const name of (await readdir(path)).sort())await visit(join(path,name),join(relative,name));
 }
 await visit(root,'.');return entries;
}

test('marked regular state refuses before every downstream bootstrap dependency',async()=>{
 const state=await fixture();
 try {
  await writeFile(join(state,'.restore-blocked'),'synthetic-private-marker-content',{mode:0o600});
  await writeFile(join(state,'journal'),'synthetic-existing-private-state',{mode:0o600});
  const before=await snapshot(state);
  for(let attempt=0;attempt<2;attempt++) {
   const result=countedBoot(state);
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
   assert.deepEqual(result.counts,zero);
   const actual=realBoot(state);
   assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.equal(actual.stderr,refusal);
   assert.deepEqual(await snapshot(state),before);
  }
 } finally {await rm(state,{recursive:true,force:true});}
});

for(const kind of ['empty','symlink','dangling-symlink','directory'])test(`marked ${kind} state refuses before every downstream bootstrap dependency`,async()=>{
 const state=await fixture();
 try {
  const marker=join(state,'.restore-blocked');
  await writeFile(join(state,'journal'),'synthetic-private-journal',{mode:0o600});
  if(kind==='empty')await writeFile(marker,'',{mode:0o000});
  else if(kind==='directory')await mkdir(marker,{mode:0o700});
  else await symlink(join(state,kind==='symlink'?'journal':'absent-target'),marker);
  const before=await snapshot(state);
  for(let attempt=0;attempt<2;attempt++) {
   const result=countedBoot(state);
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
   assert.deepEqual(result.counts,zero);
   const actual=realBoot(state);
   assert.equal(actual.status,1);assert.equal(actual.stdout,'');assert.equal(actual.stderr,refusal);
   assert.deepEqual(await snapshot(state),before);
  }
 } finally {await rm(state,{recursive:true,force:true});}
});

test('invalid root spelling refuses before touching any filesystem path',()=>{
 for(const state of ['', 'relative', '/', '/private/../state', '/private/./state', '//state', '/state/', '/state\n', '/state\\child']) {
  const result=countedBoot(state,{code:'EIO'});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
  assert.deepEqual(result.counts,zero);assert.deepEqual(result.metadata,[],state);
 }
});

test('symlink root, symlink ancestor, non-directory root and non-private root refuse',async()=>{
 const parent=await fixture();
 try {
  const state=join(parent,'state');await mkdir(state,{mode:0o700});
  const link=join(parent,'link');await symlink(state,link);
  const ancestor=join(parent,'ancestor');await symlink(parent,ancestor);
  const file=join(parent,'file');await writeFile(file,'synthetic',{mode:0o600});
  const insecure=join(parent,'insecure');await mkdir(insecure,{mode:0o755});await chmod(insecure,0o755);
  const before=await snapshot(parent);
  for(const root of [link,join(ancestor,'state'),file,insecure,join(file,'state'),join(parent,'absent','nested')]) {
   const result=countedBoot(root);
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
   assert.deepEqual(result.counts,zero);assert.deepEqual(await snapshot(parent),before);
  }
 } finally {await rm(parent,{recursive:true,force:true});}
});

test('metadata permission and unexpected failures never mean an absent marker',async()=>{
 const state=await fixture();
 try {
  const before=await snapshot(state);
  for(const path of [state,join(state,'.restore-blocked')])for(const code of ['EACCES','EPERM','EIO','ENOTDIR','ELOOP',undefined]) {
   const result=countedBoot(state,{path,code});
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
   assert.deepEqual(result.counts,zero);assert.deepEqual(await snapshot(state),before);
   assert.equal(result.metadata.at(-1),path);
  }
  const rootError=countedBoot(state,{path:'/',code:'ENOENT'});
  assert.equal(rootError.status,1);assert.equal(rootError.stderr,refusal);assert.deepEqual(rootError.counts,zero);
 } finally {await rm(state,{recursive:true,force:true});}
});

test('root without owner access bits refuses even when metadata lookup itself succeeds',async()=>{
 const state=await fixture();
 try {
  const info=await lstat(state);
  const result=countedBoot(state,{path:state,metadata:{mode:info.mode&~0o700}});
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
  assert.deepEqual(result.counts,zero);assert.equal(result.metadata.at(-1),state);
 } finally {await rm(state,{recursive:true,force:true});}
});

test('foreign root ownership and special mode bits refuse before marker lookup',async()=>{
 const state=await fixture();
 try {
  const info=await lstat(state);const before=await snapshot(state);
  for(const metadata of [{uid:info.uid+1},{mode:info.mode|0o1000},{mode:info.mode|0o4000}]) {
   const result=countedBoot(state,{path:state,metadata});
   assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
   assert.deepEqual(result.counts,zero);assert.equal(result.metadata.at(-1),state);
   assert.deepEqual(await snapshot(state),before);
  }
 } finally {await rm(state,{recursive:true,force:true});}
});

test('real inaccessible root metadata refuses without chmod, creation or downstream calls',async()=>{
 const parent=await fixture();const state=join(parent,'state');
 await mkdir(state,{mode:0o700});await chmod(state,0o000);
 try {
  const result=countedBoot(state);
  assert.equal(result.status,1);assert.equal(result.stdout,'');assert.equal(result.stderr,refusal);
  assert.deepEqual(result.counts,zero);assert.equal((await lstat(state)).mode&0o777,0);
 } finally {await chmod(state,0o700);await rm(parent,{recursive:true,force:true});}
});

test('unmarked private and only-final-component-absent roots preserve downstream order without guard writes',async()=>{
 const parent=await fixture();
 try {
  const before=await snapshot(parent);
  for(const state of [parent,join(parent,'fresh')]) {
   const result=countedBoot(state);
   assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(result.stdout,'studio: backend ready\n');
   assert.deepEqual(result.counts,{loadSecrets:1,operatorFromEnv:1,createServer:1,listen:1});
   assert.deepEqual(result.order,['loadSecrets','operatorFromEnv','createServer','listen']);
   assert.deepEqual(await snapshot(parent),before);
   assert.equal(result.metadata.at(-1),state===parent?join(state,'.restore-blocked'):state);
  }
 } finally {await rm(parent,{recursive:true,force:true});}
});

test('real unmarked bootstrap retains liveness, authentication, workspace reads and no-selection refusal',async()=>{
 const state=await fixture();
 const token='development-only-nonsecret-bootstrap-fixture-token';
 const preload=`import assert from 'node:assert/strict';
 import {Server} from 'node:net';import {request as httpRequest} from 'node:http';import {writeSync} from 'node:fs';
 let port;let providerCalls=0;let verified=false;let failure=false;
 globalThis.fetch=()=>{providerCalls++;throw new Error('No fixture provider requests permitted')};
 const listen=Server.prototype.listen;
 Server.prototype.listen=function(...args){this.once('listening',()=>{port=this.address().port});return listen.apply(this,args)};
 const write=process.stdout.write.bind(process.stdout);
 process.stdout.write=function(chunk,...args){const result=write(chunk,...args);if(chunk==='studio: backend ready\\n')void exercise();return result};
 process.on('exit',()=>writeSync(3,JSON.stringify({verified,providerCalls,failure})));
 async function request(path,auth=false,body){return new Promise((resolve,reject)=>{
  const req=httpRequest({host:'127.0.0.1',port,path,method:body?'POST':'GET',headers:{
   ...(auth?{authorization:'Bearer '+process.env.STUDIO_OPERATOR_TOKEN}:{}),...(body?{'content-type':'application/json'}:{})}},response=>{
    let text='';response.setEncoding('utf8');response.on('data',part=>text+=part);
    response.on('end',()=>{try{resolve({status:response.statusCode,body:JSON.parse(text)})}catch(error){reject(error)}});
   });req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 })}
 async function exercise(){
  try {
   assert.deepEqual(await request('/api/studio/health'),{status:200,body:{ok:true}});
   assert.deepEqual(await request('/api/studio/health',true),{status:200,body:{ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed',processBuild:'registered-templates-v1'}});
   assert.equal((await request('/api/studio/model-connections')).status,401);
   const models=await request('/api/studio/model-connections',true);
   assert.equal(models.status,200);assert.equal(models.body.selectedId,null);assert.equal(models.body.connections.length,4);
   for(const model of models.body.connections){assert.equal(model.status,'unavailable');assert.equal(model.verification,'not-probed')}
   assert.equal((await request('/api/studio/workspaces/quarantine-fixture/workflows')).status,401);
   assert.deepEqual(await request('/api/studio/workspaces/quarantine-fixture/workflows',true),{status:200,body:{drafts:[]}});
   assert.deepEqual(await request('/api/studio/build',true,{prompt:'Synthetic no-provider fixture'}),{status:409,body:{status:'model-connection-unselected',error:'select a model connection'}});
   assert.equal(providerCalls,0);verified=true;
  } catch {failure=true;process.stderr.write('studio: isolated bootstrap fixture failed\\n')}
  finally {process.kill(process.pid,'SIGTERM')}
 }`;
 try {
  const before=await snapshot(state);
  const result=realBoot(state,{operator:'Alice Fixture',token,preload});
  assert.equal(result.status,0);assert.equal(result.stderr,'');assert.equal(result.stdout,'studio: backend ready\n');
  assert.deepEqual(JSON.parse(result.output[3]),{verified:true,providerCalls:0,failure:false});
  assert.deepEqual(await snapshot(state),before);
 } finally {await rm(state,{recursive:true,force:true});}
});

test('production runtime explicitly copies and allows the early quarantine helper',async()=>{
 const image=await readFile(new URL('Dockerfile.production',import.meta.url),'utf8');
 const runtime=image.split(' AS runtime')[1];assert.ok(runtime);
 const copy=runtime.split('\n').find(line=>line.startsWith('COPY deploy/studio-docker/bootstrap.mjs '));
 assert.ok(copy?.split(/\s+/).includes('deploy/studio-docker/recovery-quarantine.mjs'));
 const ignore=await readFile(new URL('Dockerfile.production.dockerignore',import.meta.url),'utf8');
 assert.ok(ignore.split('\n').includes('!deploy/studio-docker/recovery-quarantine.mjs'));
 const source=await readFile(bootstrap,'utf8');
 const guard=source.indexOf('await assertBootstrapStateUnmarked(stateDir)');
 assert.ok(guard>=0&&guard<source.indexOf('await loadSecrets('));
 assert.ok(guard<source.indexOf("await import('../../server/index.ts')"));
 assert.match(source,/STUDIO_STATE_DIR\?\?'\/state'/);
});
