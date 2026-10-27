import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import * as editor from './WorkflowEditor';
import {WORKFLOW_CSS} from './styles';

it('offers an explicit Canvas / Stacked view choice without changing the default graph',()=>{
 const graph=editor.createWorkflowTemplate('branch'),before=JSON.stringify(graph);
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:graph}));
 expect(html).toContain('role="menubar"');
 expect(html).toContain('aria-label="Workflow application menu"');
 for(const menu of ['File','Edit','View','Insert','Run','Help'])expect(html).toContain(`aria-label="${menu} menu"`);
 expect(html).toContain('data-workflow-view="canvas"');
 const bar=html.split('<div class="wf-canvasbar">')[1]?.split('<div class="wf-presentation ')[0]??'';
 expect(bar).toContain('aria-label="Workflow view status"');
 expect(bar).not.toContain('aria-label="Canvas view"');
 expect(bar).not.toContain('aria-label="Stacked view"');
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

it('keeps Registry outside application dropdowns with native keyboard targets',()=>{
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:editor.createWorkflowTemplate('branch')}));
 const bar=html.split('<div class="wf-canvasbar">')[1]?.split('<div class="wf-presentation ')[0]??'';
 const summary=bar.split('<span class="wf-view-summary"')[1];
 expect(summary,'layout/display/zoom commands belong in View; canvas chrome contains status only').toBeDefined();
 const content=summary??'';
 expect(bar.slice(0,bar.indexOf('<span class="wf-view-summary"'))).toContain('<details class="wf-manifest">');
 expect(content).not.toContain('wf-manifest');
 expect(content).toContain('aria-label="Workflow view status"');
 expect(bar).not.toContain('class="wf-view-controls"');
 expect(bar).not.toMatch(/<(?:button|select) [^>]*aria-label="(?:Canvas view|Stacked view|Block display|Zoom out|Zoom in|Fit to graph)"/);
 expect(content).not.toMatch(/(?:tabindex="-1"|hidden=""|inert="")/);
});

it('anchors Registry to the visible canvasbar without scrolling its containing toolbar',()=>{
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
 expect(declarations('.wf-view-summary')).toContain('min-width:0');
 expect(declarations('.wf-view-controls','.wf-editor .wf-view-controls')).toBe('');
 expect(declarations('.wf-editor .wf-canvasbar>.wf-manifest')).toContain('flex-shrink:0');
});
