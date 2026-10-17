import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import {workspaceGraphSchema,type WorkspaceDraft} from '../workspace-client';
const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
const assert=(condition:unknown,message:string)=>{if(!condition)throw new Error(message);};
export function checkProductionShellViewport(){
 const canvas=document.querySelector<HTMLElement>('.wf-scroll')!.getBoundingClientRect();
 assert(document.documentElement.scrollWidth<=innerWidth,'Entire page horizontally overflows');
 if(innerWidth>=1000&&innerHeight<650)assert(canvas.top<=330,'Application chrome leaves too little visible canvas');
 return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,canvasTop:canvas.top,visibleCanvas:Math.max(0,Math.min(innerHeight,canvas.bottom)-Math.max(0,canvas.top))};
}
export async function runProductionShellBrowserChecks(){
 const host=document.getElementById('fixture')!;
 const root=createRoot(host);const requests:string[]=[];
 let draft:WorkspaceDraft|null=null;
 const fetcher:typeof fetch=async (url,init)=>{
  requests.push(String(url));
  if(!String(url).startsWith('/api/studio/workspaces/development-shell/workflows'))throw new Error('No automatic network is allowed');
  if(init?.method==='POST'){
   const graph=workspaceGraphSchema.parse(JSON.parse(String(init.body)).graph);
   draft={id:'12345678-1234-4123-8123-123456789abc',projectId:'development-shell',revision:1,status:'draft',createdBy:'Browser fixture',updatedBy:'Browser fixture',createdAt:'2026-10-13T00:00:00Z',updatedAt:'2026-10-13T00:00:00Z',approvalBindings:[],graph};
  }
  return new Response(JSON.stringify(String(url).endsWith('/runs')?{runs:[]}:{draft}),{headers:{'content-type':'application/json'}});
 };
 root.render(<StudioApp fetcher={fetcher}/>);await pause();await pause();
 const button=(name:string)=>{const found=[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name);if(!found)throw new Error(`Missing ${name}`);return found;};
 const editor=host.querySelector('.wf-editor'),workspace=host.querySelector('.wf-workspace'),resources=host.querySelector('.resource-library'),approvals=host.querySelector('.workflow-approvals');
 const name=host.querySelector<HTMLInputElement>('[aria-label="Workflow name"]')!;
 Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(name,'Retained shell graph');name.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 for(const label of ['Resources','Approvals','AI builder','Workflow builder']){button(label).click();await pause();assert(host.querySelector('.wf-editor')===editor&&host.querySelector('.wf-workspace')===workspace&&host.querySelector('.resource-library')===resources&&host.querySelector('.workflow-approvals')===approvals,'Navigation remounted an area');assert(host.querySelector('[aria-current="page"]')?.textContent===label,'Selected navigation state inaccurate');assert(host.querySelector('.studio-context')?.textContent?.includes('Retained shell graph'),'Graph context lost');}
 button('Connection settings').click();await pause();
 assert(document.activeElement===host.querySelector('[aria-label="Operator token"]'),'Connection action did not focus the real operator field');
 assert(host.querySelector('.studio-connection-help')?.hasAttribute('open'),'Connection help not disclosed');
 assert(requests.length===0,'Navigation authenticated or requested network');
 assert(host.querySelectorAll('input[type="password"]').length===1,'Duplicate credentials');
 const skip=host.querySelector<HTMLAnchorElement>('.studio-skip')!;skip.click();assert(document.activeElement===host.querySelector('#studio-main'),'Skip target not focused');
 // Isolated in-browser DTO fixture: never a real operator or server persistence claim.
 const input=async (node:HTMLInputElement,value:string)=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));await pause();};
 await input(host.querySelector<HTMLInputElement>('[aria-label="Operator token"]')!,'development-only-nonsecret-shell-sentinel');
 await input(host.querySelector<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]')!,'development-shell');
 button('Workflow builder').click();await pause();button('Save as new draft').click();await pause();await pause();
 assert(workspace?.textContent?.includes('Current draft: 12345678-1234-4123-8123-123456789abc'),'Explicit saved identity readback missing');
 await input(name,'Dirty retained shell graph');
 const savedRequests=requests.length;
 for(const label of ['Resources','Approvals','AI builder','Workflow builder']){button(label).click();await pause();assert(host.querySelector('.wf-editor')===editor&&host.querySelector('.wf-workspace')===workspace,'Saved graph or workspace remounted');assert(name.value==='Dirty retained shell graph'&&workspace?.textContent?.includes('12345678-1234-4123-8123-123456789abc'),'Saved identity or dirty graph lost across navigation');}
 assert(requests.length===savedRequests,'Credentialed navigation made automatic requests');
 root.unmount();host.remove();
 return {developmentOnly:true,checks:['retained four-area DOM and graph identity','selected native navigation','actual connection settings focus and disclosure','no automatic network or duplicate credential field','skip target focus','exact saved fixture identity and dirty graph retained through all four areas'],requests:requests.length,realBackendPersistence:false};
}

export async function runProductionShellContextChecks(){
 const host=document.createElement('div');document.body.append(host);const root=createRoot(host);
 const json=(value:unknown)=>new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}});
 let late=true,release!:(response:Response)=>void,signal:AbortSignal|null|undefined;
 const health={ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed'};
 const descriptors=[{id:'local',label:'Fixture local model',model:'fixture-only',status:'configured',verification:'not-probed'},...(['codex-chatgpt','flightdeck','anthropic'] as const).map(id=>({id,label:id,model:null,status:'unavailable',verification:'not-probed',reason:'Browser fixture unavailable'}))];
 const calls:string[]=[];
 const fetcher:typeof fetch=async (url,init)=>{calls.push(String(url));if(String(url).endsWith('/health')){signal=init?.signal;return late?new Promise(resolve=>{release=resolve;}):json(health);}if(String(url).endsWith('/model-connections'))return json({connections:descriptors,selectedId:null});if(String(url).endsWith('/skills'))return json({projectId:'development-shell',skillSourceState:'empty',skillSources:[]});throw new Error('Unexpected fixture request');};
 const controller=new StudioController(fetcher);
 const button=(name:string)=>[...host.querySelectorAll<HTMLButtonElement>('button')].find(b=>b.textContent===name)!;
 const input=async(node:HTMLInputElement|HTMLSelectElement|HTMLTextAreaElement,value:string)=>{const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();};
 try{
  root.render(<StudioApp controller={controller} fetcher={fetcher}/>);await pause();button('Connection settings').click();await pause();
  const token=host.querySelector<HTMLInputElement>('[aria-label="Operator token"]')!,project=host.querySelector<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]')!,select=host.querySelector<HTMLSelectElement>('[aria-label="Model connection"]')!;
  await input(token,'development-only-nonsecret-context-sentinel');await input(project,'development-shell');button('Check connection & project skills').click();await pause();
  await input(token,'changed-development-only-nonsecret-context-sentinel');release(json(health));await pause();await pause();
  assert(signal?.aborted&&select.value===''&&[...select.options].slice(1).every(option=>option.disabled),'Stale configuration accepted after credential change');
  late=false;button('Check connection & project skills').click();await pause();await pause();
  assert(select.value===''&&button('Create draft').disabled,'Configured provider silently selected');
  await input(select,'local');await input(host.querySelector<HTMLTextAreaElement>('textarea[placeholder="What should this project help people do?"]')!,'Development fixture request');
  assert(!button('Create draft').disabled&&host.querySelector('.studio-context')?.textContent?.includes('configured · not-probed'),'Selected model availability not truthful');
  await input(project,'different-development-project');
  assert(select.value===''&&button('Create draft').disabled&&!host.querySelector('.studio-context')?.textContent?.includes('fixture-only'),'Project change leaked stale model configuration');
  assert(!calls.some(url=>url.endsWith('/create')||url.endsWith('/blocks/propose')),'Context navigation called a model');
  return {developmentOnly:true,checks:['credential change aborts and rejects stale descriptors','no implicit model selection','explicit selected model remains configured/not-probed','project change masks prior model context'],modelCalls:0};
 }finally{root.unmount();host.remove();}
}
