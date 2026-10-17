// Explicit DEVELOPMENT harness. Imported by ai-builder-browser.html only; all DTOs come from real routes.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioApp} from '../StudioApp';
import {StudioController} from '../controller';
const token='development-only-nonsecret-ai-builder-sentinel',project='development-builder';
const workflowPrompt='Review incoming requests for legal.',subappPrompt='Show contract folders needing review, visible to legal and admin.';
const nativeFetch=window.fetch.bind(window);
const calls:Array<{url:string;method:string}>=[];
const fetcher:typeof fetch=(url,init)=>{calls.push({url:String(url),method:init?.method??'GET'});return nativeFetch(url,init);};
const controller=new StudioController(fetcher);
const host=document.getElementById('fixture')!;
createRoot(host).render(<StrictMode><StudioApp controller={controller} fetcher={fetcher}/></StrictMode>);
const pause=()=>new Promise(resolve=>setTimeout(resolve,25));
const checks:string[]=[];
function assert(value:unknown,label:string){if(!value)throw new Error(label);checks.push(label);}
function get<T extends Element>(selector:string){const element=host.querySelector<T>(selector);if(!element)throw new Error(`Missing ${selector}`);return element;}
function button(text:string){const element=[...host.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent===text);if(!element)throw new Error(`Missing button ${text}`);return element;}
async function input(node:HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement,value:string){const proto=node instanceof HTMLSelectElement?HTMLSelectElement.prototype:node instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value')!.set!.call(node,value);node.dispatchEvent(new Event(node instanceof HTMLSelectElement?'change':'input',{bubbles:true}));await pause();}
async function waitFor(test:()=>boolean,label:string){for(let i=0;i<240;i++){if(test())return;await pause();}throw new Error(`Timed out: ${label}`);}
async function configure(){button('Connection settings').click();await pause();await input(get<HTMLInputElement>('[aria-label="Operator token"]'),token);await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),project);button('Check connection & project skills').click();await waitFor(()=>[...get<HTMLSelectElement>('[aria-label="Model connection"]').options].some(option=>option.value==='local'&&!option.disabled),'connection reads');assert(get<HTMLSelectElement>('[aria-label="Model connection"]').value==='','No automatic configured-model selection');await input(get<HTMLSelectElement>('[aria-label="Model connection"]'),'local');}
async function submit(prompt:string){await input(get<HTMLTextAreaElement>('.studio-compose textarea'),prompt);button('Create draft').click();await waitFor(()=>controller.getState().phase!=='requesting','create response');await pause();}
async function approveReview(){const review=get<HTMLElement>('[aria-label="Skill send review"]');assert(!review.querySelector<HTMLInputElement>('input')!.checked,'Each exact-context send needs a fresh acknowledgment');review.querySelector<HTMLInputElement>('input')!.click();await pause();button('Resources').click();await pause();button('AI builder').click();await pause();assert(get<HTMLElement>('[aria-label="Skill send review"]')===review&&review.querySelector<HTMLInputElement>('input')!.checked,'Exact-context acknowledgment retained across normal navigation');button('Send reviewed context to model').click();await waitFor(()=>controller.getState().phase!=='requesting','reviewed response');await pause();}
function selectedArea(){return host.querySelector('[aria-current="page"]')?.textContent;}
function visibleFocus(){const focused=document.activeElement;return !focused||(!(focused instanceof HTMLElement)||!!focused.getClientRects().length&&!focused.closest('[hidden]'));}
export function viewportCheck(){const compose=get<HTMLElement>('.studio-compose').getBoundingClientRect();assert(document.documentElement.scrollWidth<=innerWidth,'No page-wide horizontal overflow');assert(get<HTMLElement>('.studio-builder-grid').getBoundingClientRect().right<=innerWidth,'Builder columns are not clipped by the shell');if(selectedArea()==='AI builder'){assert(compose.bottom<=innerHeight,'Composer remains reachable in the first viewport');if(get<HTMLElement>('.studio-builder-grid').dataset.home==='empty'){assert(get<HTMLElement>('.studio-command').getBoundingClientRect().top>=get<HTMLElement>('.studio-builder-grid').getBoundingClientRect().top,'The complete command surface is not clipped above the available grid');assert(get<HTMLElement>('.studio-chat-setup').getBoundingClientRect().bottom<=innerHeight,'Initial setup affordances stay inside the viewport');}}assert(visibleFocus(),'No focus left in a hidden control');if(selectedArea()==='Workflow builder'&&innerWidth>=1000&&innerHeight<650)assert(get<HTMLElement>('.wf-scroll').getBoundingClientRect().top<=330,'Short-screen chrome leaves a usable workflow canvas');return {width:innerWidth,height:innerHeight,pageWidth:document.documentElement.scrollWidth,composerBottom:compose.bottom,selectedArea:selectedArea()};}
export async function runAiBuilderBrowserChecks(){
 await pause();await pause();
 assert(calls.length===0,'StrictMode mount makes no model/authentication/network call');
 assert(button('Create draft').disabled,'Unconfigured draft request disabled with a visible reason');
 button('Governed intake workflow ↗').click();await pause();assert(calls.length===0,'Suggestion only prefills the composer');
 await configure();assert(calls.length===3,'Explicit connection check reads actual health, descriptors and project provenance only');
 const refs={workflow:get('.wf-editor'),workspace:get('.wf-workspace'),ide:get('.fd-wb')};
 await submit('Ask which deliverable should be created');assert(controller.getState().result?.status==='needs_input','Actual determination asks a structured clarifying question');
 await input(get<HTMLInputElement>('.studio-chat-review .studio-card input:not([type=checkbox])'),'workflow');button('Submit answers').click();await waitFor(()=>controller.getState().phase!=='requesting','clarification');await pause();
 assert(controller.getState().result?.status==='model-request-refused','Workflow skills require review before planning');
 assert(controller.getState().transcript.at(-2)?.text==='Answers\ntarget: workflow','Explicit answers preserved in conversation');
 let confirmations=0;let confirmAnswer=false;const originalConfirm=window.confirm;window.confirm=()=>{confirmations++;return confirmAnswer;};
 try{
  await approveReview();checkReceivedHandoff();assert(selectedArea()==='Workflow builder','Only accepted workflow target opens the actual graph builder');
  assert(confirmations===0,'Initial clean document needs no dirty confirmation');
  assert(host.querySelectorAll('.wf-node').length===4,'Real graph nodes received including unavoidable human gate');
  assert(host.querySelector('.wf-manifest')?.textContent?.includes('1 reusable wrapper'),'Real registry manifest reports declarative wrapper counts');
  assert(document.activeElement===get('[aria-label="Workflow editor area"]'),'Workflow handoff focuses the visible workspace');
  const graphEditor=get('.wf-editor');const workspace=refs.workspace;
  button('Save as new draft').click();await waitFor(()=>!!workspace.textContent?.includes('Current draft:'),'actual durable draft readback');
  const identity=workspace.textContent!.match(/Current draft:\s*([a-f0-9-]{36})/)?.[1];assert(!!identity,'Server save is read back with its actual identity');
  await input(get<HTMLInputElement>('[aria-label="Workflow name"]'),'Retained edited workflow');
  for(const area of ['Resources','Approvals','Sub-app IDE','AI builder','Workflow builder']){button(area).click();await pause();assert(get('.wf-editor')===graphEditor&&get('.wf-workspace')===workspace&&get('.fd-wb')===refs.ide,`Retained DOM across ${area}`);}
  assert(!host.querySelector('[aria-label="Received draft handoff"]'),'Ordinary navigation never replays a received handoff cue');
  assert(workspace.textContent?.includes(identity!)&&get<HTMLInputElement>('[aria-label="Workflow name"]').value==='Retained edited workflow','Saved identity and edited graph retained across all areas');
  button('Connection settings').click();await pause();assert(document.activeElement===get('[aria-label="Operator token"]'),'Connection settings from a builder focuses the disclosed real credential field');
  button('AI builder').click();await pause();await submit(workflowPrompt);await approveReview();
  assert(Number(confirmations)===1&&selectedArea()==='AI builder','Dirty handoff asks once and cancellation does not navigate');
  assert(!host.querySelector('[aria-label="Received draft handoff"]'),'Cancelled dirty replacement creates no opened-workspace handoff cue');
  assert(get('.wf-editor')===graphEditor&&workspace.textContent?.includes(identity!)&&get<HTMLInputElement>('[aria-label="Workflow name"]').value==='Retained edited workflow','Cancelled handoff preserves dirty graph and saved identity');
  assert(!!host.querySelector('.studio-artifact-receipt')?.textContent?.includes('pending handoff'),'Received workflow remains explicitly pending after cancellation');
  button('Resources').click();await pause();button('AI builder').click();await pause();assert(Number(confirmations)===1,'No queued handoff or StrictMode duplicate confirmation');
  confirmAnswer=true;button('Review / open workflow builder').click();await pause();await pause();assert(Number(confirmations)===2&&selectedArea()==='Workflow builder','Explicit pending-open performs one new guarded replacement');
  assert(!workspace.textContent?.includes(identity!),'New accepted document resets only the workspace identity');
  button('AI builder').click();await pause();await submit(subappPrompt);
  checkReceivedHandoff();assert(selectedArea()==='Sub-app IDE','Only proposed sub-app target opens the retained real IDE');
  assert(controller.workbench.getState().rounds.at(-1)!.candidate.files.length>4,'IDE receives actual generator source files');
  assert(get<HTMLElement>('.fd-tour').dataset.mode==='assembly','Accepted hidden-to-visible sub-app handoff starts its first real assembly');
  const receivedFiles=JSON.stringify(controller.workbench.getState().rounds.at(-1)!.candidate.files);
  assert([...host.querySelectorAll<HTMLElement>('.fd-module')].every(module=>getComputedStyle(module).transform==='none'),'Modular assembly retains stable interactive source-piece geometry');
  get<HTMLButtonElement>('[aria-label="Skip received-artifact reveal"]').click();await pause();
  assert(get<HTMLElement>('.fd-tour').dataset.mode==='ready','Sub-app Skip immediately exposes its complete received design');
  assert(JSON.stringify(controller.workbench.getState().rounds.at(-1)!.candidate.files)===receivedFiles,'Sub-app assembly and Skip do not change received source bytes');
  assert(get('.fd-wb')===refs.ide,'Sub-app IDE was not remounted on artifact arrival');
  assert(get('.fd-chat-slot').hasAttribute('hidden')&&get('.fd-chat-slot').hasAttribute('inert'),'Internal IDE composer retained but hidden and inert');
  assert(document.activeElement===get('[aria-label="Sub-app IDE area"]'),'Sub-app handoff focuses its visible workspace');
  const round=controller.workbench.getState().rounds.at(-1)!;const file=round.candidate.files.find(item=>item.kind==='web-module')!;controller.workbench.revealFile(file.path);controller.workbench.editFile(file.path,file.contents+'\n// retained edit');
  for(const area of ['Resources','AI builder','Workflow builder','Sub-app IDE']){button(area).click();await pause();}
  assert(controller.workbench.getState().drafts.get(file.path)?.buffer.endsWith('// retained edit'),'Sub-app file drafts retained through navigation');
  button('AI builder').click();await pause();await submit('Refuse invalid route');assert(selectedArea()==='AI builder'&&controller.getState().result?.status==='invalid_determination','Invalid route never opens or overwrites a builder');
  const before=calls.filter(call=>call.url.endsWith('/create')).length;
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'Hold routed draft for cancellation');button('Create draft').click();button('Create draft').click();await waitFor(()=>controller.getState().phase==='requesting','held request');await pause();
  assert(calls.filter(call=>call.url.endsWith('/create')).length===before+1,'Repeated submit causes exactly one actual HTTP request');
  assert(host.textContent?.includes('Requesting routed draft'),'Pending request has honest indeterminate state');
  button('Cancel request').click();await nativeFetch('/__development/release',{method:'POST'});await pause();await pause();assert(controller.getState().phase==='cancelled'&&selectedArea()==='AI builder','Cancellation rejects late routed results');
  await input(get<HTMLTextAreaElement>('.studio-compose textarea'),'Hold routed draft while context changes');button('Create draft').click();await pause();
  button('Connection settings').click();await pause();await input(get<HTMLInputElement>('input[placeholder="For project skills and page suggestions"]'),'changed-development-project');await nativeFetch('/__development/release',{method:'POST'});await pause();await pause();
  assert(controller.getState().transcript.length===0&&controller.workbench.getState().rounds.length===0,'Context change clears old transcript and private IDE source before late results');
  assert(!get('.fd-wb').textContent?.includes(round.candidate.manifest.label),'Context change removes prior generated source from the retained IDE DOM');
  assert(get<HTMLTextAreaElement>('.studio-compose textarea').value==='Hold routed draft while context changes','Unsent composer text is preserved across scope invalidation');
  assert(button('Create draft').disabled&&selectedArea()==='AI builder','Context change masks stale model descriptors and blocks send');
  const currentCalls=calls.length;for(const area of ['Resources','Sub-app IDE','Workflow builder','AI builder']){button(area).click();await pause();}assert(calls.length===currentCalls,'Normal navigation never automatically calls a model or resource');
  assert(visibleFocus(),'All transitions end with visible focus');
  return {developmentOnly:true,checks:[...checks],createRequests:calls.filter(call=>call.url.endsWith('/create')).length,requests:calls.length,liveProvider:false,executionOrDeployment:false};
 }finally{window.confirm=originalConfirm;}
}
export async function showWorkflow(){await configure();await submit(workflowPrompt);await approveReview();return viewportCheck();}
export async function showSubapp(){await configure();await submit(subappPrompt);return viewportCheck();}
export async function showConversation(){await configure();await submit('Ask which deliverable should be created');const label=get<HTMLElement>('.studio-chat-review label'),scroller=get<HTMLElement>('.studio-chat-scroll');assert(label.getBoundingClientRect().top>=scroller.getBoundingClientRect().top,'Clarifying question stays visible above its answer field');return viewportCheck();}
export async function checkManualScroll(){await showConversation();const scroller=get<HTMLElement>('.studio-chat-scroll');for(let turn=0;turn<3&&scroller.scrollHeight-scroller.clientHeight<144;turn++)await submit('Ask which deliverable should be created again');assert(scroller.scrollHeight-scroller.clientHeight>=144,'Manual-scroll regression first establishes a genuinely scrollable conversation beyond its near-end threshold');scroller.scrollTop=0;scroller.dispatchEvent(new Event('scroll'));await pause();await submit('Ask which deliverable should be created again');assert(scroller.scrollTop===0,'New routed turn does not steal a manually scrolled conversation');return {checks:[...checks],scrollTop:scroller.scrollTop,turnCount:controller.getState().transcript.length};}
export function checkReceivedHandoff(){
 const cue=get<HTMLElement>('[aria-label="Received draft handoff"]');
 assert(cue.dataset.requestId===controller.getState().acceptedRequestId,'Handoff cue is bound to the actual accepted request');
 assert(getComputedStyle(cue).transform==='none','Handoff text and dismiss hitbox stay stationary during the received cue');
 if(matchMedia('(prefers-reduced-motion:reduce)').matches||get<HTMLElement>('.studio-shell').dataset.motion==='off')assert(getComputedStyle(get('.studio-handoff-path i'),'::after').opacity==='0','Motion-off leaves the semantic route arrow unobscured by its decorative light trail');
 assert([...host.querySelectorAll<HTMLElement>('.studio-technical-area,.studio-compose,.studio-chat-turn')].every(node=>getComputedStyle(node).transform==='none'),'Chat turns and live workspace/composer hitboxes never translate for handoff');
 assert(cue.textContent?.includes('received')&&cue.textContent?.includes('not deployed'),'Handoff describes received drafts, not model progress or deployment');
 const result=controller.getState().result;
 if(result?.status==='workflow-proposed')assert(cue.dataset.target==='editor'&&cue.textContent?.includes(`${result.graph?.nodes.length} blocks`),'Workflow handoff counts actual received graph blocks');
 else if(result?.status==='subapp-result'&&result.outcome.status==='proposed')assert(cue.dataset.target==='ide'&&cue.textContent?.includes(`${result.outcome.generated.files.filter(file=>file.kind!=='standalone').length} source files`),'Sub-app handoff counts actual generator files');
 else throw new Error('No accepted typed result for handoff');
 return {requestId:cue.dataset.requestId,target:cue.dataset.target,text:cue.textContent};
}
export async function checkConversationToggle(){
 const chat=get<HTMLElement>('[aria-label="Draft builder conversation"]'),composer=get<HTMLTextAreaElement>('.studio-compose textarea');
 const editor=get('.wf-editor'),workspace=get('.wf-workspace'),ide=get('.fd-wb');
 const before=calls.length,prior=composer.value;
 button('Hide conversation').focus();button('Hide conversation').click();await pause();
 assert(chat.hidden&&chat.hasAttribute('inert'),'Collapsed conversation is mounted, hidden and keyboard-excluded');
 assert(document.activeElement===get('[aria-label="Workflow editor area"]'),'Hiding conversation returns focus to the active workspace');
 assert(get('.wf-editor')===editor&&get('.wf-workspace')===workspace&&get('.fd-wb')===ide,'Conversation hide preserves all builder and workspace DOM identities');
 button('Show conversation').click();await pause();
 assert(!chat.hidden&&!chat.hasAttribute('inert')&&get('.studio-compose textarea')===composer&&composer.value===prior,'Conversation show restores the same unsent composer');
 assert(document.activeElement===composer,'Conversation show focuses the retained composer');
 assert(calls.length===before,'Conversation hide and show make no network request');
 button('Hide conversation').click();await pause();button('Connection settings').click();await pause();
 assert(document.activeElement===get('[aria-label="Operator token"]'),'Connection focus wins over a prior composer-show intent from a collapsed builder');
 button('Workflow builder').click();await pause();
 return {checks:[...checks],composer:composer.value};
}
export async function checkAppearanceRetention(){
 const before=calls.length,state=controller.getState(),rounds=controller.workbench.getState().rounds;
 const composer=get<HTMLTextAreaElement>('.studio-compose textarea'),prior=composer.value;
 const tokenField=get<HTMLInputElement>('[aria-label="Operator token"]'),priorToken=tokenField.value,selection=get<HTMLSelectElement>('[aria-label="Model connection"]').value;
 const refs={editor:get('.wf-editor'),workspace:get('.wf-workspace'),ide:get('.fd-wb'),voice:get('.fd-voice-controls')};
 const bodyStyle=getComputedStyle(document.body).backgroundColor,htmlAppearance=document.documentElement.getAttribute('data-theme');
 const storageLengths=[localStorage.length,sessionStorage.length];
 button('Enable voice').click();await pause();
 assert(get('.fd-voice-toggle').getAttribute('aria-pressed')==='true','Explicit voice opt-in is enabled without microphone or test speech');
 const appearance=get<HTMLSelectElement>('[aria-label="Studio appearance"]');
 for(const mode of ['night','day','inherit']){
  get<HTMLDetailsElement>('.studio-tools').open=true;await input(appearance,mode);
  assert(get<HTMLElement>('.studio-shell').dataset.appearance===mode,`Session appearance switches to ${mode}`);
  assert(controller.getState()===state&&controller.workbench.getState().rounds===rounds,`Appearance ${mode} preserves private conversation/candidate state`);
  assert(get('.wf-editor')===refs.editor&&get('.wf-workspace')===refs.workspace&&get('.fd-wb')===refs.ide&&get('.fd-voice-controls')===refs.voice,`Appearance ${mode} retains editor/workspace/voice DOM`);
  assert(composer.value===prior&&tokenField.value===priorToken&&get<HTMLSelectElement>('[aria-label="Model connection"]').value===selection,`Appearance ${mode} keeps composer and exact destination/scope`);
  assert(get('.fd-voice-toggle').getAttribute('aria-pressed')==='true',`Appearance ${mode} does not revoke voice consent`);
  assert(getComputedStyle(document.body).backgroundColor===bodyStyle&&document.documentElement.getAttribute('data-theme')===htmlAppearance,`Appearance ${mode} never repaints the host`);
  if(mode==='night'){
   assert(getComputedStyle(refs.editor).getPropertyValue('--wf-panel').trim()==='#17242f','Night shared tokens reach the actual workflow editor');
   assert(getComputedStyle(refs.ide).getPropertyValue('--wb-surface').trim()==='#17242f','Night shared tokens reach the retained sub-app IDE');
   assert(getComputedStyle(get('.studio-voice-dialog')).backgroundColor==='rgb(23, 36, 47)','Night shared tokens reach voice settings');
  }
 }
 get<HTMLDetailsElement>('.studio-tools').open=false;button('Turn voice off').click();await pause();
 assert(calls.length===before,'Appearance changes make no network/provider request');
 assert(localStorage.length===storageLengths[0]&&sessionStorage.length===storageLengths[1],'Appearance is memory-only, with no browser storage writes');
 return {checks:[...checks],requests:before};
}
export async function checkMobileDiscuss(){
 assert(innerWidth<=850,'Mobile discuss check uses a compact viewport');
 const chat=get<HTMLElement>('[aria-label="Draft builder conversation"]'),composer=get<HTMLTextAreaElement>('.studio-compose textarea'),workspace=get('.wf-editor'),ide=get('.fd-wb');
 const prior=composer.value,before=calls.length,area=selectedArea();
 assert(chat.hidden&&chat.hasAttribute('inert'),'Mobile workspace explicitly excludes hidden conversation from keyboard access');
 const discuss=[...host.querySelectorAll<HTMLButtonElement>('.studio-workspace-heading button')].find(node=>node.textContent==='Discuss draft'&&node.getClientRects().length)!;discuss.click();await pause();
 assert(selectedArea()==='AI builder'&&!chat.hidden&&document.activeElement===composer,'Mobile Discuss returns to the same visible composer with focus');
 assert(get('.studio-compose textarea')===composer&&composer.value===prior,'Mobile back-and-forth preserves composer text and DOM');
 button(area!).click();await pause();
 assert(get('.wf-editor')===workspace&&get('.fd-wb')===ide,'Mobile return preserves both actual builder DOM identities');
 assert(calls.length===before,'Mobile Discuss never sends or regenerates');
 return viewportCheck();
}
export async function checkToolFocus(){
 const before=calls.length;
 for(const label of ['Resources','Approvals']){
  get<HTMLDetailsElement>('.studio-tools').open=true;button(label).focus();button(label).click();await pause();
  assert(!get<HTMLDetailsElement>('.studio-tools').open&&document.activeElement===get(`[aria-label="${label} area"]`),`${label} tools action closes its menu and focuses its retained visible area`);
 }
 button('AI builder').click();await pause();assert(calls.length===before,'Tools navigation performs no automatic request');
 return {checks:[...checks]};
}
/** Real composed route regression: no isolated editor sizing or clipped-overflow pass. */
export async function checkSubappSourceViewport(){
 const start=checks.length;
 await showSubapp();
 const workbench=get<HTMLElement>('.fd-wb'),tour=get<HTMLElement>('.fd-tour');
 const round=controller.workbench.getState().rounds.at(-1)!;
 const received=JSON.stringify(round.candidate.files);
 const source=get<HTMLElement>('.fd-source-slot:not([hidden]) .fd-source');
 const samples:Array<{mode:string;source:ReturnType<typeof rectangle>;viewport:ReturnType<typeof rectangle>;footer:ReturnType<typeof rectangle>}> = [];
 const arrivals=new Set<string>();
 const moduleIds=[...host.querySelectorAll<HTMLElement>('.fd-module')].map(node=>node.dataset.module);
 assert(JSON.stringify([...host.querySelectorAll<HTMLElement>('.fd-receipt-piece')].map(node=>node.dataset.module))===JSON.stringify(moduleIds),'Compact assembly uses every real full-inspection module group');
 function rectangle(node:Element){const r=node.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};}
 function measure(){
  const viewport=source.querySelector<HTMLElement>('.fd-editor,.fd-code')!;
  const sample={mode:tour.dataset.mode??'',source:rectangle(source),viewport:rectangle(viewport),footer:rectangle(get('.fd-workspace-status'))};samples.push(sample);
  assert(sample.viewport.height>=160,`Source is readable at ${innerWidth}x${innerHeight} during ${sample.mode}: ${sample.viewport.height.toFixed(2)}px >= 160px`);
  assert(sample.viewport.y>=workbench.getBoundingClientRect().top&&sample.viewport.bottom<=sample.footer.y+1&&sample.viewport.right<=workbench.getBoundingClientRect().right,`Source is genuinely contained above the workspace footer during ${sample.mode}`);
  const cue=host.querySelector<HTMLElement>('.studio-received-handoff');
  if(cue){const r=cue.getBoundingClientRect();assert(r.right<=sample.viewport.x||r.x>=sample.viewport.right||r.bottom<=sample.viewport.y||r.y>=sample.viewport.bottom,'Received handoff never covers the usable source viewport');}
  const arriving=host.querySelector<HTMLElement>('.fd-receipt-piece[data-module-state=arriving]');
  if(arriving){arrivals.add(arriving.dataset.module!);const r=arriving.getBoundingClientRect(),rail=get('.fd-tour__receipt').getBoundingClientRect();assert(r.x>=rail.x-1&&r.right<=rail.right+1,'Every actual arriving module is visible inside the compact receipt rail');assert(getComputedStyle(arriving).transform==='none'&&getComputedStyle(arriving.firstElementChild!).pointerEvents==='none','Only decorative real-group faceplates move, not interactive module or editor geometry');}
  assert(parseFloat(getComputedStyle(viewport).fontSize)>=12,'Source stays readable without shrinking its font');
  assert(workbench.dataset.sourceFocus==='false','Usable default source does not force Focus');
  return sample;
 }
 const first=measure();
 const motion=matchMedia('(prefers-reduced-motion: reduce)').matches||get<HTMLElement>('.studio-shell').dataset.motion==='off';
 assert(tour.dataset.mode===(motion?'ready':'assembly'),'Real hidden-to-visible route starts assembly, or settles immediately with motion disabled');
 // Synthetic mode choice does not pause the clock: prove editing geometry survives automatic reveal.
 const edit=[...source.querySelectorAll<HTMLButtonElement>('button')].find(node=>node.textContent==='Edit')!;edit.click();await pause();
 const editor=get<HTMLTextAreaElement>('.fd-source-slot:not([hidden]) .fd-editor');editor.setSelectionRange(5,13);
 const editing=measure();
 for(let i=0;i<170&&tour.dataset.mode==='assembly';i++){await pause();measure();}
 assert(tour.dataset.mode==='ready','Automatic real-group assembly completes without delaying source editing');
 const ready=measure();
 await input(editor,editor.value+'\n// composed retained editing regression');
 const dirty=measure();
 assert(Math.abs(ready.viewport.y-dirty.viewport.y)<1&&Math.abs(ready.viewport.height-dirty.viewport.height)<1,'Typing and unsaved source actions never resize the editing viewport');
 editor.setSelectionRange(5,13);
 source.querySelector<HTMLButtonElement>('.fd-save')!.click();await pause();
 const saved=measure();
 assert(Math.abs(ready.viewport.y-saved.viewport.y)<1&&Math.abs(ready.viewport.height-saved.viewport.height)<1,'Saving source keeps the same readable editing viewport');
 assert(Math.abs(first.viewport.y-ready.viewport.y)<1&&Math.abs(first.viewport.height-ready.viewport.height)<1,'Automatic assembly never shifts or resizes the default source viewport');
 assert(Math.abs(editing.viewport.y-ready.viewport.y)<1&&Math.abs(editing.viewport.height-ready.viewport.height)<1,'Read and Edit retain the same usable viewport through assembly');
 assert(get('.fd-source-slot:not([hidden]) .fd-editor')===editor&&editor.selectionStart===5&&editor.selectionEnd===13,'Automatic reveal retains textarea identity and selection');
 assert(JSON.stringify(controller.workbench.getState().rounds.at(-1)!.candidate.files)===received,'Presentation preserves exact real generated source bytes');
 assert(get('.fd-workspace-limit').textContent==='Page/PANELS only · other pages source-only','Source-only reader limitation remains visible');
 assert(motion||arrivals.size===moduleIds.length,'Every real module group visibly assembles without gating editing');
 await waitFor(()=>!host.querySelector('.studio-received-handoff'),'automatic receipt timeout');
 const settled=measure();
 assert(Math.abs(ready.viewport.y-settled.viewport.y)<1&&Math.abs(ready.viewport.height-settled.viewport.height)<1,'Automatic handoff dismissal never shifts the source viewport');
 return {developmentOnly:true,liveProvider:false,route:location.href,checks:[...new Set(checks.slice(start))],samples,arrivals:[...arrivals],moduleIds,workbench:rectangle(workbench),artifactCount:round.candidate.files.length};
}
export async function checkSubappInspectionRetention(){
 const start=checks.length,before=calls.length,store=controller.workbench;
 const path=store.getState().selectedPath!;
 const editor=get<HTMLTextAreaElement>('.fd-source-slot:not([hidden]) .fd-editor');
 const sourceBounds=editor.getBoundingClientRect(),value=editor.value;
 editor.setSelectionRange(5,13);
 const toggle=get<HTMLButtonElement>('[aria-label="Show received modules"]');toggle.click();await pause();
 const presentation=get<HTMLElement>('.fd-tour__presentation'),bounds=presentation.getBoundingClientRect(),root=get('.fd-wb').getBoundingClientRect();
 assert(!presentation.hidden&&bounds.height>=100&&bounds.bottom<=root.bottom&&bounds.x>=root.x&&bounds.right<=root.right,'Explicit full modules remain inspectable inside the real composed workspace');
 assert(editor.getBoundingClientRect().y===sourceBounds.y&&editor.getBoundingClientRect().height===sourceBounds.height,'Full module disclosure overlays inspection without resizing retained source');
 const modules=[...host.querySelectorAll<HTMLButtonElement>('.fd-module')];
 assert(modules.length===host.querySelectorAll('.fd-receipt-piece').length&&modules.every(node=>!!node.title&&node.getAttribute('aria-label')?.includes('received artifact')),'Full real module references and truthful counts remain accessible');
 modules.at(-1)!.click();await pause();
 assert(store.getState().selectedPath===modules.at(-1)!.title,'An inspected real module opens its authoritative source');
 get<HTMLButtonElement>('[aria-label="Hide received modules"]').click();await pause();store.revealFile(path);await pause();
 assert(get('.fd-source-slot:not([hidden]) .fd-editor')===editor&&editor.value===value&&editor.selectionStart===5&&editor.selectionEnd===13,'Module source references retain original working textarea and selection');
 get<HTMLButtonElement>('[aria-label="Open architecture walkthrough"]').click();await pause();
 assert(!get<HTMLElement>('.fd-tour__details').hidden,'Full walkthrough remains explicitly available');
 for(let i=0;i<2;i++){get<HTMLButtonElement>('[aria-label="Next walkthrough step"]').click();await pause();}
 const frame=get<HTMLIFrameElement>('.fd-preview__frame');
 assert(frame.getAttribute('sandbox')==='allow-same-origin'&&frame.getAttribute('allow')==="microphone 'none'; camera 'none'; on-device-speech-recognition 'none'"&&frame.contentDocument?.URL==='about:blank'&&frame.contentDocument?.querySelectorAll('script').length===0,'Composed walkthrough retains exact scriptless non-recording preview');
 get<HTMLButtonElement>('[aria-label="Close architecture walkthrough"]').click();await pause();store.revealFile(path);await pause();
 assert(get('.fd-source-slot:not([hidden]) .fd-editor')===editor&&get('.fd-preview__frame')===frame&&editor.value===value&&editor.selectionStart===5&&editor.selectionEnd===13,'Walkthrough retains source, selection, buffer and original iframe');
 const focus=get<HTMLButtonElement>('[aria-label="Focus source workspace"]');focus.click();await pause();
 assert(get('.fd-tour-slot').hasAttribute('hidden')&&get('.fd-tour-slot').hasAttribute('inert')&&get('.fd-explorer').hasAttribute('hidden'),'Focus retains and keyboard-excludes presentation and explorer');
 focus.click();await pause();
 assert(get('.fd-source-slot:not([hidden]) .fd-editor')===editor&&editor.selectionStart===5&&editor.selectionEnd===13&&Math.abs(editor.getBoundingClientRect().height-sourceBounds.height)<1,'Exiting Focus restores stable source geometry and retained selection');
 for(const area of ['AI builder','Workflow builder','Sub-app IDE']){button(area).click();await pause();}
 assert(get('.fd-source-slot:not([hidden]) .fd-editor')===editor&&get('.fd-preview__frame')===frame&&editor.value===value&&editor.selectionStart===5&&editor.selectionEnd===13,'Composed normal navigation retains editable private source and preview DOM');
 assert(calls.length===before,'Module inspection, walkthrough, Focus and navigation make no request');
 return {developmentOnly:true,route:location.href,checks:checks.slice(start),moduleCount:modules.length,sourceHeight:editor.getBoundingClientRect().height,requests:before};
}
Object.assign(window,{__aiBuilder:{controller,calls,checks,run:runAiBuilderBrowserChecks,showWorkflow,showSubapp,showConversation,checkManualScroll,viewportCheck,checkReceivedHandoff,checkConversationToggle,checkAppearanceRetention,checkMobileDiscuss,checkToolFocus,checkSubappSourceViewport,checkSubappInspectionRetention}});
