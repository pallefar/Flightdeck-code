import {useEffect} from 'react';
import type {StudioResult} from './result';

export type ReceivedHandoff={requestId:string;result:StudioResult;target:'editor'|'ide'};

/** A received-artifact receipt, never a streaming/model execution status. */
export function AcceptedHandoff({receipt,onDismiss}:{receipt:ReceivedHandoff;onDismiss:(requestId:string)=>void}){
 useEffect(()=>{const timeout=setTimeout(()=>onDismiss(receipt.requestId),6000);return()=>clearTimeout(timeout);},[receipt.requestId,onDismiss]);
 const result=receipt.result;
 const workflow=result.status==='workflow-proposed'||result.status==='workflow-graph-proposed'?result:null;
 const subapp=result.status==='subapp-result'&&result.outcome.status==='proposed'?result.outcome:null;
 if((receipt.target==='editor'&&!workflow)||(receipt.target==='ide'&&!subapp))return null;
 return <aside className="studio-received-handoff" aria-label="Received draft handoff" role="status" data-request-id={receipt.requestId} data-target={receipt.target}>
  <span className="studio-handoff-path" aria-hidden="true">Conversation <i>→</i> {workflow?'Workflow builder':'Sub-app IDE'}</span>
  <div className="studio-handoff-title"><span className="studio-handoff-mark" aria-hidden="true">✓</span><strong>{workflow?'Workflow draft received':'Sub-app draft received'}</strong><button type="button" aria-label="Dismiss draft handoff" onClick={()=>onDismiss(receipt.requestId)}>×</button></div>
  <p>{workflow?(workflow.graph?`${workflow.graph.nodes.length} blocks · ${workflow.graph.edges.length} connections`:'Workflow intent received'):`${subapp!.generated.files.filter(file=>file.kind!=='standalone').length} source files`} · ready to edit</p>
  <small>Review required · not deployed</small>
 </aside>;
}
