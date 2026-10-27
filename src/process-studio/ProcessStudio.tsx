import {useId,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {NAV_SECTIONS,WORKSPACE_ROLES,type CapabilityScope,type WorkspaceRole} from '../../packages/codegen/src/spec-contract';
import type {ProcessDraft,ProcessPlan,ProcessTemplate} from './contracts';
import {PROCESS_TEMPLATES,emptyProcessDraft,buildProcessPlan} from './plan';
import {ROI_ASSUMPTION_KEYS,assessProcessRoi} from './roi';
import './ProcessStudio.css';
import {RoiEvidenceSources} from './SourceEvidencePanel';

export type ProcessBuild=(draft:ProcessDraft,reviewKey:string,signal:AbortSignal)=>Promise<{artifactId:string;label:string}>;
export interface ProcessStudioProps {active:boolean;scopeEpoch:number;projectId:string;buildAvailable:boolean;buildUnavailableReason:string;onBuild:ProcessBuild;onOpenStudio:()=>void;onConnectionSettings:()=>void;onOpenGeneratedSource?:(artifactId:string)=>void}
interface ReviewState {revision:number;reviewedKey:string|null;reviewedRevision:number;pending:boolean;receipt:{artifactId:string;label:string;reviewKey:string}|null;message:string;error:boolean}
/** Session-only exact-context acknowledgment; not authorization or a durable receipt. */
export class ProcessReviewGate {
 private state:ReviewState={revision:0,reviewedKey:null,reviewedRevision:-1,pending:false,receipt:null,message:'',error:false};
 private listeners=new Set<()=>void>();
 private abort:AbortController|null=null;
 getSnapshot=()=>this.state;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private update(patch:Partial<ReviewState>){this.state={...this.state,...patch};for(const listener of this.listeners)listener();}
 edit(){this.abort?.abort();this.abort=null;this.update({revision:this.state.revision+1,reviewedKey:null,reviewedRevision:-1,pending:false,receipt:null,message:'',error:false});}
 review(key:string,checked:boolean){if(this.state.pending)return;this.update({reviewedKey:checked?key:null,reviewedRevision:checked?this.state.revision:-1});}
 isReviewed(key:string){return this.state.reviewedKey===key&&this.state.reviewedRevision===this.state.revision;}
 cancel(message='Request cancelled. No draft accepted here; work already started may still finish.'){
  this.abort?.abort();this.abort=null;this.update({pending:false,reviewedKey:null,reviewedRevision:-1,message:this.state.pending?message:'',error:false});
 }
 async run(draft:ProcessDraft,key:string,build:ProcessBuild,current:()=>boolean){
  if(this.state.pending||!this.isReviewed(key)||!current())return;
  const snapshot=structuredClone(draft),revision=this.state.revision,abort=new AbortController();this.abort=abort;
  this.update({pending:true,reviewedKey:null,reviewedRevision:-1,receipt:null,message:'',error:false});
  const valid=()=>this.abort===abort&&!abort.signal.aborted&&this.state.revision===revision&&current();
  try{
   const result=await build(snapshot,key,abort.signal);
   if(!valid())return;
   if(!result||typeof result.artifactId!=='string'||!result.artifactId||typeof result.label!=='string'||!result.label)throw new Error('Invalid receipt');
   this.update({receipt:{artifactId:result.artifactId,label:result.label,reviewKey:key},message:'Draft accepted — not deployed.'});
  }catch{if(valid())this.update({message:'Draft acceptance not confirmed. Review the current draft and connection before trying again. No automatic retry.',error:true});}
  finally{if(this.abort===abort){this.abort=null;this.update({pending:false});}}
 }
}

type RoiKey=typeof ROI_ASSUMPTION_KEYS[number];
/** Deliberately no coercion of decimals, exponent notation or whitespace. */
export function parseRoiIntegerInput(text:string,key:RoiKey):number|null|'invalid'{
 if(text==='')return null;
 if(!/^\d+$/.test(text))return 'invalid';
 const number=Number(text);
 if(!Number.isSafeInteger(number))return 'invalid';
 const input:Record<string,number|null>=Object.fromEntries(ROI_ASSUMPTION_KEYS.map(name=>[name,null]));input[key]=number;
 return assessProcessRoi(input).status==='invalid'?'invalid':number;
}
/** null lets normal traversal continue; -1 traps an empty modal itself. */
export function dialogFocusTarget(count:number,index:number,shift:boolean):number|null{
 if(count===0)return -1;
 if(index<0||(shift?index===0:index===count-1))return shift?count-1:0;
 return null;
}
const ROI_FIELDS:ReadonlyArray<{key:RoiKey;label:string;hint:string}>=[
 {key:'annualVolume',label:'Annual cases',hint:'Whole cases / year; maximum 1,000,000,000.'},
 {key:'baselineSeconds',label:'Current time per case',hint:'Whole seconds / case; maximum 31,536,000.'},
 {key:'targetSeconds',label:'Target time per case',hint:'Whole seconds / case; a longer target can produce negative capacity.'},
 {key:'adoptionBasisPoints',label:'Expected adoption',hint:'Basis points: 100 = 1%; 10,000 = 100%.'},
 {key:'loadedHourlyCostCents',label:'Loaded hourly cost',hint:'Currency hundredths / hour; 10,000 = 100.00.'},
 {key:'cashRealizationBasisPoints',label:'Capacity realized as cash',hint:'Basis points: 0 means capacity only; 10,000 = 100%.'},
 {key:'annualRecurringCostCents',label:'Annual recurring cost',hint:'Currency hundredths / year. Zero must be entered explicitly.'},
 {key:'initialCostCents',label:'Initial implementation cost',hint:'Currency hundredths. Zero must be entered explicitly.'},
];
const STEPS=['Process facts','V1 & acceptance','ROI assumptions','Template & access','Review & build'] as const;

/** A keyed child is the synchronous privacy mask: old-scope content never renders. */
export function ProcessStudio(props:ProcessStudioProps){
 const current=useRef(props);current.current=props;
 const scopeIsCurrent=()=>current.current.scopeEpoch===props.scopeEpoch&&current.current.projectId===props.projectId&&current.current.active;
 return <ProcessWorkspace key={JSON.stringify([props.scopeEpoch,props.projectId])} {...props} scopeIsCurrent={scopeIsCurrent}/>;
}

function ProcessWorkspace(props:ProcessStudioProps&{scopeIsCurrent:()=>boolean}){
 const [draft,setDraft]=useState(emptyProcessDraft),[gate]=useState(()=>new ProcessReviewGate());
 const state=useSyncExternalStore(gate.subscribe,gate.getSnapshot,gate.getSnapshot);
 const [step,setStep]=useState(0),[modal,setModal]=useState<'template'|'review'|null>(null);
 const [roiRaw,setRoiRaw]=useState<Record<string,string>>({});
 const live=useRef(props);live.current=props;
 const mounted=useRef(false),opener=useRef<HTMLElement|null>(null),heading=useRef<HTMLHeadingElement>(null);
 const prefix=useId();
 const result=useMemo(()=>buildProcessPlan(draft),[draft]);
 const roi=useMemo(()=>assessProcessRoi(draft.brief.roi),[draft.brief.roi]);
 const invalidRoi=ROI_ASSUMPTION_KEYS.some(key=>parseRoiIntegerInput(roiRaw[key]??'',key)==='invalid');
 const plan=result.status==='ready'&&!invalidRoi?result:null;
 const template=PROCESS_TEMPLATES.find(item=>item.id===draft.brief.templateId);
 const reviewed=!!plan&&gate.isReviewed(plan.reviewKey);
 useLayoutEffect(()=>{mounted.current=true;return()=>{mounted.current=false;gate.cancel();};},[gate]);
 useLayoutEffect(()=>{if(!props.active){gate.cancel();setModal(null);}},[props.active,gate]);
 useLayoutEffect(()=>{
  const leave=()=>{gate.cancel();setModal(null);};
  const visibility=()=>{if(document.hidden)leave();};
  window.addEventListener('pagehide',leave);document.addEventListener('visibilitychange',visibility);
  return()=>{window.removeEventListener('pagehide',leave);document.removeEventListener('visibilitychange',visibility);};
 },[gate]);
 function edit(next:ProcessDraft){if(!live.current.scopeIsCurrent())return;gate.edit();setDraft(next);}
 function brief<K extends keyof ProcessDraft['brief']>(key:K,value:ProcessDraft['brief'][K]){edit({...draft,brief:{...draft.brief,[key]:value}});}
 function choice<K extends keyof ProcessDraft['choices']>(key:K,value:ProcessDraft['choices'][K]){edit({...draft,choices:{...draft.choices,[key]:value}});}
 function navigate(next:number){if(!live.current.scopeIsCurrent())return;setStep(next);heading.current?.focus({preventScroll:true});}
 function open(kind:'template'|'review',element:HTMLElement){if(!live.current.scopeIsCurrent()||state.pending)return;opener.current=element;setModal(kind);}
 function build(){
  if(!mounted.current||!live.current.scopeIsCurrent()||!live.current.buildAvailable||invalidRoi)return;
  const exact=buildProcessPlan(draft);if(exact.status!=='ready'||!gate.isReviewed(exact.reviewKey))return;
  const callback=live.current.onBuild,scope=live.current.scopeEpoch,project=live.current.projectId;
  void gate.run(draft,exact.reviewKey,callback,()=>mounted.current&&live.current.scopeIsCurrent()&&live.current.buildAvailable&&live.current.scopeEpoch===scope&&live.current.projectId===project);
 }
 function toggleRole(role:WorkspaceRole){choice('visibleToRoles',draft.choices.visibleToRoles.includes(role)?draft.choices.visibleToRoles.filter(item=>item!==role):[...draft.choices.visibleToRoles,role]);}
 function toggleScope(scope:CapabilityScope){choice('consentedScopes',draft.choices.consentedScopes.includes(scope)?draft.choices.consentedScopes.filter(item=>item!==scope):[...draft.choices.consentedScopes,scope]);}
 return <section className="process-studio" aria-label="Process discovery workspace" hidden={!props.active} inert={!props.active} data-process-revision={state.revision}>
  <header className="ps-header"><div><span className="ps-kicker">AUTHORING / PROCESS</span><h1>Process discovery</h1><p>Make the work explicit. Keep V1 small enough to review.</p></div><div className="ps-header-actions"><span className="ps-session">Session only</span><button type="button" onClick={()=>{if(live.current.scopeIsCurrent())props.onOpenStudio();}}>Open AI builder</button></div></header>
  <nav className="ps-steps" aria-label="Process discovery steps">{STEPS.map((name,index)=><button key={name} type="button" aria-current={step===index?'step':undefined} onClick={()=>navigate(index)}><span aria-hidden="true">{String(index+1).padStart(2,'0')}</span>{name}</button>)}</nav>
  <div className="ps-layout"><div className="ps-configure">
   <div className="ps-section-heading"><div><span className="ps-kicker">STEP {step+1} / {STEPS.length}</span><h2 ref={heading} tabIndex={-1}>{STEPS[step]}</h2></div><span className="ps-muted">Requested project: {props.projectId||'Not selected'}</span></div>
   <section hidden={step!==0} aria-label="Process facts" className="ps-panel">
    <p className="ps-intro">Describe the process, not a solution. Use summaries; do not paste credentials or personal records.</p>
    <label>Process name<input aria-label="Process name" value={draft.brief.title} maxLength={80} onChange={event=>brief('title',event.target.value)} placeholder="Name this process"/></label>
    <label>Where does work get stuck?<small>The repeated friction, handoff or delay today.</small><textarea aria-label="Where does work get stuck?" value={draft.brief.problem} maxLength={600} onChange={event=>brief('problem',event.target.value)}/></label>
    <label>What should change?<small>Describe the outcome a person should be able to verify.</small><textarea aria-label="What should change?" value={draft.brief.outcome} maxLength={400} onChange={event=>brief('outcome',event.target.value)}/></label>
    <div className="ps-field-grid"><label>Who does this help?<input aria-label="Who does this help?" value={draft.brief.users} maxLength={240} onChange={event=>brief('users',event.target.value)}/></label><label>System of record / current tools<input aria-label="System of record / current tools" value={draft.brief.systemOfRecord} maxLength={300} onChange={event=>brief('systemOfRecord',event.target.value)}/></label></div>
    <label>Data sensitivity<small>Choose explicitly. No sensitivity level is assumed.</small><select aria-label="Data sensitivity" value={draft.brief.dataSensitivity} onChange={event=>brief('dataSensitivity',event.target.value as ProcessDraft['brief']['dataSensitivity'])}><option value="unanswered">Choose sensitivity…</option><option value="public">Public</option><option value="internal">Internal</option><option value="restricted">Restricted</option></select></label>
   </section>
   <section hidden={step!==1} aria-label="V1 and acceptance" className="ps-panel">
    <p className="ps-intro">Separate the first useful version from what comes later. These requirements describe the draft; they do not expand the template’s supported operations.</p>
    {([{key:'v1Features',label:'V1 features',hint:'What is essential for the first useful version?'},{key:'acceptanceCriteria',label:'V1 acceptance criteria',hint:'What observable behavior would make V1 acceptable?'},{key:'v2Features',label:'V2 backlog',hint:'Optional. Deliberately outside V1; no automatic follow-up build.'}] as const).map(field=><label key={field.key}>{field.label}<small>{field.hint} Up to 6 lines, 160 characters per line.</small><textarea aria-label={field.label} value={draft.brief[field.key].join('\n')} maxLength={965} onChange={event=>brief(field.key,event.target.value===''?[]:event.target.value.split('\n'))}/></label>)}
   </section>
   <section hidden={step!==2} aria-label="ROI assumptions" className="ps-panel">
    <p className="ps-intro">Eight human-entered assumptions. Blank means unknown, never zero. This estimate is not measured savings.</p>
    <label>Currency ISO code<small>Choose the shared three-letter ISO currency code, for example your budgeting currency. No conversion is performed. Money inputs use hundredths.</small><input aria-label="Currency ISO code" value={draft.brief.currency} maxLength={3} pattern="[A-Z]{3}" onChange={event=>brief('currency',event.target.value)} placeholder="Choose currency" autoCapitalize="characters"/></label>
    <div className="ps-field-grid">{ROI_FIELDS.map(field=>{const invalid=parseRoiIntegerInput(roiRaw[field.key]??'',field.key)==='invalid';return <label key={field.key}>{field.label}<small id={`${prefix}-${field.key}-hint`}>{field.hint}</small><input aria-label={field.label} aria-describedby={`${prefix}-${field.key}-hint`} aria-invalid={invalid} inputMode="numeric" type="text" value={roiRaw[field.key]??''} onChange={event=>{const text=event.target.value,value=parseRoiIntegerInput(text,field.key);setRoiRaw(current=>({...current,[field.key]:text}));brief('roi',{...draft.brief.roi,[field.key]:value==='invalid'?null:value});}} placeholder="Unknown" maxLength={16}/>{invalid&&<small className="ps-error">Enter a nonnegative whole integer within the stated bounds.</small>}</label>;})}</div>
    <RoiEstimate roi={roi} currency={draft.brief.currency} invalid={invalidRoi}/>
    <RoiEvidenceSources/>
    <details className="ps-disclosure"><summary>Formula &amp; limitations</summary><p>Released capacity = annual cases × (current − target seconds) × adoption ÷ 10,000. Capacity value = released seconds × loaded hourly cost ÷ 3,600. Cash benefit = capacity value × cash realization ÷ 10,000. Operating cashflow subtracts annual recurring costs; first-year net also subtracts initial cost.</p><p>Exact rational intermediates are retained; reported outputs are quantized. No productivity, staffing reduction, adoption, coverage or cash realization has been measured here. A bounded report may not represent a complete population.</p></details>
   </section>
   <section hidden={step!==3} aria-label="Template and access" className="ps-panel">
    <div className="ps-template-current"><div><span className="ps-kicker">DESIGN TEMPLATE</span><h3>{template?.label??'No template selected'}</h3><p>{template?`${template.version} · ${template.boundary}`:'Compare the real supported shapes before selecting.'}</p></div><button type="button" onClick={event=>open('template',event.currentTarget)}>Choose template</button></div>
    <p className="ps-intro">Draft ceilings, not grants. These human choices do not establish host registration, project membership or execution authority.</p>
    <div className="ps-field-grid"><label>Application ID<small>Start with a lowercase letter, then lowercase letters, digits or hyphens; maximum 40.</small><input aria-label="Application ID" value={draft.choices.appId} maxLength={40} onChange={event=>choice('appId',event.target.value)} autoCapitalize="none" spellCheck={false}/></label><label>Navigation icon<small>Literal icon or short text; maximum 8 characters.</small><input aria-label="Navigation icon" value={draft.choices.icon} maxLength={8} onChange={event=>choice('icon',event.target.value)}/></label></div>
    <label>Navigation section<select aria-label="Navigation section" value={draft.choices.navSection??''} onChange={event=>choice('navSection',event.target.value?event.target.value as NonNullable<ProcessDraft['choices']['navSection']>:null)}><option value="">Choose a section…</option>{NAV_SECTIONS.map(section=><option key={section}>{section}</option>)}</select></label>
    <fieldset><legend>Audience roles</legend><p>Explicit intended audience in the generated manifest. No roles are selected for you.</p><div className="ps-checkbox-grid">{WORKSPACE_ROLES.map(role=><label key={role} className="ps-check"><input type="checkbox" checked={draft.choices.visibleToRoles.includes(role)} onChange={()=>toggleRole(role)}/><code>{role}</code></label>)}</div></fieldset>
    <fieldset><legend>Exact required capability scopes</legend><p>Select every required scope for this template. Changing templates clears all scope acknowledgments.</p>{template?template.requiredScopes.map(scope=><label key={scope} className="ps-check"><input type="checkbox" checked={draft.choices.consentedScopes.includes(scope)} onChange={()=>toggleScope(scope)}/><code>{scope}</code></label>):<p>Choose a template first. No scope is inferred or granted.</p>}</fieldset>
   </section>
   <section hidden={step!==4} aria-label="Review and build" className="ps-panel">
    <p className="ps-intro">The PRD is derived from your facts and choices. Edit those facts to change it; there is no separate unsynchronized PRD editor.</p>
    {result.status==='needs-input'&&<div className="ps-questions"><h3>Still needed before review</h3><ul>{result.questions.map(question=><li key={question.id}><strong>{question.question}</strong><small>{question.because}</small></li>)}</ul></div>}
    {result.status==='invalid'&&<div role="alert" className="ps-error"><h3>Correct the draft</h3><ul>{result.issues.map((issue,index)=><li key={index}>{issue}</li>)}</ul></div>}
    {invalidRoi&&<p role="alert" className="ps-error">Correct the ROI integer inputs before reviewing or building.</p>}
    {plan&&<><PlanBlueprint plan={plan}/><button type="button" onClick={event=>open('review',event.currentTarget)} disabled={state.pending}>Review exact PRD, template &amp; scopes</button><p className="ps-muted">{reviewed?'Exact current revision reviewed. Build still requires your next explicit action.':'Review is required for this revision. Every edit revokes it, including reverting an edit.'}</p></>}
   </section>
   <div className="ps-step-actions"><button type="button" disabled={step===0} onClick={()=>navigate(step-1)}>Previous</button><span>{step+1} of {STEPS.length}</span><button type="button" disabled={step===STEPS.length-1} onClick={()=>navigate(step+1)}>Next</button></div>
  </div>
  <aside className="ps-outline" aria-label="Current process outline"><span className="ps-kicker">CURRENT DRAFT</span><h2>{draft.brief.title||'Untitled process'}</h2><dl><dt>Template</dt><dd>{template?`${template.label} · ${template.version}`:'No template selected'}</dd><dt>V1 / later</dt><dd>{draft.brief.v1Features.filter(Boolean).length} features · {draft.brief.v2Features.filter(Boolean).length} backlog items</dd><dt>Acceptance</dt><dd>{draft.brief.acceptanceCriteria.filter(Boolean).length} criteria</dd><dt>Review</dt><dd>{reviewed?'Current revision reviewed':'Not reviewed'} · revision {state.revision}</dd></dl><div className="ps-outline-roi"><RoiEstimate roi={roi} currency={draft.brief.currency} invalid={invalidRoi}/></div><details className="ps-disclosure"><summary>Current connection boundary</summary><p>Standalone operator authoring only. This workspace does not authenticate, read credentials, contact a provider or persist a process. Build is delegated to the parent’s authenticated deterministic template path.</p><button type="button" disabled>OS / Cowork connection unavailable</button><p>No live OS identity, Cowork harness or connected agent is established here. Agent plans remain proposed.</p></details></aside>
  </div>
  <footer className="ps-build-rail"><div className="ps-build-copy" aria-live="polite" role="status">{state.pending?<><strong>Awaiting genuine draft generation</strong><span>One request is pending. No completion estimate or simulated progress.</span></>:state.receipt?<><strong>Draft accepted — not deployed</strong><span>{state.receipt.label} · Artifact {state.receipt.artifactId}</span></>:<><strong>{reviewed?'Ready for your explicit build action':'Draft — not deployed'}</strong><span>{state.message||(!props.buildAvailable?props.buildUnavailableReason||'Build is unavailable for this context.':plan?'Review the exact PRD, template and scopes before building.':'Complete the process facts and build choices before review.')}</span></>}</div><div className="ps-build-actions">{state.receipt&&props.onOpenGeneratedSource&&<button type="button" onClick={()=>{if(live.current.scopeIsCurrent())live.current.onOpenGeneratedSource?.(state.receipt!.artifactId);}}>Open generated source</button>}{state.pending&&<span className="ps-pending-mark" aria-hidden="true"/>}{state.pending?<button type="button" onClick={()=>gate.cancel()}>Cancel generation</button>:<><button type="button" onClick={()=>navigate(4)}>Review draft</button><button type="button" className="ps-primary" disabled={!props.active||!props.buildAvailable||!plan||!reviewed} onClick={build}>Build V1 draft</button></>}</div></footer>
  {state.error&&<p role="alert" className="ps-error ps-build-error">{state.message}</p>}
  {!props.buildAvailable&&<div className="ps-unavailable"><span>{props.buildUnavailableReason||'Authenticated deterministic build is unavailable.'}</span><button type="button" onClick={()=>{if(live.current.scopeIsCurrent())props.onConnectionSettings();}}>Connection settings</button></div>}
  {modal&&props.active&&<DecisionDialog title={modal==='template'?'Choose a design template':'Review exact draft'} opener={opener.current} onClose={()=>setModal(null)}>{modal==='template'?<TemplateComparison selected={draft.brief.templateId} onChoose={selected=>{edit({...draft,brief:{...draft.brief,templateId:selected.id},choices:{...draft.choices,consentedScopes:[]}});setModal(null);}}/>:plan?<><div className="ps-review-meta"><h3>{template?.label} · version {template?.version}</h3><p><strong>Application:</strong> <code>{draft.choices.appId}</code> · Icon: {draft.choices.icon} · Navigation: {draft.choices.navSection}</p><p><strong>Audience:</strong> {draft.choices.visibleToRoles.join(', ')}</p><p><strong>Exact draft scopes:</strong> {draft.choices.consentedScopes.join(', ')||'None'}</p><p>Draft ceilings, not grants. Requested project: {props.projectId||'Not selected'}.</p></div><h3>Generated PRD · read only</h3><pre className="ps-prd" aria-label="Generated PRD">{plan.prd}</pre><PlanBlueprint plan={plan}/><label className="ps-check ps-review-check"><input type="checkbox" checked={reviewed} onChange={event=>gate.review(plan.reviewKey,event.target.checked)}/>I reviewed this exact PRD, template version, audience and scopes for revision {state.revision}. This is not deployment or execution approval.</label><button type="button" className="ps-primary" disabled={!reviewed} onClick={()=>setModal(null)}>Return to explicit build</button></>:<p>The draft changed. Close this review and complete the current facts.</p>}</DecisionDialog>}
 </section>;
}

function RoiEstimate({roi,currency,invalid}:{roi:ReturnType<typeof assessProcessRoi>;currency:string;invalid:boolean}){
 if(invalid||roi.status==='invalid')return <div className="ps-roi" aria-label="ROI estimate"><h3>Estimate unavailable</h3><p>Correct invalid assumptions. No savings are inferred.</p></div>;
 if(roi.status==='incomplete')return <div className="ps-roi" aria-label="ROI estimate"><h3>Unknown — no estimate</h3><p>{roi.missing.length} of 8 assumptions unanswered. Blank is not zero.</p></div>;
 const money=(value:number)=>`${(value/100).toFixed(2)} ${currency||'(currency not chosen)'}`;
 return <div className="ps-roi" aria-label="ROI estimate"><h3>Assumption-based estimate</h3><dl><dt>Released capacity / year</dt><dd>{(roi.annualCapacitySeconds/3600).toFixed(2)} hours</dd><dt>Capacity value / year · not cash</dt><dd>{money(roi.annualCapacityValueCents)}</dd><dt>Realizable cash benefit / year</dt><dd>{money(roi.annualCashBenefitCents)}</dd><dt>Operating cashflow / year</dt><dd>{money(roi.annualOperatingCashflowCents)}</dd><dt>First-year net cash</dt><dd>{money(roi.firstYearNetCashCents)}</dd><dt>First-year ROI</dt><dd>{roi.firstYearRoiBasisPoints===null?'Undefined — zero initial cost':`${(roi.firstYearRoiBasisPoints/100).toFixed(2)}%`}</dd><dt>Payback</dt><dd>{roi.paybackMonthsMilli===null?'Not reached with positive operating cashflow':`${(roi.paybackMonthsMilli/1000).toFixed(3)} months`}</dd></dl><p>Assumptions only. Released time is not a cash saving.</p></div>;
}
function PlanBlueprint({plan}:{plan:ProcessPlan}){return <div className="ps-blueprint"><h3>Reuse &amp; proposed agent blueprint</h3><ul className="ps-reuse">{plan.reuse.map(item=><li key={item.id}><strong>{item.label}</strong><small>{item.kind} · Source: <code>{item.source}</code></small></li>)}</ul><div className="ps-agents">{plan.suggestedAgents.map(agent=><article key={agent.id}><span className="ps-proposed">Proposed · not created</span><h4>{agent.label}</h4><p>{agent.purpose}</p></article>)}</div><h4>Known limitations</h4><ul>{plan.limitations.map((item,index)=><li key={index}>{item}</li>)}</ul><p>Agent suggestions do not run tools, create identities or connect an OS/Cowork harness.</p></div>;}
function TemplateComparison({selected,onChoose}:{selected:ProcessDraft['brief']['templateId'];onChoose:(template:ProcessTemplate)=>void}){return <><p>Versioned, deterministic templates. Select an actual supported boundary, not a promise of arbitrary functionality.</p><div className="ps-template-comparison">{PROCESS_TEMPLATES.map(template=><article key={template.id} data-selected={selected===template.id}><header><span className="ps-kicker">{template.version}</span><h3>{template.label}</h3></header><p>{template.description}</p><dl><dt>Required draft scopes</dt><dd>{template.requiredScopes.join(', ')||'None'}</dd><dt>Boundary</dt><dd>{template.boundary}</dd></dl><button type="button" onClick={()=>onChoose(template)}>{selected===template.id?'Keep':'Use'} {template.label}</button></article>)}</div><p>Selecting a template clears scope acknowledgments and any prior review. Nothing is built or sent.</p></>;}
function DecisionDialog({title,opener,onClose,children}:{title:string;opener:HTMLElement|null;onClose:()=>void;children:ReactNode}){
 const dialog=useRef<HTMLDialogElement>(null),alive=useRef(false),closeRef=useRef(onClose);closeRef.current=onClose;
 useLayoutEffect(()=>{const element=dialog.current;alive.current=true;if(element&&!element.open){element.showModal();element.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});}return()=>{alive.current=false;if(element?.open)element.close();if(opener?.isConnected&&opener.getClientRects().length&&!opener.closest('[hidden],[inert]'))opener.focus({preventScroll:true});};},[opener]);
 return <dialog ref={dialog} className="ps-dialog process-studio" aria-label={title} tabIndex={-1} onCancel={event=>{event.preventDefault();closeRef.current();}} onClose={()=>{if(alive.current&&!dialog.current?.open)closeRef.current();}} onKeyDown={event=>{if(event.key!=='Tab')return;const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(node=>node.getClientRects().length&&!node.closest('[hidden],[inert]'));const index=controls.indexOf(document.activeElement as HTMLElement),target=dialogFocusTarget(controls.length,index,event.shiftKey);if(target!==null){event.preventDefault();if(target<0)event.currentTarget.focus();else controls[target]?.focus();}}}><header className="ps-dialog-header"><div><span className="ps-kicker">PROCESS / DECISION</span><h2>{title}</h2></div><button type="button" onClick={()=>closeRef.current()}>Close</button></header><div className="ps-dialog-body">{children}</div></dialog>;
}
