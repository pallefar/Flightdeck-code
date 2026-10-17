import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as launcher from './studio-first-test.mjs';

const goodInspection = () => ({
  id: 'a'.repeat(64), name: '/'+launcher.TARGET.container, image: launcher.TARGET.image,
  user: '1000:1000', running: true, healthy: 'healthy', readonly: true,
  project: 'flightdeck-studio-staging', service: 'studio-staging',
  ports: {'8787/tcp': [{HostIp: '127.0.0.1', HostPort: '8790'}]},
  mounts: [{Type: 'volume', Name: launcher.TARGET.volume, Destination: '/state', RW: true}],
  security: ['no-new-privileges:true'], caps: ['ALL'], capAdd: null, privileged: false, network: 'flightdeck-studio-staging_default', ca: [],
  runtimeEnv: [true], pathApproved: true,
  tmpfs: {'/tmp':'rw,noexec,nosuid,size=64m,mode=1777'},
  hostMounts:null, binds:[launcher.TARGET.volume+':/state:rw'], volumesFrom:null, sysctls:null, apparmor:'',
  pidMode:'', ipcMode:'private', usernsMode:'', utsMode:'', cgroupnsMode:'private',
  devices:null, deviceRequests:null, deviceCgroupRules:null,
  pidsLimit:128, memoryLimit:805306368, memorySwap:1610612736, memoryReservation:0, oomKillDisable:null,
  init:true, runtime:'runc', commandApproved:true,
  maskedPaths:['/proc/acpi','/proc/asound','/proc/interrupts','/proc/kcore','/proc/keys','/proc/latency_stats','/proc/sched_debug','/proc/scsi','/proc/timer_list','/proc/timer_stats','/sys/devices/virtual/powercap','/sys/firmware'],
  readonlyPaths:['/proc/bus','/proc/fs','/proc/irq','/proc/sys','/proc/sysrq-trigger'],
});

describe('literal CLI and owned target admission', () => {
  it('pins the reviewed authoring candidate in the helper and private Studio configuration', () => {
    const approved = 'sha256:e9a04ab64bd985fabe72c44a42b8194547affdfe0643d0dd562428bd087ee152';
    expect(launcher.TARGET.image).toBe(approved);
    const compose = readFileSync(new URL('../deploy/studio-docker/staging.compose.yml', import.meta.url), 'utf8');
    expect(/^    image: (\S+)$/m.exec(compose)?.[1]).toBe(approved);
    const obsolete = goodInspection();
    obsolete.image = 'sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf';
    expect(() => launcher.validateTarget(obsolete)).toThrow('target-refused');
  });
  it('defaults to check and requires both explicit clipboard flags', () => {
    expect(typeof launcher.parseArgs).toBe('function');
    expect(launcher.parseArgs([])).toBe('check');
    expect(launcher.parseArgs(['--check'])).toBe('check');
    expect(launcher.parseArgs(['--copy-operator-token', '--acknowledge-clipboard-risk'])).toBe('copy');
    for (const args of [['--copy-operator-token'], ['--acknowledge-clipboard-risk'], ['--url=http://example.com'], ['--check', '--copy-operator-token', '--acknowledge-clipboard-risk'], ['--check','--check']]) expect(() => launcher.parseArgs(args)).toThrow('arguments-refused');
  });
  it('refuses privileged mode or added capabilities before credential admission', () => {
    for(const mutate of [v=>v.privileged=true,v=>v.capAdd=['SYS_ADMIN']]){
      const v=goodInspection();mutate(v);expect(()=>launcher.validateTarget(v)).toThrow('target-refused');
    }
  });
  it('admits only the exact image, loopback mapping, private mount and approved optional public CA', () => {
    expect(typeof launcher.validateTarget).toBe('function');
    expect(launcher.validateTarget(goodInspection())).toBe('a'.repeat(64));
    const ca = goodInspection();
    ca.mounts.push({Type:'bind',Source:'/Users/te451223/Flightdeck-code/deploy/studio-docker/trust/host-approved-public-ca.pem',Destination:'/etc/studio/trust/host-approved-public-ca.pem',RW:false});
    ca.ca = [true]; // Projection exports only path-policy booleans, never Env values.
    ca.hostMounts=[{Type:'bind',Source:'/Users/te451223/Flightdeck-code/deploy/studio-docker/trust/host-approved-public-ca.pem',Target:'/etc/studio/trust/host-approved-public-ca.pem',ReadOnly:true,BindOptions:{}}];
    expect(launcher.validateTarget(ca)).toBe('a'.repeat(64));
    for (const mutate of [x=>x.image='sha256:wrong',x=>x.name='/other',x=>x.user='0',x=>x.running=false,x=>x.ports['8787/tcp'][0].HostIp='0.0.0.0',x=>x.ports['8787/tcp'].push({HostIp:'127.0.0.1',HostPort:'9999'}),x=>x.mounts[0].Name='other',x=>x.mounts.push({Type:'bind',Source:'/secret',Destination:'/etc/secret',RW:false}),x=>x.ca=['NODE_EXTRA_CA_CERTS=/secret'],x=>x.readonly=false,x=>x.project='os',x=>x.network='host']) {
      const value = goodInspection(); mutate(value); expect(() => launcher.validateTarget(value)).toThrow('target-refused');
    }
  });
});

describe('M1 execution environment admission', () => {
  it('admits only the exact explicit native-drafting flag without exporting environment values', () => {
    const format = launcher.targetInspectionFormat();
    expect(format).toContain('(eq . "STUDIO_NATIVE_AUTHORING=1")');
    expect(format).not.toContain('(eq $key "STUDIO_NATIVE_AUTHORING")');
    expect(format).not.toContain('{{json .Config.Env}}');
    const compose = readFileSync(new URL('../deploy/studio-docker/staging.compose.yml', import.meta.url), 'utf8');
    expect(compose).toMatch(/^      STUDIO_NATIVE_AUTHORING: "1"$/m);
  });
  it('refuses missing or unsafe runtime policy before public, private or mock-copy entry', async () => {
    for (const mutate of [v=>delete v.runtimeEnv, v=>v.runtimeEnv=[], v=>v.runtimeEnv=[true,false], v=>v.runtimeEnv=['true'], v=>delete v.pathApproved, v=>v.pathApproved=false]) {
      const v=goodInspection();mutate(v);const calls=[];
      await expect(launcher.checkFirstVersion({inspect:async()=>v,publicCheck:async()=>{calls.push('public');throw new Error('unexpected-entry');},privateCheck:async()=>{calls.push('private');}})).rejects.toThrow('target-refused');
      await expect(launcher.copyOperatorToken({platform:'darwin',inspect:async()=>v,readToken:async()=>{calls.push('token');},notify:()=>calls.push('notify')})).rejects.toThrow('target-refused');
      expect(calls).toEqual([]);
    }
  });
  it('projects runtime policy without exporting raw environment values', () => {
    expect(typeof launcher.targetInspectionFormat).toBe('function');
    const format=launcher.targetInspectionFormat();
    expect(format).toContain('"runtimeEnv"');expect(format).toContain('.Config.Env');
    expect(format).not.toContain('{{json .Config.Env}}');expect(format).not.toContain('{{json .}}');
    expect(format).toContain('NODE_EXTRA_CA_CERTS=/etc/studio/trust/host-approved-public-ca.pem');
  });
});

describe('M2 complete runtime configuration admission', () => {
  it('refuses alternative mount specifications and inherited mount/security drift', () => {
    for(const mutate of [v=>v.hostMounts=[{Type:'tmpfs',Target:'/app/dist',TmpfsOptions:{SizeBytes:1024}}],v=>v.binds.push('/NONSECRET:/app:rw'),v=>v.binds=[],v=>v.volumesFrom=['NONSECRET'],v=>v.sysctls={'net.ipv4.ip_forward':'1'},v=>v.apparmor='unconfined']) {
      const value=goodInspection();mutate(value);expect(()=>launcher.validateTarget(value)).toThrow('target-refused');
    }
    for(const key of ['hostMounts','binds','volumesFrom','sysctls','apparmor']){const value=goodInspection();delete value[key];expect(()=>launcher.validateTarget(value)).toThrow('target-refused');}
  });
  it('rejects every mount, security, namespace, device, resource, init and command drift before work', async () => {
    const changes=[
      v=>delete v.tmpfs, v=>v.tmpfs={}, v=>v.tmpfs['/app/dist']='rw,size=16m', v=>v.tmpfs['/app']='rw,size=16m', v=>v.tmpfs['/state']='rw,size=16m', v=>v.tmpfs['/tmp']='rw,size=64m',
      v=>v.security.push('seccomp=unconfined'), v=>v.security.push('apparmor=unconfined'), v=>v.security.push('no-new-privileges:true'), v=>v.caps.push('SYS_ADMIN'),
      v=>v.pidMode='host', v=>v.ipcMode='host', v=>v.usernsMode='host', v=>v.utsMode='host', v=>v.cgroupnsMode='host',
      v=>v.devices=[{PathOnHost:'/dev/NONSECRET',PathInContainer:'/dev/NONSECRET',CgroupPermissions:'rwm'}], v=>v.deviceRequests=[{Count:-1,Capabilities:[['gpu']]}], v=>v.deviceCgroupRules=['c *:* rwm'],
      v=>v.pidsLimit=0, v=>v.pidsLimit=-1, v=>v.memoryLimit=0, v=>v.memoryLimit=805306369, v=>v.memorySwap=-1, v=>v.memoryReservation=1, v=>v.oomKillDisable=true,
      v=>v.init=false, v=>v.runtime='untrusted-fixture', v=>v.commandApproved=false, v=>delete v.commandApproved, v=>v.maskedPaths=[], v=>v.readonlyPaths=[],
    ];
    for(const mutate of changes) {
      const value=goodInspection();mutate(value);const calls=[];
      await expect(launcher.checkFirstVersion({inspect:async()=>value,publicCheck:async()=>{calls.push('public');throw new Error('unexpected-entry');},privateCheck:async()=>{calls.push('private');}})).rejects.toThrow('target-refused');
      expect(calls).toEqual([]);
    }
    for(const key of ['pidMode','ipcMode','usernsMode','utsMode','cgroupnsMode','devices','deviceRequests','deviceCgroupRules','pidsLimit','memoryLimit','memorySwap','memoryReservation','oomKillDisable','init','runtime','maskedPaths','readonlyPaths']) {
      const value=goodInspection();delete value[key];expect(()=>launcher.validateTarget(value)).toThrow('target-refused');
    }
  });
  it('admits approved CA mount metadata independently of object field ordering', () => {
    const value=goodInspection();
    const caSource='/Users/te451223/Flightdeck-code/deploy/studio-docker/trust/host-approved-public-ca.pem';
    const caTarget='/etc/studio/trust/host-approved-public-ca.pem';
    value.mounts.push({Type:'bind',Source:caSource,Destination:caTarget,RW:false});value.ca=[true];
    value.hostMounts=[{BindOptions:{},ReadOnly:true,Source:caSource,Target:caTarget,Type:'bind'}];
    expect(launcher.validateTarget(value)).toBe(value.id);
    value.hostMounts[0].BindOptions={Propagation:'shared'};expect(()=>launcher.validateTarget(value)).toThrow('target-refused');
    value.hostMounts[0].BindOptions={};value.hostMounts[0].Unexpected='NONSECRET';expect(()=>launcher.validateTarget(value)).toThrow('target-refused');
  });
  it('projects the omitted HostConfig surfaces and effective command as a policy boolean', () => {
    const format=launcher.targetInspectionFormat();
    for(const field of ['Tmpfs','Mounts','Binds','VolumesFrom','PidMode','IpcMode','UsernsMode','UTSMode','CgroupnsMode','Devices','DeviceRequests','DeviceCgroupRules','PidsLimit','Memory','MemorySwap','MemoryReservation','OomKillDisable','Init','Runtime','MaskedPaths','ReadonlyPaths'])expect(format).toContain('.HostConfig.'+field);
    expect(format).toContain('(index .HostConfig "Sysctls")'); // Docker may omit this empty map.
    for(const field of ['.Config.Cmd','.Config.Entrypoint','.Path','.Args','.Config.WorkingDir'])expect(format).toContain(field);
    expect(format).toContain('"commandApproved"');expect(format).not.toContain('"command":{{json .Config.Cmd}}');
  });
});

const source = new URL('./studio-first-test.mjs', import.meta.url);

const csp = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self' about:; form-action 'none'";
const html = '<html><head><script type="module" src="/assets/index-12345678.js"></script><link rel="stylesheet" href="/assets/index-12345678.css"></head><body><div id="root"></div></body></html>';
const publicFiles = {'/':html,'/assets/index-12345678.js':'/* NONSECRET BUILT JS */','/assets/index-12345678.css':'/* NONSECRET BUILT CSS */'};
const publicHeaders = {'content-security-policy':csp,'x-content-type-options':'nosniff','referrer-policy':'no-referrer','permissions-policy':'camera=(), microphone=(self), on-device-speech-recognition=(self), geolocation=(), payment=(), usb=()'};
function publicGet(path) {
  if (path==='/api/studio/health') return {status:200,headers:{},body:Buffer.from('{"ok":true}')};
  if (path==='/api/studio/ready') return {status:200,headers:{'cache-control':'no-store'},body:Buffer.from('{"ready":true,"scope":"request-admission"}')};
  if (publicFiles[path]) return {status:200,headers:{...publicHeaders,'content-type':path==='/'?'text/html; charset=utf-8':path.endsWith('.js')?'application/javascript; charset=utf-8':'text/css; charset=utf-8','cache-control':path==='/'?'no-cache':'public, max-age=31536000, immutable'},body:Buffer.from(publicFiles[path])};
  return {status:404,headers:{'content-type':'application/json'},body:Buffer.from('{}')};
}

describe('actual built assets and public lifecycle checks', () => {
  it('validates bounded literal asset bytes and reports no invented model readiness', async () => {
    expect(typeof launcher.probePublic).toBe('function');
    const paths=[];
    const result=await launcher.probePublic(async path=>{paths.push(path);return publicGet(path);});
    expect(result.health).toBe('pass'); expect(result.readiness).toBe('pass');
    expect(result.assets).toBe('pass'); expect(result.security).toBe('pass');
    expect(result.witness).toMatch(/^[0-9a-f]{64}$/);
    expect(paths).not.toContain('/api/studio/build');
  });
  it('refuses unsafe CSP, absent assets, arbitrary references and unready service', async () => {
    expect(typeof launcher.probePublic).toBe('function');
    for (const mutate of [r=>{r.headers['content-security-policy']="default-src *";},r=>{r.body=Buffer.from(html.replace('/assets/index-12345678.js','https://evil.example/code.js'));},r=>{r.status=503;}]) {
      await expect(launcher.probePublic(async path=>{const r=publicGet(path);if(path==='/')mutate(r);return r;})).rejects.toThrow('public-check-failed');
    }
    await expect(launcher.probePublic(async path=>path==='/api/studio/ready'?{status:503,headers:{},body:Buffer.from('{}')}:publicGet(path))).rejects.toThrow('public-check-failed');
    await expect(launcher.probePublic(async path=>path.endsWith('.js')?{status:404,headers:{},body:Buffer.from('{}')}:publicGet(path))).rejects.toThrow('public-check-failed');
  });
});

describe('private authenticated GET-only checks', () => {
  const descriptors = ['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,label:id,model:null,status:'unavailable',verification:'not-probed',reason:'NONSECRET fixture unavailable'}));
  function fixture() {
    const paths=[];
    const token=Buffer.from('0'.repeat(64)); // Clearly nonsecret, never a live credential.
    const get=async (path,_limit,credential)=>{
      paths.push({path,auth:!!credential});
      expect(!credential || credential.equals(token)).toBe(true);
      if(path==='/api/studio/health')return {status:200,headers:{},body:Buffer.from(JSON.stringify({ok:true,selectedId:null,model:null,modelStatus:'unselected',verification:'not-probed'}))};
      if(!credential)return {status:401,headers:{},body:Buffer.from('{"error":"NONSECRET fixture unauthorized"}')};
      const data=path==='/api/studio/model-connections'?{connections:descriptors,selectedId:null}:path.endsWith('/setup')?{available:true,persistence:'server-memory',model:'fixture-model',status:'unavailable',revision:'12345678-1234-1234-1234-123456789abc'}:{drafts:[]};
      return {status:200,headers:{'cache-control':'no-store'},body:Buffer.from(JSON.stringify(data))};
    };
    return {paths,token,get};
  }
  it('returns four truthful descriptors with no selection and no live-AI claim', async () => {
    expect(typeof launcher.probeAuthenticated).toBe('function');
    const f=fixture(); const r=await launcher.probeAuthenticated(f.get,f.token);
    expect(r.models).toEqual(descriptors.map(({id,status,verification})=>({id,status,verification})));
    expect(r.liveAI).toBe('unconfigured');expect(r.selection).toBe('none');
    expect(r.workspaceRead).toBe('pass');expect(r.setup).toBe('available-memory-only-unconfigured');
    expect(f.paths.every(p=>p.path==='/api/studio/health'||p.path==='/api/studio/model-connections'||p.path==='/api/studio/model-connections/anthropic/setup'||p.path==='/api/studio/workspaces/studio-first-test/workflows')).toBe(true);
    expect(JSON.stringify(r)).not.toContain('NONSECRET');expect(JSON.stringify(r)).not.toContain('fixture-model');
  });
  it('rejects fabricated verification, missing descriptors and failed workspace reads', async () => {
    expect(typeof launcher.probeAuthenticated).toBe('function');
    for(const change of [data=>data.connections.pop(),data=>data.connections[0].verification='verified',data=>data.connections[0].status='configured']) {
      const f=fixture();await expect(launcher.probeAuthenticated(async (...args)=>{const r=await f.get(...args);if(args[0]==='/api/studio/model-connections'&&args[2]){const data=JSON.parse(r.body);change(data);r.body=Buffer.from(JSON.stringify(data));}return r;},f.token)).rejects.toThrow('authenticated-check-failed');
    }
    const f=fixture();await expect(launcher.probeAuthenticated(async (...args)=>args[0].includes('/workspaces/')&&args[2]?{status:500,headers:{},body:Buffer.from('{"error":"PRIVATE BODY MUST NOT ESCAPE"}')}:f.get(...args),f.token)).rejects.toThrow('authenticated-check-failed');
  });
});

describe('bounded private-file and socket plumbing', () => {
  function files(change={}) {
    const closed=[];const opened=[];
    const stat={isFile:()=>true,isDirectory:()=>false,isSymbolicLink:()=>false,size:64,uid:1000,mode:0o100600,ino:7,mtimeMs:1,ctimeMs:1,...change};
    return {closed,opened,fs:{lstat:async()=>({...stat,isFile:()=>false,isDirectory:()=>true,mode:0o40700}),open:async(path,flags)=>{opened.push({path,flags});return {stat:async()=>stat,read:async b=>{b.fill('0',0,64);return {bytesRead:64};},close:async()=>{closed.push(path);}};}}};
  }
  it('reads only the existing private regular operator token with no-follow flags', async () => {
    expect(typeof launcher.readOperatorToken).toBe('function');
    const f=files();const value=await launcher.readOperatorToken(f.fs,1000);
    expect(value.equals(Buffer.from('0'.repeat(64)))).toBe(true);
    expect(f.opened.map(x=>x.path)).toEqual(['/state/operator-token']);expect(f.closed).toEqual(['/state/operator-token']);
    for(const change of [{uid:0},{mode:0o100644},{size:9000},{isFile:()=>false}])await expect(launcher.readOperatorToken(files(change).fs,1000)).rejects.toThrow('private-token-refused');
    await expect(launcher.readOperatorToken(files().fs,0)).rejects.toThrow('private-token-refused');
  });
  it('bounds real response bytes, redirects and stalled sockets without leaking response text', async () => {
    expect(typeof launcher.boundedGet).toBe('function');
    const {createServer}=await import('node:http');
    const server=createServer((req,res)=>{
      if(req.url==='/large'){res.end('NONSECRET RESPONSE '.repeat(100));return;}
      if(req.url==='/redirect'){res.writeHead(302,{location:'http://example.invalid'});res.end();return;}
      if(req.url==='/hang')return;
      res.end('{"ok":true}');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const origin='http://127.0.0.1:'+server.address().port;
    try {
      expect((await launcher.boundedGet(origin,'/',100)).status).toBe(200);
      await expect(launcher.boundedGet(origin,'/large',100)).rejects.toThrow('http-check-failed');
      await expect(launcher.boundedGet(origin,'/redirect',100)).rejects.toThrow('http-check-failed');
      await expect(launcher.boundedGet(origin,'/hang',100,undefined,25)).rejects.toThrow('http-check-failed');
    }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  });
});

describe('safe end-to-end check orchestration', () => {
  const privateResult={witness:'a'.repeat(64),immutableAssets:'pass',authentication:'pass',models:['codex-chatgpt','flightdeck','local','anthropic'].map(id=>({id,status:'unavailable',verification:'not-probed'})),selection:'none',setup:'available-memory-only-unconfigured',workspaceRead:'pass',liveAI:'unconfigured',modelRequests:'not-performed'};
  it('validates ownership before any private work and strips untrusted helper fields', async () => {
    expect(typeof launcher.checkFirstVersion).toBe('function');
    const calls=[];
    const result=await launcher.checkFirstVersion({inspect:async()=>{calls.push('inspect');return goodInspection();},publicCheck:async()=>{calls.push('public');return {witness:'a'.repeat(64)};},privateCheck:async id=>{calls.push('private');expect(id).toBe('a'.repeat(64));return {...privateResult,privateBody:'NEVER PRINT THIS'};}});
    expect(calls).toEqual(['inspect','public','inspect','private','inspect']);
    expect(result.localWorkflows).toBe('ready-to-test');expect(result.liveAI).toBe('unconfigured');
    expect(result.clipboard).toBe('not-accessed');expect(result.recordWrites).toBe('not-performed');
    expect(JSON.stringify(result)).not.toContain('NEVER PRINT THIS');expect(JSON.stringify(result)).not.toContain('witness');
    let entered=false;
    await expect(launcher.checkFirstVersion({inspect:async()=>({...goodInspection(),image:'wrong'}),privateCheck:async()=>{entered=true;}})).rejects.toThrow('target-refused');expect(entered).toBe(false);
  });
  it('rejects a replaced container, mismatched served bytes or malformed status payloads', async () => {
    expect(typeof launcher.checkFirstVersion).toBe('function');
    for(const change of [r=>r.witness='b'.repeat(64),r=>r.models[0].status='PRIVATE LEAK',r=>r.selection='PRIVATE LEAK',r=>r.workspaceRead='fail']) {
      const p=structuredClone(privateResult);change(p);
      await expect(launcher.checkFirstVersion({inspect:async()=>goodInspection(),publicCheck:async()=>({witness:'a'.repeat(64)}),privateCheck:async()=>p})).rejects.toThrow('helper-check-failed');
    }
  });
});

describe('bounded executable launcher', () => {
  it('rejects clipboard intent without acknowledgment before accessing any secret', async () => {
    const {spawnSync}=await import('node:child_process');
    const r=spawnSync(process.execPath,[source.pathname,'--copy-operator-token'],{encoding:'utf8',timeout:5000,env:{PATH:'/usr/bin:/bin',HOME:'/nonexistent',TMPDIR:'/Users/te451223/.hermes/cache/scratch'}});
    expect(r.status).toBe(1);expect(JSON.parse(r.stdout)).toEqual({schemaVersion:1,status:'broken',check:'arguments-refused'});expect(r.stderr).toBe('');
  });
  it('bounds child output and execution with fixed nonsecret errors', async () => {
    expect(typeof launcher.runProcess).toBe('function');
    const result=await launcher.runProcess(process.execPath,['-e','process.stdout.write("NONSECRET")'],{limit:100,timeoutMs:1000});
    expect(result.toString()).toBe('NONSECRET');
    await expect(launcher.runProcess(process.execPath,['-e','process.stdout.write("NONSECRET".repeat(1000))'],{limit:100,timeoutMs:1000})).rejects.toThrow('process-check-failed');
    await expect(launcher.runProcess(process.execPath,['-e','setInterval(()=>{},1000)'],{limit:100,timeoutMs:25})).rejects.toThrow('process-check-failed');
    await expect(launcher.runProcess(process.execPath,['-e','process.stderr.write("DO NOT EXPOSE");process.exit(1)'],{limit:100,timeoutMs:1000})).rejects.toThrow('process-check-failed');
  });
  it('generates a self-contained container helper without secret arguments or environment reads', async () => {
    expect(typeof launcher.helperSource).toBe('function');
    const text=launcher.helperSource('check');
    expect(text).toContain('readOperatorToken');expect(text).not.toContain('process.env');
    expect(text).not.toContain('pbcopy');
    const {spawnSync}=await import('node:child_process');
    const r=spawnSync(process.execPath,['--input-type=module','--check'],{input:text,encoding:'utf8',timeout:5000});
    expect(r.status).toBe(0);expect(r.stderr).toBe('');
    expect(()=>launcher.helperSource('other')).toThrow('arguments-refused');
  });
});

describe('L1 owned child lifecycle', () => {
  const scratch='/Users/te451223/.hermes/cache/scratch/';
  const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const alive=pid=>{try{process.kill(pid,0);return true;}catch{return false;}};
  async function fixture() {
    const fs=await import('node:fs/promises');
    const dir=await fs.mkdtemp(scratch+'first-test-owned-child-');
    const marker=dir+'/pids.json';
    let pids=[];
    return {marker,async pids(){for(let i=0;i<200;i++){try{pids=JSON.parse(await fs.readFile(marker,'utf8'));return pids;}catch{await delay(5);}}throw new Error('fixture-pid-timeout');},async clean(){for(const pid of pids)if(alive(pid))try{process.kill(pid,'SIGKILL');}catch{}for(let i=0;i<100&&pids.some(alive);i++)await delay(5);await fs.rm(dir,{recursive:true,force:true});expect(pids.filter(alive),'all owned fixture children must be gone').toEqual([]);}};
  }
  function code(marker,{escape=false,exit=false}={}) {
    return `const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setTimeout(()=>{},3000)'],{detached:${escape},stdio:['ignore','inherit','inherit']});fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify([process.pid,child.pid]));${exit?'process.stdout.write("NONSECRET");process.exit(0);':'setTimeout(()=>process.exit(0),3000);'}`;
  }
  it('kills an owned process group on timeout without waiting for inherited pipes', async () => {
    const f=await fixture();let work;
    try {
      work=launcher.runProcess(process.execPath,['-e',code(f.marker)],{limit:128,timeoutMs:150}).then(()=> 'resolved',e=>e.message);
      const pids=await f.pids();const status=await Promise.race([work,delay(650).then(()=> 'pending')]);
      expect(status).toBe('process-check-failed');
      for(let i=0;i<100&&pids.some(alive);i++)await delay(5);
      expect(pids.filter(alive),'ordinary descendants must not survive the timeout').toEqual([]);
    }finally{await f.clean();await work;}
  });
  it('reaps same-group descendants when the direct child successfully exits', async () => {
    const f=await fixture();let work;
    try {
      work=launcher.runProcess(process.execPath,['-e',code(f.marker,{exit:true})],{limit:128,timeoutMs:2000}).then(b=>b.toString(),e=>e.message);
      const pids=await f.pids();expect(await Promise.race([work,delay(650).then(()=> 'pending')])).toBe('NONSECRET');
      for(let i=0;i<100&&pids.some(alive);i++)await delay(5);
      expect(pids.filter(alive)).toEqual([]);
    }finally{await f.clean();await work;}
  });
  it('bounds stream closure even when an owned fixture escapes its process group', async () => {
    const f=await fixture();let work;
    try {
      work=launcher.runProcess(process.execPath,['-e',code(f.marker,{escape:true})],{limit:128,timeoutMs:150}).then(()=> 'resolved',e=>e.message);
      await f.pids();expect(await Promise.race([work,delay(650).then(()=> 'pending')])).toBe('process-check-failed');
      // Only this harness knows the escaped PID; it is cleaned below, not claimed killed by runProcess.
    }finally{await f.clean();await work;}
  });
  it('cleans its owned group on explicit parent exit', async () => {
    const f=await fixture();let wrapper;
    const {spawn}=await import('node:child_process');
    try {
      const body=`import {runProcess} from ${JSON.stringify(source.href)};import {existsSync} from 'node:fs';const poll=setInterval(()=>{if(existsSync(${JSON.stringify(f.marker)}))process.exit(0);},5);await runProcess(process.execPath,['-e',${JSON.stringify(code(f.marker))}],{limit:128,timeoutMs:2500}).catch(()=>{});clearInterval(poll);`;
      wrapper=spawn(process.execPath,['--input-type=module','-e',body],{env:{PATH:'/usr/bin:/bin',HOME:scratch,TMPDIR:scratch},stdio:'ignore'});
      const exit=new Promise(resolve=>wrapper.once('exit',(code,signal)=>resolve({code,signal})));
      const pids=await f.pids();expect(await Promise.race([exit,delay(1000).then(()=> 'pending')])).toEqual({code:0,signal:null});
      for(let i=0;i<100&&pids.some(alive);i++)await delay(5);
      expect(pids.filter(alive),'explicit parent exit must not orphan its owned group').toEqual([]);
    }finally{if(wrapper?.exitCode===null&&wrapper?.signalCode===null)wrapper.kill('SIGKILL');await f.clean();}
  });
  it.each(['SIGINT','SIGTERM'])('cancels its owned group on parent %s', async signal => {
    const f=await fixture();let wrapper;
    const {spawn}=await import('node:child_process');
    try {
      const body=`import {runProcess} from ${JSON.stringify(source.href)};await runProcess(process.execPath,['-e',${JSON.stringify(code(f.marker))}],{limit:128,timeoutMs:2500}).catch(()=>{});`;
      wrapper=spawn(process.execPath,['--input-type=module','-e',body],{env:{PATH:'/usr/bin:/bin',HOME:scratch,TMPDIR:scratch},stdio:'ignore'});
      const exit=new Promise(resolve=>wrapper.once('exit',(code,signal)=>resolve({code,signal})));
      const pids=await f.pids();wrapper.kill(signal);
      const result=await Promise.race([exit,delay(1000).then(()=> 'pending')]);
      expect(result).toEqual({code:signal==='SIGINT'?130:143,signal:null});
      for(let i=0;i<100&&pids.some(alive);i++)await delay(5);
      expect(pids.filter(alive),'parent cancellation must reach ordinary owned descendants').toEqual([]);
    }finally{if(wrapper?.exitCode===null&&wrapper?.signalCode===null)wrapper.kill('SIGKILL');await f.clean();}
  });
});

describe('explicit clipboard exception with NONSECRET doubles only', () => {
  function fixture(changed=false) {
    const events=[];let value=Buffer.alloc(0);let generation=1;
    const original=Buffer.from('0'.repeat(64));
    return {events,original,deps:{platform:'darwin',inspect:async()=>{events.push('inspect');return goodInspection();},readToken:async()=>{events.push('read-owned-token');return original;},notify:message=>events.push(message),wait:async ms=>{events.push(['wait',ms]);if(changed){generation++;value=Buffer.from('NONSECRET OTHER APP COPY');}},clipboard:{generation:async()=>generation,copy:async bytes=>{events.push('pbcopy-stdin');value=Buffer.from(bytes);generation++;},read:async()=>Buffer.from(value),clearIfUnchanged:async expected=>{events.push('conditional-clear');if(generation!==expected)return false;value.fill(0);value=Buffer.alloc(0);generation++;return true;}}},value:()=>value};
  }
  it('uses only stdin, retains a short lifetime, and zeroes the private buffer', async () => {
    expect(typeof launcher.copyOperatorToken).toBe('function');
    const f=fixture();const r=await launcher.copyOperatorToken(f.deps);
    expect(r).toEqual({schemaVersion:1,operatorSignIn:'copied',clipboard:'cleared-owned-value',lifetimeSeconds:30});
    expect(f.events.indexOf('inspect')).toBeLessThan(f.events.indexOf('read-owned-token'));
    expect(f.events).toContain('pbcopy-stdin');expect(f.events).toContainEqual(['wait',30000]);expect(f.value().length).toBe(0);expect(f.original.every(b=>b===0)).toBe(true);
    expect(JSON.stringify(f.events)).not.toContain('0'.repeat(64));
  });
  it('does not clear another app’s clipboard value or operate on other platforms', async () => {
    expect(typeof launcher.copyOperatorToken).toBe('function');
    const f=fixture(true);const r=await launcher.copyOperatorToken(f.deps);
    expect(r.clipboard).toBe('left-changed');expect(f.events).not.toContain('conditional-clear');expect(f.value().toString()).toBe('NONSECRET OTHER APP COPY');
    const other=fixture();other.deps.platform='linux';await expect(launcher.copyOperatorToken(other.deps)).rejects.toThrow('clipboard-unavailable');expect(other.events).toEqual([]);
    const bad=fixture();bad.deps.inspect=async()=>({...goodInspection(),mounts:[]});await expect(launcher.copyOperatorToken(bad.deps)).rejects.toThrow('target-refused');expect(bad.events).not.toContain('read-owned-token');
  });
});

describe('L2 exact token byte admission', () => {
  const invalid=[0xb0,0xb1,0xe1,0xe6,0x80,0x00,0x2f,0x3a,0x60,0x67,0x41];
  it('rejects non-ASCII and non-hex private file bytes without lossy decoding', async () => {
    for(const byte of invalid) {
      let closed=false;let readBuffer;
      const stat={isFile:()=>true,uid:1000,mode:0o100600,size:64,ino:7,mtimeMs:1,ctimeMs:1};
      const fs={lstat:async()=>({isDirectory:()=>true,isSymbolicLink:()=>false,uid:1000,mode:0o40700}),open:async()=>({stat:async()=>stat,read:async b=>{readBuffer=b;b.fill(0x30,0,64);b[31]=byte;return {bytesRead:64};},close:async()=>{closed=true;}})};
      await expect(launcher.readOperatorToken(fs,1000)).rejects.toThrow('private-token-refused');
      expect(closed).toBe(true);expect(readBuffer.every(b=>b===0)).toBe(true);
    }
  });
  it('refuses the same invalid bytes before any mock clipboard entry and zeroes them', async () => {
    for(const byte of invalid) {
      const bytes=Buffer.alloc(64,0x30);bytes[31]=byte;const events=[];
      await expect(launcher.copyOperatorToken({platform:'darwin',inspect:async()=>goodInspection(),notify:()=>{},readToken:async()=>bytes,clipboard:{generation:async()=>{events.push('clipboard');throw new Error('unexpected-entry');}},wait:async()=>{events.push('wait');}})).rejects.toThrow('clipboard-unavailable');
      expect(events).toEqual([]);expect(bytes.every(b=>b===0)).toBe(true);
    }
  });
});

describe('native clipboard adapter (nonsecret process doubles)', () => {
  it('sends only stdin to fixed pbcopy and never puts the fixture in arguments or environment', async () => {
    expect(typeof launcher.macClipboard).toBe('function');
    const calls=[];const fixture=Buffer.from('NONSECRET CLIPBOARD PLUMBING FIXTURE');
    const adapter=launcher.macClipboard(async (command,args,options)=>{calls.push({command,args,options});if(command.endsWith('osascript'))return Buffer.from('7\n');if(command.endsWith('pbpaste'))return Buffer.from('NONSECRET READBACK');return Buffer.alloc(0);});
    await adapter.copy(fixture);
    expect(calls[0].command).toBe('/usr/bin/pbcopy');expect(calls[0].args).toEqual([]);expect(calls[0].options.input).toBe(fixture);expect(calls[0].options).not.toHaveProperty('env');
    expect(await adapter.generation()).toBe(7);expect((await adapter.read()).toString()).toBe('NONSECRET READBACK');
    expect(calls[2].command).toBe('/usr/bin/pbpaste');
    expect(JSON.stringify(calls.map(x=>x.args))).not.toContain('NONSECRET');
  });
  it('does not zero the private pipe buffer before the child write has settled', async () => {
    const {spawnSync}=await import('node:child_process');
    const fixture='0'.repeat(64); // Synthetic only. Never reads /state or the clipboard.
    const text=launcher.helperSource('copy').replace(launcher.readOperatorToken.toString(),`async function readOperatorToken(){return Buffer.from('${fixture}');}`);
    const slowPipe='const originalWrite=process.stdout.write.bind(process.stdout);process.stdout.write=(data,callback)=>setTimeout(()=>originalWrite(data,callback),20);\n';
    const r=spawnSync(process.execPath,['--input-type=module'],{input:slowPipe+text,encoding:'utf8',timeout:5000});
    expect(r.status).toBe(0);expect(r.stdout).toBe(fixture);expect(r.stderr).toBe('');
  });
});

describe('first-version launcher entry', () => {
  it('provides the missing read-only launcher', () => {
    expect(existsSync(source), 'the first-version launcher must exist').toBe(true);
  });
});
