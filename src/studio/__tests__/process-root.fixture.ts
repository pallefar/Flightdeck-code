// DEVELOPMENT ONLY. Actual root and registered SDK pipeline; no live credentials/provider/host.
import type {FastifyRequest} from 'fastify';
import {createServer as createViteServer,type InlineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {pathToFileURL} from 'node:url';
import {createServer} from '../../../server/index';
import {createModelConnections} from '../../../server/model-connections';
import {createMemoryGrantStore} from '../../../packages/approvals/src/store';
import base from '../../../vite.config';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createFileSubappWorkspaceStore} from '../../../server/subapp-workspace-store';
import {createFileWorkflowWorkspaceStore} from '../../../server/workflow-workspace-store';
import {ResourceStore} from '../../../packages/resources/store';
import {ResourceRegistry} from '../../../packages/resources/registry';

export async function createProcessRootFixture({scratchParent=process.env.TMPDIR??tmpdir()}:{scratchParent?:string}={}){
 const privateRoot=await mkdtemp(join(await realpath(scratchParent),'process-ui-owned-'));
 const registry=createModelConnections({env:{STUDIO_MODEL_CONNECTION:'local',STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1/v1',STUDIO_LOCAL_MODEL:'development-configured-not-probed'}});
 let resolutions=0,builds=0;
 const resolve=()=>{resolutions++;throw new Error('DEVELOPMENT fixture prohibits model resolution.');};
 const app=createServer({operator:{actor:'Development Operator',token:'public-process-root-development-only'},modelConnections:{...registry,resolve,resolveSelected:resolve},store:createMemoryGrantStore(),projectSkillSource:async()=>[],nativeAuthoringEnabled:false,anthropicSessionSetup:{enabled:false},subappWorkspaceStore:createFileSubappWorkspaceStore(join(privateRoot,'subapps.json')),workflowWorkspaceStore:createFileWorkflowWorkspaceStore(join(privateRoot,'workflows.json')),workflowResources:{store:new ResourceStore(join(privateRoot,'resources')),registry:new ResourceRegistry([],{}),authorize:async()=>false}});
 app.addHook('onClose',async()=>{await rm(privateRoot,{recursive:true,force:true});});
 app.addHook('preHandler',async (request:FastifyRequest)=>{if(request.url==='/api/studio/process/build')builds++;});
 app.get('/__process_root/metrics',async()=>({developmentOnly:true,resolutions,builds}));
 return {app,privateRoot};
}
export function processFixtureViteConfig(backend:string):InlineConfig{
 return {configFile:false,envFile:false,envDir:false,root:process.cwd(),plugins:[react()],...(base.resolve?{resolve:base.resolve}:{}),server:{host:'127.0.0.1',port:0,hmr:false,proxy:{'/api':{target:backend,changeOrigin:false},'/__process_root':{target:backend,changeOrigin:false}}}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const {app,privateRoot}=await createProcessRootFixture();const backend=await app.listen({host:'127.0.0.1',port:0});
 const vite=await createViteServer(processFixtureViteConfig(backend));
 await vite.listen();const address=vite.httpServer!.address();if(!address||typeof address==='string')throw new Error('Missing fixture address');
 console.log(JSON.stringify({developmentOnly:true,pid:process.pid,url:`http://127.0.0.1:${address.port}/src/studio/__tests__/process-root.browser.html`,backend,privateRoot}));
 let stopping=false;const close=async()=>{if(stopping)return;stopping=true;await vite.close();await app.close();process.exit(0);};process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
}
