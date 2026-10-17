import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { PlannerLlmLike } from './planner-bridge';

export interface CodexCommandOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly timeout: number;
  readonly maxBuffer: number;
  readonly killSignal: 'SIGKILL';
}
export interface CodexProbeOptions {
  /** Trusted server startup policy, never accepted from a request body. */
  readonly privateLocal: boolean;
  readonly cliPath?: string;
  readonly env?: Readonly<Record<string,string | undefined>>;
  readonly scratchRoot?: string;
  /** Injected command fixture seam. Production uses execFile, no shell. */
  readonly runCommand?: (file:string,args:readonly string[],options:CodexCommandOptions) => Promise<{stdout:string;stderr:string}>;
}
export interface CodexProbeResult {
  readonly installed: boolean;
  readonly version?: string;
  readonly authenticated: boolean;
  readonly usable: false;
  readonly reason: string;
}
/** Explicit nonbilling probe; never reads native auth files or model output. */
export async function probeCodexSubscription(options: CodexProbeOptions): Promise<CodexProbeResult> {
  if (!options.privateLocal) return {installed:false,authenticated:false,usable:false,reason:'Codex probe requires private authenticated local tooling'};
  const env = options.env ?? process.env;
  const childEnv: NodeJS.ProcessEnv = {};
  for (const name of ['HOME','PATH','CODEX_HOME']) if (env[name]) childEnv[name] = env[name];
  let cwd: string | undefined;
  try {
    cwd = await mkdtemp(join(options.scratchRoot ?? tmpdir(),'studio-codex-probe-'));
    const run = options.runCommand ?? promisify(execFile);
    const bounds: CodexCommandOptions = {cwd,env:childEnv,timeout:5000,maxBuffer:16384,killSignal:'SIGKILL'};
    const versionResponse = await run(options.cliPath ?? 'codex',['--version'],bounds);
    const version = /^codex-cli ([0-9]+\.[0-9]+\.[0-9]+)\s*$/.exec(versionResponse.stdout)?.[1];
    if (!version) throw new Error();
    const authResponse = await run(options.cliPath ?? 'codex',['login','status'],bounds);
    const authenticated = /^Logged in using ChatGPT\s*$/.test(`${authResponse.stdout}${authResponse.stderr}`);
    return {installed:true,version,authenticated,usable:false,reason:CODEX_SAFETY_BLOCKER};
  } catch { return {installed:false,authenticated:false,usable:false,reason:'Codex native connection probe failed'}; }
  finally { if (cwd) await rm(cwd,{recursive:true,force:true}).catch(() => { throw new Error('Codex native probe cleanup failed'); }); }
}

/** No supported, audited zero-tool execution boundary established for CLI 0.162.1.
 * ShellTool=false is insufficient: apply_patch is independently model-gated.
 * Do not replace this with prompt instructions, sandbox bypass, an API key,
 * credential extraction, or a synthetic completion. See docs/model-connections.md.
 */
export const CODEX_SAFETY_BLOCKER = 'Codex subscription unavailable: zero-tool execution boundary is not verified';
export function codexSubscriptionLlm(): PlannerLlmLike {
  return async () => { throw new Error(CODEX_SAFETY_BLOCKER); };
}
