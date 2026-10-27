import { it, expect } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexSubscriptionLlm, probeCodexSubscription, CODEX_SAFETY_BLOCKER } from './codex-subscription';
it('explicit nonbilling probe isolates cwd, filters environment and reports native login only', async () => {
  const root = await mkdtemp(join(tmpdir(),'codex-probe-test-'));
  const calls: string[][] = [];
  try {
    const result = await probeCodexSubscription({privateLocal:true,scratchRoot:root,env:{HOME:'/native/home',PATH:'/trusted/bin',CODEX_HOME:'/native/codex',OPENAI_API_KEY:'secret',ANTHROPIC_API_KEY:'secret',NODE_OPTIONS:'secret'},runCommand:async(file,args,options)=>{
      expect(file).toBe('codex'); calls.push([...args]);
      expect(options.cwd.startsWith(root)).toBe(true);
      expect(options.env).toEqual({HOME:'/native/home',PATH:'/trusted/bin',CODEX_HOME:'/native/codex'});
      expect(options.timeout).toBe(5000); expect(options.maxBuffer).toBe(16384); expect(options.killSignal).toBe('SIGKILL');
      return {stdout:args[0] === '--version' ? 'codex-cli 0.162.1\n' : '',stderr:args[0] === 'login' ? 'Logged in using ChatGPT\n' : ''};
    }});
    expect(calls).toEqual([['--version'],['login','status']]);
    expect(result).toEqual({installed:true,version:'0.162.1',authenticated:true,usable:false,reason:CODEX_SAFETY_BLOCKER});
    expect(await readdir(root)).toEqual([]);
  } finally {await rm(root,{recursive:true,force:true});}
});
it('rejects nonprivate usage before any native command', async () => {
  let called = false;
  await expect(probeCodexSubscription({privateLocal:false,runCommand:async()=>{called=true;throw new Error('private');}})).resolves.toMatchObject({usable:false,authenticated:false,reason:'Codex probe requires private authenticated local tooling'});
  expect(called).toBe(false);
});
it.each(['malformed','nonzero','truncated','api-auth'])('sanitizes native probe failure fixture %s', async mode => {
  const root = await mkdtemp(join(tmpdir(),'codex-probe-test-'));
  try {
    const result = await probeCodexSubscription({privateLocal:true,scratchRoot:root,runCommand:async(_,args)=>{
      if (mode === 'nonzero') throw new Error('secret output');
      if (args[0] === '--version') return {stdout:mode === 'malformed' ? 'secret output' : 'codex-cli 0.162.1',stderr:''};
      return {stdout:mode === 'api-auth' ? 'Logged in using an API key - secret' : 'Logged in using Chat',stderr:''};
    }});
    expect(result.usable).toBe(false); expect(result.authenticated).toBe(false);
    expect(JSON.stringify(result)).not.toContain('secret');
    expect(await readdir(root)).toEqual([]);
  } finally {await rm(root,{recursive:true,force:true});}
});
it.each(['timeout','output-limit'])('real child-process fixture %s is killed and isolated cwd cleaned', async mode => {
  const root = await mkdtemp(join(tmpdir(),'codex-process-fixture-'));
  const executable = join(root,'fixture-cli');
  try {
    await writeFile(executable, mode==='timeout' ? '#!/bin/sh\nexec /bin/sleep 30\n' : '#!/bin/sh\nwhile :; do printf "fixture-output-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx\\n"; done\n', {mode:0o700});
    const result = await probeCodexSubscription({privateLocal:true,cliPath:executable,scratchRoot:root,env:{HOME:root,PATH:'/usr/bin:/bin'}});
    expect(result).toEqual({installed:false,authenticated:false,usable:false,reason:'Codex native connection probe failed'});
    expect(await readdir(root)).toEqual(['fixture-cli']);
  } finally {await rm(root,{recursive:true,force:true});}
},10000);
it('sanitizes scratch creation failures', async () => {
  const result = await probeCodexSubscription({privateLocal:true,scratchRoot:join(tmpdir(),'missing-probe-parent-secret','absent')});
  expect(result).toMatchObject({usable:false,authenticated:false,reason:'Codex native connection probe failed'});
});
it('fails closed without invoking tools or exposing protected requests', async () => {
  const llm = codexSubscriptionLlm();
  await expect(llm({system:'private',user:'private',purpose:'draft',attempt:1})).rejects.toThrow(CODEX_SAFETY_BLOCKER);
});
