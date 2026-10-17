import { describe, it, expect } from 'vitest';
import { createEmptyGraph, graphSchema, validateGraph, builtinRegistry } from './graph';
describe('graph validation', () => {
 it('creates a strict reusable draft with builtins and rejects unsafe definitions', () => {
  const g = createEmptyGraph(); expect(graphSchema.parse(g).version).toBe(1);
  expect(builtinRegistry.map(b => b.type)).toContain('approval');
  expect(graphSchema.safeParse({...g, surprise:true}).success).toBe(false);
  expect(validateGraph({...g,nodes:[{id:'a',type:'http',label:'HTTP',position:{x:0,y:0},config:{url:'https://user:secret@example.com',method:'GET'}}]}).ok).toBe(false);
 });
 it('rejects duplicate IDs, dangling references, cycles and approval wrappers', () => {
  const g=createEmptyGraph();const n={id:'a',type:'set',label:'Set',position:{x:0,y:0},config:{fields:{}}};
  expect(validateGraph({...g,nodes:[n,n]}).ok).toBe(false);
  expect(validateGraph({...g,edges:[{id:'e',source:'a',target:'missing'}]}).ok).toBe(false);
  expect(validateGraph({...g,nodes:[n],edges:[{id:'e',source:'a',target:'a'}]}).ok).toBe(false);
  expect(validateGraph({...g,customBlocks:[{id:'custom',label:'Unsafe',baseType:'approval',defaults:{},description:''}]}).ok).toBe(false);
  expect(validateGraph({...g,customBlocks:[{id:'custom',label:'Unsafe',baseType:'set',defaults:{code:'eval(x)'},description:''}]}).ok).toBe(false);
 });
 it('refuses prototype names, deeply nested secret fields and unsafe inline URL credentials',()=>{
  const g=createEmptyGraph();const n={id:'a',type:'constructor',label:'Unsafe',position:{x:0,y:0},config:{}};
  expect(validateGraph({...g,nodes:[n]}).ok).toBe(false);
  expect(validateGraph({...g,nodes:[{...n,type:'set',config:{fields:{nested:{password:'inline-secret'}}}}]}).ok).toBe(false);
  expect(validateGraph({...g,nodes:[{...n,type:'set',config:{fields:{url:'https://user:password@example.com'}}}]}).ok).toBe(false);
 });
});
