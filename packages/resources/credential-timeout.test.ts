import { it,expect } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from './store';
import { ResourceRegistry } from './registry';
it('sanitizes a rejecting vault resolver at the reusable adapter boundary',async()=>{
 const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-vault-error-'));
 try{
  const store=new ResourceStore(root),registry=new ResourceRegistry([{id:'read',kind:'rest',projects:['a'],endpoint:'https://example.com/fixed',method:'GET',input:{type:'object',properties:{},required:[],additionalProperties:false},output:{type:'boolean'},credential:{ref:'vault',origin:'https://example.com',header:'authorization'}}],{},async()=>{throw new Error('PRIVATE VAULT SECRET');});
  const draft=await store.propose('a',{name:'Vault errors',functions:['read']},'author'),active=await registry.activate(store,'a',draft.id,1,'reviewer');
  await expect(registry.execute(active,'read',{},'operator')).rejects.toMatchObject({statusCode:503,message:'resource blocked'});
 }finally{await rm(root,{recursive:true,force:true});}
});
it('bounds a stalled server vault resolver before any network call',async()=>{
 const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-vault-'));
 try{
  const store=new ResourceStore(root),registry=new ResourceRegistry([{id:'read',kind:'rest',projects:['a'],endpoint:'https://example.com/fixed',method:'GET',input:{type:'object',properties:{},required:[],additionalProperties:false},output:{type:'boolean'},credential:{ref:'vault',origin:'https://example.com',header:'authorization'}}],{timeoutMs:20},async()=>new Promise<string>(()=>{}));
  const draft=await store.propose('a',{name:'Vault bounded',functions:['read']},'author'),active=await registry.activate(store,'a',draft.id,1,'reviewer');
  await expect(registry.execute(active,'read',{},'operator')).rejects.toMatchObject({statusCode:504});
 }finally{await rm(root,{recursive:true,force:true});}
},1000);
