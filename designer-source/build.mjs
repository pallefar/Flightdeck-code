// Fixed-entry source packaging only. No application/server/provider execution.
import ts from 'typescript';
import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('./',import.meta.url));
const repository=path.resolve(root,'..');
const destination=path.resolve(repository,'src/studio/designer');
const require=createRequire(import.meta.url);
const zodRoot=path.dirname(require.resolve('zod/package.json'));
const digest=b=>createHash('sha256').update(b).digest('hex');
const portable=p=>p.split(path.sep).join('/');
const dependencyRoots=['typescript','react','react-dom','@types/react','@types/react-dom','csstype','zod'].map(name=>({name,root:path.dirname(require.resolve(name+'/package.json'))}));
const relative=p=>{for(const d of dependencyRoots)if(p.startsWith(d.root+path.sep))return 'node_modules/'+d.name+'/'+portable(path.relative(d.root,p));return portable(path.relative(root,p));};
const zod=JSON.parse(fs.readFileSync(path.join(zodRoot,'package.json'),'utf8'));
for(const [name,expected] of [['typescript','5.9.3'],['esbuild','0.28.2'],['zod','3.25.76']]){
 const actual=JSON.parse(fs.readFileSync(require.resolve(name+'/package.json'),'utf8')).version;
 if(actual!==expected)throw Error(`Use pinned cached ${name} ${expected}; found ${actual}`);
}
const provenance=JSON.parse(fs.readFileSync(path.join(root,'SOURCE-PROVENANCE.json'),'utf8'));
for(const f of provenance.files){if(digest(fs.readFileSync(path.join(root,f.path)))!==f.sha256)throw Error('Source projection drift: '+f.path);}
const stat=path.join(root,'mirror/flightdeck/web/src/widgets/parts/StatTile.tsx');
const seam=path.join(root,'app/widget-host-seam.ts');
const outputs=new Map();
const put=(name,bytes)=>outputs.set(name,Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes));
const options={preserveSymlinks:true,strict:true,skipLibCheck:false,noEmit:false,declaration:true,emitDeclarationOnly:true,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,jsx:ts.JsxEmit.ReactJSX,lib:['lib.es2022.d.ts','lib.dom.d.ts','lib.dom.iterable.d.ts'],types:['react','react-dom'],typeRoots:[path.join(repository,'node_modules/@types')],allowSyntheticDefaultImports:true,esModuleInterop:true,forceConsistentCasingInFileNames:true,rootDir:root,outDir:path.join(destination,'types')};
const host=ts.createCompilerHost(options);
host.resolveModuleNames=(names,containing)=>names.map(name=>containing===stat&&['../../i18n','../../nav'].includes(name)?{resolvedFileName:seam,extension:ts.Extension.Ts}:ts.resolveModuleName(name,containing,options,host).resolvedModule);
const roots=['app/AppDesigner.tsx','app/public.ts','app/model.ts','app/native.ts'].map(p=>path.join(root,p));
const program=ts.createProgram(roots,options,host);
const diagnostics=ts.getPreEmitDiagnostics(program);
if(diagnostics.length)throw Error(ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:f=>f,getCurrentDirectory:()=>root,getNewLine:()=> '\n'}));
const typeImports=[];
function rewriteDeclarations(context){return source=>{
 const emitted=path.join(destination,'types',path.relative(root,source.fileName).replace(/\.tsx?$/,'.d.ts'));
 const relocate=value=>{
  if(value!=='zod'&&!value.startsWith('zod/'))return value;
  const suffix=value==='zod'?'':value.slice(4);
  const target=path.join(destination,'types/vendor/zod',suffix,'index.js');
  const declaration=path.join(zodRoot,suffix,'index.d.ts');
  if(!fs.existsSync(declaration))throw Error('Missing pinned Zod entry '+value);
  let specifier=portable(path.relative(path.dirname(emitted),target));if(!specifier.startsWith('.'))specifier='./'+specifier;
  typeImports.push({file:portable(path.relative(destination,emitted)),from:value,to:specifier});return specifier;
 };
 const visit=node=>{
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){
   const spec=node.moduleSpecifier.text;
   if(ts.isImportDeclaration(node)&&!node.importClause&&spec.endsWith('.css'))return undefined;
   const changed=relocate(spec);
   if(changed!==spec){if(ts.isImportDeclaration(node))return ts.factory.updateImportDeclaration(node,node.modifiers,node.importClause,ts.factory.createStringLiteral(changed),node.attributes);return ts.factory.updateExportDeclaration(node,node.modifiers,node.isTypeOnly,node.exportClause,ts.factory.createStringLiteral(changed),node.attributes);}
  }
  if(ts.isImportTypeNode(node)&&ts.isLiteralTypeNode(node.argument)&&ts.isStringLiteral(node.argument.literal)){
   const changed=relocate(node.argument.literal.text);
   if(changed!==node.argument.literal.text)return ts.factory.updateImportTypeNode(node,ts.factory.createLiteralTypeNode(ts.factory.createStringLiteral(changed)),node.attributes,node.qualifier,node.typeArguments,node.isTypeOf);
  }
  return ts.visitEachChild(node,visit,context);
 };
 return ts.visitNode(source,visit);
};}
const result=program.emit(undefined,(file,data)=>{
 if(!file.startsWith(destination+path.sep)||!file.endsWith('.d.ts'))throw Error('Unexpected declaration destination');
 put(portable(path.relative(destination,file)),data);
},undefined,true,{afterDeclarations:[rewriteDeclarations]});
if(result.emitSkipped||result.diagnostics.length)throw Error('Declaration generation failed');
let vendorCount=0;
function vendor(dir){for(const entry of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){const p=path.join(dir,entry.name);if(entry.isDirectory())vendor(p);else if(entry.isFile()&&/\.d\.(?:ts|cts|mts)$/.test(entry.name)){put('types/vendor/zod/'+portable(path.relative(zodRoot,p)),fs.readFileSync(p));vendorCount++;}}}
vendor(zodRoot);
const zodLicense=fs.readFileSync(path.join(zodRoot,'LICENSE'),'utf8');
put('types/vendor/zod/LICENSE',zodLicense);
const plugin={name:'only-two-StatTile-host-seams',setup(build){build.onResolve({filter:/^\.\.\/\.\.\/(?:i18n|nav)$/},args=>{if(args.importer!==stat)throw Error('Unexpected host seam');return {path:seam};});}};
const runtimeInputs=new Set();
const runtimeOutputs=[];
for(const [name,entry] of [['AppDesigner','app/AppDesigner.tsx'],['model','app/model.ts'],['native','app/native.ts']]){
 const built=await esbuild.build({preserveSymlinks:true,absWorkingDir:repository,entryPoints:[path.join(root,entry)],bundle:true,jsx:'automatic',format:'esm',platform:'browser',target:['chrome120'],external:['react','react/jsx-runtime'],plugins:[plugin],write:false,outfile:path.join(destination,name+'.js'),metafile:true,logLevel:'warning',legalComments:'inline'});
 for(const input of Object.keys(built.metafile.inputs)){
  const resolved=path.resolve(repository,input);
  if(!resolved.startsWith(root)&&!resolved.startsWith(path.resolve(zodRoot)+path.sep))throw Error('Unexpected compiler input '+input);
  runtimeInputs.add(portable(input));
 }
 for(const file of built.outputFiles){const name=portable(path.relative(destination,file.path));put(name,file.contents);runtimeOutputs.push(name);}
}
// Facades reference actual complete compiler output, never handwritten any types.
put('AppDesigner.d.ts',"export {AppDesigner} from './types/app/AppDesigner.js';\nexport type {AppDesignerProps,AppDesignerCreatePageRequestHandle} from './types/app/AppDesigner.js';\nexport type {DesignerDocumentHandle,DesignerDocumentSnapshot,DesignerNativeOptions,DesignerSaveResult} from './types/app/public.js';\n");
put('model.d.ts',"export * from './types/app/model.js';\n");
put('native.d.ts',"export * from './types/app/native.js';\n");
put('NOTICE.md','# Source and third-party notices\n\nThis is a source-derived local design sandbox. The rights holder explicitly authorized public redistribution of this finite source set on October 27, 2026; see designer-source/REDISTRIBUTION.md and SOURCE-PROVENANCE.json. That permission does not extend to the rest of the private OS repository and does not invent a repository-wide OS license. Sample widgets contain no live data or authority. React is external, not bundled.\n\nBundled Zod runtime and emitted private Zod declarations both come from exact npm zod '+zod.version+'. Bare zod is its v3 entry; zod/v4 is the co-shipped v4 entry. Their exact complete declaration closure is private-relative, so host Zod majors cannot change the ABI.\n\n## Zod MIT license\n\n'+zodLicense);
const declarations=[...outputs.keys()].filter(p=>p.endsWith('.d.ts')&&!p.includes('/vendor/')).sort();
const manifest={schema:'flightdeck-designer-source-build/1',strict:true,skipLibCheck:false,reactExternal:true,zod:{version:zod.version,declarationFiles:vendorCount},source:provenance.files.map(({path,sha256,bytes})=>({path,sha256,bytes})),runtimeInputs:[...runtimeInputs].sort(),runtimeOutputs:runtimeOutputs.sort(),declarations,typeImports:typeImports.sort((a,b)=>(a.file+a.from).localeCompare(b.file+b.from)),compilerProgram:program.getSourceFiles().map(f=>relative(f.fileName)).sort(),outputs:[...outputs].sort(([a],[b])=>a.localeCompare(b)).map(([path,b])=>({path,bytes:b.length,sha256:digest(b)})),publicImportAuthorized:true};
put('build-manifest.json',JSON.stringify(manifest,null,2)+'\n');
const check=process.argv.includes('--check');
// Do not silently retain an opaque/stale output outside the generated inventory.
function existingOutputs(dir,prefix=''){
 if(!fs.existsSync(dir))return [];
 const names=[];
 for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
  const name=prefix+entry.name,full=path.join(dir,entry.name);
  if(entry.isSymbolicLink())throw Error('Unexpected generated output symlink '+name);
  if(entry.isDirectory())names.push(...existingOutputs(full,name+'/'));
  else if(entry.isFile())names.push(name);
  else throw Error('Unexpected generated output kind '+name);
 }
 return names;
}
for(const name of existingOutputs(destination))if(!outputs.has(name))throw Error('Unexpected generated output '+name);
for(const [name,bytes] of outputs){const p=path.join(destination,name);if(check){if(!fs.existsSync(p)||!fs.readFileSync(p).equals(bytes))throw Error('Generated output drift '+name);}else{fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,bytes);}}
console.log(JSON.stringify({status:check?'exact-regeneration-match':'built',destination,outputs:outputs.size,sourceFiles:provenance.files.length,programFiles:program.getSourceFiles().length,diagnostics:0,vendoredZodDeclarations:vendorCount,publicImportAuthorized:true}));
