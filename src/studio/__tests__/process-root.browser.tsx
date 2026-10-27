// DEVELOPMENT ONLY. Real mounted entry, native HTTP and registered SDK output.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
import {completeProcessDraft} from './process-template-fixture';
import {buildProcessPlan,PROCESS_TEMPLATES} from '../../process-studio/plan';
import type {ProcessTemplateId} from '../../process-studio/contracts';
import {captureSubappSnapshot} from '../subapp-snapshot';
const host=document.getElementById('fixture')!;
const controller=new StudioController();
const checks:string[]=[];
const browserErrors:string[]=[];
window.addEventListener('error',event=>browserErrors.push(event.message));
window.addEventListener('unhandledrejection',()=>browserErrors.push('Unhandled rejection in DEVELOPMENT fixture'));
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
function assert(value:unknown,label:string){if(!value)throw new Error(label);checks.push(label);}
const get=<T extends Element=HTMLElement,>(selector:string):T=>{const node=host.querySelector<T>(selector);if(!node)throw new Error(`Missing ${selector}`);return node;};
function button(text:string,parent:Element=host){const node=[...parent.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.trim()===text);if(!node)throw new Error(`Missing button ${text}`);return node;}
async function input(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){const prototype=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();}
async function waitFor(test:()=>boolean,label:string){for(let i=0;i<240;i++){if(test())return;await pause();}throw new Error(`Timed out: ${label}`);}
let omitProcessCapability=false;
let hold=false,held:(()=>void)|null=null,lastSignal:AbortSignal|null=null,lastBody:unknown;
const transport:typeof fetch=async(url,init)=>{
 if(String(url)==='/api/studio/health'&&omitProcessCapability){const response=await fetch(url,init);const metadata=await response.json();delete metadata.processBuild;return new Response(JSON.stringify(metadata),{status:response.status,headers:response.headers});}
 if(String(url)!=='/api/studio/process/build')return fetch(url,init);
 lastSignal=init?.signal??null;lastBody=JSON.parse(String(init?.body));
 // Deliberately ignore abort only in this transport fixture to prove late-result suppression.
 const response=await fetch(url,{...init,signal:null});
 if(hold)await new Promise<void>(resolve=>{held=resolve;});
 return response;
};
createRoot(host).render(<StrictMode><StudioApp controller={controller} fetcher={transport}/></StrictMode>);
function processArea(){return get('.process-studio[aria-label="Process discovery workspace"]');}
function currentArea(){return get('.studio-builder-grid').getAttribute('data-area');}
async function configure(){
 button('Connection settings').click();await pause();
 await input(get<HTMLInputElement>('[aria-label="Operator token"]'),'public-process-root-development-only');
 await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'development-process');
 button('Check connection & project skills').click();await waitFor(()=>get<HTMLSelectElement>('[aria-label="Model connection"]').value==='local','real authenticated metadata');
}
async function fillDraft(templateId:ProcessTemplateId='operations-queue'){
 const draft=completeProcessDraft(templateId);
 const values:Record<string,string>={'Process name':draft.brief.title,'Where does work get stuck?':draft.brief.problem,'What should change?':draft.brief.outcome,'Who does this help?':draft.brief.users,'System of record / current tools':draft.brief.systemOfRecord,'Data sensitivity':draft.brief.dataSensitivity,'V1 features':draft.brief.v1Features.join('\n'),'V1 acceptance criteria':draft.brief.acceptanceCriteria.join('\n'),'V2 backlog':draft.brief.v2Features.join('\n'),'Application ID':draft.choices.appId,'Navigation icon':draft.choices.icon,'Navigation section':draft.choices.navSection!};
 for(const [label,value] of Object.entries(values)){
  const step=['V1 features','V1 acceptance criteria','V2 backlog'].includes(label)?1:['Application ID','Navigation icon','Navigation section'].includes(label)?3:0;
  processArea().querySelectorAll<HTMLButtonElement>('.ps-steps button')[step]!.click();await pause();
  const control=get<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`.process-studio [aria-label="${label}"]`);
  assert(!control.closest('[hidden],[inert]'),`Visible step exposes ${label}`);await input(control,value);
 }
 button('Choose template',processArea()).click();await pause();
 const label=PROCESS_TEMPLATES.find(item=>item.id===templateId)!.label;
 const chooser=get('dialog[aria-label="Choose a design template"]');
 const option=[...chooser.querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent===`Use ${label}`||item.textContent===`Keep ${label}`);if(!option)throw new Error('Registered template choice missing');option.click();await pause();
 for(const control of processArea().querySelectorAll<HTMLInputElement>('[aria-label="Template and access"] input[type="checkbox"]')){
  const text=control.closest('label')!.textContent!.trim();
  const wanted=[...draft.choices.visibleToRoles,...draft.choices.consentedScopes].some(choice=>choice===text);
  if(control.checked!==wanted){control.click();await pause();}
 }
 button('Review draft',processArea()).click();await pause();return draft;
}
async function review(){
 button('Review exact PRD, template & scopes',processArea()).click();await pause();
 const dialog=get<HTMLDialogElement>('dialog[aria-label="Review exact draft"]');get<HTMLInputElement>('dialog[aria-label="Review exact draft"] .ps-review-check input').click();await pause();button('Return to explicit build',dialog).click();await pause();
}
async function runBuild(){
 await pause();await pause();assert(currentArea()==='studio','Chat-first default retained');
 button('Start from a process / template').click();await pause();const name=get<HTMLInputElement>('.process-studio [aria-label="Process name"]');await input(name,'Retained private draft');button('AI builder').click();await pause();button('Process discovery').click();await pause();assert(get('.process-studio [aria-label="Process name"]')===name&&name.value==='Retained private draft','Ordinary navigation retains mounted process form');
 await configure();await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'A reviewed request waiting for an explicit AI action.');assert(!button('Create draft').disabled,'Configured nonempty AI authoring is available before process generation');button('Process discovery').click();await pause();const draft=await fillDraft();await review();
 assert(!button('Build V1 draft',processArea()).disabled,'Authenticated processBuild metadata enables reviewed deterministic build without requiring a model send');
 hold=true;button('Build V1 draft',processArea()).click();await waitFor(()=>held!==null,'held real generated response');
 assert(button('Create draft').disabled,'Shared busy disables AI authoring during the deterministic request');
 assert(processArea().textContent?.includes('Awaiting genuine draft generation'),'Real pending state shown');
 const plan=buildProcessPlan(draft);assert(plan.status==='ready','Exact compiler fixture is ready');assert(JSON.stringify(lastBody)===JSON.stringify({projectId:'development-process',draft,reviewKey:plan.status==='ready'?plan.reviewKey:''}),'Parent sends the current exact compiler review key and draft');
 held!();held=null;hold=false;await waitFor(()=>!!processArea().textContent?.includes('Draft accepted — not deployed'),'ProcessReviewGate accepts returned receipt');
 assert(currentArea()==='process','onBuild does not navigate away before review gate accepts receipt');
 assert(controller.workbench.getState().rounds.length===1,'Strict client receipt is admitted as one real Workbench round');
 assert(controller.getState().transcript.at(-1)?.destination.connectionId==='registered-template','Transcript identifies deterministic registered-template destination, not invented model routing');
 assert(!button('Create draft').disabled,'AI authoring is available again after deterministic settlement');
 assert(!button('Open generated source',processArea()).disabled,'Accepted receipt offers explicit generated-source handoff');
 button('Open generated source',processArea()).click();await pause();assert(currentArea()==='ide','Only explicit Open generated source opens the admitted exact round');
 button('Process discovery').click();await pause();
 const metrics=await(await fetch('/__process_root/metrics')).json();assert(metrics.resolutions===0,'Real root resolves zero model providers');
 return {checks:[...checks],metrics,area:currentArea(),rounds:controller.workbench.getState().rounds.length};
}
async function beginHeld(){hold=true;held=null;await review();button('Build V1 draft',processArea()).click();await waitFor(()=>held!==null,'held real SDK response');}
async function releaseHeld(){held?.();held=null;hold=false;await pause();await pause();}
async function runCancellationChecks(){
 const rounds=controller.workbench.getState().rounds.length;
 for(const reason of ['cancel','hide','settings','edit-revert','pagehide'] as const){
  await beginHeld();const signal=lastSignal;
  if(reason==='cancel')button('Cancel generation',processArea()).click();
  else if(reason==='hide')button('AI builder').click();
  else if(reason==='settings'){button('Connection settings').click();assert(signal?.aborted,'settings: navigation revokes process signal synchronously before the next render');}
  else if(reason==='pagehide')window.dispatchEvent(new Event('pagehide'));
  else{const name=get<HTMLInputElement>('.process-studio [aria-label="Process name"]');const value=name.value;await input(name,value+' changed');await input(name,value);}
  await pause();assert(signal?.aborted,`${reason}: parent transport signal is aborted`);
  await releaseHeld();if(currentArea()!=='process'){button('Process discovery').click();await pause();}
  assert(controller.workbench.getState().rounds.length===rounds,`${reason}: late genuine response creates no round`);
  assert(!processArea().textContent?.includes('Draft accepted — not deployed'),`${reason}: late receipt never reappears`);
  assert(button('Build V1 draft',processArea()).disabled,`${reason}: fresh review is required even after a revert`);
 }
 return {checks:[...checks],rounds};
}
async function runSourceGuards(){
 const before=controller.workbench.getState(),round=before.rounds.at(-1)!;
 const file=round.candidate.files.find(item=>item.kind==='web-module')!;
 assert(controller.workbench.editFile(file.path,file.contents+'\n// DEVELOPMENT saved source annotation\n')===null,'Guard fixture edits a real generated source file');controller.workbench.saveFile(file.path);
 assert(controller.workbench.editFile(file.path,file.contents+'\n// DEVELOPMENT unsaved source annotation\n')===null,'Guard fixture retains a distinct real unsaved source buffer');
 const edited=controller.workbench.getState(),original=window.confirm;let confirmations=0;
 window.confirm=()=>{confirmations++;return false;};
 try{await review();button('Build V1 draft',processArea()).click();await waitFor(()=>!!processArea().querySelector('[role="alert"]'),'declined source admission');}finally{window.confirm=original;}
 assert(confirmations===1,'Edited source replacement asks exactly once before admission');
 assert(controller.workbench.getState()===edited,'Declining replacement preserves exact saved/unsaved source and round identity');
 await beginHeld();controller.workbench.revertFile(file.path);await pause();const changed=controller.workbench.getState();
 await releaseHeld();await waitFor(()=>!!processArea().querySelector('[role="alert"]'),'changed-source refusal');
 assert(controller.workbench.getState()===changed,'Source edits during generation suppress admission without silently discarding work');
 window.confirm=()=>{confirmations++;return true;};
 try{await review();button('Build V1 draft',processArea()).click();await waitFor(()=>!!processArea().textContent?.includes('Draft accepted — not deployed'),'explicitly confirmed source admission');}finally{window.confirm=original;}
 assert(confirmations===2,'A fresh reviewed build requires its own explicit edited-source confirmation');
 assert(controller.workbench.getState().drafts.get(file.path)?.buffer.includes('DEVELOPMENT saved source annotation'),'Confirmed admission retains manual source in the real reconciliation state');
 assert(!button('Open generated source',processArea()).disabled,'New exact admitted artifact has a reachable source action before replacement');
 const latest=controller.workbench.getState().rounds.at(-1)!;
 const turn=controller.workbench.prompt('DEVELOPMENT explicit store replacement sentinel')!;controller.workbench.settle(turn,latest.candidate);await pause();
 assert(![...processArea().querySelectorAll('button')].some(item=>item.textContent==='Open generated source'),'A replaced round cannot reuse an older artifact source action');
 return {checks:[...checks],confirmations};
}
async function runRetentionChecks(){
 const observations:{mode:string;rounds:number;confirmations:number;bufferRetained:boolean;savedRetained:boolean}[]=[];
 for(const mode of ['unsaved-only','saved-plus-unsaved'] as const){
  if(currentArea()!=='process'){button('Process discovery').click();await pause();}
  const before=controller.workbench.getState(),round=before.rounds.at(-1)!;
  const file=round.candidate.files.find(item=>item.kind==='web-module');if(!file)throw new Error('Real registered SDK web module required');
  button('Open generated source',processArea()).click();await pause();
  await input(get<HTMLInputElement>('.fd-explorer [aria-label="Search source paths"]'),file.path);
  const row=[...host.querySelectorAll<HTMLButtonElement>('.fd-tree button')].find(item=>item.title===file.path);if(!row)throw new Error('Generated source tree path missing');row.click();await pause();
  const pane=()=>get<HTMLElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) .fd-source`);
  button('Edit',pane()).click();await pause();
  const saved=file.contents+'\n// DEVELOPMENT saved layer: café 保留\n';
  const pending=(mode==='saved-plus-unsaved'?saved:file.contents)+'\n// DEVELOPMENT pending layer: e\u0301 🧭\n';
  if(mode==='saved-plus-unsaved'){
   await input(get<HTMLTextAreaElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) textarea.fd-editor`),saved);
   button('Save',pane()).click();await pause();
   assert(controller.workbench.getState().drafts.get(file.path)?.saved===saved,`${mode}: explicit editor Save establishes the separate project layer`);
  }
  await input(get<HTMLTextAreaElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) textarea.fd-editor`),pending);
  const originalDraft=controller.workbench.getState().drafts.get(file.path);
  assert(originalDraft?.buffer===pending,`${mode}: mounted editor records the exact pending buffer`);
  const expectedSaved=mode==='saved-plus-unsaved'?saved:null;
  assert(originalDraft?.saved===expectedSaved,`${mode}: typing does not implicitly save pending source`);
  button('Process discovery').click();await pause();await review();
  const originalConfirm=window.confirm;let confirmations=0;
  // Trusted confirmation fixture only; this is not native-dialog accessibility proof.
  window.confirm=()=>{confirmations++;return true;};
  try{button('Build V1 draft',processArea()).click();await waitFor(()=>controller.workbench.getState().rounds.length===before.rounds.length+1,'confirmed genuine repeated template receipt');}finally{window.confirm=originalConfirm;}
  await pause();const retained=controller.workbench.getState().drafts.get(file.path);
  assert(confirmations===1,`${mode}: replacement requires one explicit confirmation`);
  assert(retained?.buffer===pending,`${mode}: identical regenerated source retains the pending buffer`);
  assert(retained?.saved===expectedSaved,`${mode}: regeneration retains the independent saved layer`);
  assert(retained?.conflict!==null&&retained?.conflict!==undefined,`${mode}: retained edits require explicit conflict resolution`);
  assert(controller.workbench.effectiveFiles().find(item=>item.path===file.path)?.contents===file.contents,`${mode}: pending source is not applied while the conflict remains open`);
  button('Open generated source',processArea()).click();await pause();
  const keep=[...pane().querySelectorAll<HTMLButtonElement>('button')].find(item=>item.textContent?.startsWith('Keep mine — discard Studio'));
  if(!keep)throw new Error('Reachable Keep mine conflict action missing');keep.click();await pause();
  const kept=controller.workbench.getState().drafts.get(file.path);
  assert(kept?.buffer===pending,`${mode}: Keep mine retains the current pending buffer`);
  assert(kept?.saved===(expectedSaved??file.contents),`${mode}: Keep mine restores only the saved/effective project overlay`);
  assert(get<HTMLTextAreaElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) textarea.fd-editor`).value===pending,`${mode}: retained pending text is visible in the mounted editor after resolution`);
  assert(!!pane().querySelector('.fd-dirty')&&!button('Save',pane()).disabled,`${mode}: pending text remains visibly unsaved and requires explicit Save`);
  assert(controller.workbench.effectiveFiles().find(item=>item.path===file.path)?.contents===(expectedSaved??file.contents),`${mode}: Keep mine never implicitly applies pending text`);
  button('Save',pane()).click();await pause();
  assert(controller.workbench.effectiveFiles().find(item=>item.path===file.path)?.contents===pending,`${mode}: only explicit editor Save applies the retained buffer`);
  assert(controller.workbench.getState().rounds.at(-1)!.candidate.files.find(item=>item.path===file.path)?.contents===file.contents,`${mode}: immutable generated baseline remains unchanged`);
  observations.push({mode,rounds:controller.workbench.getState().rounds.length,confirmations,bufferRetained:kept?.buffer===pending,savedRetained:kept?.saved===(expectedSaved??file.contents)});
 }
 button('Process discovery').click();await pause();
 const metrics=await(await fetch('/__process_root/metrics')).json();assert(metrics.resolutions===0,'Retention browser acceptance resolves zero model providers');
 return {checks:[...checks],observations,metrics,browserErrors:[...browserErrors]};
}
let removedCase:{path:string;saved:string;pending:string}|null=null;
async function reviewedTemplateBuild(templateId:ProcessTemplateId){
 if(currentArea()!=='process'){button('Process discovery').click();await pause();}
 await fillDraft(templateId);await review();
 const count=controller.workbench.getState().rounds.length,original=window.confirm;let confirmations=0;
 window.confirm=()=>{confirmations++;return true;};
 try{button('Build V1 draft',processArea()).click();await waitFor(()=>controller.workbench.getState().rounds.length===count+1,'explicit reviewed template switch');}finally{window.confirm=original;}
 await pause();return confirmations;
}
async function runRemovedSourceSetup(locked=false){
 let round=controller.workbench.getState().rounds.at(-1)!;
 if(!round.candidate.files.some(file=>file.path.endsWith('/routes/queue.ts'))){await reviewedTemplateBuild('operations-queue');round=controller.workbench.getState().rounds.at(-1)!;}
 assert(controller.workbench.getState().drafts.size===0,'Removed-source setup begins with clean owned source');
 const file=round.candidate.files.find(item=>item.path.endsWith('/routes/queue.ts'));if(!file)throw new Error('Actual Operations queue route missing');
 if(currentArea()!=='process'){button('Process discovery').click();await pause();}
 button('Open generated source',processArea()).click();await pause();
 const focusControl=get<HTMLButtonElement>('[aria-label="Focus source workspace"]');
 if(focusControl.getAttribute('aria-pressed')==='true'){focusControl.click();await pause();}
 const explorerControl=get<HTMLButtonElement>('[aria-label="Toggle file explorer"]');
 if(explorerControl.getAttribute('aria-expanded')!=='true'){explorerControl.click();await pause();}
 await input(get<HTMLInputElement>('.fd-explorer [aria-label="Search source paths"]'),file.path);
 const row=[...host.querySelectorAll<HTMLButtonElement>('.fd-tree button')].find(item=>item.title===file.path);if(!row)throw new Error('Actual route tree entry missing');row.click();await pause();
 const pane=get<HTMLElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) .fd-source`);button('Edit',pane).click();await pause();
 const saved=file.contents+'\n// DEVELOPMENT held removed source: café 保留\n';
 const pending=saved+'// DEVELOPMENT pending removed source: e\u0301 🧭 <script>never execute</script>\n';
 await input(get<HTMLTextAreaElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) textarea.fd-editor`),saved);button('Save',pane).click();await pause();
 await input(get<HTMLTextAreaElement>(`.fd-source-slot[data-source-path="${file.path}"]:not([hidden]) textarea.fd-editor`),pending);
 if(locked&&!controller.workbench.getState().locks.has(file.path)){button('Lock',pane).click();await pause();}
 const confirmations=await reviewedTemplateBuild('analytical-report');
 assert(confirmations===1,'Genuine queue-to-report replacement requires explicit edited-source confirmation');
 button('Open generated source',processArea()).click();await pause();
 const retained=controller.workbench.getState().drafts.get(file.path);
 assert(retained?.conflict?.kind==='removed'&&retained.saved===saved&&retained.buffer===pending,'Genuine template switch retains independent removed-source layers');
 assert(!controller.workbench.effectiveFiles().some(item=>item.path===file.path),'Unresolved removed source stays out of effective inventory');
 const decision=get<HTMLElement>(`[aria-label="Removed source ${file.path}"]`);
 assert(!decision.closest('[hidden],[inert]'),'Removed decision is mounted outside hidden source slots');
 assert(decision.querySelectorAll('button').length===2,'Every removed path exposes both explicit decision controls');
 assert(!!get('.fd-removed-conflicts').textContent?.includes('in this session only'),'Removed source warns about unchanged durable inventory policy');
 removedCase={path:file.path,saved,pending};
 return {checks:[...checks],path:file.path,locked,confirmations};
}
async function observeRemovedSourceOutcome(choice:'mine'|'studio'){
 if(!removedCase)throw new Error('Removed-source setup required');
 const {path,saved,pending}=removedCase,state=controller.workbench.getState();
 if(choice==='studio'){
  assert(!state.drafts.has(path)&&!controller.workbench.effectiveFiles().some(file=>file.path===path),'Native Take Studio explicitly discards only the chosen removed source');
  assert(state.selectedPath!==path&&controller.workbench.effectiveFiles().some(file=>file.path===state.selectedPath),'Take Studio navigates to an existing source');
  const snapshot=captureSubappSnapshot(state);assert(!snapshot.files.some(file=>file.path===path),'Take Studio restores valid latest source snapshot capture');
 }else{
  const kept=state.drafts.get(path);
  assert(state.view==='files'&&state.selectedPath===path,'Native Keep mine opens the retained source editor');
  assert(kept?.conflict===null&&kept.saved===saved&&kept.buffer===pending,'Native Keep mine retains saved and pending layers independently');
  const pane=get<HTMLElement>(`.fd-source-slot[data-source-path="${path}"]:not([hidden]) .fd-source`);
  assert(pane.querySelector<HTMLTextAreaElement>('textarea.fd-editor')?.value===pending&&!!pane.querySelector('.fd-dirty'),'Kept removed pending text is visibly editable and still unsaved');
  const editor=pane.querySelector<HTMLTextAreaElement>('textarea.fd-editor')!,rect=editor.getBoundingClientRect();
  let top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
  for(let node=editor.parentElement;node;node=node.parentElement){if(/hidden|clip|auto|scroll/.test(getComputedStyle(node).overflowY)){const bounds=node.getBoundingClientRect();top=Math.max(top,bounds.top);bottom=Math.min(bottom,bounds.bottom);}}
  assert(bottom-top>=64,'Kept removed editor has at least 64 visible vertical pixels after ancestor clipping');
  assert(controller.workbench.effectiveFiles().find(file=>file.path===path)?.contents===saved,'Keep mine does not silently publish pending removed text');
  assert(!!get('.fd-removed-conflicts').textContent?.includes('in-session only'),'Kept extra path remains labelled in-session only');
 }
 return {checks:[...checks],choice,selectedPath:state.selectedPath,activeTag:document.activeElement?.tagName,browserErrors:[...browserErrors]};
}
async function finishKeptRemovedSource(){
 if(!removedCase)throw new Error('Removed-source setup required');const {path,pending}=removedCase;
 const pane=get<HTMLElement>(`.fd-source-slot[data-source-path="${path}"]:not([hidden]) .fd-source`);button('Save',pane).click();await pause();
 assert(controller.workbench.effectiveFiles().find(file=>file.path===path)?.contents===pending,'Only explicit local Save publishes kept removed typing');
 let refused=false;try{captureSubappSnapshot(controller.workbench.getState());}catch(error){refused=String(error).includes('unsupported artifact inventory');}
 assert(refused,'Durable snapshot still refuses an explicitly kept extra path');
 button('Restore generated',pane).click();await pause();
 assert(!controller.workbench.getState().drafts.has(path)&&controller.workbench.getState().selectedPath!==path,'Existing editor Restore generated removes the kept extra path and recovers selection');
 assert(!captureSubappSnapshot(controller.workbench.getState()).files.some(file=>file.path===path),'Restore generated recovers valid source snapshot capture');
 const metrics=await(await fetch('/__process_root/metrics')).json();assert(metrics.resolutions===0,'Removed-source browser acceptance invokes zero model providers');
 return {checks:[...checks],metrics,browserErrors:[...browserErrors]};
}
async function runScopeChecks(){
 for(const kind of ['model','project','token'] as const){
  if(kind!=='model'){await configure();button('Process discovery').click();await pause();await fillDraft();}
  await beginHeld();const old=get<HTMLInputElement>('.process-studio [aria-label="Process name"]'),signal=lastSignal;
  // Real retained setup handlers, invoked with public development scope only.
  const field=kind==='model'?get<HTMLSelectElement>('[aria-label="Model connection"]'):kind==='project'?get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'):get<HTMLInputElement>('[aria-label="Operator token"]');
  await input(field,kind==='model'?'':kind==='project'?'replacement-process':'replacement-public-development-sentinel');
  const fresh=get<HTMLInputElement>('.process-studio [aria-label="Process name"]');
  assert(fresh!==old&&fresh.value==='',`${kind}: synchronous keyed scope mask clears private process form`);
  assert(signal?.aborted,`${kind}: scope replacement aborts the pending client`);
  assert(controller.workbench.getState().rounds.length===0&&controller.getState().transcript.length===0,`${kind}: old private Workbench and transcript are cleared`);
  await releaseHeld();assert(controller.workbench.getState().rounds.length===0,`${kind}: late genuine response cannot repopulate old private source`);
 }
 return {checks:[...checks]};
}
async function runCapabilityGate(){
 // Negative DTO mutation only: actual authenticated health, with its optional marker removed.
 omitProcessCapability=true;await configure();button('Process discovery').click();await pause();
 assert(processArea().querySelector('.ps-unavailable')?.textContent?.includes('server does not advertise registered-template builds'),'Authenticated legacy metadata remains unavailable with an explicit missing-capability reason');
 assert(button('Build V1 draft',processArea()).disabled,'No capability marker means no deterministic build or model fallback');
 omitProcessCapability=false;button('AI builder').click();await pause();return {checks:[...checks]};
}
Object.assign(window,{processRootFixture:{runBuild,runCancellationChecks,runSourceGuards,runRetentionChecks,runRemovedSourceSetup,observeRemovedSourceOutcome,finishKeptRemovedSource,runScopeChecks,runCapabilityGate,controller,checks,browserErrors,getSignal:()=>lastSignal,release:()=>{held?.();held=null;hold=false;}}});
