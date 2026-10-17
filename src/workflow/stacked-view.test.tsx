import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import * as editor from './WorkflowEditor';
import {WORKFLOW_CSS} from './styles';

it('offers an explicit Canvas / Stacked view choice without changing the default graph',()=>{
 const graph=editor.createWorkflowTemplate('branch'),before=JSON.stringify(graph);
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:graph}));
 expect(html).toContain('aria-label="Workflow view"');
 expect(html).toMatch(/aria-label="Canvas view"[^>]*aria-pressed="true"/);
 expect(html).toMatch(/aria-label="Stacked view"[^>]*aria-pressed="false"/);
 expect(JSON.stringify(graph)).toBe(before);
});

it('reserves the shared title row without claiming any result before a local run',()=>{
 const graph=editor.createWorkflowTemplate('branch'),before=JSON.stringify(graph);
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:graph})).replace(/<style>[\s\S]*?<\/style>/g,'');
 expect(html.match(/class="wf-node-title"/g)??[]).toHaveLength(graph.nodes.length);
 expect(html.match(/class="wf-node-label"/g)??[]).toHaveLength(graph.nodes.length);
 expect(html).not.toContain('data-local-run-status=');
 expect(html).not.toMatch(/aria-describedby="[^"]*-local-/);
 expect(JSON.stringify(graph)).toBe(before);
});

it('keeps Registry outside the scrollable view controls with native keyboard targets',()=>{
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:editor.createWorkflowTemplate('branch')}));
 const bar=html.split('<div class="wf-canvasbar">')[1]?.split('<div class="wf-presentation ')[0]??'';
 const controls=bar.match(/<div class="wf-view-controls">([\s\S]*)<\/div><\/div>\s*$/)?.[1];
 expect(controls,'only view, display and zoom/Fit controls belong in the scrolling group').toBeDefined();
 const content=controls??'';
 expect(bar.slice(0,bar.indexOf('<div class="wf-view-controls">'))).toContain('<details class="wf-manifest">');
 expect(content).not.toContain('wf-manifest');
 expect(content).toContain('role="group" aria-label="Workflow view"');
 for(const label of ['Canvas view','Stacked view','Block display','Zoom out','Reset zoom to 100 percent','Zoom in','Fit to graph']){
  expect(content).toMatch(new RegExp(`<(?:button|select) [^>]*aria-label="${label}"`));
 }
 expect(content).toMatch(/aria-label="Canvas view"[^>]*aria-pressed="true"/);
 expect(content).not.toMatch(/(?:tabindex="-1"|hidden=""|inert="")/);
});

it('anchors Registry to the visible canvasbar while only mobile view controls scroll',()=>{
 const rules=Array.from(WORKFLOW_CSS.replace(/\/\*[\s\S]*?\*\//g,'').matchAll(/([^{}]+)\{([^{}]*)\}/g));
 const declarations=(...selectors:string[])=>rules.filter(rule=>rule[1]!.split(',').some(selector=>selectors.includes(selector.trim()))).map(rule=>rule[2]).join(';');
 const manifest=declarations('.wf-manifest-body','.wf-editor .wf-canvasbar .wf-manifest-body');
 expect(manifest).not.toContain('position:fixed');
 expect(manifest).toContain('position:absolute');
 expect(manifest).toContain('top:100%');
 expect(manifest).not.toMatch(/top:\d+px/);
 expect(manifest).toContain('width:min(570px,calc(100% - 24px))');
 expect(manifest).toContain('max-height:var(--workflow-canvas-height,');
 const bar=declarations('.wf-canvasbar','.wf-editor .wf-canvasbar');
 expect(bar).toContain('position:relative');
 expect(bar).toContain('overflow:visible');
 expect(bar).not.toMatch(/overflow(?:-[xy])?:(?:auto|scroll|hidden|clip)/);
 expect(declarations('.wf-manifest')).toContain('position:static');
 const controls=declarations('.wf-view-controls','.wf-editor .wf-view-controls');
 for(const declaration of ['display:flex','align-items:center','min-width:0','overflow-x:auto','flex-wrap:nowrap','scroll-padding:8px'])expect(controls).toContain(declaration);
 expect(declarations('.wf-view-controls>*','.wf-editor .wf-view-controls>*')).toContain('flex-shrink:0');
 expect(declarations('.wf-editor .wf-canvasbar>.wf-manifest')).toContain('flex-shrink:0');
});
