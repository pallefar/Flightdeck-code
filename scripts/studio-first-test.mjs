#!/usr/bin/env node
// Private first-version checks. No model calls or automatic browser sign-in.
export const TARGET = Object.freeze({
  origin: 'http://127.0.0.1:8790',
  container: 'flightdeck-studio-staging-studio-staging-1',
  image: 'sha256:e9a04ab64bd985fabe72c44a42b8194547affdfe0643d0dd562428bd087ee152',
  volume: 'flightdeck-studio-staging_staging-private',
});

export function parseArgs(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--check')) return 'check';
  if (args.length === 2 && new Set(args).size === 2 && args.includes('--copy-operator-token') && args.includes('--acknowledge-clipboard-risk')) return 'copy';
  throw new Error('arguments-refused');
}

export async function probePublic(get) {
  try {
    const {createHash} = await import('node:crypto');
    const health = await get('/api/studio/health', 4096);
    if (health.status !== 200 || JSON.stringify(JSON.parse(health.body.toString())) !== '{"ok":true}') throw new Error();
    const ready = await get('/api/studio/ready', 4096);
    if (ready.status !== 200 || ready.headers['cache-control'] !== 'no-store' || JSON.stringify(JSON.parse(ready.body.toString())) !== '{"ready":true,"scope":"request-admission"}') throw new Error();
    const expectedCsp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self' about:; form-action 'none'";
    const page = await get('/', 128*1024);
    function headers(response, mime, cache) {
      if (response.status !== 200 || response.body.length === 0 || response.headers['content-security-policy'] !== expectedCsp || response.headers['x-content-type-options'] !== 'nosniff' || response.headers['referrer-policy'] !== 'no-referrer' || response.headers['cache-control'] !== cache || !response.headers['content-type']?.startsWith(mime) || !['camera=(), microphone=(self), on-device-speech-recognition=(self), geolocation=(), payment=(), usb=()','camera=(), microphone=(), on-device-speech-recognition=(), geolocation=(), payment=(), usb=()'].includes(response.headers['permissions-policy'])) throw new Error();
    }
    headers(page, 'text/html', 'no-cache');
    const text = new TextDecoder('utf-8',{fatal:true}).decode(page.body);
    const paths = [...new Set([...text.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)].map(m=>m[1]))].sort();
    if (paths.length < 2 || paths.length > 16 || !paths.some(p=>p.endsWith('.js')) || !paths.some(p=>p.endsWith('.css')) || paths.some(p=>!/^\/assets\/[A-Za-z0-9][A-Za-z0-9_-]{0,100}-[A-Za-z0-9_-]{8,32}\.(js|css)$/.test(p))) throw new Error();
    const scripts=[...text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    if (!scripts.length || scripts.some(m=>m[2].trim() || !paths.includes(/\bsrc=["']([^"']+)["']/i.exec(m[1])?.[1]))) throw new Error();
    const files = new Map([['/',page.body]]); let total=page.body.length;
    const witness=createHash('sha256').update('/\0').update(page.body);
    for (const path of paths) {
      const asset=await get(path,Math.min(8*1024*1024,20*1024*1024-total));
      headers(asset,path.endsWith('.js')?'application/javascript':'text/css','public, max-age=31536000, immutable');
      total+=asset.body.length; if(total>20*1024*1024)throw new Error();
      files.set(path,asset.body); witness.update(path+'\0').update(asset.body);
    }
    for (const path of ['/package.json','/server/index.ts','/assets/index.js.map','/api/bogus']) {
      const absent=await get(path,4096);
      if(absent.status!==404 || absent.headers['content-type']?.includes('text/html'))throw new Error();
    }
    return {health:'pass',readiness:'pass',assets:'pass',security:'pass',witness:witness.digest('hex'),files};
  } catch { throw new Error('public-check-failed'); }
}

export async function probeAuthenticated(get, token) {
  try {
    const ids=['codex-chatgpt','flightdeck','local','anthropic'];
    const descriptorPath='/api/studio/model-connections';
    const setupPath=descriptorPath+'/anthropic/setup';
    const workspacePath='/api/studio/workspaces/studio-first-test/workflows';
    for(const path of [descriptorPath,workspacePath]) if((await get(path,4096)).status!==401)throw new Error();
    async function json(path,limit=16384) {
      const r=await get(path,limit,token);if(r.status!==200)throw new Error();
      return {data:JSON.parse(r.body.toString('utf8')),headers:r.headers};
    }
    const {data:models}=await json(descriptorPath);
    if(!Array.isArray(models.connections)||models.connections.length!==4||new Set(models.connections.map(d=>d.id)).size!==4||!(models.selectedId===null||ids.includes(models.selectedId)))throw new Error();
    const safeModels=ids.map(id=>{
      const d=models.connections.find(d=>d.id===id);
      if(!d||d.verification!=='not-probed'||!['configured','unavailable'].includes(d.status)||typeof d.label!=='string'||d.label.length>200||(d.status==='configured'?typeof d.model!=='string'||!d.model.trim()||d.model.length>180:d.model!==null))throw new Error();
      return {id,status:d.status,verification:'not-probed'};
    });
    const {data:health}=await json('/api/studio/health',4096);
    const selected=models.selectedId===null?undefined:models.connections.find(d=>d.id===models.selectedId);
    if(health.ok!==true||health.selectedId!==models.selectedId||health.verification!=='not-probed'||health.model!==(selected?.model??null)||health.modelStatus!==(selected?.status??'unselected'))throw new Error();
    const unauthSetup=await get(setupPath,4096);
    let setup='disabled';
    if(unauthSetup.status!==404) {
      if(unauthSetup.status!==401)throw new Error();
      const {data:s,headers}=await json(setupPath);
      const anthropic=safeModels.find(d=>d.id==='anthropic');
      if(headers['cache-control']!=='no-store'||s.status!==anthropic.status||typeof s.model!=='string'||!s.model||s.model.length>180||!(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/).test(s.revision))throw new Error();
      if(s.available===true&&s.persistence==='server-memory') setup=s.status==='configured'?'available-memory-only-configured':'available-memory-only-unconfigured';
      else if(s.available===false&&s.persistence==='external'&&s.status==='configured')setup='externally-managed';
      else throw new Error();
    }
    const {data:workspace}=await json(workspacePath,1024*1024);
    if(!workspace||!Array.isArray(workspace.drafts)||workspace.drafts.length>1024||Object.keys(workspace).some(k=>k!=='drafts'))throw new Error();
    return {authentication:'pass',models:safeModels,selection:models.selectedId??'none',setup,workspaceRead:'pass',liveAI:safeModels.some(d=>d.status==='configured')?'configured-not-probed':'unconfigured',modelRequests:'not-performed'};
  } catch {throw new Error('authenticated-check-failed');}
}

export async function readOperatorToken(fs, uid) {
  let file;let bytes;
  try {
    fs ??= await import('node:fs/promises'); uid ??= process.getuid();
    const {constants}=await import('node:fs');
    if(uid!==1000)throw new Error();
    const root=await fs.lstat('/state');
    if(!root.isDirectory()||root.isSymbolicLink()||root.uid!==1000||(root.mode&0o7777)!==0o700)throw new Error();
    file=await fs.open('/state/operator-token',constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    const before=await file.stat();
    if(!before.isFile()||before.uid!==1000||(before.mode&0o7777)!==0o600||before.size!==64)throw new Error();
    bytes=Buffer.alloc(65);const {bytesRead}=await file.read(bytes,0,65,0);
    const after=await file.stat();
    if(bytesRead!==64||after.size!==before.size||after.ino!==before.ino||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs||!bytes.subarray(0,64).every(b=>(b>=0x30&&b<=0x39)||(b>=0x61&&b<=0x66)))throw new Error();
    return Buffer.from(bytes.subarray(0,64));
  }catch{throw new Error('private-token-refused');}
  finally{bytes?.fill(0);await file?.close();}
}

// Native HTTP deliberately ignores proxy environment and never follows redirects.
export async function boundedGet(origin,path,limit,token,deadlineMs=2500) {
  const {request}=await import('node:http');
  return new Promise((resolve,reject)=>{
    let requestSocket;let timer;let settled=false;
    function fail(){if(settled)return;settled=true;clearTimeout(timer);requestSocket?.destroy();reject(new Error('http-check-failed'));}
    try {
      const url=new URL(origin);
      if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.pathname!=='/'||url.search||url.hash||url.username||url.password||!path.startsWith('/')||path.startsWith('//')||/[\r\n]/.test(path)||!Number.isInteger(limit)||limit<1||limit>8*1024*1024||deadlineMs<1||deadlineMs>2500)throw new Error();
      requestSocket=request({hostname:'127.0.0.1',port:url.port,path,method:'GET',agent:false,maxHeaderSize:16384,headers:{connection:'close',...(token?{authorization:'Bearer '+token.toString('latin1')}:{})}},response=>{
        if((response.statusCode??0)>=300&&(response.statusCode??0)<400){response.destroy();fail();return;}
        const declared=response.headers['content-length'];
        if(declared!==undefined&&(!/^[0-9]+$/.test(declared)||Number(declared)>limit)){response.destroy();fail();return;}
        let size=0;const parts=[];
        response.on('data',chunk=>{size+=chunk.length;if(size>limit){response.destroy();fail();}else parts.push(chunk);});
        response.on('error',fail);response.on('aborted',fail);
        response.on('end',()=>{if(settled)return;settled=true;clearTimeout(timer);resolve({status:response.statusCode,headers:response.headers,body:Buffer.concat(parts,size)});});
      });
      requestSocket.on('error',fail);timer=setTimeout(fail,deadlineMs);requestSocket.end();
    }catch{fail();}
  });
}

export async function checkFirstVersion({inspect,publicCheck,privateCheck}) {
  const id=validateTarget(await inspect());
  const publicResult=await publicCheck();
  if(validateTarget(await inspect())!==id)throw new Error('target-refused');
  const p=await privateCheck(id);
  if(validateTarget(await inspect())!==id)throw new Error('target-refused');
  const ids=['codex-chatgpt','flightdeck','local','anthropic'];
  if(!p||!(/^[0-9a-f]{64}$/).test(p.witness)||p.witness!==publicResult.witness||p.immutableAssets!=='pass'||p.authentication!=='pass'||p.workspaceRead!=='pass'||p.modelRequests!=='not-performed'||!Array.isArray(p.models)||p.models.length!==4||!['none',...ids].includes(p.selection)||!['disabled','available-memory-only-configured','available-memory-only-unconfigured','externally-managed'].includes(p.setup)||!['unconfigured','configured-not-probed'].includes(p.liveAI))throw new Error('helper-check-failed');
  const models=ids.map((id,i)=>{
    const d=p.models[i];if(!d||d.id!==id||!['configured','unavailable'].includes(d.status)||d.verification!=='not-probed')throw new Error('helper-check-failed');
    return {id,status:d.status,verification:'not-probed'};
  });
  if(p.liveAI!==(models.some(d=>d.status==='configured')?'configured-not-probed':'unconfigured'))throw new Error('helper-check-failed');
  return {schemaVersion:1,target:'pass',loopback:'pass',health:'pass',readiness:'pass',builtAssets:'pass',securityPolicy:'pass',authentication:'pass',models,selection:p.selection,anthropicSetup:p.setup,workspaceRead:'pass',localWorkflows:'ready-to-test',liveAI:p.liveAI,modelRequests:'not-performed',recordWrites:'not-performed',clipboard:'not-accessed'};
}

// Shell-free, bounded children; diagnostic streams never propagate to the caller.
/**
 * @param {string} command
 * @param {string[]} args
 * @param {{input?: string | Uint8Array, limit?: number, timeoutMs?: number}} [options]
 * @returns {Promise<Buffer>}
 */
export async function runProcess(command,args,{input,limit=16384,timeoutMs=10000}={}) {
  const {spawn}=await import('node:child_process');const {userInfo}=await import('node:os');
  return new Promise((resolve,reject)=>{
    const grouped=process.platform!=='win32';
    let child;let timer;let closeTimer;let broken=false;let settled=false;let signalled=false;
    let size=0;let errors=0;const parts=[];
    // detached creates a new POSIX session/group, never the launcher's group.
    // This cannot reach daemon-side Docker execs or descendants that escape it.
    const stopOwned=()=>{
      if(signalled||!child?.pid)return;signalled=true;
      try{if(grouped)process.kill(-child.pid,'SIGKILL');else child.kill('SIGKILL');}catch{try{child.kill('SIGKILL');}catch{}}
    };
    const onInterrupt=()=>{process.exitCode=130;fail();};
    const onTerminate=()=>{process.exitCode=143;fail();};
    const finish=code=>{
      if(settled)return;settled=true;clearTimeout(timer);clearTimeout(closeTimer);
      process.removeListener('SIGINT',onInterrupt);process.removeListener('SIGTERM',onTerminate);process.removeListener('exit',stopOwned);
      child?.stdin.destroy();child?.stdout.destroy();child?.stderr.destroy();
      if(broken||code!==0){child?.unref();for(const p of parts)p.fill(0);parts.length=0;reject(new Error('process-check-failed'));}
      else{const result=Buffer.concat(parts,size);for(const p of parts)p.fill(0);parts.length=0;resolve(result);}
    };
    // Do not depend indefinitely on close: an escaped descendant may hold a pipe.
    const boundClose=()=>{closeTimer??=setTimeout(()=>{broken=true;stopOwned();finish(1);},250);};
    const fail=()=>{if(settled)return;broken=true;stopOwned();boundClose();};
    try {
      child=spawn(command,args,{shell:false,detached:grouped,env:{HOME:userInfo().homedir,PATH:'/usr/bin:/bin:/usr/sbin:/sbin',TMPDIR:'/Users/te451223/.hermes/cache/scratch'},stdio:['pipe','pipe','pipe']});
      process.on('SIGINT',onInterrupt);process.on('SIGTERM',onTerminate);process.on('exit',stopOwned);
      timer=setTimeout(fail,timeoutMs);
      child.on('error',fail);child.stdin.on('error',fail);
      child.stdout.on('data',chunk=>{if(settled){chunk.fill(0);return;}size+=chunk.length;if(size>limit){chunk.fill(0);fail();}else parts.push(chunk);});
      child.stderr.on('data',chunk=>{errors+=chunk.length;chunk.fill(0);if(errors>16384)fail();});
      child.once('exit',code=>{stopOwned();if(code!==0)broken=true;boundClose();});
      child.once('close',finish);
      child.stdin.end(input);
    }catch{fail();finish(1);}
  });
}

async function containerMain(mode) {
  if(mode==='copy')return readOperatorToken();
  const fs=await import('node:fs/promises');const {constants}=await import('node:fs');
  const get=(path,limit,token)=>boundedGet('http://127.0.0.1:8787',path,limit,token);
  const publicResult=await probePublic(get);
  for(const [path,expected] of publicResult.files) {
    const filename=path==='/'?'/app/dist/index.html':'/app/dist'+path;
    const file=await fs.open(filename,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const stat=await file.stat();if(!stat.isFile()||stat.size!==expected.length||stat.size>8*1024*1024)throw new Error('helper-check-failed');
      const bytes=Buffer.alloc(stat.size+1);const {bytesRead}=await file.read(bytes,0,bytes.length,0);
      if(bytesRead!==stat.size||!bytes.subarray(0,bytesRead).equals(expected))throw new Error('helper-check-failed');
    }finally{await file.close();}
  }
  const token=await readOperatorToken();
  try{return {witness:publicResult.witness,immutableAssets:'pass',...await probeAuthenticated(get,token)};}
  finally{token.fill(0);}
}

export function helperSource(mode) {
  if(!['check','copy'].includes(mode))throw new Error('arguments-refused');
  return [boundedGet,probePublic,probeAuthenticated,readOperatorToken,containerMain].map(fn=>fn.toString()).join('\n')+`\nconst timer=setTimeout(()=>process.exit(1),30000);\ntry {const result=await containerMain(${JSON.stringify(mode)});await new Promise((resolve,reject)=>process.stdout.write(${mode==='copy'?'result':'JSON.stringify(result)'},error=>error?reject(new Error()):resolve()));${mode==='copy'?'result.fill(0);':''}}catch{process.exitCode=1;}finally{clearTimeout(timer);}\n`;
}

// Docker CLI evaluates these predicates after receiving inspect JSON over the trusted local socket.
// Only environment-policy booleans reach this launcher; the CLI sees full inspect metadata.
// A key allowlist (not a blacklist) refuses even empty/unknown execution overrides.
export function targetInspectionFormat() {
  const fields={id:'.Id',name:'.Name',image:'.Image',user:'.Config.User',running:'.State.Running',healthy:'.State.Health.Status',readonly:'.HostConfig.ReadonlyRootfs',project:'(index .Config.Labels "com.docker.compose.project")',service:'(index .Config.Labels "com.docker.compose.service")',ports:'.NetworkSettings.Ports',mounts:'.Mounts',security:'.HostConfig.SecurityOpt',caps:'.HostConfig.CapDrop',capAdd:'.HostConfig.CapAdd',privileged:'.HostConfig.Privileged',network:'.HostConfig.NetworkMode'};
  Object.assign(fields,{hostMounts:'.HostConfig.Mounts',binds:'.HostConfig.Binds',volumesFrom:'.HostConfig.VolumesFrom',sysctls:'(index .HostConfig "Sysctls")',apparmor:'.AppArmorProfile',tmpfs:'.HostConfig.Tmpfs',pidMode:'.HostConfig.PidMode',ipcMode:'.HostConfig.IpcMode',usernsMode:'.HostConfig.UsernsMode',utsMode:'.HostConfig.UTSMode',cgroupnsMode:'.HostConfig.CgroupnsMode',devices:'.HostConfig.Devices',deviceRequests:'.HostConfig.DeviceRequests',deviceCgroupRules:'.HostConfig.DeviceCgroupRules',maskedPaths:'.HostConfig.MaskedPaths',readonlyPaths:'.HostConfig.ReadonlyPaths',pidsLimit:'.HostConfig.PidsLimit',memoryLimit:'.HostConfig.Memory',memorySwap:'.HostConfig.MemorySwap',memoryReservation:'.HostConfig.MemoryReservation',oomKillDisable:'.HostConfig.OomKillDisable',init:'.HostConfig.Init',runtime:'.HostConfig.Runtime'});
  const command=JSON.stringify(JSON.stringify(['node','--import','tsx','deploy/studio-docker/bootstrap.mjs']));
  const entrypoint=JSON.stringify(JSON.stringify(['docker-entrypoint.sh']));
  const keys=['NODE_VERSION','YARN_VERSION','STUDIO_OPERATOR','STUDIO_HOST','PORT','STUDIO_STATE_DIR','STUDIO_GRANTS_FILE','STUDIO_WORKSPACE_FILE','STUDIO_FRONTEND_ASSET_ROOT','STUDIO_ANTHROPIC_SESSION_SETUP','STUDIO_VOICE_INPUT'];
  const path='PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin';
  const ca='NODE_EXTRA_CA_CERTS=/etc/studio/trust/host-approved-public-ca.pem';
  const approved='or '+keys.map(key=>'(eq $key '+JSON.stringify(key)+')').join(' ')+[path,ca,'NODE_ENV=production','STUDIO_NATIVE_AUTHORING=1'].map(value=>' (eq . '+JSON.stringify(value)+')').join('');
  return '{'+Object.entries(fields).map(([key,value])=>JSON.stringify(key)+':{{json '+value+'}}').join(',')+
    ',"commandApproved":{{and (eq (json .Config.Cmd) '+command+') (eq (json .Config.Entrypoint) '+entrypoint+') (eq .Path "docker-entrypoint.sh") (eq (json .Args) '+command+') (eq .Config.WorkingDir "/app")}}'+
    ',"runtimeEnv":[true{{range .Config.Env}}{{$key := index (split . "=") 0}},{{'+approved+'}}{{end}}]'+
    ',"pathApproved":{{$ok := false}}{{range .Config.Env}}{{if eq . '+JSON.stringify(path)+'}}{{$ok = true}}{{end}}{{end}}{{$ok}}'+
    ',"ca":[{{$comma := ""}}{{range .Config.Env}}{{if eq (index (split . "=") 0) "NODE_EXTRA_CA_CERTS"}}{{$comma}}{{eq . '+JSON.stringify(ca)+'}}{{$comma = ","}}{{end}}{{end}}]}';
}

async function ownedDocker() {
  const fs=await import('node:fs/promises');const {constants}=await import('node:fs');const {userInfo}=await import('node:os');
  const binaries=[userInfo().homedir+'/.docker/bin/docker','/usr/local/bin/docker','/opt/homebrew/bin/docker','/Applications/Docker.app/Contents/Resources/bin/docker'];
  let binary;let socket;
  for(const path of binaries)try{await fs.access(path,constants.X_OK);binary=path;break;}catch{}
  for(const path of [userInfo().homedir+'/.docker/run/docker.sock','/var/run/docker.sock'])try{if((await fs.stat(path)).isSocket()){socket=path;break;}}catch{}
  if(!binary||!socket)throw new Error('docker-unavailable');
  const invoke=(args,options)=>runProcess(binary,['--host','unix://'+socket,...args],options);
  // Deliberately select metadata; environment values are never exported.
  const format=targetInspectionFormat();
  const inspect=async()=>{try{return JSON.parse((await invoke(['inspect','--format',format,TARGET.container])).toString());}catch{throw new Error('target-refused');}};
  const privateCheck=async id=>{
    if(validateTarget(await inspect())!==id)throw new Error('target-refused');
    try{return JSON.parse((await invoke(['exec','-i','--user','1000:1000',id,'node','--input-type=module'],{input:helperSource('check'),limit:16384,timeoutMs:35000})).toString());}catch{throw new Error('helper-check-failed');}
  };
  return {inspect,privateCheck,invoke};
}

export async function copyOperatorToken({platform,inspect,readToken,clipboard,wait,notify}) {
  if(platform!=='darwin')throw new Error('clipboard-unavailable');
  const id=validateTarget(await inspect());let token;let observed;
  try {
    notify('Clipboard risk: clipboard managers/history, Universal Clipboard and sync may retain this operator token. Clearing cannot erase their copies. Keep this terminal open; paste only into this Studio’s Operator token field within 30 seconds.');
    token=await readToken(id);
    if(!Buffer.isBuffer(token)||token.length!==64||!token.every(b=>(b>=0x30&&b<=0x39)||(b>=0x61&&b<=0x66)))throw new Error('clipboard-unavailable');
    if(validateTarget(await inspect())!==id)throw new Error('target-refused');
    const before=await clipboard.generation();
    await clipboard.copy(token);
    const owned=await clipboard.generation();
    observed=await clipboard.read();
    if(owned<=before||!observed.equals(token)||await clipboard.generation()!==owned) return {schemaVersion:1,operatorSignIn:'copy-unconfirmed',clipboard:'left-changed',lifetimeSeconds:30};
    observed.fill(0);observed=undefined;
    notify('Operator token copied. Paste into the masked Studio Operator token field now. Conditional cleanup in 30 seconds.');
    await wait(30000);
    let status='left-changed';
    if(await clipboard.generation()===owned) {
      observed=await clipboard.read();
      if(observed.equals(token)&&await clipboard.generation()===owned) {
        if(await clipboard.clearIfUnchanged(owned)) {
          observed.fill(0);observed=await clipboard.read();
          status=observed.length===0?'cleared-owned-value':'cleanup-unconfirmed';
        }
      }
    }
    return {schemaVersion:1,operatorSignIn:'copied',clipboard:status,lifetimeSeconds:30};
  }finally{observed?.fill(0);token?.fill(0);}
}

export function macClipboard(run=runProcess) {
  const jxa=async text=>(await run('/usr/bin/osascript',['-l','JavaScript','-e',text],{limit:128,timeoutMs:3000})).toString().trim();
  return {
    generation:async()=>{const raw=await jxa('ObjC.import("AppKit"); String($.NSPasteboard.generalPasteboard.changeCount);');if(!/^[0-9]{1,15}$/.test(raw))throw new Error('clipboard-unavailable');return Number(raw);},
    copy:async bytes=>{await run('/usr/bin/pbcopy',[],{input:bytes,limit:128,timeoutMs:3000});},
    read:()=>run('/usr/bin/pbpaste',['-Prefer','txt'],{limit:8192,timeoutMs:3000}),
    clearIfUnchanged:async count=>{
      if(!Number.isSafeInteger(count)||count<0)throw new Error('clipboard-unavailable');
      const result=await jxa('ObjC.import("AppKit"); var p=$.NSPasteboard.generalPasteboard; var result="changed"; if(Number(p.changeCount)==='+count+'){p.clearContents; result="cleared";} result;');
      if(!['changed','cleared'].includes(result))throw new Error('clipboard-unavailable');return result==='cleared';
    },
  };
}

function waitForClipboardLifetime(ms) {
  return new Promise(resolve=>{
    const finish=()=>{clearTimeout(timer);process.removeListener('SIGINT',finish);process.removeListener('SIGTERM',finish);resolve();};
    const timer=setTimeout(finish,ms);process.once('SIGINT',finish);process.once('SIGTERM',finish);
  });
}

async function main() {
  let check='arguments-refused';
  try {
    const mode=parseArgs(process.argv.slice(2));
    check='docker-unavailable';const docker=await ownedDocker();
    check='required-check-failed';
    const result=await checkFirstVersion({...docker,publicCheck:()=>probePublic((path,limit)=>boundedGet(TARGET.origin,path,limit))});
    if(mode==='copy') {
      const copyResult=await copyOperatorToken({platform:process.platform,inspect:docker.inspect,readToken:async id=>{
        if(validateTarget(await docker.inspect())!==id)throw new Error('target-refused');
        return docker.invoke(['exec','-i','--user','1000:1000',id,'node','--input-type=module'],{input:helperSource('copy'),limit:64,timeoutMs:10000});
      },clipboard:macClipboard(),wait:waitForClipboardLifetime,notify:message=>process.stderr.write(message+'\n')});
      process.stdout.write(JSON.stringify(copyResult)+'\n');
    }else process.stdout.write(JSON.stringify(result)+'\n');
  }catch(error){
    const allowed=['arguments-refused','docker-unavailable','target-refused','public-check-failed','authenticated-check-failed','helper-check-failed','clipboard-unavailable'];
    process.stdout.write(JSON.stringify({schemaVersion:1,status:'broken',check:allowed.includes(error?.message)?error.message:check})+'\n');process.exitCode=1;
  }
}
const {pathToFileURL}=await import('node:url');
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();

export function validateTarget(v) {
  const caTarget = '/etc/studio/trust/host-approved-public-ca.pem';
  const caSource = '/Users/te451223/Flightdeck-code/deploy/studio-docker/trust/host-approved-public-ca.pem';
  if (!v || !Array.isArray(v.runtimeEnv) || v.runtimeEnv.length < 1 || v.runtimeEnv.some(flag=>flag!==true) || v.pathApproved !== true) throw new Error('target-refused');
  const exact=(value,expected)=>JSON.stringify(value)===JSON.stringify(expected);
  if (!exact(v.binds,[TARGET.volume+':/state:rw']) || v.volumesFrom!==null || v.sysctls!==null || v.apparmor!=='') throw new Error('target-refused');
  const masked=['/proc/acpi','/proc/asound','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/sched_debug','/proc/scsi','/proc/timer_list','/proc/timer_stats','/sys/devices/virtual/powercap','/sys/firmware'];
  const readonly=['/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger'];
  if (!exact(v.tmpfs,{'/tmp':'rw,noexec,nosuid,size=64m,mode=1777'}) || !exact(v.security,['no-new-privileges:true']) || !exact(v.caps,['ALL']) || v.pidMode!=='' || v.ipcMode!=='private' || v.usernsMode!=='' || v.utsMode!=='' || v.cgroupnsMode!=='private' || v.devices!==null || v.deviceRequests!==null || v.deviceCgroupRules!==null || v.pidsLimit!==128 || v.memoryLimit!==805306368 || v.memorySwap!==1610612736 || v.memoryReservation!==0 || v.oomKillDisable!==null || v.init!==true || v.runtime!=='runc' || v.commandApproved!==true || !exact(v.maskedPaths,masked) || !exact(v.readonlyPaths,readonly)) throw new Error('target-refused');
  const state = v?.mounts?.find(m => m.Destination === '/state');
  const ca = v?.mounts?.find(m => m.Destination === caTarget);
  if (!v || !/^[0-9a-f]{64}$/.test(v.id) || v.name !== '/'+TARGET.container || v.image !== TARGET.image || v.user !== '1000:1000' || v.running !== true || v.healthy !== 'healthy' || v.readonly !== true || v.project !== 'flightdeck-studio-staging' || v.service !== 'studio-staging' || v.network !== 'flightdeck-studio-staging_default' || JSON.stringify(v.ports) !== JSON.stringify({'8787/tcp':[{HostIp:'127.0.0.1',HostPort:'8790'}]}) || !v.security?.includes('no-new-privileges:true') || !v.caps?.includes('ALL') || v.privileged !== false || !(v.capAdd === null || (Array.isArray(v.capAdd) && v.capAdd.length === 0)) || !state || state.Type !== 'volume' || state.Name !== TARGET.volume || state.RW !== true || !Array.isArray(v.ca)) throw new Error('target-refused');
  if (ca) {
    const spec=v.hostMounts?.[0];
    if (!Array.isArray(v.hostMounts) || v.hostMounts.length!==1 || !spec || !exact(Object.keys(spec).sort(),['BindOptions','ReadOnly','Source','Target','Type']) || spec.Type!=='bind' || spec.Source!==caSource || spec.Target!==caTarget || spec.ReadOnly!==true || !exact(spec.BindOptions,{})) throw new Error('target-refused');
    if (v.mounts.length !== 2 || ca.Type !== 'bind' || ca.Source !== caSource || ca.RW !== false || JSON.stringify(v.ca) !== JSON.stringify([true])) throw new Error('target-refused');
  } else if (v.mounts.length !== 1 || v.ca.length !== 0 || v.hostMounts!==null) throw new Error('target-refused');
  return v.id;
}
