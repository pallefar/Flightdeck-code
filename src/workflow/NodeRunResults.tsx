import {type RunResult,type TraceEntry,type TraceDetails} from '../../packages/workflow/engine';
import {type Json} from '../../packages/workflow/graph';
export type LocalTraceDetails=TraceDetails;
export function localDetails(entry:TraceEntry|undefined):LocalTraceDetails|undefined{return entry?.details;}
export function localNodeRunEntry(nodeId:string,run:RunResult|null):TraceEntry|undefined{return [...(run?.trace??[])].reverse().find(t=>t.nodeId===nodeId);}
export function NodeRunStatus({nodeId,run,id}:{nodeId:string;run:RunResult|null;id?:string}){
 if(!run)return null;
 const entry=localNodeRunEntry(nodeId,run);
 const status=entry?.status??'not-reached';
 const label=entry?entry.status[0]!.toUpperCase()+entry.status.slice(1):'Not reached';
 const selectedPort=entry?.details?.selectedPort;
 const description='Last local result for this applied graph; changes to execution input or unapplied settings have not been rerun.'+(selectedPort==='true'||selectedPort==='false'?` Observed branch: ${selectedPort}.`:'');
 return <span className="wf-node-run-status" data-local-run-status={status} id={id} title={description}>{label}<span className="wf-sr-only"> — {description}</span></span>;
}
function bounded(value:Json):string {const text=JSON.stringify(value,null,2);return text.length>12000?text.slice(0,12000)+'\n… Display truncated':text;}
export function NodeRunResults({nodeId,run}:{nodeId:string;run:RunResult|null}){
 const entry=localNodeRunEntry(nodeId,run),details=localDetails(entry);
 return <section className="wf-results" aria-label="Node run results"><p role="status">{!run?'Not run — run the current graph locally.':!entry?'Not reached in this run':entry.status[0]!.toUpperCase()+entry.status.slice(1)}</p>
 <p>Graph edits clear local results. These are actual local measurements, not model estimates. Captured input/output is privacy-filtered: identity fields may be removed, text scrubbed, and oversized data omitted.</p>
 {entry?.message&&<p role={entry.status==='blocked'?'alert':undefined}>{entry.message}</p>}
 {details&&<dl><dt>Measured duration</dt><dd>{details.durationMs.toFixed(2)} ms</dd>{details.selectedPort&&<><dt>Selected branch</dt><dd>{details.selectedPort}</dd></>}{details.errorCode&&<><dt>Error code</dt><dd>{details.errorCode}</dd></>}</dl>}
 {entry&&entry.status!=='skipped'&&<>{(['input','output'] as const).map(kind=><section key={kind}><h4>{kind==='input'?'Actual input':'Actual output'}</h4>{details&&Object.hasOwn(details,kind)?<pre>{bounded(details[kind]!)}</pre>:<p>Data unavailable — not captured or not produced.</p>}</section>)}</>}
 {entry?.status==='skipped'&&<p>This branch did not execute; no output was produced.</p>}
 <p>Tokens / model usage: Unavailable. No usage accounting is supplied by this local runner.</p></section>;
}
