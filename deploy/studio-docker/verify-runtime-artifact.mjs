// Pipe into a read-only, network-none candidate container (never a live service).
import assert from 'node:assert/strict';
import {readdirSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {setTimeout as delay} from 'node:timers/promises';
const root=process.cwd();
const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
const forbidden=new Set(['vitest','@vitest/mocker','@vitest/runner','vite','vite-node','typescript','tinypool','@vitejs/plugin-react']);
const installed=[];
function modules(dir){
 for(const e of readdirSync(dir,{withFileTypes:true})){
  if(e.name.startsWith('.'))continue;
  const path=join(dir,e.name);
  if(e.name.startsWith('@')){modules(path);continue;}
  const manifest=join(path,'package.json');
  if(!existsSync(manifest))continue;
  const p=JSON.parse(readFileSync(manifest,'utf8'));
  assert.equal(forbidden.has(p.name),false,`development package installed: ${p.name}`);
  const key=path.slice(root.length+1),entry=lock.packages[key];
  assert.ok(entry,`unlocked installed package: ${key}`);
  assert.notEqual(entry.dev,true,`dev-only lock entry physically installed: ${key}`);
  assert.equal(entry.version,p.version,`installed/lock mismatch: ${key}`);
  installed.push({path:key,name:p.name,version:p.version});
  if(existsSync(join(path,'node_modules')))modules(join(path,'node_modules'));
 }
}
modules(join(root,'node_modules'));
for(const name of Object.keys(lock.packages[''].dependencies))assert.ok(installed.some(p=>p.name===name),`missing runtime dependency: ${name}`);
function sources(dir){
 for(const e of readdirSync(dir,{withFileTypes:true})){
  assert.notEqual(e.name,'__tests__','test-source directory in runtime');
  assert.equal(/\.(?:test|spec)\.[cm]?[jt]sx?$/.test(e.name),false,'test source in runtime');
  if(e.isDirectory())sources(join(dir,e.name));
 }
}
for(const dir of ['server','packages'])sources(join(root,dir));
const ls=spawnSync('npm',['ls','--omit=dev','--all','--json'],{encoding:'utf8',env:{...process.env,npm_config_cache:'/tmp/npm-cache'}});
assert.equal(ls.status,0,'installed runtime npm graph has missing/invalid/extraneous dependencies');
installed.sort((a,b)=>a.path.localeCompare(b.path));
const report={node:process.version,uid:process.getuid(),installedCount:installed.length,installed,forbiddenPackagesAbsent:true,testSourcesAbsent:true,installedGraphValid:true};
if(process.argv.includes('--smoke')){
 assert.equal(process.getuid(),1000,'candidate must run as node');
 const state=process.env.STUDIO_STATE_DIR??'/state';
 const child=spawn(process.execPath,['--import','tsx','deploy/studio-docker/bootstrap.mjs'],{env:{...process.env,PORT:'18787',STUDIO_HOST:'127.0.0.1',STUDIO_OPERATOR:'Runtime Artifact Development Operator'},stdio:['ignore','pipe','pipe']});
 const exit=once(child,'exit');
 let ready=false;
 child.stdout.on('data',data=>{if(data.toString().includes('studio: backend ready'))ready=true;});
 child.stderr.resume();
 try{
  for(let i=0;i<150&&!ready&&child.exitCode===null;i++)await delay(100);
  assert.ok(ready,'actual private bootstrap failed to become ready');
  const get=path=>fetch('http://127.0.0.1:18787'+path,{signal:AbortSignal.timeout(5000)});
  assert.equal((await get('/api/studio/health')).status,200);
  assert.equal((await get('/api/studio/model-connections')).status,401);
  const token=readFileSync(join(state,'operator-token'),'utf8');
  const models=await fetch('http://127.0.0.1:18787/api/studio/model-connections',{headers:{authorization:'Bearer '+token},signal:AbortSignal.timeout(5000)});
  assert.equal(models.status,200);
  const descriptors=await models.json();
  assert.equal(descriptors.selectedId,null);
  assert.equal(descriptors.connections.length,4);
  assert.equal(new Set(descriptors.connections.map(c=>c.id)).size,4);
  const blocked=await fetch('http://127.0.0.1:18787/api/studio/build',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({prompt:'Isolated no-selection development check'}),signal:AbortSignal.timeout(5000)});
  assert.equal(blocked.status,409);
  assert.equal((await blocked.json()).status,'model-connection-unselected');
  const page=await get('/');assert.equal(page.status,200);
  const html=await page.text();
  const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(m=>m[1]);
  assert.ok(assets.length>=2,'real built JS/CSS entry references');
  for(const asset of assets){const r=await get(asset);assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>0);}
  for(const path of ['/server/index.ts','/package.json','/api/nonexistent','/assets/index.js.map'])assert.equal((await get(path)).status,404);
  report.bootstrap={health:200,unauthorized:401,authenticatedModels:200,modelDescriptors:4,noSelectionBuild:409,entry:200,builtAssets:assets.length,noSourceOrApiFallback:true,noVendorCalls:true};
 }finally{child.kill('SIGTERM');await exit;}
}
console.log(JSON.stringify(report,null,2));
