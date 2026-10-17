import {loadSecrets} from './secrets.mjs';
import {assertBootstrapStateUnmarked} from './recovery-quarantine.mjs';
process.umask(0o077);
try {
 const stateDir=process.env.STUDIO_STATE_DIR??'/state';
 await assertBootstrapStateUnmarked(stateDir);
 const loaded=await loadSecrets(process.env,stateDir);
 for(const [key,value] of Object.entries(loaded))if(value!==undefined)process.env[key]=value;
 for(const key of ['ANTHROPIC_API_KEY_FILE','ANTHROPIC_AUTH_TOKEN_FILE','STUDIO_OPERATOR_TOKEN_FILE','STUDIO_LOCAL_API_KEY_FILE'])delete process.env[key];
 const {operatorFromEnv,createServer}=await import('../../server/index.ts');
 const operator=operatorFromEnv(process.env);
 if(typeof operator==='string')throw new Error();
 const app=createServer({operator});
 await app.listen({port:Number(process.env.PORT??8787),host:process.env.STUDIO_HOST??'127.0.0.1'});
 for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{void app.close().then(()=>process.exit(0));});
 process.stdout.write('studio: backend ready\n');
} catch {
 process.stderr.write('studio: startup refused (check private configuration)\n');
 process.exit(1);
}
