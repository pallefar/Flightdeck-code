import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {AcceptedHandoff} from '../AcceptedHandoff';
import {parseStudioResult} from '../result';
import {createWorkflowTemplate} from '../../workflow';
import {workflow,subapp} from './fixtures';

it('keeps clarification/refusal or mismatched targets out of the received-workspace cue',()=>{
 for(const result of [parseStudioResult({status:'needs_input',questions:[{id:'target',question:'Which deliverable?'}]}),parseStudioResult({status:'invalid_determination',issues:['No route']}),parseStudioResult(subapp())]){
  expect(renderToStaticMarkup(<AcceptedHandoff receipt={{requestId:'accepted-only',result,target:'editor'}} onDismiss={()=>{}}/>)).toBe('');
 }
});
it('counts only the received workflow topology and labels it as an editable undeployed draft',()=>{
 const graph=createWorkflowTemplate('branch'),result=parseStudioResult({...workflow,graph});
 const html=renderToStaticMarkup(<AcceptedHandoff receipt={{requestId:'workflow-receipt',result,target:'editor'}} onDismiss={()=>{}}/>);
 expect(html).toContain('data-request-id="workflow-receipt"');
 expect(html).toContain(`${graph.nodes.length} blocks · ${graph.edges.length} connections`);
 expect(html).toContain('Workflow draft received');
 expect(html).toContain('Review required · not deployed');
 expect(html).not.toContain('Generating');
});
it('counts actual generated non-standalone sources without inventing tool or deployment progress',()=>{
 const result=parseStudioResult(subapp());
 if(result.status!=='subapp-result'||result.outcome.status!=='proposed')throw new Error('Invalid source fixture');
 const html=renderToStaticMarkup(<AcceptedHandoff receipt={{requestId:'subapp-receipt',result,target:'ide'}} onDismiss={()=>{}}/>);
 expect(html).toContain(`${result.outcome.generated.files.filter(file=>file.kind!=='standalone').length} source files`);
 expect(html).toContain('Sub-app draft received');
 expect(html).not.toContain('%');
 expect(html).not.toContain('Executing');
});
