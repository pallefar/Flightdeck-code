import { it, expect } from 'vitest';
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { ResourceStore } from './store';
import { ResourceRegistry } from './registry';
import { requestJson } from './transport';
it('rejects self-review and response credential echo',async()=>{
  const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-security-'));
  const server=createServer((req,res)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify({text:req.headers.authorization?.replace(/^Bearer /,'')}));});server.listen(0,'127.0.0.1');await once(server,'listening');
  const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try {
    const store=new ResourceStore(root),registry=new ResourceRegistry([{id:'echo',kind:'rest',projects:['a'],endpoint:origin,method:'GET',input:{type:'object',properties:{},required:[],additionalProperties:false},output:{type:'object',properties:{text:{type:'string'}},required:['text'],additionalProperties:false},credential:{ref:'vault-ref',origin,header:'authorization'}}],{developmentOrigins:[origin]},async()=> 'Bearer secret-value');
    const draft=await store.propose('a',{name:'Echo',functions:['echo']},'operator');
    await expect(registry.activate(store,'a',draft.id,1,'operator')).rejects.toMatchObject({statusCode:403});
    const active=await registry.activate(store,'a',draft.id,1,'independent-reviewer');
    await expect(registry.execute(active,'echo',{},'operator')).rejects.toMatchObject({statusCode:502});
    const outside=join(root,'outside');await writeFile(outside,'1',{mode:0o600});await rm(join(root,'a',draft.id,'head'));await symlink(outside,join(root,'a',draft.id,'head'));
    await expect(store.get('a',draft.id)).rejects.toMatchObject({statusCode:503});
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));await rm(root,{recursive:true,force:true});}
});
it('denies nonpublic destinations, aliases and unsupported address families before connect',async()=>{
  for(const url of ['http://localhost:1234','https://127.0.0.1','https://10.0.0.1','https://169.254.169.254','https://[::1]','https://[::ffff:127.0.0.1]','https://100.64.0.1','https://192.168.1.1','https://192.88.99.1']) {
    if(url.includes('[')) await expect(requestJson(url,{method:'GET'},{timeoutMs:200})).rejects.toBeDefined();
    else await expect(requestJson(url,{method:'GET'},{timeoutMs:200})).rejects.toMatchObject({statusCode:403});
  }
});
it('enforces cancellation, streaming response caps, malformed JSON and schema-free SSE matching',async()=>{
  const server=createServer((req,res)=>{
    if(req.url==='/hang') return;
    if(req.url==='/sse'){res.setHeader('content-type','text/event-stream');res.write('event: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"real":true}}\n\n');return;}
    res.setHeader('content-type','application/json');res.end(req.url==='/bad' ? '{SECRET_ERROR' : JSON.stringify({huge:'x'.repeat(1000)}));
  });server.listen(0,'127.0.0.1');await once(server,'listening');const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const policy={developmentOrigins:[origin],timeoutMs:50,maxBytes:100};
    await expect(requestJson(origin+'/hang',{method:'GET'},policy)).rejects.toMatchObject({statusCode:504});
    await expect(requestJson(origin,{method:'GET'},policy)).rejects.toMatchObject({statusCode:413});
    await expect(requestJson(origin+'/bad',{method:'GET'},policy)).rejects.toMatchObject({statusCode:502,message:'resource blocked'});
    expect((await requestJson(origin+'/sse',{method:'POST',rpcId:7},policy)).value).toEqual({jsonrpc:'2.0',id:7,result:{real:true}});
    const controller=new AbortController();controller.abort();await expect(requestJson(origin,{method:'GET',signal:controller.signal},policy)).rejects.toMatchObject({statusCode:504});
  }finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
});
