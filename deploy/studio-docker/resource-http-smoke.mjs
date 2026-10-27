// Execute via stdin inside Studio companion. Development drafts only; no activation.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadSecrets} from '/app/deploy/studio-docker/secrets.mjs';
try {
 const state=process.env.STUDIO_STATE_DIR??'/state';
 const env=await loadSecrets(process.env,state);
 assert.equal(env.STUDIO_OPERATOR,'Karsten Haldan');
 async function request(path,method='GET',body,status=200,authenticated=true) {
  const response=await fetch('http://127.0.0.1:8787'+path,{method,headers:{...(authenticated?{authorization:`Bearer ${env.STUDIO_OPERATOR_TOKEN}`}:{ }),...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  assert.equal(response.status,status,'Unexpected resource HTTP status');return response.json();
 }
 const saved=state+'/docker-resource-smoke-record.json';let record;
 if(process.argv[2]==='save') {
  const projectId='docker-resource-'+randomUUID().slice(0,8);
  const base=`/api/studio/workspaces/${projectId}/resources`;
  await request(base,'GET',undefined,401,false);
  const list=await request(base);assert.deepEqual(list.functions,[]);
  await request(base+'?unexpected=true','GET',undefined,400);
  const resource=(await request(base,'POST',{definition:{name:'Development unconfigured resource draft',functions:['unconfigured_read_reference']}},201)).resource;
  assert.equal(resource.state,'draft');assert.equal(resource.actor,env.STUDIO_OPERATOR);
  await request(`${base}/${resource.id}/execute`,'POST',{revision:resource.revision,functionId:'unconfigured_read_reference',parameters:{}},403);
  await request(`${base}/${resource.id}/activate`,'POST',{},404);
  record={base,projectId,resource};await writeFile(saved,JSON.stringify(record),{mode:0o600});
 } else {assert.equal(process.argv[2],'readback');record=JSON.parse(await readFile(saved,'utf8'));}
 assert.deepEqual((await request(`${record.base}/${record.resource.id}`)).resource,record.resource);
 assert.deepEqual((await request(`${record.base}/${record.resource.id}/revisions`)).revisions,[record.resource]);
 assert.ok((await request(record.base)).resources.some(r=>r.id===record.resource.id));
 console.log(JSON.stringify({verified:true,stage:process.argv[2],projectId:record.projectId,resourceId:record.resource.id,revision:record.resource.revision,state:'draft',configuredFunctions:0,execution:'denied',activationRoute:'absent'}));
} catch {console.error('studio: Docker Resources smoke failed (credentials omitted)');process.exitCode=1;}
