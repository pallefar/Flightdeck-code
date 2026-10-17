import {createElement,isValidElement,type ReactElement,type ReactNode} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {createEmptyGraph,type BuiltinType,type Graph,type GraphNode} from '../../packages/workflow/graph';
import {NodeParameters,createParameterDraft,hasAdvancedParameterDraft,applyQuickParameterDraft,QUICK_PARAMETER_DRAFT_MESSAGE} from './NodeParameters';

// Bounded hook-state fixture for the real form callbacks, not native DOM proof.
// The parent browser regression separately checks retained actual field nodes.
const hooks=vi.hoisted(()=>({active:false,index:0,slots:[] as unknown[]}));
vi.mock('react',async importOriginal=>{
 const actual=await importOriginal<typeof import('react')>();
 return {...actual,useState:(initial:unknown)=>{
  if(!hooks.active)return actual.useState(initial);
  const index=hooks.index++;
  if(!(index in hooks.slots))hooks.slots[index]=typeof initial==='function'?initial():initial;
  return [hooks.slots[index],(next:unknown)=>{hooks.slots[index]=typeof next==='function'?next(hooks.slots[index]):next;}];
 }};
});
afterEach(()=>{hooks.active=false;hooks.slots=[];hooks.index=0;});

type Props=Parameters<typeof NodeParameters>[0] & {level?:'quick'|'extended'};
type ElementProps={children?:ReactNode;hidden?:boolean;disabled?:boolean;'aria-label'?:string;'data-level'?:string;onClick?:()=>void;onChange?:(event:{target:{value:string}})=>void;onFocus?:()=>void;value?:unknown;role?:string};
function formFixture(graph:Graph,node=graph.nodes[1]!){
 hooks.active=true;hooks.slots=[];
 let updates=0,dirty=0,level:'quick'|'extended'='quick';
 const props:Props={graph,node,level,update:()=>{updates++;return {ok:true};},onDraftChange:()=>{dirty++;}};
 function render(nextLevel=level){
  level=nextLevel;hooks.index=0;
  const element=NodeParameters({...props,level}) as ReactElement<Props>;
  const Component=element.type as (props:Props)=>ReactElement;
  return {key:element.key,tree:Component(element.props)};
 }
 return {render,get updates(){return updates;},get dirty(){return dirty;}};
}
function controls(tree:ReactNode){
 const result:{element:ReactElement<ElementProps>;hidden:boolean;disabled:boolean;path:string}[]=[];
 function visit(child:ReactNode,hidden=false,disabled=false,path='root'){
  if(Array.isArray(child)){child.forEach((entry,index)=>visit(entry,hidden,disabled,`${path}.${index}`));return;}
  if(!isValidElement<ElementProps>(child))return;
  const props=child.props;hidden=hidden||props.hidden===true;disabled=disabled||props.disabled===true;
  result.push({element:child,hidden,disabled,path});visit(props.children,hidden,disabled,`${path}.children`);
 }
 visit(tree);return result;
}
function field(tree:ReactNode,label:string){
 const match=controls(tree).find(({element})=>element.props['aria-label']===label);
 expect(match,`actual form field ${label}`).toBeDefined();return match!;
}
function applyButton(tree:ReactNode){
 const match=controls(tree).find(({element})=>element.type==='button'&&element.props.children==='Apply settings');
 expect(match).toBeDefined();return match!;
}

function fixture(type:string,config:GraphNode['config']={}):Graph {
 return {...createEmptyGraph(),nodes:[
  {id:'start',type:'manual',label:'Start',position:{x:0,y:0},config:{}},
  {id:'edit',type,label:'Edit',position:{x:250,y:0},config},
  {id:'end',type:'output',label:'End',position:{x:500,y:0},config:{}},
 ],edges:[{id:'first',source:'start',target:'edit'},{id:'last',source:'edit',target:'end',...(type==='branch'?{sourcePort:'true' as const}:{})}]};
}

const advancedCases:[BuiltinType,string,GraphNode['config'][string]][]=[
 ['http','service','slack'],['http','credentialRef','otherVault'],['http','bodyText','{"count":2}'],
 ['llm','model','development-model'],['resource','revision','2'],['approval','reason','Review a change'],
];

describe('quick parameter draft boundary',()=>{
 it.each(advancedCases)('refuses hidden %s.%s edits before the update callback',(type,key,value)=>{
  const graph=fixture(type),node=graph.nodes[1]!,draft=createParameterDraft(graph,node);
  expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(false);
  draft.config[key]=value;
  const before=JSON.stringify(draft);let updates=0;
  expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(true);
  expect(applyQuickParameterDraft(graph,node,draft,()=>{updates++;return {ok:true};})).toEqual({ok:false,error:QUICK_PARAMETER_DRAFT_MESSAGE});
  expect(updates).toBe(0);expect(JSON.stringify(draft)).toBe(before);
 });
 it('refuses JSON-mode drafts even when valid or equal to stored JSON, without mutation',()=>{
  const graph=fixture('llm',{instruction:'Original'}),node=graph.nodes[1]!,draft=createParameterDraft(graph,node);
  draft.mode='json';let updates=0;
  for(const text of ['{"instruction":"Changed"}',draft.advanced,'unfinished JSON']){
   draft.advanced=text;expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(true);
   expect(applyQuickParameterDraft(graph,node,draft,()=>{updates++;return {ok:true};})).toEqual({ok:false,error:QUICK_PARAMETER_DRAFT_MESSAGE});
   expect(draft.advanced).toBe(text);expect(draft.mode).toBe('json');
  }
  expect(updates).toBe(0);
 });
 it('compares effective reusable defaults and preserves untouched inheritance on quick Apply',()=>{
  const graph=fixture('wrapped');graph.customBlocks=[{id:'wrapped',label:'Wrapped',baseType:'http',description:'Reviewed declaration',defaults:{url:'https://example.com',method:'POST',service:'generic',credentialRef:'teamVault',body:{count:1}}}];
  const node=graph.nodes[1]!,draft=createParameterDraft(graph,node);
  expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(false);
  draft.config.method='PATCH';let saved:unknown;
  expect(applyQuickParameterDraft(graph,node,draft,config=>{saved=config;return {ok:true};})).toEqual({ok:true});
  expect(saved).toEqual({method:'PATCH'});
  draft.config.credentialRef='otherVault';expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(true);
  draft.config.credentialRef='teamVault';expect(hasAdvancedParameterDraft(graph,node,draft)).toBe(false);
 });
 it('does not mistake quick branch JSON or typed set rows for hidden edits',()=>{
  const branch=fixture('branch'),node=branch.nodes[1]!,draft=createParameterDraft(branch,node);
  draft.config={...draft.config,field:'ready',valueText:'true'};
  expect(hasAdvancedParameterDraft(branch,node,draft)).toBe(false);
  const set=fixture('set'),setNode=set.nodes[1]!,setDraft=createParameterDraft(set,setNode);
  setDraft.rows=[{name:'count',type:'number',value:'2'}];
  expect(hasAdvancedParameterDraft(set,setNode,setDraft)).toBe(false);
 });
});

describe('quick versus extended form surface',()=>{
 it('retains a quick typed draft across extended open/close without applying it',()=>{
  const form=formFixture(fixture('llm',{instruction:'Original'}));
  const quick=form.render('quick');
  field(quick.tree,'Instruction').element.props.onChange!({target:{value:'Pending quick instruction'}});
  const full=form.render('extended'),returned=form.render('quick');
  expect(full.key).toBe(quick.key);expect(returned.key).toBe(quick.key);
  expect(field(full.tree,'Instruction').element.props.value).toBe('Pending quick instruction');
  expect(field(returned.tree,'Instruction').element.props.value).toBe('Pending quick instruction');
  expect(form.updates).toBe(0);expect(form.dirty).toBe(1);
  applyButton(returned.tree).element.props.onClick!();expect(form.updates).toBe(1);
 });
 it('quick typed set rows are visible and JSON mode locks Add, Remove and edits without discarding the source',()=>{
  const form=formFixture(fixture('set',{fields:{count:1}})),full=form.render('extended');
  field(full.tree,'Node configuration JSON').element.props.onChange!({target:{value:'{"fields":{"count":2}}'}});
  const quick=form.render('quick');
  for(const label of ['Field 1 name','Field 1 type','Field 1 value','Remove field 1']){
   expect(field(quick.tree,label).hidden).toBe(false);expect(field(quick.tree,label).disabled).toBe(true);
  }
  const add=controls(quick.tree).find(({element})=>element.type==='button'&&element.props.children==='Add field')!;
  expect(add.disabled).toBe(true);add.element.props.onClick!();
  field(quick.tree,'Remove field 1').element.props.onClick!();
  field(quick.tree,'Field 1 value').element.props.onChange!({target:{value:'3'}});
  expect(hooks.slots[0]).toMatchObject({mode:'json',advanced:'{"fields":{"count":2}}',rows:[{name:'count',value:'1'}]});
  expect(form.updates).toBe(0);expect(form.dirty).toBe(1);
 });
 it('full Apply retains original strict validation after a JSON draft was blocked in quick controls',()=>{
  const form=formFixture(fixture('http')),full=form.render('extended');
  field(full.tree,'Node configuration JSON').element.props.onChange!({target:{value:'{"url":"http://example.com","credentialRef":"developmentVault"}'}});
  applyButton(form.render('quick').tree).element.props.onClick!();expect(form.updates).toBe(0);
  applyButton(form.render('extended').tree).element.props.onClick!();expect(form.updates).toBe(0);
  expect(renderToStaticMarkup(form.render('extended').tree)).toContain('Use HTTPS');
 });
 it.each([
  ['http',['HTTP URL','HTTP method'],['Service','Credential reference','HTTP body JSON']],
  ['llm',['Instruction'],['Model']],
  ['resource',['Resource ID','Function ID'],['Active resource revision']],
  ['approval',['Reviewer'],['Review reason']],
  ['branch',['Condition field','Condition operator','Condition value JSON'],[]],
  ['unconfigured',['Description'],[]],
 ] as const)('shows only the main %s fields while retaining all advanced elements',(type,quick,advanced)=>{
  const graph=fixture(type,type==='unconfigured'?{description:'Draft step'}:{}),form=formFixture(graph);
  const first=form.render('quick');
  for(const label of quick)expect(field(first.tree,label).hidden).toBe(false);
  for(const label of [...advanced,'Node configuration JSON'])expect(field(first.tree,label).hidden).toBe(true);
  const full=form.render('extended');
  expect(full.key).toBe(first.key);
  for(const label of [...quick,...advanced,'Node configuration JSON']){
   expect(field(full.tree,label).hidden).toBe(false);
   expect(field(full.tree,label).path).toBe(field(first.tree,label).path);
   expect(field(full.tree,label).element.type).toBe(field(first.tree,label).element.type);
  }
  expect(form.updates).toBe(0);expect(form.dirty).toBe(0);
 });
 it.each(['manual','output'])('has no visible quick Apply or JSON for parameterless %s',(type)=>{
  const graph=fixture(type),form=formFixture(graph,type==='manual'?graph.nodes[0]!:graph.nodes[2]!);
  const quick=form.render('quick').tree;
  expect(applyButton(quick).hidden).toBe(true);expect(field(quick,'Node configuration JSON').hidden).toBe(true);
  expect(applyButton(form.render('extended').tree).hidden).toBe(false);
 });
 it('defaults old callers to the complete extended controls',()=>{
  const graph=fixture('http');
  const html=renderToStaticMarkup(createElement(NodeParameters,{graph,node:graph.nodes[1]!,update:()=>({ok:true as const})}));
  expect(html).toContain('data-level="extended"');expect(html).toContain('Advanced JSON');
  expect(html).toContain('Credential reference');expect(html).toContain('Apply settings');
 });
 it.each(advancedCases)('retains pending %s.%s values and refuses a forced quick callback',(type,key,value)=>{
  const labels:Record<string,string>={service:'Service',credentialRef:'Credential reference',bodyText:'HTTP body JSON',model:'Model',revision:'Active resource revision',reason:'Review reason'};
  const form=formFixture(fixture(type)),full=form.render('extended');
  field(full.tree,labels[key]!).element.props.onChange!({target:{value:String(value)}});
  const quick=form.render('quick');
  expect(field(quick.tree,labels[key]!).element.props.value).toBe(String(value));
  expect(applyButton(quick.tree).disabled).toBe(true);
  expect(renderToStaticMarkup(quick.tree)).toContain(QUICK_PARAMETER_DRAFT_MESSAGE);
  applyButton(quick.tree).element.props.onClick!();expect(form.updates).toBe(0);
  const reopened=form.render('extended');
  expect(reopened.key).toBe(full.key);expect(field(reopened.tree,labels[key]!).element.props.value).toBe(String(value));
  expect(form.dirty).toBe(1);
 });
 it('locks quick typed controls while retaining JSON and only full Apply saves it',()=>{
  const form=formFixture(fixture('llm',{instruction:'Original'}));
  const full=form.render('extended');
  field(full.tree,'Node configuration JSON').element.props.onChange!({target:{value:'{"instruction":"From JSON","model":"development-model"}'}});
  const quick=form.render('quick');
  expect(field(quick.tree,'Instruction').disabled).toBe(true);
  expect(applyButton(quick.tree).disabled).toBe(true);
  // Forced callbacks are guarded as well as native fieldset disabling.
  field(quick.tree,'Instruction').element.props.onChange!({target:{value:'Discard JSON'}});
  expect(field(form.render('quick').tree,'Node configuration JSON').element.props.value).toBe('{"instruction":"From JSON","model":"development-model"}');
  expect(hooks.slots[0]).toMatchObject({mode:'json'});
  applyButton(form.render('quick').tree).element.props.onClick!();expect(form.updates).toBe(0);
  const reopened=form.render('extended');
  expect(field(reopened.tree,'Instruction').disabled).toBe(false);
  applyButton(reopened.tree).element.props.onClick!();expect(form.updates).toBe(1);
  expect(field(form.render('quick').tree,'Instruction').element.props.value).toBe('From JSON');
 });
});
