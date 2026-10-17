import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowEditor,createWorkflowTemplate} from './WorkflowEditor';
import {builtinRegistry} from '../../packages/workflow/graph';

it('prioritizes builtin reuse with truthful graph-local wrapper provenance and usage',()=>{
 const graph=createWorkflowTemplate('http');
 graph.customBlocks=[{id:'normalize',label:'Normalize request',baseType:'set',defaults:{fields:{ready:true}},description:'Local reusable defaults'}];
 graph.nodes.push({id:'wrapped',type:'normalize',label:'Normalize',config:{},position:{x:910,y:150}},{id:'missing',type:'unconfigured',label:'Missing capability',config:{description:'Pending setup'},position:{x:910,y:330}});
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:graph}));
 expect(html).toContain('aria-label="Block composer"');
 expect(html).toContain('Reuse a block');
 expect(html).toContain('Graph-local wrappers');
 expect(html).toContain('Local definition · base set · 1 in graph');
 expect(html).toContain('Builtin · 1 in graph');
 expect(html).toContain('Placeholder · execution blocked');
 expect(html).toContain('Not a published library or resource activation');
 expect(html).toContain('Need different defaults?');
 expect((html.match(/draggable="true"/g)??[]).length).toBe(builtinRegistry.length+1);
 expect(html).not.toMatch(/Generating block|Activating wrapper|Agent tasks/);
});

it('consolidates workspace commands above the canvas with honest manifest facts',()=>{
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:createWorkflowTemplate('branch')}));
 const header=html.match(/<header class="wf-header[\s\S]*?<\/header>/)?.[0]??'';
 expect(header.includes('aria-label="Workflow workspace"')).toBe(true);
 for(const control of ['Add or search blocks','Toggle node inspector','Undo','Redo','Document','Explain workflow','Run locally'])expect(header.includes(control),control).toBe(true);
 expect(html.includes('aria-label="Graph composition facts"')).toBe(true);
 for(const fact of ['Existing builtin instances','Graph-local wrapper definitions','Unresolved capabilities'])expect(html.includes(fact),fact).toBe(true);
 expect(html.includes('Final design is not execution')).toBe(true);
});
