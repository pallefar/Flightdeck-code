import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root=fileURLToPath(new URL('../',import.meta.url));
function ignored(paths:string[]){
 const result=spawnSync('git',['check-ignore','--no-index','--stdin'],{cwd:root,input:paths.join('\n')+'\n',encoding:'utf8',timeout:5000});
 if(result.error||!([0,1].includes(result.status??-1)))throw new Error('Git ignore policy could not be checked');
 return new Set(result.stdout.trim().split('\n').filter(Boolean));
}

it('keeps local runtime-validation evidence and compile caches out of publication',()=>{
 const paths=['docs/evidence/review/report.json','src/studio/__tests__/evidence/browser.png','packages/authoring-harness/evidence/runtime.log','scratch/node-compile-cache/cache-entry'];
 expect(ignored(paths)).toEqual(new Set(paths));
});

it('ignores machine dotenv variants without hiding documented examples or test sources',()=>{
 const privatePaths=['.env.production','deploy/studio-docker/.env.staging','deploy/studio-docker/.env.runtime'];
 const sourcePaths=['.env.example','deploy/studio-docker/.env.example','src/workflow/stacked-layout.ts','src/studio/__tests__/subapp-workspace.generated.snapshot','docs/stacked-workflow-view.md'];
 expect(ignored([...privatePaths,...sourcePaths])).toEqual(new Set(privatePaths));
});
