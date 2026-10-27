import { useEffect, useState, useSyncExternalStore } from 'react';
import { ResourceController } from './resource-controller';
import { validateResourceValue, type FunctionSummary } from './resource-client';
import { definitionSchema, type ResourceSelection } from '../../packages/resources/contract';
type Schema=FunctionSummary['input'];
const restricted=/(secret|password|token|api.?key|authorization|credential|destination|endpoint|url|command|headers?)/i;
function inputAllowed(schema:Schema):boolean {
 if(schema.type==='object') return Object.entries(schema.properties).every(([k,s])=>!restricted.test(k) && inputAllowed(s));
 return schema.type!=='array' || inputAllowed(schema.items);
}
function ParameterField({schema,value,onChange,label,disabled}:{schema:Schema;value:unknown;onChange:(value:unknown)=>void;label:string;disabled:boolean}) {
 const [numeric,setNumeric]=useState(value===undefined?'':String(value));
 if(schema.type==='object') {
  const record=value && typeof value==='object' && !Array.isArray(value)?value as Record<string,unknown>:{};
  return <fieldset disabled={disabled}><legend>{label} · object</legend>{Object.entries(schema.properties).map(([key,s])=>{
   const required=schema.required.includes(key);const present=Object.hasOwn(record,key);
   return <div key={key}>{!required && <label className="resource-optional"><input type="checkbox" checked={present} onChange={e=>{const next={...record};if(e.target.checked) next[key]=s.type==='object'?{}:s.type==='array'?[]:s.type==='string'?'':s.type==='boolean'?false:0;else delete next[key];onChange(next);}}/>Include optional {key}</label>}{(required || present) && <ParameterField schema={s} value={record[key]} label={`${key}${required?' (required)':''}`} disabled={disabled} onChange={child=>onChange({...record,[key]:child})}/>}</div>;
  })}</fieldset>;
 }
 if(schema.type==='array') {
  const items=Array.isArray(value)?value:[];
  return <fieldset disabled={disabled}><legend>{label} · array (maximum {schema.maxItems})</legend>{items.map((item,index)=><div key={index}><ParameterField schema={schema.items} value={item} label={`Item ${index+1}`} disabled={disabled} onChange={child=>onChange(items.map((v,i)=>i===index?child:v))}/><button type="button" onClick={()=>onChange(items.filter((_v,i)=>i!==index))}>Remove item {index+1}</button></div>)}<button type="button" disabled={disabled || items.length>=schema.maxItems} onClick={()=>onChange([...items,schema.items.type==='object'?{}:schema.items.type==='array'?[]:schema.items.type==='string'?'':schema.items.type==='number'?0:false])}>Add item</button></fieldset>;
 }
 if(schema.type==='boolean') return <label>{label} · boolean<select disabled={disabled} value={typeof value==='boolean'?String(value):''} onChange={e=>onChange(e.target.value===''?undefined:e.target.value==='true')}><option value="">Choose…</option><option value="true">True</option><option value="false">False</option></select></label>;
 if(schema.type==='number') return <label>{label} · number<input disabled={disabled} type="number" step="any" value={numeric} onChange={e=>{setNumeric(e.target.value);onChange(e.target.value===''?undefined:Number(e.target.value));}}/></label>;
 return <label>{label} · string<input disabled={disabled} maxLength={schema.maxLength??4096} value={typeof value==='string'?value:''} onChange={e=>onChange(e.target.value)}/></label>;
}
export function ResourceLibrary({projectId,token,fetcher=fetch,controller:supplied,onCredentials,onSelectResource}:{projectId:string;token:string;fetcher?:typeof fetch;controller?:ResourceController;onCredentials:()=>void;onSelectResource?:(selection:ResourceSelection)=>void}) {
 const [controller]=useState(()=>supplied??new ResourceController(fetcher));
 const raw=useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
 const matching=controller.matchesScope(projectId,token);
 useEffect(()=>{controller.setScope(projectId,token);},[controller,projectId,token]);
 useEffect(()=>()=>controller.cancel(),[controller]);
 const state=matching?raw:null;
 const ready=!!state?.ready;const busy=!!state?.busy;
 const fn=state?.functions.find(f=>f.id===state.functionId);
 const allowed=!!fn && inputAllowed(fn.input);
 const valid=!!fn && validateResourceValue(state?.parameters,fn.input);
 const selected=state?.selected;
 const canTest=ready && !busy && selected?.state==='active' && allowed && valid;
 const draft=state?.draft;
 return <section className="resource-library" aria-label="Resource library"><style>{CSS}</style>
  <header><span className="studio-eyebrow">STUDIO / RESOURCES</span><h1>Resources</h1><p>Reusable read-only server functions. Configuration is not a connection test. No model or network execution happens automatically.</p></header>
  <p className="studio-notice">Independent server review required</p><p>Saving creates a proposal draft. Activation is a separate independently authorized server action; this UI cannot approve resources.</p>
  <p>Project: <code>{projectId || 'not selected'}</code> · operator credential stays in shared Studio memory.</p>
  {!ready && <p role="status">Connect operator credential in AI builder and enter a valid project ID. Previously loaded resources are hidden when scope changes. <button type="button" onClick={onCredentials}>Open AI builder credentials</button></p>}
  <div className="resource-actions"><button type="button" aria-label="Refresh resources" disabled={!ready || busy} onClick={()=>void controller.refresh()}>{busy?'Working…':'Refresh resources'}</button><button type="button" disabled={!ready || busy || !state?.loaded || !state.functions.length} onClick={()=>controller.create()}>New resource proposal</button>{busy && <button type="button" onClick={()=>controller.cancel()}>Cancel request</button>}</div>
  {!state?.loaded ? <p role="status">Resources not checked — use authenticated Refresh.</p> : <><p>{state.resources.length ? `${state.resources.length} saved resource(s).`:'No resources saved in this project.'}</p>{!state.functions.length && <p role="status">No functions configured. Configure the server-owned resource registry for this project; destinations and credentials are never entered here.</p>}<div className="resource-functions"><h2>Configured functions</h2>{state.functions.map(f=><p key={f.id}><code>{f.id}</code> · {f.kind.toUpperCase()} · read-only · configured-not-probed</p>)}</div></>}
  <div className="resource-layout"><div className="studio-card"><h2>Saved resources</h2>{state?.resources.map(resource=><button className="resource-row" type="button" key={resource.id} disabled={busy} aria-pressed={selected?.id===resource.id} onClick={()=>void controller.open(resource.id)}><strong>{resource.definition.name}</strong><span>Revision {resource.revision} · {resource.state==='active'?'Activated':'Draft'} · {resource.definition.functions.length} function(s)</span></button>)}</div>
  <div className="studio-card"><h2>{draft ? selected?'Resource proposal & revision':'New resource proposal':'Select a resource'}</h2>
   {selected && <><p><code>{selected.id}</code> · {selected.state==='active'?'Activated':'Draft'} · revision {selected.revision}{selected.sourceRevision!==null && ` · source draft revision ${selected.sourceRevision}`} · actor {selected.actor}</p><label>Resource revision<select disabled={busy} value={selected.revision} onChange={e=>controller.selectRevision(Number(e.target.value))}>{state?.revisions.map(r=><option key={r.revision} value={r.revision}>Revision {r.revision} · {r.state==='active'?'Activated':'Draft'} · {r.definition.name}</option>)}</select></label><p>Loading a revision replaces only this resource proposal. Updating uses that exact revision; stale revisions conflict instead of overwriting.</p></>}
   {draft && <form onSubmit={e=>{e.preventDefault();void controller.save();}}><label>Resource name<input required maxLength={120} disabled={busy} value={draft.name} onChange={e=>controller.edit({...draft,name:e.target.value})}/></label><fieldset disabled={busy}><legend>Server-configured function IDs</legend>{state?.functions.map(f=><label className="resource-optional" key={f.id}><input type="checkbox" checked={draft.functions.includes(f.id)} onChange={e=>controller.edit({...draft,functions:e.target.checked?[...draft.functions,f.id]:draft.functions.filter(id=>id!==f.id)})}/>{f.id} · {f.kind} · configured-not-probed</label>)}</fieldset>{draft.functions.some(id=>!state?.functions.some(f=>f.id===id)) && <p>Some proposal functions are not configured for this project. Configure them on the server or remove them through a reviewed replacement.</p>}<button type="submit" disabled={!ready || busy || !definitionSchema.safeParse(draft).success}>{selected?'Save new draft revision':'Save resource draft'}</button></form>}
   {state?.saved && <p role="status">Saved draft confirmed by exact authenticated readback. Not activated.</p>}
   {selected && <section aria-label="Resource function test"><h3>Explicit read-only test</h3><label>Resource function<select disabled={busy} value={state?.functionId??''} onChange={e=>controller.chooseFunction(e.target.value)}>{selected.definition.functions.map(id=><option key={id} value={id}>{id}{state?.functions.some(f=>f.id===id)?' · configured-not-probed':' · not configured'}</option>)}</select></label>
    {!fn && <p>Selected function is not configured. Configure the server registry; no destination or secret fields are accepted here.</p>}
    {fn && <><p>{fn.kind.toUpperCase()} · {fn.effect} · {fn.status}. A test result describes one invocation, not persistent connectivity.</p>{allowed ? <ParameterField key={`${selected.id}:${selected.revision}:${fn.id}`} schema={fn.input} value={state?.parameters} label="Test parameters" disabled={busy} onChange={value=>controller.setParameters(value)}/> : <p>This input requests restricted connection or credential fields. Configure a safe data-only function schema on the server.</p>}<details><summary>Validated function schemas</summary><pre>{JSON.stringify({input:fn.input,output:fn.output},null,2)}</pre></details></>}
    {selected.state==='draft' && <p>Draft cannot execute. Independent server review required; refresh and load the activated revision afterward.</p>}
    {allowed && !valid && <p>Enter parameters matching the selected function schema. All required fields and bounds must validate.</p>}
    <button type="button" disabled={!canTest} onClick={()=>void controller.test()}>Test read-only function</button>
    {onSelectResource && <button type="button" disabled={!canTest} onClick={()=>{if(selected && fn && canTest) onSelectResource({resourceId:selected.id,revision:selected.revision,functionId:fn.id,parameters:structuredClone(state?.parameters)});}}>Use resource function</button>}
    {state?.result && <div role="status"><h3>Actual invocation result</h3><p>Project {projectId} · resource <code>{state.result.resourceId}</code> · revision {state.result.revision} · function {state.result.functionId} · duration {state.result.durationMs.toFixed(2)} ms</p><pre>{JSON.stringify(state.result.output,null,2)}</pre><p>Measured for this invocation only. Configuration remains not-probed for future calls.</p></div>}
   </section>}
  </div></div>{state?.error && <p role="alert">{state.error}</p>}
 </section>;
}
const CSS=`.resource-library{color:var(--ink,#253d4b)}.resource-library header h1{margin-bottom:8px}.resource-library .resource-actions{display:flex;gap:8px;flex-wrap:wrap;margin:20px 0}.resource-library .resource-layout{display:grid;grid-template-columns:minmax(220px,1fr) minmax(300px,2fr);gap:20px}.resource-library .resource-row{display:flex;flex-direction:column;text-align:left;width:100%;margin:8px 0;gap:4px}.resource-library .resource-row[aria-pressed=true]{border-color:var(--te,#e98300)}.resource-library fieldset{border:1px solid var(--line,#d5dfe5);border-radius:8px;margin:16px 0;padding:16px}.resource-library .resource-optional{flex-direction:row;align-items:center;gap:8px}.resource-library pre{max-height:360px;overflow:auto;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}.resource-library [role=alert]{color:var(--red,#aa3122);border:1px solid var(--red,#aa3122);padding:12px}.resource-library .resource-functions{border-top:1px solid var(--line,#d5dfe5);margin:16px 0}@media(max-width:850px){.resource-library .resource-layout{grid-template-columns:1fr}}`;
