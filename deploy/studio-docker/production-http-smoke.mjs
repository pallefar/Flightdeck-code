// Isolated DEVELOPMENT candidate only; pipe into node in its container.
// Generated credentials are read internally and never printed or sent to a model.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadSecrets} from './deploy/studio-docker/secrets.mjs';
process.umask(0o077);
try {
 const state=process.env.STUDIO_STATE_DIR??'/state';
 const env=await loadSecrets(process.env,state);
 assert.equal(env.STUDIO_OPERATOR,'Production serving development operator');
 const token=env.STUDIO_OPERATOR_TOKEN;
 const origin='http://127.0.0.1:8787';
 const page=await fetch(origin+'/'); assert.equal(page.status,200);
 assert.equal(page.headers.get('x-content-type-options'),'nosniff');
 assert.equal(page.headers.get('cache-control'),'no-cache');
 const csp=page.headers.get('content-security-policy');
 assert.ok(csp.includes("script-src 'self'"));assert.ok(!csp.includes('unsafe-eval'));
 const html=await page.text();
 assert.equal(await (await fetch(origin+'/demo')).text(),html);
 const head=await fetch(origin+'/',{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
 const assets=[...html.matchAll(/(?:src|href)="(\/assets\/[^" ]+)"/g)].map(m=>m[1]);assert.ok(assets.length>=2);
 for(const path of assets){const response=await fetch(origin+path);assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'public, max-age=31536000, immutable');assert.ok((await response.arrayBuffer()).byteLength>0);}
 for(const path of ['/package.json','/server/index.ts','/assets/index.js.map','/api/bogus']){const r=await fetch(origin+path);assert.equal(r.status,404);assert.ok(!r.headers.get('content-type').includes('text/html'));}
 async function request(path,method='GET',body,auth=true,status=200){
  const response=await fetch(origin+path,{method,headers:{...(auth?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.status,status,'Unexpected HTTP status');return response.json();
 }
 assert.deepEqual(await request('/api/studio/health','GET',undefined,false),{ok:true});
 const health=await request('/api/studio/health');assert.equal(health.verification,'not-probed');assert.equal(health.modelStatus,'unselected');
 await request('/api/studio/model-connections','GET',undefined,false,401);
 const descriptors=await request('/api/studio/model-connections');assert.equal(descriptors.connections.length,4);assert.equal(descriptors.selectedId,null);
 assert.equal((await request('/api/studio/build','POST',{prompt:'Development configuration probe'},true,409)).status,'model-connection-unselected');
 const recordPath=state+'/production-development-record.json';let record;
 if(process.argv[2]==='save'){
  const projectId='production-development-'+randomUUID().slice(0,8);const base=`/api/studio/workspaces/${projectId}/workflows`;
  await request(base,'GET',undefined,false,401);
  const graph={version:1,id:'productionDevelopment',name:'Production candidate development persistence',customBlocks:[],nodes:[
   {id:'trigger',type:'manual',label:'Manual',position:{x:0,y:0},config:{}},
   {id:'set',type:'set',label:'Set',position:{x:250,y:0},config:{fields:{verified:true}}},
   {id:'output',type:'output',label:'Output',position:{x:500,y:0},config:{}}
  ],edges:[{id:'edge1',source:'trigger',target:'set'},{id:'edge2',source:'set',target:'output'}]};
  let draft=(await request(base,'POST',{graph},true,201)).draft;
  graph.name='Production development saved revision';draft=(await request(base+'/'+draft.id,'PUT',{graph,expectedRevision:draft.revision})).draft;
  assert.equal(draft.revision,2);assert.equal(draft.createdBy,env.STUDIO_OPERATOR);
  assert.deepEqual((await request(base+'/'+draft.id)).draft,draft);
  const run=(await request(base+'/'+draft.id+'/runs','POST',{revision:draft.revision,input:{development:true}},true,201)).run;
  assert.equal(run.state,'completed');assert.deepEqual(run.result.output,{development:true,verified:true});assert.deepEqual(run.graphSnapshot,draft.graph);
  record={base,draft,run};await writeFile(recordPath,JSON.stringify(record),{mode:0o600});
 }else if(process.argv[2]==='readback')record=JSON.parse(await readFile(recordPath,'utf8'));else throw new Error();
 assert.deepEqual((await request(record.base+'/'+record.draft.id)).draft,record.draft);
 assert.deepEqual((await request(record.base+'/'+record.draft.id+'/runs/'+record.run.id)).run,record.run);
 assert.deepEqual((await request(record.base+'/'+record.draft.id+'/runs')).runs,[record.run]);
 for(const name of ['operator-token','workflow-workspace.json','production-development-record.json'])assert.equal((await stat(state+'/'+name)).mode&0o777,0o600);
 console.log(JSON.stringify({stage:process.argv[2],verified:true,draftId:record.draft.id,revision:record.draft.revision,runId:record.run.id,assets:assets.length,unauthorized:401,model:'unselected-not-probed',privateFileModes:'0600'}));
}catch{console.error('studio: isolated production smoke failed (no credentials logged)');process.exit(1);}
