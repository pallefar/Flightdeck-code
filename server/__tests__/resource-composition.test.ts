import { it, expect } from 'vitest';
import { mkdtemp, rm, writeFile, stat } from 'node:fs/promises';
import { vi } from 'vitest';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../index';
import { ResourceStore } from '../../packages/resources/store';

const operator={actor:'Karsten Haldan',token:'composition-test-token-at-least-24-chars'};
const headers={authorization:`Bearer ${operator.token}`};
const base='/api/studio/workspaces/local-project/resources';
it('mounts auth-first private local resource authoring with empty registry and no activation authority',async()=>{
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-composition-'));
  const store=new ResourceStore(root);
  const app=createServer({operator,workflowResources:{store}});
  try {
    expect((await app.inject({method:'POST',url:base,headers:{'content-type':'application/json'},payload:'{'})).statusCode).toBe(401);
    expect((await app.inject({method:'GET',url:base,headers})).json()).toEqual({resources:[],functions:[]});
    const created=await app.inject({method:'POST',url:base,headers,payload:{definition:{name:'Unconfigured local draft',functions:['not-configured']}}});
    expect(created.statusCode).toBe(201);
    const draft=created.json().resource;
    expect(draft.actor).toBe(operator.actor);
    expect((await app.inject({method:'GET',url:base+'/'+draft.id,headers})).json().resource).toEqual(draft);
    expect((await store.get('local-project',draft.id)).state).toBe('draft');
    const updated=await app.inject({method:'PUT',url:base+'/'+draft.id,headers,payload:{expectedRevision:1,definition:{name:'Updated local draft',functions:['not-configured']}}});
    expect(updated.statusCode).toBe(200);
    expect((await app.inject({method:'GET',url:base+'/'+draft.id,headers})).json().resource).toEqual(updated.json().resource);
    expect((await app.inject({method:'GET',url:base+'/'+draft.id+'/revisions',headers})).json().revisions.map((r:{revision:number})=>r.revision)).toEqual([1,2]);
    expect((await app.inject({method:'PUT',url:base+'/'+draft.id,headers,payload:{expectedRevision:1,definition:draft.definition}})).statusCode).toBe(409);
    expect((await app.inject({method:'POST',url:base+'/'+draft.id+'/execute',headers,payload:{revision:2,functionId:'not-configured',parameters:{}}})).statusCode).toBe(403);
    expect((await app.inject({method:'POST',url:base+'/'+draft.id+'/activate',headers,payload:{reviewer:'browser-reviewer'}})).statusCode).toBe(404);
    expect((await app.inject({method:'GET',url:base+'?endpoint=http://evil',headers})).statusCode).toBe(400);
    expect((await app.inject({method:'POST',url:base,headers,payload:{definition:{name:'Override',functions:['f'],endpoint:'http://evil'}}})).statusCode).toBe(400);
  } finally {await app.close();await rm(root,{recursive:true,force:true});}
});

it('loads configured function descriptors from fixed private startup config and persists under STUDIO_STATE_DIR/resources',async()=>{
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-default-'));
  const file=join(root,'config.json');
  const schema={type:'object',properties:{},required:[],additionalProperties:false};
  await writeFile(file,JSON.stringify({version:1,projects:[{id:'local-project',actions:['read','propose']}],network:{allowedOrigins:['https://example.com']},functions:[{id:'configured_read',kind:'rest',projects:['local-project'],endpoint:'https://example.com/read',method:'GET',input:schema,output:schema}]}),{mode:0o600});
  vi.stubEnv('STUDIO_RESOURCE_CONFIG_FILE',file);vi.stubEnv('STUDIO_STATE_DIR',root);vi.stubEnv('STUDIO_RESOURCE_DIR',undefined);
  const app=createServer({operator});
  try {
    const list=await app.inject({method:'GET',url:base,headers});
    expect(list.json().functions.map((f:{id:string})=>f.id)).toEqual(['configured_read']);
    expect(JSON.stringify(list.json())).not.toContain('example.com');
    expect((await app.inject({method:'GET',url:'/api/studio/workspaces/foreign/resources',headers})).statusCode).toBe(403);
    const created=await app.inject({method:'POST',url:base,headers,payload:{definition:{name:'Configured local draft',functions:['configured_read']}}});expect(created.statusCode).toBe(201);
    expect((await stat(join(root,'resources'))).mode&0o077).toBe(0);
    const draft=created.json().resource;
    await app.close();
    const restarted=createServer({operator});
    try {expect((await restarted.inject({method:'GET',url:base+'/'+draft.id,headers})).json().resource).toEqual(draft);} finally {await restarted.close();}
  } finally {await app.close();vi.unstubAllEnvs();await rm(root,{recursive:true,force:true});}
});
