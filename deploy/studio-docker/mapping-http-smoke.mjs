// Development smoke via stdin inside the companion; no credentials are emitted.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {loadSecrets} from '/app/deploy/studio-docker/secrets.mjs';
try {
  const state=process.env.STUDIO_STATE_DIR??'/state';
  const env=await loadSecrets(process.env,state);
  assert.equal(env.STUDIO_OPERATOR,'Karsten Haldan');
  async function request(path,method='GET',body,status=200) {
    const response=await fetch('http://127.0.0.1:8787'+path,{method,headers:{authorization:`Bearer ${env.STUDIO_OPERATOR_TOKEN}`,...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
    assert.equal(response.status,status,'Unexpected HTTP status');return response.json();
  }
  const path=state+'/docker-mapping-smoke-record.json';
  let record;
  if(process.argv[2]==='save') {
    const projectId='docker-mapping-'+randomUUID().slice(0,8);
    const base=`/api/studio/workspaces/${projectId}/workflows`;
    const node=(id,type,config={},inputMappings)=>({id,type,label:id,position:{x:0,y:0},config,...(inputMappings?{inputMappings}:{})});
    const graph={version:1,id:'dockerMapped',name:'Docker mapped diagnostic verification',customBlocks:[],nodes:[
      node('start','manual'),
      node('set','set',{fields:{verified:true}},[{target:'label',source:{kind:'input',path:['customer','labels',0]}},{target:'ready',source:{kind:'literal',value:true}}]),
      node('branch','branch',{field:'ready',operator:'equals',value:true}),
      node('yes','output',{},[{target:'label',source:{kind:'node',nodeId:'set',path:['label']}},{target:'verified',source:{kind:'node',nodeId:'set',path:['verified']}}]),
      node('no','output')
    ],edges:[{id:'e1',source:'start',target:'set'},{id:'e2',source:'set',target:'branch'},{id:'e3',source:'branch',target:'yes',sourcePort:'true'},{id:'e4',source:'branch',target:'no',sourcePort:'false'}]};
    const draft=(await request(base,'POST',{graph},201)).draft;
    const run=(await request(`${base}/${draft.id}/runs`,'POST',{revision:draft.revision,input:{customer:{labels:['docker-mapped']},discarded:true}},201)).run;
    assert.equal(run.state,'completed');assert.deepEqual(run.result.output,{label:'docker-mapped',verified:true});
    assert.deepEqual(run.graphSnapshot,draft.graph);
    assert.equal(run.result.trace.find(t=>t.nodeId==='branch').details.selectedPort,'true');
    assert.equal(run.result.trace.find(t=>t.nodeId==='no').status,'skipped');
    for(const entry of run.result.trace) {
      if(entry.status==='completed')assert.ok(Number.isFinite(entry.details.durationMs)&&entry.details.durationMs>=0);
      if(entry.details){assert.equal('input' in entry.details,false);assert.equal('output' in entry.details,false);}
    }
    await request(`${base}/${draft.id}/runs`,'POST',{revision:draft.revision,input:{}},409);
    record={projectId,base,draft,run};await writeFile(path,JSON.stringify(record),{mode:0o600});
  } else {assert.equal(process.argv[2],'readback');record=JSON.parse(await readFile(path,'utf8'));}
  assert.deepEqual((await request(`${record.base}/${record.draft.id}`)).draft,record.draft);
  assert.deepEqual((await request(`${record.base}/${record.draft.id}/runs/${record.run.id}`)).run,record.run);
  console.log(JSON.stringify({verified:true,stage:process.argv[2],projectId:record.projectId,draftId:record.draft.id,runId:record.run.id,output:record.run.result.output,branch:'true',diagnosticPayloadsPersisted:false}));
} catch {console.error('studio: mapped Docker smoke failed (credentials omitted)');process.exitCode=1;}
