import {useEffect,useRef} from 'react';
import {customBlockSchema} from '../../packages/workflow/graph';
import {blockConfigSummary} from './build-manifest';

export function WrapperReview({text,prompt,reviewed,requesting,canRequest,error,onText,onPrompt,onReviewed,onRequest,onAdd,onClose}:{
 text:string;prompt:string;reviewed:boolean;requesting:boolean;canRequest:boolean;error:string;
 onText:(value:string)=>void;onPrompt:(value:string)=>void;onReviewed:(value:boolean)=>void;
 onRequest:()=>void;onAdd:()=>void;onClose:()=>void;
}) {
 const dialog=useRef<HTMLDialogElement|null>(null);
 useEffect(()=>{
  const element=dialog.current,opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
  if(!element)return;
  element.showModal();element.querySelector<HTMLInputElement|HTMLTextAreaElement>('[aria-label="Block purpose"], [aria-label="Custom block JSON"]')?.focus({preventScroll:true});
  return ()=>{if(element.open)element.close();if(opener?.isConnected&&!opener.closest('[hidden]'))opener.focus({preventScroll:true});};
 },[]);
 let block:ReturnType<typeof customBlockSchema.parse>|null=null;
 try{const parsed=customBlockSchema.safeParse(JSON.parse(text));if(parsed.success)block=parsed.data;}catch{/* Untrusted draft stays editable. */}
 return <dialog ref={dialog} className="wf-wrapper-dialog wf-panel" aria-label="Review custom block" onCancel={event=>{event.preventDefault();onClose();}} onClose={onClose}>
  <header className="wf-wrapper-header"><div><span className="wf-kicker">COMPOSE / REVIEW</span><h2>Declarative custom block</h2><p>Reuse an existing base. Change defaults, not execution privileges.</p></div><button aria-label="Close wrapper review" onClick={onClose}>Close ×</button></header>
  {error&&<p role="alert" className="wf-error">{error}</p>}
  <div className="wf-wrapper-body"><section className="wf-wrapper-definition" aria-label="Wrapper definition">
   {canRequest&&<div className="wf-wrapper-request"><label>Describe reusable defaults<input aria-label="Block purpose" value={prompt} onChange={event=>onPrompt(event.target.value)} maxLength={2000} placeholder="What should this existing base do?"/></label><button disabled={requesting||!prompt.trim()} onClick={onRequest}>{requesting?'Requesting…':'Request block proposal'}</button><p>Only this explicit request uses the selected model. Its response is an unreviewed local proposal.</p></div>}
   <label>Definition JSON<textarea aria-label="Custom block JSON" value={text} onChange={event=>onText(event.target.value)} spellCheck={false}/></label>
   <details><summary>Block JSON contract</summary><p>Required keys: id, label, baseType (http | llm | set | branch | output), defaults matching the base schema, description. Unknown keys, executable code, approval wrappers and inline secrets are rejected.</p><pre>{JSON.stringify({id:'normalizeRequest',label:'Normalize request',baseType:'set',defaults:{fields:{ready:true}},description:'Describe the purpose for human review'},null,2)}</pre></details>
  </section><aside className="wf-wrapper-preview" aria-label="Wrapper preview"><span className="wf-kicker">ACTUAL DEFINITION</span>{block?<><h3>{block.label}</h3><dl><dt>Local identifier</dt><dd><code>{block.id}</code></dd><dt>Existing builtin base</dt><dd><code>{block.baseType}</code></dd><dt>Typed default shape</dt><dd>{blockConfigSummary(block.baseType,block.defaults)}</dd></dl>{(block.baseType==='http'||block.baseType==='llm')&&<p>Configuration and a trusted adapter are still required. Defining a wrapper does not configure a connector.</p>}</>:<p>Invalid declarative definition. Correct the JSON and base schema before adding.</p>}<h4>Graph-local definition only</h4><p>Review adds a reusable declaration to this graph. It does not publish a library, activate a resource, install a plugin or approve execution.</p><p>Human approval gates remain independent. Final design is not execution.</p></aside></div>
  <footer className="wf-wrapper-footer"><label className="wf-checkbox"><input type="checkbox" disabled={requesting} checked={reviewed} onChange={event=>onReviewed(event.target.checked)}/>I reviewed the base type, defaults, description and credential references.</label><div><button disabled={!block||!reviewed||requesting} onClick={onAdd}>Add reviewed reusable block</button><button onClick={onClose}>Cancel</button></div></footer>
 </dialog>;
}
