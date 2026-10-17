import {it,expect} from 'vitest';
import {WorkflowEditorStore} from './store';
import * as editor from './WorkflowEditor';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';

import {WORKFLOW_CSS} from './styles';

it('preserves left-aligned Flightdeck palette labels when items are nested in categories',()=>{
 expect(WORKFLOW_CSS.match(/\.wf-palette-item\{([^}]+)/)?.[1]).toContain('text-align:left');
});

it('offers actual drag sources for builtins and reusable blocks without embedding configuration',()=>{
 const store=new WorkflowEditorStore();store.addCustomBlock({id:'customSet',label:'Reusable set',baseType:'set',defaults:{fields:{ready:true}},description:'Reviewed data'},true);
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:store.getSnapshot().graph}));
 expect((html.match(/draggable="true"/g)??[]).length).toBe(builtinRegistry.length+store.getSnapshot().graph.customBlocks.length);
 expect(html).toContain('Reusable set');
});

it('refuses foreign, oversized, malformed, unregistered and config-bearing drag payloads',()=>{
 expect(editor).toHaveProperty('paletteDropType');
 const store=new WorkflowEditorStore();const graph=store.getSnapshot().graph;
 const read=(raw:string,active:string|null='set')=>editor.paletteDropType(raw,active,graph);
 expect(read('set')).toBe('set');
 for(const raw of ['http','unknown','{"type":"set","config":{}}','set'.repeat(100),''])expect(read(raw)).toBeNull();
 expect(read('set',null)).toBeNull();
});

import {builtinRegistry} from '../../packages/workflow/graph';

it('categorizes every real registry entry exactly once and filters reusable blocks by category and search',()=>{
 expect(editor).toHaveProperty('paletteEntries');
 const store=new WorkflowEditorStore();store.addCustomBlock({id:'customSet',label:'Reusable set',baseType:'set',defaults:{fields:{}},description:'Reviewed data'},true);
 const graph=store.getSnapshot().graph;const entries=editor.paletteEntries(graph,'All','');
 expect(entries).toHaveLength(builtinRegistry.length+graph.customBlocks.length);
 expect(new Set(entries.map(e=>e.type)).size).toBe(entries.length);
 expect(entries.every(e=>editor.PALETTE_CATEGORIES.includes(e.category as typeof editor.PALETTE_CATEGORIES[number]))).toBe(true);
 expect(editor.paletteEntries(graph,'Connectors / AI','').map(e=>e.type)).toEqual(['http','resource','llm']);
 expect(editor.paletteEntries(graph,'Reusable blocks','reviewed').map(e=>e.type)).toEqual(['customSet']);
 const html=renderToStaticMarkup(createElement(editor.WorkflowEditor,{initialGraph:graph}));
 expect(html).toContain('Filter block category');expect(html).toContain('Search blocks');expect(html).toContain('Logic / review');
});

it('maps drop coordinates through viewport scroll and zoom, refusing off-canvas or invalid coordinates',()=>{
 expect(editor).toHaveProperty('canvasDropPosition');
 const map=editor.canvasDropPosition;
 expect(map({x:260,y:180},{left:100,top:60,width:500,height:400},240,120,.8)).toEqual({x:500,y:300});
 for(const point of [{x:99,y:180},{x:601,y:180},{x:260,y:NaN}])expect(map(point,{left:100,top:60,width:500,height:400},0,0,1)).toBeNull();
 expect(map({x:260,y:180},{left:100,top:60,width:500,height:400},0,0,0)).toBeNull();
});

it('rejects unknown types and out-of-bounds placement without changing graph or undo history',()=>{
 const store=new WorkflowEditorStore();const before=store.getSnapshot();
 for(const position of [{x:-1,y:0},{x:10001,y:0},{x:0,y:NaN},{x:Infinity,y:0}])expect(()=>store.addNode('set',position)).toThrow();
 expect(()=>store.addNode('foreign',{x:50,y:50})).toThrow('Unknown block type');
 expect(store.getSnapshot()).toBe(before);expect(store.getSnapshot().canUndo).toBe(false);
});

it('inserts a dropped block at explicit coordinates with one atomic undo and immutable defaults',()=>{
 const store=new WorkflowEditorStore();const before=store.getSnapshot().graph;
 const id=store.addNode('set',{x:432.5,y:218});
 expect(store.getSnapshot().graph.nodes[0]).toMatchObject({id,position:{x:432.5,y:218},config:{fields:{}}});
 expect(before.nodes).toEqual([]);
 store.undo();expect(store.getSnapshot().graph.nodes).toEqual([]);expect(store.getSnapshot().canUndo).toBe(false);
 store.redo();expect(store.getSnapshot().graph.nodes[0]!.position).toEqual({x:432.5,y:218});
});
