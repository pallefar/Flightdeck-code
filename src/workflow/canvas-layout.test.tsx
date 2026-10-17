import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import * as editor from './WorkflowEditor';
import {WorkflowEditorStore} from './store';

it('defaults to Expanded with View-menu controls and smaller Compact geometry',()=>{
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:editor.createWorkflowTemplate('branch')}));
 expect(html).toContain('aria-label="View menu"');expect(html).toContain('Canvas · expanded · 100%');
 expect(html).not.toContain('aria-label="Block display"');
 expect(editor).toHaveProperty('nodeLayout');
 const expanded=editor.nodeLayout('expanded'),compact=editor.nodeLayout('compact');
 expect(expanded).toEqual({width:220,height:144,anchorY:124});
 expect(compact).toEqual({width:176,height:88,anchorY:68});
 const store=new WorkflowEditorStore(editor.createWorkflowTemplate('branch'));const before=store.exportJson();
 editor.nodeLayout('compact');expect(store.exportJson()).toBe(before);expect(store.getSnapshot().canUndo).toBe(false);
});

it('fits the visible graph bounds without changing positions or history',()=>{
 expect(editor).toHaveProperty('fitGraphViewport');
 const store=new WorkflowEditorStore(editor.createWorkflowTemplate('branch'));const before=store.exportJson();
 for(const display of ['expanded','compact'] as const){
  const viewport={width:604,height:310};const fit=editor.fitGraphViewport(store.getSnapshot().graph.nodes,display,viewport);
  const layout=editor.nodeLayout(display);
  for(const n of store.getSnapshot().graph.nodes){
   expect(n.position.x*fit.zoom-fit.scrollLeft).toBeGreaterThanOrEqual(0);
   expect(n.position.y*fit.zoom-fit.scrollTop).toBeGreaterThanOrEqual(0);
   expect((n.position.x+layout.width)*fit.zoom-fit.scrollLeft).toBeLessThanOrEqual(viewport.width);
   expect((n.position.y+layout.height)*fit.zoom-fit.scrollTop).toBeLessThanOrEqual(viewport.height);
  }
 }
 expect(store.exportJson()).toBe(before);expect(store.getSnapshot().canUndo).toBe(false);
});

it('fits empty and distant graphs safely and uses compact dimensions',()=>{
 expect(editor).toHaveProperty('fitGraphViewport');
 expect(editor.fitGraphViewport([],'expanded',{width:0,height:0})).toEqual({zoom:1,scrollLeft:0,scrollTop:0});
 const nodes=editor.createWorkflowTemplate('branch').nodes;
 const distant=nodes.map((n,i)=>({...n,position:{x:i*3300,y:i*3300}}));
 const fit=editor.fitGraphViewport(distant,'expanded',{width:320,height:300});
 expect(fit.zoom).toBeGreaterThan(0);expect(fit.zoom).toBeLessThan(.05);
 expect(fit.scrollLeft).toBeGreaterThanOrEqual(0);expect(fit.scrollTop).toBeGreaterThanOrEqual(0);
 expect(editor.fitGraphViewport(nodes,'compact',{width:600,height:300}).zoom).toBeGreaterThan(editor.fitGraphViewport(nodes,'expanded',{width:600,height:300}).zoom);
 const negative=nodes.map(n=>({...n,position:{x:-100,y:-100}}));
 expect(Object.values(editor.fitGraphViewport(negative,'expanded',{width:1,height:1})).every(Number.isFinite)).toBe(true);
});

it('routes connections at display-specific node boundaries and tracks preview movement',()=>{
 expect(editor).toHaveProperty('connectionPath');
 expect(editor.connectionPath({x:70,y:150},{x:350,y:150},'expanded')).toBe('M290,274 C380,274 260,274 350,274');
 expect(editor.connectionPath({x:70,y:150},{x:350,y:150},'compact')).toBe('M246,218 C336,218 260,218 350,218');
 expect(editor.connectionPath({x:100,y:200},{x:350,y:150},'compact')).toContain('M276,268');
});
