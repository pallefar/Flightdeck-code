import {describe,it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowFragmentReview,localFragmentExample} from './WorkflowFragmentReview';
import {WorkflowEditorStore} from './store';
import {createEmptyGraph,type GraphNode} from '../../packages/workflow/graph';
import {createWorkflowRunner} from '../../packages/workflow/engine';
import {WORKFLOW_COMPOSITION_LIMITS} from '../../packages/workflow/composition';
function host(){const node=(id:string,type:string,config:GraphNode['config']={}):GraphNode=>({id,type,label:id,position:{x:0,y:0},config});return {...createEmptyGraph(),nodes:[node('start','manual'),node('slot','unconfigured',{description:'Local slot'}),node('done','output')],edges:[{id:'in',source:'start',target:'slot'},{id:'out',source:'slot',target:'done'}]};}
describe('fragment review surface',()=>{
 it('bounds the editable source itself before byte-bound inspection',()=>{
  const store=new WorkflowEditorStore(host()),session=store.beginFragmentReview('slot');
  const html=renderToStaticMarkup(createElement(WorkflowFragmentReview,{store,session,active:true,onClose:()=>{},onApplied:()=>{}}));
  expect(html).toMatch(new RegExp(`aria-label="Fragment graph JSON"[^>]*maxLength="${WORKFLOW_COMPOSITION_LIMITS.maxBytes}"`,'i'));
 });
 it('labels the source local-only and keeps fragment checkbox selectors separate from wrapper review',()=>{
  const store=new WorkflowEditorStore(host()),session=store.beginFragmentReview('slot');
  const html=renderToStaticMarkup(createElement(WorkflowFragmentReview,{store,session,active:true,onClose:()=>{},onApplied:()=>{}}));
  for(const text of ['Local example initially','not AI-generated','no authoritative host protection binding','original run seed','unavoidable','Fragment entry ID','Fragment exit ID','Fragment namespace','wf-fragment-reviewed'])expect(html).toContain(text);
  expect(html).not.toContain('class="wf-checkbox"');expect(html).toContain('class="wf-fragment-checkbox"');expect(html).toMatch(/type="checkbox" disabled=""/);
 });
 it('provides an ordinary supported deterministic branch example with exact preserved coordinates',async()=>{
  const store=new WorkflowEditorStore(host()),session=store.beginFragmentReview('slot'),example=localFragmentExample();
  const preview=store.previewFragment(session,{namespace:'part',fragment:{entryId:'entry',exitId:'exit',graph:example}});
  expect(preview.graph.nodes.filter(n=>n.id.startsWith('part_')).map(n=>n.position)).toEqual(example.nodes.map(n=>n.position));
  for(const selected of [true,false]){
   const result=await createWorkflowRunner(preview.graph).run({selected});expect(result.status).toBe('completed');expect(result.output).toEqual({selected,path:selected?'yes':'no'});
  }
  expect(store.getSnapshot().canUndo).toBe(false);
 });
});
