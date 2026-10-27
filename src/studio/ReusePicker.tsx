import {useEffect,useId,useRef,useState,useSyncExternalStore,type RefObject} from 'react';
import {createReuseController,type CatalogPort,type ComposerPort,type ComposerSnapshot,type ReuseControllerState} from '../reuse-catalog/controller';
import type {ReuseKind,ReuseMetadata} from '../reuse-catalog/catalog';
import './ReusePicker.css';

export interface StudioReusePreviewContext {
  readonly projectId:string;
  readonly connectionId:string;
  readonly authoringEngine:'json-planner'|'native-v1';
  readonly pendingAnswers:Readonly<Record<string,string>>;
  readonly pendingContext:unknown;
}
export interface StudioReuseBridgeOptions {
  readonly invalidateSendReview:()=>void;
  readonly setPrompt:(text:string)=>void;
  readonly preview:()=>StudioReusePreviewContext;
  readonly available:()=>boolean;
  readonly scope?:()=>readonly unknown[];
  readonly routeEdit?:(next:string,cas:{expected:ComposerSnapshot;isCurrent:()=>boolean})=>ComposerSnapshot|null;
  readonly catalog?:CatalogPort;
  readonly refs?:{readonly text:{current:string};readonly revision:{current:number};readonly contextEpoch:{current:number}};
}
/** Session-local composer capability. No credentials or effect ports. */
export function createStudioReuseBridge(options:StudioReuseBridgeOptions){
  let connected=false,disposed=false,lifecycle=0;
  const refs=options.refs??{text:{current:''},revision:{current:0},contextEpoch:{current:0}};
  const snapshot={
    get contextEpoch(){return refs.contextEpoch.current;},set contextEpoch(value:number){refs.contextEpoch.current=value;},
    get revision(){return refs.revision.current;},set revision(value:number){refs.revision.current=value;},
    get text(){return refs.text.current;},set text(value:string){refs.text.current=value;},
  };
  let observedScope:readonly unknown[]|null=null;
  function observeScope(){
    const next=options.scope?.();if(!next)return;
    if(observedScope&&(next.length!==observedScope.length||next.some((value,index)=>!Object.is(value,observedScope![index]))))snapshot.contextEpoch++;
    observedScope=[...next];
  }
  const composer:ComposerPort={read:()=>{observeScope();return connected&&!disposed&&options.available()?JSON.stringify(snapshot):null;},measure:text=>{
    observeScope();
    if(!connected||disposed||!options.available())throw Error('composer-unavailable');
    const c=options.preview();
    const request={projection:'studio-reuse-current-request/1',prompt:text,projectId:c.projectId,connectionId:c.connectionId||null,authoringEngine:c.authoringEngine,pendingAnswers:c.pendingAnswers,pendingContext:c.pendingContext};
    const dynamic=JSON.stringify(request);
    const envelope={projection:'studio-reuse-raw-envelope/1',task:'studio.spec.draft',facts:{workflow:{kind:'text',text:dynamic}}};
    const bytes=(value:unknown)=>new TextEncoder().encode(JSON.stringify(value)).length;
    return JSON.stringify({requestBytes:bytes(request),dynamicContextCodeUnits:dynamic.length,envelopeBytes:bytes(envelope)});
  },compareAndSet:(expected,next,isCurrent)=>{
    const result=(options.routeEdit??editPrompt)(next,{expected,isCurrent});
    return result?JSON.stringify(result):null;
  }};
  const reuse=createReuseController({composer,...(options.catalog?{catalog:options.catalog}:{})});
  function editPrompt(value:string|((current:string)=>string),cas?:{expected:ComposerSnapshot;isCurrent:()=>boolean}){
    if(!connected||disposed)return null;
    if(cas){
      const matches=()=>{observeScope();return connected&&!disposed&&options.available()&&cas.isCurrent()&&snapshot.contextEpoch===cas.expected.contextEpoch&&snapshot.revision===cas.expected.revision&&snapshot.text===cas.expected.text;};
      if(!matches())return null;
      options.invalidateSendReview();
      if(!matches())return null;
      const next=typeof value==='function'?value(snapshot.text):value;
      snapshot.revision++;snapshot.text=next;options.setPrompt(next);reuse.sync();
      return {...snapshot};
    }
    const next=typeof value==='function'?value(snapshot.text):value;
    const revision=++snapshot.revision;
    // Reserve a fresh revision and revoke before either store publishes.
    reuse.sync();
    options.invalidateSendReview();
    if(!connected||disposed||snapshot.revision!==revision)return null;
    snapshot.text=next;options.setPrompt(next);reuse.sync();
    return {...snapshot};
  }
  function revokeContext(){snapshot.contextEpoch++;reuse.sync();reuse.hide();}
  function connect(){
    if(disposed)return ()=>{};
    connected=true;const generation=++lifecycle;let cleaned=false;
    return ()=>{
      if(cleaned||generation!==lifecycle)return;cleaned=true;connected=false;revokeContext();
      // StrictMode's immediate setup cancels final disposal, never revives it.
      queueMicrotask(()=>{if(!connected&&generation===lifecycle){disposed=true;reuse.dispose();}});
    };
  }
  return {composer,reuse,editPrompt,revokeContext,connect};
}

export type StudioReuseController=ReturnType<typeof createReuseController>;
const serializeSelection=(row:ReuseMetadata)=>JSON.stringify({kind:row.kind,id:row.id,metadataDigest:row.metadataDigest,templateVersion:row.templateVersion});
const ERROR_LABELS:Readonly<Record<string,string>>=Object.freeze({
  'catalog-input':'The search or selection was refused. Use the bounded search and choose a listed source.',
  'catalog-unavailable':'Bundled source definitions are unavailable. No connection or approval is established.',
  'catalog-stale':'The selected definition changed or is unavailable. Select it again and review a new preview.',
  'prompt-limit':'This reference exceeds the conservative local preview limit (2,000 raw JSON code units), the 8,000-code-unit composer limit or a byte ceiling. Explicitly shorten your request or pending context before selecting again. Nothing is truncated or silently omitted.',
  'composer-changed':'Your request changed. Select a source again and review the new exact preview.',
  'context-changed':'The authoring context changed. Browse again in the current conversation.',
  'review-required':'Review the exact current reference before adding it.',
  'composer-unavailable':'The composer is unavailable or the edit confirmation is uncertain. Inspect your current request before taking another action. No automatic retry or rollback is performed.',
});

export function ReusePicker({reuse,active,onBeforeOpen}: {reuse:StudioReuseController;active:boolean;onBeforeOpen?:()=>void}){
  const state=useSyncExternalStore(reuse.subscribe,reuse.getState,reuse.getState);
  const trigger=useRef<HTMLButtonElement>(null),undoId=state.undoId;
  useEffect(()=>{if(!active)reuse.hide();},[active,reuse]);
  return <div className="reuse-picker-entry">
    <button ref={trigger} type="button" aria-label="Browse reusable sources" aria-haspopup="dialog" aria-expanded={active&&state.open} disabled={!active} onClick={()=>{if(!active)return;onBeforeOpen?.();void reuse.open('{}');}}>Browse reusable sources</button>
    {undoId!==null&&<button type="button" disabled={!active} onClick={()=>reuse.undo(JSON.stringify({undoId}))}>Undo insertion</button>}
    {active&&state.open&&<ReuseDialog reuse={reuse} state={state} trigger={trigger}/>}
  </div>;
}
export function activateReuseDialog(node:HTMLDialogElement,search:HTMLInputElement|null,opener:()=>HTMLButtonElement|null,close:()=>void,isOpen:()=>boolean){
  try{if(!node.open)node.showModal();search?.focus();}catch{close();}
  return ()=>queueMicrotask(()=>{
    // Removing a dialog releases its native modal layer. Calling close() in
    // effect cleanup queues a close event that can kill StrictMode's new setup.
    if(node.isConnected&&isOpen())return;
    const target=opener();
    if(node.ownerDocument.visibilityState!=='hidden'&&target?.isConnected&&!target.closest('[hidden],[inert]'))target.focus({preventScroll:true});
  });
}
export function handleReuseDialogKey(event:Pick<KeyboardEvent,'key'|'shiftKey'|'preventDefault'|'stopPropagation'>&{currentTarget:HTMLDialogElement},close:()=>void){
  event.stopPropagation();
  if(event.key==='Escape'){event.preventDefault();close();return;}
  if(event.key!=='Tab')return;
  const nodes=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,[tabindex]:not([tabindex="-1"])')].filter(node=>node.getClientRects().length&&!node.closest('[hidden],[inert]'));
  const first=nodes[0],last=nodes.at(-1),active=event.currentTarget.ownerDocument.activeElement;
  if(first&&last&&(!event.shiftKey&&active===last||event.shiftKey&&active===first)){
    event.preventDefault();(event.shiftKey?last:first).focus();
  }
}
function ReuseDialog({reuse,state,trigger}:{reuse:StudioReuseController;state:ReuseControllerState;trigger:RefObject<HTMLButtonElement|null>}){
  const dialog=useRef<HTMLDialogElement>(null),search=useRef<HTMLInputElement>(null),titleId=useId();
  const [query,setQuery]=useState(''),[kind,setKind]=useState<ReuseKind|'all'>('all');
  useEffect(()=>{
    const node=dialog.current;if(!node)return;
    return activateReuseDialog(node,search.current,()=>trigger.current,()=>reuse.close(),()=>reuse.getState().open);
  },[reuse,trigger]);
  return <dialog ref={dialog} className="reuse-picker-dialog" aria-modal="true" aria-labelledby={titleId} onCancel={event=>{event.preventDefault();reuse.close();}} onClose={()=>reuse.close()} onKeyDown={event=>handleReuseDialogKey(event,()=>reuse.close())}>
    <header><div><span className="studio-eyebrow">SOURCE DEFINITIONS · LOCAL</span><h2 id={titleId}>Reusable sources</h2><p>Bundled definitions only — availability is not a live connection, executable artifact or independent approval.</p></div><button type="button" aria-label="Close reusable sources" onClick={()=>reuse.close()}>Close</button></header>
    <div className="reuse-picker-filters"><label>Search reusable sources<input ref={search} type="search" maxLength={160} value={query} onChange={event=>{const next=event.target.value;setQuery(next);void reuse.query(JSON.stringify({query:next,kind}));}}/></label><label>Source kind<select value={kind} onChange={event=>{const next=event.target.value as ReuseKind|'all';setKind(next);void reuse.query(JSON.stringify({query,kind:next}));}}><option value="all">All sources</option><option value="workflow-builtin">Workflow built-ins</option><option value="process-template">Process templates</option></select></label></div>
    <ReusePickerBody reuse={reuse} state={state}/>
    <footer className="reuse-picker-actions"><span>No send, graph edit, build, save or execution.</span><button type="button" onClick={()=>reuse.close()}>Cancel</button></footer>
  </dialog>;
}
/** Same rendering/action boundary used in the native dialog; no hooks or effects. */
export function ReusePickerBody({reuse,state}:{reuse:StudioReuseController;state:ReuseControllerState}){
  const {candidate,detail,reviewId}=state;
  return <>
    <p className="reuse-picker-count" role="status">{state.phase==='listing'?'Reading bundled metadata…':state.phase==='detail'?'Reading the selected definition…':state.phase==='inserting'?'Checking the reviewed definition…':`${state.rows.length} source definitions`}{state.undoId!==null&&!candidate&&' · Reference added. Close to inspect the request; Undo insertion is beside Browse.'}</p>
    {state.error&&<p role="alert">{ERROR_LABELS[state.error]??'The local reference action was refused. Inspect the current request.'}</p>}
    <div className="reuse-picker-layout"><ul className="reuse-picker-list" aria-label="Reusable source results">{state.rows.map(row=><li key={`${row.kind}:${row.id}`}><button type="button" aria-pressed={state.selection?.kind===row.kind&&state.selection.id===row.id} disabled={state.phase==='inserting'} onClick={()=>void reuse.select(serializeSelection(row))}><strong>{row.label}</strong><small>{row.kind==='workflow-builtin'?'Workflow built-in':'Process template'} · ID: {row.id}</small><span>{row.description}</span>{row.templateVersion!==null&&<small>Template version: {row.templateVersion}</small>}</button></li>)}</ul>
    <section className="reuse-picker-detail" aria-label="Selected reusable source">{!detail||!candidate?<p>{state.rows.length===0&&state.phase==='idle'?'No matching source definitions. Change your search or kind filter.':'Select one source to inspect its details. Browsing does not add context.'}</p>:<>
      <h3>{detail.label}</h3><p>{detail.description}</p><dl><dt>Source kind</dt><dd>{detail.kind}</dd><dt>ID</dt><dd>{detail.id}</dd>{detail.templateVersion!==null&&<><dt>Template version</dt><dd>{detail.templateVersion}</dd></>}<dt>Availability</dt><dd>Source-static · not probed</dd><dt>Executable version</dt><dd>Unknown</dd><dt>License</dt><dd>Unknown</dd><dt>Independent approval</dt><dd>Unknown</dd><dt>Canonical owner</dt><dd>Unknown</dd></dl>
      <p>{detail.boundary}</p><p>Required scope ceilings (not grants): {detail.requiredScopes.join(', ')||'None declared by this definition.'}</p>
      {detail.kind==='workflow-builtin'&&<><h4>Schema fields · structural summary only</h4><ul>{detail.schemaFields.map(field=><li key={field.name}><code>{field.name}</code> · {field.type} · {field.optional?'Optional':'Required'}{field.hasDefault?' · Has a default':''}</li>)}</ul><p>Runtime refinements and adapter configuration remain authoritative.</p></>}
      <details><summary>Definition consistency fingerprints · not executable hashes</summary><dl><dt>Metadata</dt><dd>{detail.metadataDigest}</dd><dt>Detail</dt><dd>{detail.detailDigest}</dd><dt>Schema structure</dt><dd>{detail.schemaDigest??'Not applicable'}</dd><dt>Defaults projection</dt><dd>{detail.defaultsDigest??'Not applicable'}</dd></dl></details>
      <h4>Exact insertion preview</h4><p>Untrusted request context only. This does not enforce reuse, choose an executable tool or approve a release.</p><pre aria-label="Exact insertion preview">{candidate.insertedText}</pre>
      <div className="reuse-picker-metrics"><h4>Local preview measurements</h4><dl><dt>Reference · UTF-8 bytes</dt><dd>{candidate.insertedUtf8Bytes}</dd><dt>Resulting prompt · UTF-8 bytes</dt><dd>{candidate.promptUtf8Bytes}</dd><dt>Prompt JSON · UTF-8 bytes</dt><dd>{candidate.promptJsonUtf8Bytes}</dd><dt>Current-request projection · UTF-8 bytes</dt><dd>{candidate.requestBytes}</dd><dt>Raw context · UTF-16 code units</dt><dd>{candidate.dynamicContextCodeUnits} / 2,000</dd><dt>Local envelope projection · UTF-8 bytes</dt><dd>{candidate.envelopeBytes} / 32,768</dd></dl><p><code>studio-reuse-current-request/1</code> includes the current project, connection/engine and pending answers/context, including any locally known configuration. <code>studio-reuse-raw-envelope/1</code> wraps that raw JSON as a text fact. These are exact local projections, not HTTP, pseudonymised guard or provider-envelope bytes; an unselected connection remains null. No credential is included. Server-loaded skill content and later model requests are not measured here. The 8,000-code-unit composer still applies; the conservative 2,000 raw JSON limit can refuse earlier without truncation. Actual privacy, guard and exact-send review remain authoritative when you explicitly send.</p></div>
      <label className="reuse-picker-review"><input type="checkbox" checked={reviewId!==null} onChange={event=>reuse.review(JSON.stringify({candidateId:candidate.candidateId,exactText:candidate.insertedText,accepted:event.target.checked}))}/> I reviewed this exact reference and its unknowns. Add it as untrusted request context only.</label>
      <button type="button" disabled={reviewId===null||state.phase==='inserting'} onClick={()=>{if(reviewId!==null)void reuse.insert(JSON.stringify({reviewId}));}}>Add reference</button>
    </>}</section></div>
  </>;
}
