// DEVELOPMENT ONLY. Predetermined model replies pass through the real Fastify composition root.
// No vendor keys, OAuth access, live provider, host edits or execution adapters.
import type {FastifyRequest} from 'fastify';
import {mkdtemp,realpath,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer as createViteServer} from 'vite';
import {pathToFileURL} from 'node:url';
import {createServer} from '../../../server/index';
import {createModelConnections} from '../../../server/model-connections';
import {createMemoryGrantStore} from '../../../packages/approvals/src/store';
import {createFileWorkflowWorkspaceStore} from '../../../server/workflow-workspace-store';
import {EXAMPLE_DRAFT_JSON} from '../../../packages/spec/src/prompt';
import {graphSchema} from '../../../packages/workflow/graph';

export const DEVELOPMENT_TOKEN='development-only-nonsecret-ai-builder-sentinel';
export const DEVELOPMENT_PROJECT='development-builder';
export const SUBAPP_REQUEST='Show contract folders needing review, visible to legal and admin.';
export const WORKFLOW_REQUEST='Review incoming requests for legal.';
const skill={id:'review',version:'1',content:'review queue shows human_review for legal. human gate: human_review. country de.'};
const planned={workflow:{name:'Review intake',slug:'review-flow',country:'DE',intakeFields:[{name:'request',type:'string',required:true}],steps:['intake_received','human_review','complete'],statutorySteps:['human_review']},pages:[{slug:'review-queue',title:'Review queue',purpose:'review queue shows human_review for legal.',sourceSkillIds:['review'],stepIds:['human_review'],icon:'document',navSection:'Contract pipeline',visibleToRoles:['legal'],evidence:[{skillId:'review',quote:'review queue shows human_review for legal.'}]}]};
export const DEVELOPMENT_GRAPH=graphSchema.parse({version:1,id:'developmentReview',name:'Review intake',customBlocks:[{id:'markReview',label:'Mark for review',baseType:'set',defaults:{fields:{reviewNeeded:true}},description:'Declarative review marker; human review remains a separate gate.'}],nodes:[{id:'intake_received',type:'manual',label:'Intake received',position:{x:60,y:150},config:{}},{id:'prepare',type:'markReview',label:'Mark for review',position:{x:320,y:150},config:{}},{id:'human_review',type:'approval',label:'Independent human review',position:{x:580,y:150},config:{reviewer:'development-review-queue',reason:'Independent human review required'}},{id:'complete',type:'output',label:'Complete',position:{x:840,y:150},config:{}}],edges:[{id:'intakePrepare',source:'intake_received',target:'prepare'},{id:'prepareReview',source:'prepare',target:'human_review'},{id:'reviewComplete',source:'human_review',target:'complete'}]});

export async function createAiBuilderFixture(){
 const dir=await mkdtemp(join(await realpath(process.env.TMPDIR!), 'ai-builder-development-'));
 const requests:Array<{prompt:string;connectionId:string;reviewed:boolean;answers:boolean}>=[];
 const modelCalls:string[]=[];let held:Array<()=>void>=[];
 const registry=createModelConnections({env:{STUDIO_LOCAL_BASE_URL:'http://127.0.0.1:1234/v1',STUDIO_LOCAL_MODEL:'development-predetermined-not-live'},localFetch:async(_url,init)=>{
  const body=JSON.parse(String(init?.body));const messages=body.messages as Array<{role:string;content:string}>;
  const system=messages.find(message=>message.role==='system')?.content??'';
  const user=messages.find(message=>message.role==='user')?.content??'';
  modelCalls.push(system.includes('STUDIO_DETERMINATION_V1')?'determination':system.includes('STUDIO_WORKFLOW_DRAFT_V1')?'workflow':system.includes('Reuse builtins first')?'graph':'subapp');
  let value:unknown;
  if(system.includes('STUDIO_DETERMINATION_V1')){
   const input=JSON.parse(user) as {prompt:string;answers?:Record<string,string>};
   if(input.prompt.includes('Hold routed draft'))await new Promise<void>(resolve=>held.push(resolve));
   if(input.prompt.includes('Ask which deliverable')&&!input.answers?.target)value={status:'needs_input',questions:[{id:'target',question:'Should this be a workflow or an isolated application?'}]};
   else if(input.prompt.includes('Refuse invalid route'))value={target:'invented-agent',reason:'Invalid fixture route must fail closed'};
   else value={target:input.prompt.includes('contract folders needing review')?'subapp':'workflow',reason:input.prompt.includes('contract folders needing review')?'A persistent isolated review application.':'An ordered intake and independent human review process.'};
  }else if(system.includes('STUDIO_WORKFLOW_DRAFT_V1'))value=planned;
  else if(system.includes('Reuse builtins first'))value=DEVELOPMENT_GRAPH;
  else{const draft=JSON.parse(EXAMPLE_DRAFT_JSON);draft.spec.visibleToRoles={roles:['legal','admin'],evidence:'visible to legal and admin'};draft.spec.capabilities=[{capability:'read:contracts',evidence:'contract folders needing review'}];draft.understanding=SUBAPP_REQUEST;value=draft;}
  return new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify(value)}}]}),{headers:{'content-type':'application/json'}});
 }});
 const app=createServer({operator:{actor:'Development Builder Operator',token:DEVELOPMENT_TOKEN},modelConnections:registry,store:createMemoryGrantStore(),projectSkillSource:async()=>[skill],workflowWorkspaceStore:createFileWorkflowWorkspaceStore(join(dir,'workspace.json'))});
 app.addHook('preHandler',async (request:FastifyRequest)=>{if(request.url==='/api/studio/create'){const body=request.body as {prompt:string;connectionId:string;reviewedSkillHash?:string;answers?:unknown};requests.push({prompt:body.prompt,connectionId:body.connectionId,reviewed:!!body.reviewedSkillHash,answers:!!body.answers});}});
 app.get('/__development/metrics',async()=>({developmentOnly:true,requests,modelCalls,held:held.length}));
 app.post('/__development/release',async()=>{const pending=held;held=[];pending.forEach(release=>release());return {released:pending.length};});
 return {app,requests,modelCalls,async close(){held.forEach(release=>release());held=[];await app.close();await rm(dir,{recursive:true,force:true});}};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const fixture=await createAiBuilderFixture();const backend=await fixture.app.listen({host:'127.0.0.1',port:0});
 const vite=await createViteServer({root:process.cwd(),server:{host:'127.0.0.1',port:0,proxy:{'/api':backend,'/__development':backend}}});await vite.listen();
 const address=vite.httpServer!.address();if(!address||typeof address!=='object')throw new Error('Fixture address missing');
 console.log(JSON.stringify({developmentOnly:true,browserUrl:`http://127.0.0.1:${address.port}/src/studio/__tests__/ai-builder-browser.html`,rootUrl:`http://127.0.0.1:${address.port}/`,backend}));
 let stopping=false;const close=async()=>{if(stopping)return;stopping=true;await vite.close();await fixture.close();process.exit(0);};process.on('SIGINT',()=>void close());process.on('SIGTERM',()=>void close());
}
