// Repository-policy context + source-COPY contract, NOT a Docker image build or
// omit-dev dependency audit. Installed node_modules is shared read-only by
// convention. The closed ignore grammar below does not certify all Docker syntax.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,lstatSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {dirname,join,posix} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const root=fileURLToPath(new URL('../../',import.meta.url));
const compilerFiles=['contracts.ts','plan.ts','roi.ts'].map(name=>'src/process-studio/'+name);
const recipes=['Dockerfile','Dockerfile.production'];

// Closed grammar for these two policies ONLY: literal root-relative paths,
// literal/**, **, and the eight existing **/sensitive-basename patterns. Reject
// other filepath/glob syntax. Rules match the path OR a parent; last match wins.
// A re-included directory includes descendants, hence explicit re-exclusions.
// References: Docker build/concepts/context (#dockerignore-files), Moby
// patternmatcher MatchesOrParentMatches / go-archive TarWithOptions. Specific
// Dockerfile ignore REPLACES root ignore; metadata absence is never a fallback.
function policy(text){
 const literal='[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.-]+)*';
 const rules=text.split(/\r?\n/).filter(line=>line&&!line.startsWith('#')).map(line=>{
  assert.equal(line,line.trim(),'unsupported ignore whitespace');
  const include=line.startsWith('!'),pattern=(include?line.slice(1):line).replace(/^\/|\/$/g,'');
  assert.doesNotMatch(pattern,/(?:^|\/)\.{1,2}(?:\/|$)/,'unsupported ignore path');
  let expression;
  if(pattern==='**')expression='.*';
  else if(new RegExp('^'+literal+'$').test(pattern))expression=pattern.replaceAll('.','\\.');
  else if(pattern.endsWith('/**')&&new RegExp('^'+literal+'$').test(pattern.slice(0,-3)))expression=pattern.slice(0,-3).replaceAll('.','\\.')+'/.*';
  else{
   assert.ok(['**/node_modules','**/.env*','**/*.pem','**/*.key','**/.studio','**/.git','**/credentials*','**/secrets.json'].includes(pattern),'unsupported ignore rule: '+line);
   expression='(?:.*/)?'+pattern.slice(3).replaceAll('.','\\.').replaceAll('*','[^/]*');
  }
  return {include,match:new RegExp('^'+expression+'$')};
 });
 return path=>{
  assert.match(path,new RegExp('^'+literal+'$'),'canonical context path required');
  const parts=path.split('/'),parents=parts.map((_,i)=>parts.slice(0,i+1).join('/'));
  let admitted=true;
  for(const rule of rules)if(parents.some(parent=>rule.match.test(parent)))admitted=rule.include;
  return admitted;
 };
}
function context(recipe,read=path=>readFileSync(join(root,path),'utf8'),exists=path=>existsSync(join(root,path))){
 const specific='deploy/studio-docker/'+recipe+'.dockerignore';
 const path=exists(specific)?specific:'.dockerignore';
 return {path,admits:policy(read(path))};
}

// Deliberately fail closed on unmodelled COPY syntax/stages rather than silently
// filling missing dependencies from the checkout or a hardcoded success tree.
function copies(text){
 const stages=[];
 for(const line of text.replace(/\\\r?\n\s*/g,' ').split(/\r?\n/).map(line=>line.trim())){
  if(!line||line.startsWith('#'))continue;
  if(/^FROM\s/i.test(line)){
   const match=/^FROM\s+\S+(?:\s+AS\s+([\w-]+))?$/i.exec(line);
   assert.ok(match,'unsupported FROM: '+line);
   stages.push({name:match[1]??String(stages.length),copies:[]});continue;
  }
  assert.ok(stages.length,'instruction outside a stage');
  if(/^WORKDIR\s/i.test(line))assert.equal(line,'WORKDIR /app','projection requires explicit /app');
  if(!/^COPY\s/i.test(line))continue;
  let args=line.slice(5),from;
  if(args.startsWith('--')){
   const match=/^--from=([\w-]+)\s+(.+)$/.exec(args);
   assert.ok(match,'unsupported COPY option: '+line);from=match[1];args=match[2];
  }
  const words=args.startsWith('[')?JSON.parse(args):args.split(/\s+/);
  assert.ok(words.length>=2,'COPY needs source and destination');
  for(const word of words){assert.equal(typeof word,'string');assert.doesNotMatch(word,/[\s$*?"'\\]|(?:^|\/)\.\.(?:\/|$)/,'unsupported COPY path');}
  const dest=words.at(-1);
  assert.ok(dest.startsWith('./')||dest.startsWith('/app/'),'destination must stay in /app');
  assert.ok(words.length===2||dest.endsWith('/'),'multiple sources need a directory');
  stages.at(-1).copies.push({from,sources:words.slice(0,-1),dest:posix.normalize(dest.replace(/^\/app\//,'')),directory:dest.endsWith('/')});
 }
 assert.ok(stages.length,'recipe needs stages');
 return stages;
}
function projectedInput(path){
 return /^(?:server|packages|src)(?:\/|$)|^deploy\/studio-docker(?:\/|$)/.test(path)||['package.json','package-lock.json','tsconfig.json','.gitignore','.dockerignore'].includes(path);
}
function inventory(text,admission){
 const stages=copies(text);
 admission??=context(stages.length===1?'Dockerfile':'Dockerfile.production');
 // Validate all declared host selectors, including build-only inputs. The
 // minimal API subset proves their policy admission, NOT production build bytes.
 for(const stage of stages)for(const copy of stage.copies)if(copy.from===undefined)for(const source of copy.sources){
  const path=source.replace(/^\.\//,'').replace(/\/$/,'');
  assert.ok(admission.admits(path),'context excluded COPY input: '+path+' ('+admission.path+')');
 }
 function stageFiles(stageIndex){
  const result=new Map();
  for(const copy of stages[stageIndex].copies)for(const source of copy.sources){
   const relative=source.replace(/^\/app\//,'').replace(/^\.\//,'').replace(/\/$/,'');
   if(!projectedInput(relative))continue;
   let files;
   if(copy.from!==undefined){
    const from=stages.findIndex(stage=>stage.name===copy.from);
    assert.ok(from>=0&&from<stageIndex,'COPY must reference an earlier named stage');
    files=[...stageFiles(from)].filter(([name])=>name===relative||name.startsWith(relative+'/'));
    assert.ok(files.length,'stage source not declared: '+source);
   }else{
    // Enumerate admitted filenames only; projection reads runtime bytes, never
    // excluded deployment secrets or production build-only frontend bytes.
    const full=join(root,relative);
    assert.ok(existsSync(full),'recipe input absent: '+relative);
    files=list(full).map(name=>posix.join(relative,name)).filter(name=>admission.admits(name)).map(name=>[name,name]);
    assert.ok(files.length,'context excluded all COPY contents: '+relative);
   }
   for(const [name,origin] of files){
    const tail=name.slice(relative.length).replace(/^\//,'');
    const destination=tail?posix.join(copy.dest,tail):copy.directory?posix.join(copy.dest,posix.basename(relative)):copy.dest;
    // COPY directory semantics preserve its contents, not the source basename.
    const isDirectory=files.some(([name])=>name!==relative);
    const output=isDirectory?posix.join(copy.dest,tail):destination;
    if(stageIndex>0&&copy.from!==undefined&&/^(server|packages)\//.test(output)&&/(?:^|\/)__tests__(?:\/|$)|\.(?:test|spec)\.[cm]?[jt]sx?$/.test(output)){
     assert.match(text,/RUN npm run build && node deploy\/studio-docker\/prune-runtime-tests\.mjs/,'production prune contract changed');continue;
    }
    result.set(output,origin);
   }
  }
  return result;
 }
 return stageFiles(stages.length-1);
}
function list(path){
 const info=lstatSync(path);assert.equal(info.isSymbolicLink(),false,'source symlinks are not projected');
 if(info.isFile())return [''];
 assert.ok(info.isDirectory(),'regular source tree required');
 return readdirSync(path).sort().flatMap(name=>list(join(path,name)).map(tail=>posix.join(name,tail)));
}
function assertCompilerInventory(files){
 assert.deepEqual([...files.keys()].filter(name=>name.startsWith('src/')).sort(),compilerFiles,
  'runtime src must contain only the three individual compiler files (no Studio/UI/test/browser/native sources)');
}

// Handwritten owned-child fixture, not browser support or generated code.
// Fastify inject starts real plugin/routes without opening ANY listening socket.
const exercise=String.raw`
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {syncBuiltinESMExports} from 'node:module';
import net from 'node:net';import http from 'node:http';import https from 'node:https';
import tls from 'node:tls';import dgram from 'node:dgram';import dns from 'node:dns';
const calls={fetch:0,socket:0,listen:0,http:0,https:0,tls:0,dgram:0,dns:0,model:0};
const deny=key=>()=>{calls[key]++;throw new Error('Runtime COPY fixture prohibits '+key)};
globalThis.fetch=deny('fetch');net.Socket.prototype.connect=deny('socket');net.Server.prototype.listen=deny('listen');
http.request=deny('http');http.get=deny('http');https.request=deny('https');https.get=deny('https');
tls.connect=deny('tls');dgram.createSocket=deny('dgram');
for(const name of ['lookup','resolve','resolve4','resolve6','reverse']){dns[name]=deny('dns');dns.promises[name]=deny('dns');}
syncBuiltinESMExports();
const {createServer}=await import('./server/index.ts');
if(process.argv[2]==='import-only'){console.log(JSON.stringify({imported:true,calls}));}
else{
 const [{emptyProcessDraft,buildProcessPlan,PROCESS_TEMPLATES},{createMemoryGrantStore},
  {createModelConnections},{createFileSubappWorkspaceStore},{createFileWorkflowWorkspaceStore},
  {ResourceStore},{ResourceRegistry}]=await Promise.all([
   import('./src/process-studio/plan.ts'),import('./packages/approvals/src/store.ts'),
   import('./server/model-connections.ts'),import('./server/subapp-workspace-store.ts'),
   import('./server/workflow-workspace-store.ts'),import('./packages/resources/store.ts'),import('./packages/resources/registry.ts')]);
 const state=join(process.cwd(),'owned-state');
 const operator={actor:'Development Operator',token:'public-development-runtime-copy-sentinel'};
 const headers={authorization:'Bearer '+operator.token,host:'127.0.0.1:3111',origin:'http://127.0.0.1:3111'};
 const base=createModelConnections({env:{}}),model=deny('model');
 const app=createServer({operator,nativeAuthoringEnabled:false,anthropicSessionSetup:{enabled:false,env:{}},
  modelConnections:{...base,resolve:model,resolveSelected:model},store:createMemoryGrantStore(),
  projectSkillSource:async()=>[],subappWorkspaceStore:createFileSubappWorkspaceStore(join(state,'subapps.json')),
  workflowWorkspaceStore:createFileWorkflowWorkspaceStore(join(state,'workflows.json')),
  workflowResources:{store:new ResourceStore(join(state,'resources')),registry:new ResourceRegistry([],{}),authorize:async()=>false}});
 const builds=[];
 try{
  await app.ready();
  const health=await app.inject({url:'/api/studio/health',headers});
  assert.equal(health.statusCode,200);assert.equal(health.headers['cache-control'],'no-store');
  assert.deepEqual(health.json(),{ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed',processBuild:'registered-templates-v1'});
  const publicHealth=await app.inject({url:'/api/studio/health'});
  assert.deepEqual(publicHealth.json(),{ok:true});assert.equal(publicHealth.headers['cache-control'],'no-store');
  const unauthorized=await app.inject({method:'POST',url:'/api/studio/process/build',headers:{host:headers.host},payload:{}});
  assert.equal(unauthorized.statusCode,401);assert.equal(unauthorized.headers['cache-control'],'no-store');
  assert.deepEqual(PROCESS_TEMPLATES.map(t=>t.id).sort(),['analytical-report','case-workspace','operations-queue']);
  for(const template of PROCESS_TEMPLATES){
   // Synthetic DEVELOPMENT facts, copied from no browser/native fixture.
   const draft=emptyProcessDraft();
   Object.assign(draft.brief,{title:'Process review',problem:'Review requests are scattered across a manual intake queue.',
    outcome:'Prepare a reviewable request without changing source records.',users:'Operations staff and independent human reviewers',
    systemOfRecord:'Workspace contract references; no external connector is configured.',dataSensitivity:'internal',templateId:template.id,
    v1Features:['Prepare one bounded human-review proposal'],v2Features:[],acceptanceCriteria:['A proposal is not an approval or a completed process step']});
   Object.assign(draft.choices,{appId:'process-review',icon:'📋',navSection:'Ops & insight',visibleToRoles:['legal'],consentedScopes:[...template.requiredScopes]});
   const plan=buildProcessPlan(draft);assert.equal(plan.status,'ready');
   const response=await app.inject({method:'POST',url:'/api/studio/process/build',headers,
    payload:{projectId:'development-process',draft,reviewKey:plan.reviewKey}});
   assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');
   assert.ok(Buffer.byteLength(response.body)<1000000,'bounded template response');
   const value=response.json();assert.equal(value.status,'process-built',JSON.stringify(value));
   assert.equal(value.projectId,'development-process');assert.equal(value.reviewKey,plan.reviewKey);
   assert.equal(value.templateId,template.id);assert.equal(value.templateVersion,template.version);
   assert.equal(value.outcome.status,'proposed');assert.equal(value.outcome.conformance.ok,true);assert.equal(value.outcome.artifacts.decision,'allow');
   assert.ok(value.outcome.generated.files.length>0);
   const artifactId=createHash('sha256').update(JSON.stringify(value.outcome.generated.files.map(({path,kind,contents})=>({path,kind,contents})))).digest('hex');
   assert.equal(value.artifactId,artifactId);
   builds.push({templateId:template.id,files:value.outcome.generated.files.length,artifactId});
  }
  assert.deepEqual(calls,{fetch:0,socket:0,listen:0,http:0,https:0,tls:0,dgram:0,dns:0,model:0});
  console.log(JSON.stringify({imported:true,ready:true,authenticatedHealth:true,unauthorized:401,builds,calls}));
 }finally{await app.close();}
}
`;
function project(files,run){
 for(const path of files.keys())if(path.startsWith('src/'))assert.ok(compilerFiles.includes(path),'refuse to project non-compiler src: '+path);
 const owned=mkdtempSync(join(tmpdir(),'studio-process-runtime-copy-'));
 try{
  for(const [destination,source] of files){
   assert.ok(projectedInput(destination),'unmodelled projection input: '+destination);
   const target=join(owned,destination);mkdirSync(dirname(target),{recursive:true});cpSync(join(root,source),target);
  }
  assert.ok(existsSync(join(owned,'server/index.ts')),'actual composition root must be copied');
  assert.ok(existsSync(join(owned,'packages/pipeline/src/build-subapp-spec.ts')),'actual native pipeline must be copied');
  const actualSrc=existsSync(join(owned,'src'))?list(join(owned,'src')).map(name=>'src/'+name).sort():[];
  assert.deepEqual(actualSrc,[...files.keys()].filter(name=>name.startsWith('src/')).sort(),'on-disk src matches recipe inventory');
  for(const name of actualSrc)assert.deepEqual(readFileSync(join(owned,name)),readFileSync(join(root,files.get(name))),'exact compiler bytes');
  symlinkSync(join(root,'node_modules'),join(owned,'node_modules'),'dir');
  const home=join(owned,'empty-home');mkdirSync(home);const temp=join(owned,'temp');mkdirSync(temp);
  writeFileSync(join(owned,'exercise.mjs'),exercise);
  const result=run(owned,{HOME:home,TMPDIR:temp,TMP:temp,TEMP:temp,NODE_ENV:'test',TSX_DISABLE_CACHE:'1',NODE_DISABLE_COMPILE_CACHE:'1'});
  return result;
 }finally{rmSync(owned,{recursive:true,force:true});assert.equal(existsSync(owned),false,'remove only the exact owned projection');}
}
function child(files,mode='exercise'){
 return project(files,(cwd,env)=>spawnSync(process.execPath,['--import','tsx','exercise.mjs',mode],{cwd,env,encoding:'utf8',timeout:30000,maxBuffer:2000000}));
}
for(const recipe of recipes)test(`${recipe}: actual runtime COPY composition root starts and builds all registered templates`,t=>{
 const text=readFileSync(new URL(recipe,import.meta.url),'utf8'),files=inventory(text);
 const result=child(files);
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr);
 assertCompilerInventory(files);
 const proof=JSON.parse(result.stdout);assert.equal(proof.ready,true);assert.equal(proof.builds.length,3);
 t.diagnostic(JSON.stringify({recipe,sourceFileCount:files.size,compilerInventory:compilerFiles.map(path=>({path,source:files.get(path),sha256:createHash('sha256').update(readFileSync(join(root,files.get(path)))).digest('hex')})),proof}));
});

for(const recipe of recipes)test(`${recipe}: missing compiler COPY counterfactuals cannot borrow checkout sources`,t=>{
 const text=readFileSync(new URL(recipe,import.meta.url),'utf8');
 for(const file of compilerFiles){
  const stages=copies(text),stage=stages.at(-1);
  const matching=stage.copies.filter(copy=>copy.sources.some(source=>source.replace(/^\/app\//,'')===file));
  assert.equal(matching.length,1,'each compiler source must be explicitly copied once: '+file);
  const copy=matching[0],source=copy.sources.find(source=>source.replace(/^\/app\//,'')===file);
  const lines=text.split('\n');
  const index=lines.findLastIndex(line=>line.startsWith('COPY ')&&line.split(/\s+/).includes(source));
  assert.ok(index>=0);
  const words=lines[index].split(/\s+/).filter(word=>word!==source);
  lines[index]=copy.sources.length===1?'# removed compiler COPY negative control':words.join(' ');
  const missing=inventory(lines.join('\n'));
  assert.equal(missing.has(file),false,'counterfactual must actually remove its file');
  assert.deepEqual([...missing.keys()].filter(name=>name.startsWith('src/')).sort(),compilerFiles.filter(name=>name!==file),'remove exactly the chosen compiler source');
  assert.throws(()=>assertCompilerInventory(missing),/runtime src must contain only/);
  if(file.endsWith('contracts.ts')){t.diagnostic(JSON.stringify({recipe,missing:file,inventoryRejected:true,typeOnly:true}));continue;}
  const result=child(missing,'import-only');
  assert.equal(result.error,undefined);assert.equal(result.status,1);
  assert.match(result.stderr,/ERR_MODULE_NOT_FOUND/);
  assert.match(result.stderr,new RegExp("Cannot find module '[^'\\n]*/"+file.replace(/\.ts$/,'')+"' imported from"));
  t.diagnostic(JSON.stringify({recipe,missing:file,inventoryRejected:true,exitCode:result.status,exactMissingModule:true}));
 }
});

test('COPY inventory rejects unmodelled syntax instead of silently projecting a success tree',()=>{
 for(const line of ['COPY --link src ./src','COPY src/* ./src/','COPY ../src ./src/','COPY --from=unknown /app/src ./src']){
  assert.throws(()=>inventory('FROM node:22-slim\nWORKDIR /app\n'+line));
 }
 assert.throws(()=>project(new Map([['src/studio/forbidden-fixture.ts','src/studio/forbidden-fixture.ts']]),()=>{}),/refuse to project non-compiler src/);
});

test('closed repository ignore grammar follows parent, globstar and last-match rules; rejects other syntax',()=>{
 const admits=policy('**\n!src/\nsrc/**\n!src/process-studio/\nsrc/process-studio/**\n!src/process-studio/plan.ts\n**/.env*\n**/*.key\n');
 for(const [path,want] of [['src',true],['src/other.ts',false],['src/process-studio',true],['src/process-studio/plan.ts',true],['src/process-studio/roi.ts',false],['src/process-studio/.env.local',false]])assert.equal(admits(path),want,path);
 assert.equal(policy('**\n!src/\n')('src/nested/file.ts'),true,'directory exception includes children');
 assert.equal(policy('**\n!src/**\n')('src/nested/file.ts'),true,'globstar spans directories');
 assert.equal(policy('**\n!plan.ts\nplan.ts\n')('plan.ts'),false,'last exclusion wins');
 for(const text of ['!src/*.ts','!src/?.ts','!src/[ab].ts','!../src','!src//plan.ts',' !src','\\!src'])assert.throws(()=>policy(text),/unsupported/);
});

test('effective API context admits compiler inputs only, while production override retains full build src',()=>{
 const api=context('Dockerfile'),production=context('Dockerfile.production');
 assert.equal(api.path,'.dockerignore');assert.equal(production.path,'deploy/studio-docker/Dockerfile.production.dockerignore');
 for(const file of compilerFiles){assert.ok(existsSync(join(root,file)),'checkout input exists');assert.equal(api.admits(file),true,'API context must admit '+file);assert.equal(production.admits(file),true);}
 assert.deepEqual(list(join(root,'src')).map(path=>'src/'+path).filter(api.admits).sort(),compilerFiles,'entire present src tree admits only compiler files (minimal subset needs no UI checkout)');
 // Literal, nonsecret path sentinels, not reads of UI/browser/private fixtures.
 for(const file of ['src/studio/StudioApp.tsx','src/process-studio/plan.test.ts','src/process-studio/__tests__/process.browser.tsx','src/private/hidden.ts','src/process-studio/private.ts','src/other.ts']){
  assert.equal(api.admits(file),false,file);assert.equal(production.admits(file),true,'unchanged production tsc/Vite context: '+file);
 }
 for(const admitted of [api,production])for(const prefix of ['', 'server/', 'packages/nested/', 'src/process-studio/', 'deploy/studio-docker/'])for(const name of ['node_modules/pkg/index.js','.env','.env.local','root.pem','root.key','.studio/state.json','.git/config','credentials-local.json','secrets.json'])assert.equal(admitted.admits(prefix+name),false,prefix+name);
 const text=readFileSync(new URL('Dockerfile',import.meta.url),'utf8');
 for(const file of compilerFiles)assert.throws(()=>inventory(text,{path:'counterfactual-root',admits:policy(readFileSync(join(root,'.dockerignore'),'utf8')+'\n'+file+'\n')}),/context excluded COPY input/,'excluded checkout input cannot be borrowed');
});

test('Dockerfile-specific ignore replaces root policy; missing effective metadata fails closed',()=>{
 const specific='deploy/studio-docker/Dockerfile.production.dockerignore';
 const files=new Map([['.dockerignore','**\n!root-only.ts\n'],[specific,'**\n!override-only.ts\n']]);
 const selected=context('Dockerfile.production',path=>{assert.ok(files.has(path));return files.get(path);},path=>files.has(path));
 assert.equal(selected.admits('override-only.ts'),true);assert.equal(selected.admits('root-only.ts'),false,'policies must not merge');
 assert.throws(()=>context('Dockerfile',()=>{throw new Error('required ignore metadata absent');},()=>false),/required ignore metadata absent/);
});

test('API COPY includes exact test metadata; omitting gitignore reproduces unchanged default-RUN test failure',()=>{
 const files=inventory(readFileSync(new URL('Dockerfile',import.meta.url),'utf8'));
 for(const name of ['.gitignore','.dockerignore'])assert.equal(files.get(name),name,'API default RUN must COPY required metadata: '+name);
 const missing=new Map(files);missing.delete('.gitignore');
 const result=project(missing,(cwd,env)=>{
  assert.equal(existsSync(join(cwd,'.gitignore')),false);
  return spawnSync(process.execPath,['--test','deploy/studio-docker/staging-trust.test.mjs'],{cwd,env,encoding:'utf8',timeout:10000});
 });
 assert.equal(result.error,undefined);assert.equal(result.status,1);assert.match(result.stdout,/ENOENT/);assert.match(result.stdout,/\.gitignore/);
 const noContext=new Map(files);noContext.delete('.dockerignore');
 project(noContext,cwd=>assert.throws(()=>readFileSync(join(cwd,'.dockerignore')),/ENOENT/));
});
