import {useState} from 'react';
import {configSchemas, graphSchema, resolveNode, type Graph, type GraphNode, type Json} from '../../packages/workflow/graph';
import {blockControlProfile} from './block-controls';

export type SaveOutcome = {ok:true} | {ok:false; error:string};
export type ValueType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array';
export interface FieldRow {name:string; type:ValueType; value:string}
export interface ParameterDraft {config:Record<string,Json>; rows:FieldRow[]; advanced:string; mode:'typed'|'json'}

export const QUICK_PARAMETER_DRAFT_MESSAGE = 'Open full settings to review and apply pending advanced edits.';

export function createParameterDraft(graph:Graph,node:GraphNode):ParameterDraft {
  const {config:effective,type} = resolveNode(graph,node);
  const config = {...effective};
  if (type==='http') config.bodyText = effective.body===undefined?'':JSON.stringify(effective.body,null,2);
  if (type==='branch') config.valueText = effective.value===undefined?'':JSON.stringify(effective.value,null,2);
  const fields = config.fields as Record<string,Json> | undefined;
  return {config, rows:Object.entries(fields ?? {}).map(([name,value])=>({name,
    type:value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value as ValueType,
    value:typeof value === 'string' ? value : JSON.stringify(value),
  })), advanced:JSON.stringify(node.config,null,2), mode:'typed'};
}

function parseRow(row:FieldRow):Json {
  if (row.value.length>20000) throw new Error(`Value for ${row.name} is too large (maximum 20000 characters)`);
  if (row.type === 'string') return row.value;
  if (row.type === 'null') return null;
  const value:unknown = JSON.parse(row.value);
  const actual = value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value;
  if (actual !== row.type) throw new Error(`Expected ${row.type} for ${row.name}`);
  return value as Json;
}

/** Compare effective defaults, not node overrides. JSON mode remains pending even
 * when its text is equal: quick editing must not silently switch/discard modes. */
export function hasAdvancedParameterDraft(graph:Graph,node:GraphNode,draft:ParameterDraft):boolean {
  if (draft.mode==='json') return true;
  const {type} = resolveNode(graph,node);
  const baseline = createParameterDraft(graph,node);
  const quickKeys = new Set(blockControlProfile(type).quickKeys);
  if (type==='branch') quickKeys.add('valueText');
  return [...new Set([...Object.keys(baseline.config),...Object.keys(draft.config)])]
    .some(key=>!quickKeys.has(key)&&JSON.stringify(baseline.config[key])!==JSON.stringify(draft.config[key]));
}

/** Refuse before validation/update; never save edits hidden by the quick surface. */
export function applyQuickParameterDraft(graph:Graph,node:GraphNode,draft:ParameterDraft,
  update:(config:GraphNode['config'])=>SaveOutcome):SaveOutcome {
  if (hasAdvancedParameterDraft(graph,node,draft)) return {ok:false,error:QUICK_PARAMETER_DRAFT_MESSAGE};
  return applyParameterDraft(graph,node,draft,update);
}

export function applyParameterDraft(graph:Graph,node:GraphNode,draft:ParameterDraft,
  update:(config:GraphNode['config'])=>SaveOutcome):SaveOutcome {
  try {
    const {type,config:original} = resolveNode(graph,node);
    const wrapper = graph.customBlocks.find(block=>block.id===node.type);
    const boundedJson = (text:string) => {
      if (text.length>20000) throw new Error('JSON value is too large (maximum 20000 characters)');
      return JSON.parse(text);
    };
    let config = draft.mode === 'json' ? boundedJson(draft.advanced) : {...draft.config};
    if (draft.mode==='typed') {
      if(type==='resource' && typeof config.revision==='string') {
        if(!/^[1-9][0-9]*$/.test(config.revision)) throw new Error('Active resource revision must be a positive safe integer');
        config.revision=Number(config.revision);
      }
      const jsonFields:[string,string][] = type==='http'?[['bodyText','body']]:type==='branch'?[['valueText','value']]:[];
      for (const [textKey,valueKey] of jsonFields) {
        const text = String(config[textKey] ?? '');
        delete config[textKey];
        if (type==='branch' && config.operator==='exists') continue;
        if (text.trim()) config[valueKey]=boundedJson(text);
        else delete config[valueKey];
      }
    }
    if (draft.mode === 'typed' && type === 'set') {
      const fields:Record<string,Json> = {};
      for (const row of draft.rows) {
        if (Object.hasOwn(fields,row.name)) throw new Error(`Duplicate field: ${row.name}`);
        Object.defineProperty(fields,row.name,{value:parseRow(row),enumerable:true});
      }
      config.fields = fields;
    }
    if (wrapper && draft.mode==='typed') {
      const overrides = {...node.config};
      for (const key of new Set([...Object.keys(original),...Object.keys(config)])) {
        if (JSON.stringify(original[key])===JSON.stringify(config[key])) continue;
        if (config[key]===undefined) delete overrides[key];
        else overrides[key]=config[key];
      }
      config=overrides;
    }
    if (!config || typeof config!=='object' || Array.isArray(config)) throw new Error('Configuration must be an object');
    configSchemas[type].parse({...wrapper?.defaults,...config});
    graphSchema.parse({...graph,nodes:graph.nodes.map(n=>n.id===node.id?{...n,config}:n)});
    return update(config);
  } catch (error) {
    return {ok:false,error:error instanceof Error ? error.message : 'Invalid settings'};
  }
}

export function parameterDraftJson(graph:Graph,node:GraphNode,draft:ParameterDraft):string {
  let text='';
  const result=applyParameterDraft(graph,node,draft,config=>{
    text=JSON.stringify(config,null,2);
    return {ok:true};
  });
  if (!result.ok) throw new Error(result.error);
  return text;
}

type ParameterProps = {graph:Graph;node:GraphNode;update:(config:GraphNode['config'])=>SaveOutcome;onDraftChange?:()=>void;level?:'quick'|'extended'};

/** Config revisions remount the draft, including undo/redo and wrapper default changes.
 * Label/position updates do not discard an in-progress parameter edit. */
export function NodeParameters(props:ParameterProps) {
  const wrapper = props.graph.customBlocks.find(block=>block.id===props.node.type);
  const revision = JSON.stringify([props.node.id,props.node.type,props.node.config,wrapper?.defaults]);
  return <ParameterForm key={revision} {...props}/>;
}

function ParameterForm({graph,node,update,onDraftChange,level='extended'}:ParameterProps) {
  const [draft,setDraft] = useState(()=>createParameterDraft(graph,node));
  const [status,setStatus] = useState('Saved settings');
  const [issue,setIssue] = useState('');
  const quick = level==='quick';
  const jsonLocked = quick&&draft.mode==='json';
  const advancedPending = quick&&hasAdvancedParameterDraft(graph,node,draft);
  function change(next:ParameterDraft) {
    if (jsonLocked&&next.mode==='typed') return;
    onDraftChange?.();setDraft(next);setStatus('Unsaved settings');setIssue('');
  }
  function changeRow(index:number,patch:Partial<FieldRow>) {
    change({...draft,mode:'typed',rows:draft.rows.map((row,i)=>i===index?{...row,...patch}:row)});
  }
  const {type} = resolveNode(graph,node);
  const wrapper = graph.customBlocks.find(block=>block.id===node.type);
  function field(key:string,label:string,multiline=false,numeric=false) {
    const props = { 'aria-label':label, value:String(draft.config[key] ?? ''), maxLength:key.endsWith('Text')?20000:2000,
      onChange:(event:{target:{value:string}})=>{
        const config = {...draft.config};
        if (event.target.value === '' && key !== 'description') delete config[key];
        else config[key] = event.target.value;
        change({...draft,mode:'typed',config});
      }};
    return <label>{label}{multiline?<textarea {...props}/>:<input {...props} {...(numeric?{type:'number',min:1,step:1}:{})}/>}</label>;
  }
  function select(key:string,label:string,options:string[]) {
    return <label>{label}<select aria-label={label} value={String(draft.config[key] ?? '')}
      onChange={event=>change({...draft,mode:'typed',config:{...draft.config,[key]:event.target.value}})}>
      <option value="">Not specified</option>{options.map(value=><option key={value}>{value}</option>)}
    </select></label>;
  }
  return <div className="wf-parameters">
    {wrapper&&<p hidden={quick}>Effective {wrapper.baseType} parameters include reusable defaults. Untouched defaults remain inherited; edits create node overrides. Advanced JSON edits overrides only; use {'{}'} to restore all defaults.</p>}
    {draft.mode==='json'&&<p hidden={quick}>Advanced JSON is active. Apply saves the JSON below. Editing a parameter instead switches back to parameter controls.</p>}
    <fieldset className="wf-typed-parameters" aria-label="Typed parameters" data-level={level} disabled={jsonLocked}
      style={{border:0,padding:0,margin:0,minWidth:0}}>
    {type==='manual'&&<p>Manual input is supplied at local execution. No stored parameters.</p>}
    {type==='output'&&<p>Returns incoming data unchanged. No stored parameters.</p>}
    {type==='resource'&&<>
      {field('resourceId','Resource ID')}
      {field('functionId','Function ID')}
      <div data-parameter-group="advanced" hidden={quick}>
      {field('revision','Active resource revision',false,true)}
      <p>Reference only: select an active read-only REST / MCP function from the Resources library. Active authorizations and independent server review are required at execution; these fields do not grant access.</p>
      <p>Inputs supplies schema-bound function parameters to the trusted Resource adapter. No secrets or model overrides, destinations, headers or credentials are stored here. Incomplete references may be saved as drafts but cannot execute.</p>
      </div>
    </>}
    {type==='http'&&<>
      {field('url','HTTP URL')}
      {select('method','HTTP method',['GET','POST','PUT','PATCH','DELETE'])}
      <div data-parameter-group="advanced" hidden={quick}>
      {select('service','Service',['generic','slack','microsoft365'])}
      {field('credentialRef','Credential reference')}
      <p>Vault identifier only, never inline secrets. Service is metadata, not a working integration. HTTP adapter is not configured unless supplied by the trusted host.</p>
      {field('bodyText','HTTP body JSON',true)}
      </div>
    </>}
    {type==='llm'&&<>
      {field('instruction','Instruction',true)}
      <div data-parameter-group="advanced" hidden={quick}>{field('model','Model')}</div>
      <p>LLM adapter is not configured unless supplied by the trusted host. No autonomous tools.</p>
    </>}
    {type==='branch'&&<>
      {field('field','Condition field')}{select('operator','Condition operator',['equals','exists'])}
      {draft.config.operator!=='exists'&&field('valueText','Condition value JSON',true)}
      <p>Routes incoming data to true or false ports. Equality compares JSON values.</p>
    </>}
    {type==='approval'&&<>
      {field('reviewer','Reviewer')}
      <div data-parameter-group="advanced" hidden={quick}>{field('reason','Review reason',true)}</div>
      <p>Pauses for an independently authenticated human. This editor cannot authorize approval or self-approval.</p>
    </>}
    {type==='unconfigured'&&<>{field('description','Description',true)}<p>This placeholder cannot execute.</p></>}
    {type==='set'&&<><p>Fields merge into incoming input. Nested values use bounded JSON; no expressions or code.</p>
    {draft.rows.map((row,index)=><div className="wf-field-row" key={index}>
      <label>Name
        <input aria-label={`Field ${index+1} name`} value={row.name} maxLength={64}
          onChange={event=>changeRow(index,{name:event.target.value})}/>
      </label>
      <label>Type
        <select aria-label={`Field ${index+1} type`} value={row.type}
          onChange={event=>changeRow(index,{type:event.target.value as ValueType})}>
          {(['string','number','boolean','null','object','array'] as const).map(type=><option key={type}>{type}</option>)}
        </select>
      </label>
      <label>Value
        <input aria-label={`Field ${index+1} value`} value={row.value} maxLength={20000}
          disabled={row.type==='null'} onChange={event=>changeRow(index,{value:event.target.value})}/>
      </label>
      <button aria-label={`Remove field ${index+1}`}
        onClick={()=>change({...draft,mode:'typed',rows:draft.rows.filter((_,i)=>i!==index)})}>Remove</button>
    </div>)}
    <button onClick={()=>change({...draft,mode:'typed',rows:[...draft.rows,{name:'',type:'string',value:''}]})}>Add field</button></>}
    </fieldset>
    <details hidden={quick}><summary>Advanced JSON</summary>
      <p>Schema-validated JSON, not code. Focusing this editor loads the current parameter edits; subsequent changes use JSON mode.</p>
      <label>Configuration JSON
        <textarea aria-label="Node configuration JSON" value={draft.advanced} spellCheck={false}
          maxLength={20000}
          onFocus={()=>{
            if(draft.mode==='json') return;
            try {setDraft({...draft,advanced:parameterDraftJson(graph,node,draft)});}
            catch(error) {setIssue(error instanceof Error?error.message:'Invalid settings');}
          }}
          onChange={event=>change({...draft,mode:'json',advanced:event.target.value})}/>
      </label>
    </details>
    {advancedPending&&<p role="note">{QUICK_PARAMETER_DRAFT_MESSAGE}</p>}
    {issue&&<p role="alert">{issue}</p>}
    <p role="status">{status}</p>
    <button hidden={quick&&(type==='manual'||type==='output')} disabled={advancedPending} onClick={()=>{
      const apply = quick?applyQuickParameterDraft:applyParameterDraft;
      const result = apply(graph,node,draft,config=>{
        const outcome=update(config);
        // A successful no-op save may keep the same revision key (e.g. restoring
        // inherited defaults with {}). Refresh even when React does not remount.
        if(outcome.ok) setDraft(createParameterDraft(graph,{...node,config}));
        return outcome;
      });
      setIssue(result.ok?'':result.error);
      setStatus(result.ok?'Saved settings':'Invalid settings — not saved');
    }}>Apply settings</button>
  </div>;
}
