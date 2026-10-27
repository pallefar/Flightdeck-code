// Build-stage only: run AFTER the complete unchanged TypeScript/frontend build.
import {readdirSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
const root=resolve(process.argv[2]??process.cwd());
function prune(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const path=join(dir,entry.name);
  if(entry.isDirectory()){
   if(entry.name==='__tests__')rmSync(path,{recursive:true});
   else prune(path);
  }else if(entry.isFile() && /\.(?:test|spec)\.[cm]?[jt]sx?$/.test(entry.name))rmSync(path);
 }
}
for(const dir of ['server','packages'])prune(join(root,dir));
// Exact test-only support paths; names like testing/fixtures also occur in runtime modules.
for(const path of [
 'packages/authoring-harness/tests',
 'packages/workflow/test-helpers.ts',
 'packages/subapp-workspace/testing.ts',
 'packages/subapp-workspace/process-fixture.ts',
])rmSync(join(root,path),{recursive:true,force:true});
