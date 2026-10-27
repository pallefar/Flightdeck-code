// Run only inside the companion. Credentials stay in this process, never stdout.
import assert from 'node:assert/strict';
import {readFile,writeFile,stat} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadSecrets} from './secrets.mjs';
process.umask(0o077);
try {
 const state=process.env.STUDIO_STATE_DIR??'/state';
 const env=await loadSecrets(process.env,state);
 const actor=env.STUDIO_OPERATOR;
 assert.equal(actor,'Karsten Haldan','Smoke requires the approved operator');
 const token=env.STUDIO_OPERATOR_TOKEN;
 const host='http://127.0.0.1:8787';
 async function request(path,method='GET',body,authenticated=true,status=200) {
  const response=await fetch(host+path,{method,headers:{...(authenticated?{authorization:`Bearer ${token}`} : {}),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.status,status,'Unexpected HTTP status');return response.json();
 }
 assert.deepEqual(await request('/api/studio/health','GET',undefined,false),{ok:true});
 const health=await request('/api/studio/health');
 assert.equal(health.selectedId,'anthropic');assert.equal(health.modelStatus,'unavailable');assert.equal(health.verification,'not-probed');
 const descriptors=await request('/api/studio/model-connections');
 assert.equal(descriptors.connections.length,4);
 assert.equal(descriptors.connections.find(c=>c.id==='anthropic').status,'unavailable');
 const unavailable=await request('/api/studio/build','POST',{prompt:'Development configuration probe',connectionId:'anthropic'},true,409);
 assert.equal(unavailable.status,'model-connection-unavailable');
 const recordPath=state+'/docker-smoke-record.json';
 let record;
 if(process.argv[2]==='save') {
  const projectId='docker-development-'+randomUUID().slice(0,8);
  const base=`/api/studio/workspaces/${projectId}/workflows`;
  await request(base,'GET',undefined,false,401);
  const graph={version:1,id:'dockerDevelopment',name:'Docker development persistence smoke',customBlocks:[],nodes:[
   {id:'trigger',type:'manual',label:'Manual',position:{x:0,y:0},config:{}},
   {id:'set',type:'set',label:'Set deterministic output',position:{x:250,y:0},config:{fields:{verified:true}}},
   {id:'output',type:'output',label:'Output',position:{x:500,y:0},config:{}}
  ],edges:[{id:'edge1',source:'trigger',target:'set'},{id:'edge2',source:'set',target:'output'}]};
  let draft=(await request(base,'POST',{graph},true,201)).draft;
  assert.equal(draft.createdBy,actor);
  graph.name='Docker development saved revision';
  draft=(await request(base+'/'+draft.id,'PUT',{graph,expectedRevision:draft.revision})).draft;
  assert.equal(draft.revision,2);assert.equal(draft.updatedBy,actor);
  assert.deepEqual((await request(base+'/'+draft.id)).draft,draft);
  const run=(await request(base+'/'+draft.id+'/runs','POST',{revision:draft.revision,input:{approved:true}},true,201)).run;
  assert.equal(run.initiatedBy,actor);assert.equal(run.state,'completed');
  assert.deepEqual(run.result.output,{approved:true,verified:true});
  assert.deepEqual(run.graphSnapshot,draft.graph);
  record={projectId,base,draft,run};
  await writeFile(recordPath,JSON.stringify(record),{mode:0o600});
 } else if(process.argv[2]==='readback')record=JSON.parse(await readFile(recordPath,'utf8'));
 else throw new Error();
 assert.deepEqual((await request(record.base+'/'+record.draft.id)).draft,record.draft);
 assert.deepEqual((await request(record.base+'/'+record.draft.id+'/runs/'+record.run.id)).run,record.run);
 assert.deepEqual((await request(record.base+'/'+record.draft.id+'/runs')).runs,[record.run]);
 await request(record.base+'/'+record.draft.id,'GET',undefined,false,401);
 assert.equal((await stat(state+'/operator-token')).mode&0o777,0o600);
 assert.equal((await stat(state+'/workflow-workspace.json')).mode&0o777,0o600);
 console.log(JSON.stringify({stage:process.argv[2],verified:true,operator:actor,projectId:record.projectId,draftId:record.draft.id,revision:record.draft.revision,runId:record.run.id,result:record.run.result.output,anthropic:'unavailable-not-probed',privateFileModes:'0600',unauthorized:401}));
} catch {console.error('studio: Docker HTTP smoke failed (no credentials logged)');process.exit(1);}
