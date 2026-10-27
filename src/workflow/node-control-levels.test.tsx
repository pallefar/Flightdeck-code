import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {createWorkflowTemplate,NodeSettings,WorkflowEditor} from './WorkflowEditor';
import {WORKFLOW_CSS} from './styles';
import {blockControlProfile} from './block-controls';

it('shows the HTTP operation and its real adapter boundary rather than generic configuration help',()=>{
 const graph=createWorkflowTemplate('http'),node=graph.nodes[1]!;
 const html=renderToStaticMarkup(createElement(NodeSettings,{graph,node,hint:'Legacy hint',level:'quick',update:()=>({ok:true as const})}));
 const profile=blockControlProfile('http');
 expect(html).toContain(profile.title);expect(html).toContain(profile.purpose);expect(html).toContain(profile.boundary);
});

it('gives the quick drawer a close action and keeps generic graph controls in extended mode',()=>{
 const graph=createWorkflowTemplate('branch'),before=JSON.stringify(graph);
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:graph}));
 expect(html).toContain('aria-label="Close quick controls"');
 expect(html).toMatch(/class="wf-extended-graph"[^>]*hidden=""/);
 expect(JSON.stringify(graph)).toBe(before);
});

it('slides the quick inspector inside the editor with computed bounded placement and reduced-motion support',()=>{
 expect(WORKFLOW_CSS).toMatch(/\.wf-settings-dialog:not\(\[open\]\)\{[^}]*position:absolute;[^}]*left:var\(--wf-inspector-left/);
 expect(WORKFLOW_CSS).toContain('max-height:var(--wf-inspector-height');
 expect(WORKFLOW_CSS).toContain('animation:wf-quick-inspector-in');
 expect(WORKFLOW_CSS).toContain('[data-presentation-motion="off"] .wf-settings-dialog:not([open]) .wf-inspector{animation:none}');
});

it('keeps the quick-to-full opener mounted but hidden in extended mode for reliable focus return',()=>{
 const graph=createWorkflowTemplate('branch'),node=graph.nodes[1]!;
 const common={graph,node,hint:'Condition',onOpenExtended:()=>{},update:()=>({ok:true as const})};
 const quick=renderToStaticMarkup(createElement(NodeSettings,{...common,level:'quick'}));
 const extended=renderToStaticMarkup(createElement(NodeSettings,{...common,level:'extended'}));
 expect(quick).toMatch(/class="wf-extended-action"[^>]*aria-label="Open block settings"/);
 expect(extended).toMatch(/class="wf-extended-action"[^>]*hidden=""/);
 expect(extended).toContain('aria-label="Extended block controls"');
 expect(extended).toContain('Node settings sections');
});

it('trigger input controls describe the original execution seed instead of a generic mapping editor',()=>{
 const graph=createWorkflowTemplate('branch'),node=graph.nodes[0]!;
 node.inputMappings=[{target:'legacy',source:{kind:'literal',value:'DEVELOPMENT old mapping'}}];
 const props={graph,node,hint:'Trigger',level:'extended' as const,onOpenExecutionInput:()=>{},update:()=>({ok:true as const})};
 const html=renderToStaticMarkup(createElement(NodeSettings,props));
 expect(html).toContain('aria-label="Trigger execution input"');
 expect(html).toContain('Edit local execution input');
 expect(html).toContain('Clear legacy trigger mappings');
 expect(html).toMatch(/class="wf-node-input-mapper"[^>]*hidden=""/);
});

it('single-click quick controls prioritize the block function and conceal extended sections',()=>{
 const graph=createWorkflowTemplate('branch'),node=graph.nodes[1]!,before=JSON.stringify(graph);
 const props={graph,node,hint:'Legacy configuration hint',level:'quick' as const,update:()=>({ok:true as const})};
 const html=renderToStaticMarkup(createElement(NodeSettings,props));
 expect(html).toContain('aria-label="Quick block controls"');
 expect(html).toContain('data-block-type="branch"');
 expect(html).toMatch(/class="wf-tabs"[^>]*hidden=""/);
 expect(html).toMatch(/class="wf-node-identity"[^>]*hidden=""/);
 expect(html).toContain('Condition field');
 expect(JSON.stringify(graph)).toBe(before);
});
