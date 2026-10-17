import {mkdir,open,lstat} from 'node:fs/promises';
import {constants} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {join} from 'node:path';
const fileSecrets=['ANTHROPIC_API_KEY','ANTHROPIC_AUTH_TOKEN','STUDIO_OPERATOR_TOKEN','STUDIO_LOCAL_API_KEY'];
const trustedPaths=['STUDIO_WORKSPACE_FILE','STUDIO_GRANTS_FILE','STUDIO_PROJECT_SKILLS_FILE','STUDIO_RESOURCE_CONFIG_FILE'];
const refused=()=>new Error('Studio secret configuration refused');

async function readSecret(path) {
 let file;
 try {
  if(typeof path!=='string'||!path||!path.startsWith('/')||path.split('/').some(p=>p==='.'||p==='..'))throw refused();
  const parts=path.split('/').filter(Boolean);
  for(let i=1;i<parts.length;i++) {
   const parent=await lstat('/'+parts.slice(0,i).join('/'));
   if(!parent.isDirectory()||parent.isSymbolicLink())throw refused();
  }
  file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  const info=await file.stat();
  if(!info.isFile()||info.size<1||info.size>8192||(info.mode&0o077)!==0||(info.mode&0o7000)!==0||![0,process.getuid()].includes(info.uid))throw refused();
  const bytes=Buffer.alloc(8193);const {bytesRead}=await file.read(bytes,0,bytes.length,0);
  if(bytesRead<1||bytesRead>8192)throw refused();
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,bytesRead));
  const value=raw.replace(/\r?\n$/,'');
  if(!value.trim()||/[\r\n\x00-\x1f\x7f]/.test(value))throw refused();
  return value;
 } catch {throw refused();} finally {await file?.close();}
}
export async function loadSecrets(env,stateDir) {
 try {
  const output={...env};
  for(const key of Object.keys(env))if(key.endsWith('_FILE')&&!fileSecrets.some(s=>key===s+'_FILE')&&!trustedPaths.includes(key))throw refused();
  for(const key of fileSecrets) {
   if(env[key+'_FILE']!==undefined) {
    if(env[key]!==undefined)throw refused();
    output[key]=await readSecret(env[key+'_FILE']);delete output[key+'_FILE'];
   }
  }
  await mkdir(stateDir,{recursive:true,mode:0o700});
  const dir=await lstat(stateDir);
  if(!dir.isDirectory()||dir.isSymbolicLink()||(dir.mode&0o077)!==0||dir.uid!==process.getuid())throw refused();
  if(output.STUDIO_OPERATOR_TOKEN===undefined) {
   const tokenPath=join(stateDir,'operator-token');
   try {
    const file=await open(tokenPath,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    try {await file.writeFile(randomBytes(32).toString('hex'));await file.sync();} finally {await file.close();}
   } catch(error) {if(error.code!=='EEXIST')throw refused();}
   output.STUDIO_OPERATOR_TOKEN=await readSecret(tokenPath);
  }
  return output;
 } catch {throw refused();}
}
