import { it,expect } from 'vitest';
import { mkdtemp,writeFile,chmod,symlink,rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { loadResourceConfig } from '../resource-config';
import Fastify from 'fastify';
import { ResourceStore } from '../../packages/resources/store';

const schema={type:'object',properties:{},required:[],additionalProperties:false};
const config={version:1,projects:[{id:'local-project',actions:['read','propose','execute']}],network:{allowedOrigins:['https://example.com']},functions:[{id:'read',kind:'rest',projects:['local-project'],endpoint:'https://example.com/read',method:'GET',input:schema,output:schema}]};
it('loads only a bounded private no-symlink server config with explicit project and origin grants',async()=>{
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-config-'));
  const file=join(root,'config.json');
  try {
    await writeFile(file,JSON.stringify(config),{mode:0o600});
    const loaded=loadResourceConfig(file)!;
    expect(loaded.registry.summaries('local-project')).toEqual([{id:'read',kind:'rest',input:schema,output:schema,effect:'read-only',status:'configured-not-probed'}]);
    expect(await loaded.authorize('any-local-operator','local-project','execute')).toBe(true);
    expect(await loaded.authorize('any-local-operator','foreign','execute')).toBe(false);
    expect(loadResourceConfig(undefined)).toBeUndefined();
    await chmod(file,0o644);expect(()=>loadResourceConfig(file)).toThrow('resource configuration unavailable');await chmod(file,0o600);
    await symlink(file,join(root,'link.json'));expect(()=>loadResourceConfig(join(root,'link.json'))).toThrow('resource configuration unavailable');
    await writeFile(file,' '.repeat(64_001));expect(()=>loadResourceConfig(file)).toThrow('resource configuration unavailable');
  } finally {await rm(root,{recursive:true,force:true});}
});

it('rejects unsupported schemas, browser-style overrides, unsafe origins and non-scalar query mappings before constructing a registry',async()=>{
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-config-invalid-'));
  const file=join(root,'config.json');
  const variants:unknown[]=[
    {...config,functions:[{...config.functions[0],input:{type:'object',properties:{object:schema},required:['object'],additionalProperties:false},query:{object:'object'}}]},
    {...config,functions:[{...config.functions[0],method:'POST'}]},
    {...config,functions:[{...config.functions[0],input:{...schema,oneOf:[schema]}}]},
    {...config,functions:[{...config.functions[0],endpoint:'https://foreign.example/read'}]},
    {...config,functions:[{...config.functions[0],projects:['foreign']}]},
    {...config,functions:[{...config.functions[0],headers:{authorization:'inline-secret'}}]},
    {...config,functions:[{...config.functions[0],reviewer:'browser-reviewer'}]},
    {...config,network:{allowedOrigins:['http://127.0.0.1:8787']}},
    {...config,network:{allowedOrigins:['http://localhost:8787'],developmentOrigins:['http://localhost:8787']}},
    {...config,functions:[{...config.functions[0],endpoint:'https://user:password@example.com/read'}]},
    {...config,functions:[config.functions[0],config.functions[0]]},
    {...config,projects:[config.projects[0],config.projects[0]]},
    {...config,functions:[{...config.functions[0],input:{...schema,required:['missing']}}]},
    {...config,functions:[{...config.functions[0],input:{type:'string',maxLength:-1}}]},
  ];
  try {
    for(const variant of variants){await writeFile(file,JSON.stringify(variant),{mode:0o600});expect(()=>loadResourceConfig(file)).toThrow('resource configuration unavailable');}
  } finally {await rm(root,{recursive:true,force:true});}
});

it('fails closed without credential resolver and invalidates activation when file origin policy changes',async()=>{
  let hits=0;
  const remote=Fastify();remote.get('/read',async req=>{hits++;expect(req.headers.authorization).toBe('Bearer development-fixture');return {};});
  const origin=await remote.listen({host:'127.0.0.1',port:0});
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-config-live-'));
  const file=join(root,'config.json');
  const local={...config,network:{allowedOrigins:[origin],developmentOrigins:[origin]},functions:[{...config.functions[0],endpoint:origin+'/read',credential:{ref:'fixture-reference',origin,header:'authorization'}}]};
  try {
    await writeFile(file,JSON.stringify(local),{mode:0o600});
    const store=new ResourceStore(join(root,'resources'));
    const noResolver=loadResourceConfig(file)!;
    const draft=await store.propose('local-project',{name:'DEVELOPMENT credential fixture',functions:['read']},'Operator fixture');
    const active=await noResolver.registry.activate(store,'local-project',draft.id,1,'Independent reviewer fixture');
    await expect(noResolver.registry.execute(active,'read',{},'Operator fixture')).rejects.toMatchObject({statusCode:409});expect(hits).toBe(0);
    const resolveCredential=async(ref:string,context:{projectId:string;actor:string;origin:string})=>{expect(ref).toBe('fixture-reference');expect(context).toEqual({projectId:'local-project',actor:'Operator fixture',origin});return 'Bearer development-fixture';};
    const live=loadResourceConfig(file,resolveCredential)!;
    expect((await live.registry.execute(active,'read',{},'Operator fixture')).output).toEqual({});expect(hits).toBe(1);
    await writeFile(file,JSON.stringify({...local,network:{...local.network,allowedOrigins:[origin,'https://example.com']}}));
    const changed=loadResourceConfig(file,resolveCredential)!;
    await expect(changed.registry.execute(active,'read',{},'Operator fixture')).rejects.toMatchObject({statusCode:409});expect(hits).toBe(1);
  } finally {await remote.close();await rm(root,{recursive:true,force:true});}
});
