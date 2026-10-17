import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkflowEditor,createWorkflowTemplate} from './WorkflowEditor';
import * as editor from './WorkflowEditor';
import {graphSchema,type Graph} from '../../packages/workflow/graph';
import {WORKFLOW_CSS} from './styles';

it('reveals only explicitly accepted AI topology with capped visual-only motion and host-sized canvas',()=>{
 const graph=createWorkflowTemplate('branch');
 const local=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:graph}));
 const ai=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:graph,buildReveal:true}));
 expect((ai.match(/class="wf-node-content wf-reveal-node"/g)??[]).length).toBe(graph.nodes.length);
 expect(local).not.toContain('class="wf-node-content wf-reveal-node"');
 expect(ai).toContain('wf-reveal-edge');
 expect(WORKFLOW_CSS).toContain('--workflow-canvas-height');
 expect(WORKFLOW_CSS).toContain('@media(prefers-reduced-motion:reduce)');
 expect(WORKFLOW_CSS.match(/@keyframes wf-node-reveal\{([\s\S]*?)\n/)?.[1]).not.toMatch(/transform|left|top/);
});

function fixture():Graph {
 const graph=createWorkflowTemplate('branch');
 graph.customBlocks=[{id:'normalize',label:'Normalize request',baseType:'set',defaults:{fields:{ready:true}},description:'Normalize reviewed input'}];
 graph.nodes.push({id:'wrapped',type:'normalize',label:'Normalize',position:{x:900,y:200},config:{},inputMappings:[{target:'label',source:{kind:'literal',value:'private user value'}}]},{id:'reference',type:'resource',label:'Resource',position:{x:900,y:400},config:{resourceId:'ba9acba0-752e-4c44-8c4a-603754b44a18',revision:2,functionId:'measure'}});
 return graphSchema.parse(graph);
}

it('derives the build manifest from actual builtin instances, wrapper definitions, references and mappings',()=>{
 expect(editor).toHaveProperty('workflowBuildManifest');
 const manifest=editor.workflowBuildManifest(fixture());
 expect(manifest.counts).toEqual({nodes:6,connections:3,existingBlocks:5,reusableWrappers:1,wrapperDefinitions:1,resourceReferences:1,mappings:1,mappedNodes:1,unresolved:0,configurationWarnings:0});
 expect(manifest.nodes.find(n=>n.id==='wrapped')).toMatchObject({kind:'wrapper',baseType:'set',family:'Data',mappingCount:1,configSummary:'1 field · ready:boolean'});
 expect(manifest.nodes.find(n=>n.id==='node1')).toMatchObject({defaultsSummary:'Field missing · equals',configSummary:'approved · equals'});
 expect(manifest.nodes.find(n=>n.id==='reference')?.warnings).toEqual([]);
 expect(manifest.wrappers[0]).toMatchObject({id:'normalize',baseType:'set',instanceCount:1,description:'Normalize reviewed input',defaultsSummary:'1 field · ready:boolean'});
 expect(JSON.stringify(manifest)).not.toContain('private user value');
});

it('keeps the registry manifest collapsed near the canvas and links actual nodes to settings',()=>{
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:fixture(),buildReveal:true}));
 expect(html).toContain('Registry / build manifest');
 expect(html).toContain('5 existing blocks');expect(html).toContain('1 reusable wrapper instance');
 expect(html).toContain('AI graph declarations · review required');
 expect(html).toContain('Open block settings for Normalize');
 expect(html).toContain('Resource references do not grant access');
 expect(html).not.toContain('private user value');
 expect(html).toMatch(/<details class="wf-manifest">/);
 expect(html).not.toMatch(/Building node|Tools used|percent complete/i);
});

it('renders safe typed configuration and real registry origins on functional node cards',()=>{
 const html=renderToStaticMarkup(createElement(WorkflowEditor,{initialGraph:fixture()}));
 expect(html.includes('wf-node-origin')).toBe(true);
 expect(html.includes('Existing block')).toBe(true);
 expect(html.includes('Reusable wrapper')).toBe(true);
 expect(html.includes('ready:boolean')).toBe(true);
 expect(html.includes('approved · equals')).toBe(true);
 expect(html.includes('JSON in')).toBe(true);
 expect(html.includes('JSON out')).toBe(true);
 expect(html).not.toContain('private user value');
});

it('counts registered unconfigured placeholders as unresolved capabilities, not usable execution adapters',()=>{
 const graph=createWorkflowTemplate('http');
 graph.nodes.push({id:'missingCapability',type:'unconfigured',label:'Needs a block',position:{x:900,y:100},config:{description:'Missing capability'}});
 const manifest=editor.workflowBuildManifest(graph);
 expect(manifest.counts.unresolved).toBe(1);
 expect(manifest.counts.configurationWarnings).toBe(2);
 expect(manifest.nodes[3]).toMatchObject({kind:'builtin',configSummary:'Execution blocked',warnings:['Executor unconfigured']});
});

it('reports missing configuration and unresolved registry nodes without leaking payloads or secrets',()=>{
 const graph=createWorkflowTemplate('http');
 graph.nodes.push({id:'model',type:'llm',label:'Model',config:{instruction:'private customer instruction',model:'private model label'},position:{x:0,y:0}},{id:'reference',type:'resource',label:'Resource',config:{},position:{x:0,y:0}},{id:'unknown',type:'absent',label:'Unknown',config:{},position:{x:0,y:0}});
 graph.customBlocks=[{id:'normalize',label:'Normalize',baseType:'set',defaults:{fields:{label:'private customer value'}},description:'Reviewed data shape'}];
 const manifest=editor.workflowBuildManifest(graph);
 expect(manifest.counts).toMatchObject({nodes:6,existingBlocks:5,unresolved:1,configurationWarnings:3,resourceReferences:1});
 expect(manifest.nodes.find(n=>n.id==='unknown')).toMatchObject({kind:'unresolved',baseType:null,warnings:['Unknown registry type']});
 expect(manifest.nodes.find(n=>n.id==='reference')?.warnings).toEqual(['Resource ID / active revision / function reference missing']);
 expect(JSON.stringify(manifest)).not.toMatch(/private customer|private model/);
 expect(manifest.wrappers[0]?.defaultsSummary).toBe('1 field · label:string');
});
