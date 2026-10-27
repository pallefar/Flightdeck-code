import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {it,expect} from 'vitest';
import {WorkflowEditor,createWorkflowTemplate} from './WorkflowEditor';
import {WORKFLOW_CSS} from './styles';
it('keeps modular snap motion on an aria-hidden decorative plate, never the editing wrapper',()=>{
 const graph=createWorkflowTemplate('branch');
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:graph,buildReveal:true}));
 expect((html.match(/class="wf-assembly-plate"/g)??[]).length).toBe(graph.nodes.length);
 expect(html).toMatch(/class="wf-assembly-plate"[^>]+aria-hidden="true"[^>]+data-assembly-phase="locked"/);
 expect(WORKFLOW_CSS).toMatch(/\.wf-assembly-plate\{[^}]*pointer-events:none/);
 expect(WORKFLOW_CSS).toMatch(/@keyframes wf-module-snap\{[^\n]*translateY\(-18px\)[^\n]*translateY\(2px\)/);
 expect(WORKFLOW_CSS).not.toMatch(/\.wf-node(?:-assembly|-content|-head)?\{[^}]*animation:[^;}]*wf-module-snap/);
});
it('offers a compact explain action and a retained, accessible design-only walkthrough without an execution hero',()=>{
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:createWorkflowTemplate('branch')}));
 expect(html).toContain('Explain workflow');
 expect(html).toContain('aria-label="Workflow design walkthrough"');
 expect(html).toMatch(/<aside[^>]+hidden=""[^>]+class="wf-walkthrough"/);
 expect(html).toContain('Design walkthrough · not an execution');
 expect(html).toContain('Narrate current step');
 expect(html).not.toMatch(/Tools used|Gate passed|Installing|Executing walkthrough/);
});
