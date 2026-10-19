import {StrictMode} from 'react';
import {createRoot,type Root} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {generateSubApp,type GeneratedSubApp} from '../../../packages/codegen/src/pure';
import {ProcessStudio,type ProcessStudioProps} from '../ProcessStudio';
import {PROCESS_TEMPLATES,buildProcessPlan,emptyProcessDraft} from '../plan';
import type {ProcessDraft} from '../contracts';
import '../../studio/StudioShell.css';

type Receipt={artifactId:string;label:string};
interface Attempt {draft:ProcessDraft;key:string;signal:AbortSignal;generated:GeneratedSubApp;resolve:(receipt:Receipt)=>void;reject:(reason:unknown)=>void;delivered:boolean;sourceHash:string|null}
interface BrowserReport {kind:'mounted-development-fixture';passed:string[];attempts:number;sourceHashes:string[];limitations:string[]}
const host=document.getElementById('fixture-root')!;
let root:Root|null=null,active=true,scopeEpoch=0,appearance:'day'|'night'='day',available=true;
const attempts:Attempt[]=[];
let studioActions=0,connectionActions=0;
function assert(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
function onBuild(draft:ProcessDraft,key:string,signal:AbortSignal){
 const plan=buildProcessPlan(draft);assert(plan.status==='ready','Actual domain plan must be ready.');
 assert(plan.reviewKey===key,'Callback must receive exact domain review key.');
 const generated=generateSubApp(plan.spec);
 return new Promise<Receipt>((resolve,reject)=>{attempts.push({draft,key,signal,generated,resolve,reject,delivered:false,sourceHash:null});});
}
function render(){
 if(!root)root=createRoot(host);
 const props:ProcessStudioProps={active,scopeEpoch,projectId:'development-fixture',buildAvailable:available,buildUnavailableReason:'Development build is disabled.',onBuild,onOpenStudio:()=>{studioActions++;},onConnectionSettings:()=>{connectionActions++;}};
 flushSync(()=>root!.render(<StrictMode><div className="studio-shell" data-appearance={appearance}><ProcessStudio {...props}/></div></StrictMode>));
}
function reset(){if(root)flushSync(()=>root!.unmount());root=null;active=true;scopeEpoch=0;available=true;attempts.splice(0);studioActions=0;connectionActions=0;render();}
const tick=()=>new Promise<void>(resolve=>setTimeout(resolve,0));
function panel(){const element=host.querySelector<HTMLElement>('[aria-label="Process discovery workspace"]');assert(element,'Mounted workspace missing.');return element;}
function visibleButtons(base:ParentNode=panel()){return [...base.querySelectorAll<HTMLButtonElement>('button')].filter(element=>element.getClientRects().length&&!element.closest('[hidden],[inert]'));}
function button(text:string,base:ParentNode=panel()){const found=visibleButtons(base).find(element=>element.textContent?.trim()===text);assert(found,`Visible button missing: ${text}`);return found;}
function click(text:string,base:ParentNode=panel()){const element=button(text,base);assert(!element.disabled,`Button disabled: ${text}`);flushSync(()=>element.click());return element;}
function step(index:number){const element=panel().querySelectorAll<HTMLButtonElement>('.ps-steps button')[index];assert(element,'Step missing.');flushSync(()=>element.click());}
function field(label:string){const element=panel().querySelector<HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement>(`[aria-label="${label}"]`);assert(element&&element.getClientRects().length,`Visible field missing: ${label}`);return element;}
function fill(label:string,value:string){
 const element=field(label),prototype=element instanceof HTMLSelectElement?HTMLSelectElement.prototype:element instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
 const setter=Object.getOwnPropertyDescriptor(prototype,'value')?.set;assert(setter,'Native field setter missing.');
 flushSync(()=>{setter.call(element,value);element.dispatchEvent(new Event(element instanceof HTMLSelectElement?'change':'input',{bubbles:true}));});
}
function checkboxByText(text:string,base:ParentNode=panel()){
 const label=[...base.querySelectorAll<HTMLLabelElement>('label')].find(element=>element.textContent?.trim()===text);
 const input=label?.querySelector<HTMLInputElement>('input[type="checkbox"]');assert(input,'Checkbox missing: '+text);flushSync(()=>input.click());return input;
}
function modal(label:string){const element=host.querySelector<HTMLDialogElement>(`dialog[aria-label="${label}"]`);assert(element?.open&&element.matches(':modal'),'Actual native modal missing: '+label);return element;}
async function deliver(index=attempts.length-1){
 const attempt=attempts[index];assert(attempt&&!attempt.delivered,'No undelivered generation attempt.');
 const source=JSON.stringify(attempt.generated.files.map(file=>({path:file.path,kind:file.kind,contents:file.contents})));
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(source));
 const hash=[...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
 attempt.sourceHash=hash;attempt.delivered=true;attempt.resolve({artifactId:`development-pure-${hash}`,label:attempt.generated.plan.label});await tick();return hash;
}
function setupReady(){
 const expected=emptyProcessDraft();
 step(0);
 const facts={title:'Development process fixture',problem:'Manual review requests wait at the current handoff between teams.',outcome:'A human can inspect a request and file an independent review proposal.',users:'Preparers and independent human reviewers',systemOfRecord:'Existing contract-reference capability; no imported production records.'};
 for(const [label,key] of [['Process name','title'],['Where does work get stuck?','problem'],['What should change?','outcome'],['Who does this help?','users'],['System of record / current tools','systemOfRecord']] as const){fill(label,facts[key]);expected.brief[key]=facts[key];}
 fill('Data sensitivity','internal');expected.brief.dataSensitivity='internal';
 step(1);fill('V1 features','List only this app’s own proposals for human review.');fill('V1 acceptance criteria','A human can inspect and submit a proposal without self-approval.');fill('V2 backlog','Investigate broader source integration separately.');
 expected.brief.v1Features=['List only this app’s own proposals for human review.'];expected.brief.acceptanceCriteria=['A human can inspect and submit a proposal without self-approval.'];expected.brief.v2Features=['Investigate broader source integration separately.'];
 step(2);fill('Currency ISO code','EUR');expected.brief.currency='EUR';
 step(3);click('Choose template');const comparison=modal('Choose a design template');
 assert(comparison.querySelectorAll('.ps-template-comparison article').length===PROCESS_TEMPLATES.length,'Actual template metadata count differs.');
 for(const template of PROCESS_TEMPLATES)assert(comparison.textContent?.includes(template.boundary),'Template boundary omitted.');
 click('Use Operations queue',comparison);expected.brief.templateId='operations-queue';
 fill('Application ID','development-process');expected.choices.appId='development-process';fill('Navigation icon','Q');expected.choices.icon='Q';fill('Navigation section','Ops & insight');expected.choices.navSection='Ops & insight';
 checkboxByText('admin');expected.choices.visibleToRoles=['admin'];checkboxByText('write:inbox-proposal');expected.choices.consentedScopes=['write:inbox-proposal'];
 step(4);const exact=buildProcessPlan(expected);assert(exact.status==='ready','Actual expected domain draft refused.');
 assert(!button('Review exact PRD, template & scopes').disabled,'Ready review action disabled.');return {expected,plan:exact};
}
async function acknowledge(){
 click('Review exact PRD, template & scopes');await tick();const review=modal('Review exact draft');
 const checkbox=review.querySelector<HTMLInputElement>('.ps-review-check input');assert(checkbox,'Exact review checkbox missing.');flushSync(()=>checkbox.click());click('Return to explicit build',review);await tick();assert(!button('Build V1 draft').disabled,'Exact acknowledgment failed to arm explicit Build.');
}
/** Runs actual mounted React/native-dialog DOM, not SSR or a mocked domain API. */
export async function runProcessBrowserTests():Promise<BrowserReport>{
 reset();const passed:string[]=[];
 assert((field('Process name') as HTMLInputElement).value==='','Initial business name must be empty.');
 assert(field('Data sensitivity').value==='unanswered','Sensitivity must be an explicit unanswered choice.');assert(attempts.length===0,'Mount sent a request.');
 assert(button('Build V1 draft').disabled,'Initial Build must be disabled.');passed.push('empty initial facts, unanswered sensitivity, blocked build and no send');
 const {expected,plan}=setupReady();await tick();assert(attempts.length===0,'Questions or template selection sent a request.');
 click('Review exact PRD, template & scopes');await tick();let review=modal('Review exact draft');
 assert(review.querySelector('[aria-label="Generated PRD"]')?.textContent===plan.prd,'Displayed PRD is not the exact real domain PRD.');
 assert(review.textContent?.includes('Proposed · not created'),'Agent proposal boundary missing.');
 const controls=visibleButtons(review),first=controls[0]!,last=review.querySelector<HTMLElement>('.ps-review-check input')!;
 first.focus();const backward=new KeyboardEvent('keydown',{key:'Tab',shiftKey:true,bubbles:true,cancelable:true});first.dispatchEvent(backward);assert(backward.defaultPrevented&&document.activeElement===last,'Explicit Shift+Tab trap failed.');
 const forward=new KeyboardEvent('keydown',{key:'Tab',bubbles:true,cancelable:true});last.dispatchEvent(forward);assert(forward.defaultPrevented&&document.activeElement===first,'Explicit Tab trap failed.');
 click('Close',review);await tick();assert(document.activeElement===button('Review exact PRD, template & scopes'),'Exact opener focus not restored.');
 passed.push('StrictMode native modal, exact PRD, DOM-dispatched Tab wrapping and opener focus return');
 await acknowledge();assert(attempts.length===0,'Acknowledgment itself sent a request.');
 step(0);fill('Process name',expected.brief.title+' edited');fill('Process name',expected.brief.title);assert(button('Build V1 draft').disabled,'Edit→revert incorrectly restored review.');
 step(4);await acknowledge();const build=button('Build V1 draft');flushSync(()=>{build.click();build.click();});assert(Number(attempts.length)===1,'Duplicate explicit clicks sent more than one request.');
 assert(panel().textContent?.includes('Awaiting genuine draft generation'),'Pending status missing.');assert(!panel().querySelector('[role="progressbar"]'),'Fabricated progress bar appeared.');
 const firstAttempt=attempts[0]!;assert(JSON.stringify(firstAttempt.draft)===JSON.stringify(expected),'Callback snapshot differs from reviewed human choices.');
 click('Cancel generation');assert(firstAttempt.signal.aborted,'Cancel did not abort callback signal.');await deliver(0);
 assert(!panel().textContent?.includes('Draft accepted — not deployed'),'Cancelled late generation was accepted.');passed.push('explicit-only one-send build, exact cloned draft, genuine pending, abort and discarded late real generated bytes');
 step(4);await acknowledge();click('Build V1 draft');const editAttempt=attempts[1]!;step(0);fill('Process name',expected.brief.title+' changed while pending');fill('Process name',expected.brief.title);assert(editAttempt.signal.aborted,'Editing pending draft did not abort.');await deliver(1);assert(!panel().textContent?.includes('Draft accepted — not deployed'),'Edit→revert accepted stale output.');passed.push('pending edit→revert aborts and discards late output');
 step(4);await acknowledge();click('Build V1 draft');const hideAttempt=attempts[2]!;active=false;render();assert(panel().hidden,'Inactive retained workspace is not hidden.');assert(hideAttempt.signal.aborted,'Navigation hide did not abort.');active=true;render();step(0);assert(field('Process name').value===expected.brief.title,'Ordinary navigation discarded process facts.');await deliver(2);assert(button('Build V1 draft').disabled,'Hidden review was restored.');
 step(3);click('Choose template');await tick();modal('Choose a design template');active=false;render();assert(!host.querySelector('dialog[open]'),'Hide retained a private modal.');active=true;render();step(0);assert(field('Process name').value===expected.brief.title,'Modal close navigation lost facts.');passed.push('retained ordinary navigation, closed modal, revoked review and aborted hidden callback');
 step(4);await acknowledge();click('Build V1 draft');const scopeAttempt=attempts[3]!;scopeEpoch++;render();
 assert(panel().querySelector<HTMLInputElement>('[aria-label="Process name"]')?.value==='','New scope did not synchronously render empty facts.');assert(!panel().textContent?.includes(expected.brief.title),'Old-scope private title leaked in new rendered scope.');assert(scopeAttempt.signal.aborted,'Scope replacement did not abort old callback.');await deliver(3);assert(!panel().textContent?.includes('Draft accepted — not deployed'),'Old-scope output was accepted.');passed.push('synchronous scope replacement masks and clears private facts and rejects late callbacks');
 setupReady();await acknowledge();click('Build V1 draft');const acceptedHash=await deliver();assert(panel().textContent?.includes(`development-pure-${acceptedHash}`),'Actual returned artifact ID not shown.');assert(panel().textContent?.includes('Draft accepted — not deployed'),'Accepted pure-generated output mislabeled.');assert(studioActions===0&&connectionActions===0,'Acceptance navigated or changed connection implicitly.');passed.push('real pure-generated source hash acceptance without automatic navigation or deployment');
 step(0);fill('Process name','A replacement development fact');assert(!panel().textContent?.includes(acceptedHash),'Editing retained an obsolete acceptance receipt.');
 step(2);fill('Annual cases','1.5');assert(field('Annual cases').getAttribute('aria-invalid')==='true','Invalid ROI notation silently coerced.');fill('Annual cases','0');assert(field('Annual cases').getAttribute('aria-invalid')==='false','Explicit zero not admitted.');fill('Annual cases','');assert(panel().textContent?.includes('Unknown — no estimate'),'Blank ROI silently became zero.');passed.push('explicit nullable ROI, invalid integer refusal, zero and unknown separation');
 const report:BrowserReport={kind:'mounted-development-fixture',passed,attempts:attempts.length,sourceHashes:attempts.flatMap(attempt=>attempt.sourceHash?[attempt.sourceHash]:[]),limitations:['Injected parent callback seam with real pure codegen; not authenticated server, provider, host installation or execution.','Keyboard events in this function are DOM-dispatched, not trusted native CDP input. Use prepareProcessKeyboardProbe plus real Tab/Shift+Tab/Escape.','Responsive native pointer hit testing and screenshots are separate foreground browser checks.']};
 window.__processBrowserReport=report;return report;
}
/** Parent collector can use trusted keys after this fresh native-modal setup. */
export async function prepareProcessKeyboardProbe(){
 if(!active){active=true;render();}step(3);click('Choose template');await tick();const dialog=modal('Choose a design template');const controls=visibleButtons(dialog);assert(controls.length>1,'No modal controls.');const first=controls[0]!,last=controls[controls.length-1]!;first.focus();
 return {label:dialog.getAttribute('aria-label'),first:first.textContent,last:last.textContent,opener:'Choose template',width:innerWidth,height:innerHeight,rect:dialog.getBoundingClientRect().toJSON()};
}
export function processGeometryReport(){const workspace=panel(),dialog=host.querySelector<HTMLDialogElement>('dialog[open]');return {width:innerWidth,height:innerHeight,documentOverflow:document.documentElement.scrollWidth>innerWidth,workspace:workspace.getBoundingClientRect().toJSON(),modal:dialog?.getBoundingClientRect().toJSON()??null,focus:document.activeElement?.textContent?.slice(0,120),pending:attempts.filter(attempt=>!attempt.delivered).length};}

declare global {interface Window {runProcessBrowserTests:typeof runProcessBrowserTests;prepareProcessKeyboardProbe:typeof prepareProcessKeyboardProbe;processGeometryReport:typeof processGeometryReport;__processBrowserReport?:BrowserReport;__processBrowserError?:string;processFixture:{setActive:(value:boolean)=>void;rotateScope:()=>void;setBuildAvailable:(value:boolean)=>void;deliver:typeof deliver;reset:typeof reset}}}
window.runProcessBrowserTests=runProcessBrowserTests;window.prepareProcessKeyboardProbe=prepareProcessKeyboardProbe;window.processGeometryReport=processGeometryReport;
window.processFixture={setActive:value=>{active=value;render();},rotateScope:()=>{scopeEpoch++;render();},setBuildAvailable:value=>{available=value;render();},deliver,reset};
render();
document.getElementById('fixture-run')!.onclick=()=>{const report=document.getElementById('fixture-report')!;report.textContent='Running mounted development DOM tests…';void runProcessBrowserTests().then(result=>{report.textContent=JSON.stringify(result,null,2);}).catch(error=>{window.__processBrowserError=String(error);report.textContent=String(error);});};
document.getElementById('fixture-retain')!.onclick=()=>{active=!active;render();};document.getElementById('fixture-scope')!.onclick=()=>{scopeEpoch++;render();};document.getElementById('fixture-theme')!.onclick=()=>{appearance=appearance==='day'?'night':'day';render();};
document.getElementById('fixture-deliver')!.onclick=()=>{void deliver().catch(error=>{document.getElementById('fixture-report')!.textContent=String(error);});};document.getElementById('fixture-reject')!.onclick=()=>{const attempt=attempts.at(-1);if(attempt&&!attempt.delivered){attempt.delivered=true;attempt.reject(new Error('Development fixture rejection.'));}};
