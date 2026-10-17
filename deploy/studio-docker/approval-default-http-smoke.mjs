// Development check of the actual unconfigured reviewer runtime; no approval authority.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadSecrets} from '/app/deploy/studio-docker/secrets.mjs';
try {
 const state=process.env.STUDIO_STATE_DIR??'/state';const env=await loadSecrets(process.env,state);
 assert.equal(env.STUDIO_OPERATOR,'Karsten Haldan');
 async function request(path,method='GET',body,status=200,auth=true) {
  const r=await fetch('http://127.0.0.1:8787'+path,{method,headers:{...(auth?{authorization:`Bearer ${env.STUDIO_OPERATOR_TOKEN}`}:{ }),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(r.status,status,'Unexpected approval HTTP status');return r.json();
 }
 const recordPath=state+'/docker-approval-default-smoke.json';let record;
 if(process.argv[2]==='save') {
  const projectId='docker-approval-'+randomUUID().slice(0,8);const base=`/api/studio/workspaces/${projectId}`;
  await request(base+'/approvals','GET',undefined,401,false);
  await request(base+'/approvals','GET',undefined,503);
  await request(`${base}/approvals/${randomUUID()}/decisions`,'POST',{approvalId:randomUUID(),revision:1,decision:'approve',contextDigest:'a'.repeat(64)},503);
  const graph={version:1,id:'approvalDefault',name:'Unconfigured independent review development check',customBlocks:[],nodes:[
   {id:'start',type:'manual',label:'Start',position:{x:0,y:0},config:{}},
   {id:'gate',type:'approval',label:'Independent review',position:{x:250,y:0},config:{reviewer:'Independent review queue',reason:'Explicit human review required'}},
   {id:'end',type:'output',label:'Return',position:{x:500,y:0},config:{}}
  ],edges:[{id:'e1',source:'start',target:'gate'},{id:'e2',source:'gate',target:'end'}]};
  const draft=(await request(base+'/workflows','POST',{graph},201)).draft;
  const run=(await request(`${base}/workflows/${draft.id}/runs`,'POST',{revision:draft.revision,input:{request:'development-only'}},201)).run;
  assert.equal(run.state,'paused');assert.equal(run.resumable,false);assert.equal(run.pauseDisposition,'unavailable-no-resume');
  assert.equal(run.result.pendingNodeId,'gate');assert.ok(!run.result.trace.some(t=>t.nodeId==='end'));
  record={base,projectId,draft,run};await writeFile(recordPath,JSON.stringify(record),{mode:0o600});
 } else {assert.equal(process.argv[2],'readback');record=JSON.parse(await readFile(recordPath,'utf8'));}
 assert.deepEqual((await request(`${record.base}/workflows/${record.draft.id}/runs/${record.run.id}`)).run,record.run);
 await request(record.base+'/approvals','GET',undefined,503);
 console.log(JSON.stringify({verified:true,stage:process.argv[2],projectId:record.projectId,runId:record.run.id,state:'paused',resumable:false,reviewRuntime:'unconfigured',approvalRequestStatus:503,unauthenticatedStatus:401}));
} catch {console.error('studio: default approval Docker smoke failed (credentials omitted)');process.exitCode=1;}
