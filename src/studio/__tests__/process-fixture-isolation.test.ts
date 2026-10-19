import {expect,it,vi} from 'vitest';
import {access,mkdtemp,realpath,rm} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {snapshotFixture} from '../../../packages/subapp-workspace/testing';
import {createProcessRootFixture,processFixtureViteConfig} from './process-root.fixture';

it('keeps Vite env/config loading disabled and proxies only to its owned development backend',()=>{
 const backend='http://127.0.0.1:12345',config=processFixtureViteConfig(backend);
 expect(config.configFile).toBe(false);expect(config.envFile).toBe(false);expect(config.envDir).toBe(false);
 expect(config.server?.host).toBe('127.0.0.1');expect(config.server?.hmr).toBe(false);
 expect(Object.keys(config.server?.proxy??{}).sort()).toEqual(['/__process_root','/api']);
 expect(config.server?.proxy?.['/api']).toEqual({target:backend,changeOrigin:false});
});

it('confines the DEVELOPMENT root to newly owned state despite ambient file/config and setup overrides',async()=>{
 const parent=await mkdtemp(join(await realpath(process.env.TMPDIR!),'process-fixture-isolation-'));
 const outside=join(parent,'ambient-not-owned');
 for(const [key,value] of Object.entries({STUDIO_RESOURCE_CONFIG_FILE:join(outside,'missing-config.json'),STUDIO_SUBAPP_WORKSPACE_FILE:join(outside,'subapps.json'),STUDIO_WORKSPACE_FILE:join(outside,'workflows.json'),STUDIO_RESOURCE_DIR:join(outside,'resources'),STUDIO_NATIVE_AUTHORING:'1',STUDIO_ANTHROPIC_SESSION_SETUP:'1'}))vi.stubEnv(key,value);
 let fixture:Awaited<ReturnType<typeof createProcessRootFixture>>|undefined;
 try{
  fixture=await createProcessRootFixture({scratchParent:parent});
  expect(dirname(fixture.privateRoot)).toBe(parent);
  const headers={authorization:'Bearer public-process-root-development-only'};
  const availability=await fixture.app.inject({url:'/api/studio/authoring',headers});
  expect(availability.statusCode).toBe(200);expect(availability.json()).toMatchObject({enabled:false});
  const source=await fixture.app.inject({method:'POST',url:'/api/studio/workspaces/development-process/subapps',headers,payload:{snapshot:snapshotFixture()}});
  expect(source.statusCode).toBe(201);
  await expect(access(join(fixture.privateRoot,'subapps.json'))).resolves.toBeUndefined();
  const saved=source.json().draft;
  const readback=await fixture.app.inject({url:`/api/studio/workspaces/development-process/subapps/${saved.id}`,headers});
  expect(readback.json().draft).toEqual(saved);
  await expect(access(outside)).rejects.toMatchObject({code:'ENOENT'});
  await fixture.app.close();
  await expect(access(fixture.privateRoot)).rejects.toMatchObject({code:'ENOENT'});
 }finally{if(fixture)await fixture.app.close();vi.unstubAllEnvs();await rm(parent,{recursive:true,force:true});}
});
