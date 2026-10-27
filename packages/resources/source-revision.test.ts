import { it,expect } from 'vitest';
import { mkdtemp,rm,readFile,writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { ResourceStore } from './store';
it('rejects an active revision whose reviewed source revision has changed on disk',async()=>{
 const root=await mkdtemp(join(homedir(),'.hermes/cache/scratch/resource-source-'));
 try{
  const store=new ResourceStore(root),draft=await store.propose('a',{name:'Original',functions:['measure']},'operator');
  await store.activate('a',draft.id,1,'reviewer',{measure:'trusted-binding'});
  const file=join(root,'a',draft.id,'1.json'),source=JSON.parse(await readFile(file,'utf8'));source.definition.name='Tampered';await writeFile(file,JSON.stringify(source));
  await expect(new ResourceStore(root).get('a',draft.id)).rejects.toMatchObject({statusCode:503});
 }finally{await rm(root,{recursive:true,force:true});}
});
