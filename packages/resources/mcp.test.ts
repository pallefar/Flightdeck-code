import { it,expect } from 'vitest';
import Fastify from 'fastify';
import { mkdtemp,rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from './store';
import { ResourceRegistry } from './registry';
import { registerDevelopmentMcp, graphInput, graphOutput } from './development-mcp';
it('invokes real DEVELOPMENT graph-validation MCP through initialization, selected tools/list and tools/call',async()=>{
  const app=Fastify(); registerDevelopmentMcp(app,authorization=>authorization==='Bearer reference-test');
  const origin=await app.listen({host:'127.0.0.1',port:0});
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-mcp-'));
  const store=new ResourceStore(root);
  const registry=new ResourceRegistry([{id:'validate',kind:'mcp',projects:['a'],endpoint:origin+'/mcp',tool:'validate_graph',readOnly:true,input:graphInput,output:graphOutput,credential:{ref:'development',origin,header:'authorization'}}],{developmentOrigins:[origin]},async()=>'Bearer reference-test');
  try {
    const draft=await store.propose('a',{name:'DEVELOPMENT graph validator',functions:['validate']},'operator');
    const active=await registry.activate(store,'a',draft.id,1,'reviewer');
    const result=await registry.execute(active,'validate',{nodes:['a','b'],edges:[{from:'a',to:'b'}]},'operator');
    expect(result.output).toEqual({valid:true,nodeCount:2,edgeCount:1});
    console.info('REAL DEVELOPMENT MCP smoke', JSON.stringify({tool:'validate_graph',output:result.output,durationMs:result.durationMs}));
    expect((await registry.execute(active,'validate',{nodes:['a','b'],edges:[{from:'a',to:'b'},{from:'b',to:'a'}]},'operator')).output).toEqual({valid:false,nodeCount:2,edgeCount:2});
    await expect(registry.execute(active,'unapproved',{},'operator')).rejects.toMatchObject({statusCode:409});
    const wrong=new ResourceRegistry([{id:'validate',kind:'mcp',projects:['a'],endpoint:origin+'/mcp',tool:'unapproved_tool',readOnly:true,input:graphInput,output:graphOutput,credential:{ref:'development',origin,header:'authorization'}}],{developmentOrigins:[origin]},async()=>'Bearer reference-test');
    await expect(wrong.execute(active,'validate',{nodes:[],edges:[]},'operator')).rejects.toMatchObject({statusCode:409});
    const missingDraft=await store.propose('a',{name:'Selected tool is not offered',functions:['validate']},'operator');
    const missingActive=await wrong.activate(store,'a',missingDraft.id,1,'reviewer');
    await expect(wrong.execute(missingActive,'validate',{nodes:[],edges:[]},'operator')).rejects.toMatchObject({statusCode:409});
    expect((await app.inject({method:'POST',url:'/mcp',headers:{authorization:'Bearer reference-test',origin:'https://evil.example'},payload:{}})).statusCode).toBe(403);
  } finally {await app.close();await rm(root,{recursive:true,force:true});}
});
