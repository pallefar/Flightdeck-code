// DEVELOPMENT-only browser fixture. Never mounted by Studio entry or Docker.
import {mkdtemp,rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createServer} from '../../server/index';
import {createFileWorkflowWorkspaceStore} from '../../server/workflow-workspace-store';
import {ResourceStore} from '../../packages/resources/store';
import {ResourceRegistry} from '../../packages/resources/registry';
const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/insertion-browser-'));
const store=new ResourceStore(join(root,'resources'));
const empty={type:'object' as const,properties:{},required:[],additionalProperties:false as const};
const registry=new ResourceRegistry([{id:'measure',kind:'rest',projects:['insertion-test'],endpoint:'http://127.0.0.1:9192/development-never-called',method:'GET',input:{...empty,properties:{label:{type:'string'}},required:['label']},output:empty},{id:'empty',kind:'rest',projects:['insertion-test'],endpoint:'http://127.0.0.1:9192/development-never-called',method:'GET',input:empty,output:empty}],{developmentOrigins:['http://127.0.0.1:9192']});
const operator={actor:'DEVELOPMENT insertion proposer',token:'resource-insertion-public-development-token'};
const draft=await store.propose('insertion-test',{name:'DEVELOPMENT insertion fixture',functions:['measure','empty']},operator.actor);
await registry.activate(store,'insertion-test',draft.id,1,'Independent DEVELOPMENT reviewer fixture');
const app=createServer({operator,workflowWorkspaceStore:createFileWorkflowWorkspaceStore(join(root,'workspace.json')),workflowResources:{store,registry,authorize:async(_actor,project)=>project==='insertion-test'}});
let hits=0;app.get('/development-never-called',async()=>{hits++;return {};});app.get('/development-observations',async()=>({hits}));
await app.listen({host:'127.0.0.1',port:9192});
console.info('DEVELOPMENT insertion fixture ready on 9192; no production credentials or registry');
async function close(){await app.close();await rm(root,{recursive:true,force:true});process.exit(0);}
process.on('SIGTERM',()=>void close());process.on('SIGINT',()=>void close());
