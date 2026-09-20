/** Running generated code somewhere it cannot do damage.
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE: generated code never executes
 * in the process that is judging it. A sub-app is judged by Studio, which
 * runs on a developer's machine with their filesystem, their credentials
 * and their network. `vm.runInNewContext` would give a model's output all
 * three — it is a scoping tool, not a sandbox, and treating it as one is
 * the classic mistake. So the probe runs in a SEPARATE Node process under
 * the platform permission model, with:
 *
 *   • no filesystem WRITE permission at all, anywhere;
 *   • read permission for exactly two directories — the staging tree and
 *     the host's `node_modules`, which is how `zod` resolves;
 *   • no child-process, worker-thread or native-addon permission, so it
 *     cannot escape by spawning something less restricted;
 *   • an EMPTY environment but for PATH, so a generated `process.env` read
 *     finds nothing of the developer's to leak into its output;
 *   • a hard deadline, and a kill — not a flag somebody checks later.
 *
 * ⛔ AND IF IT CANNOT BE ISOLATED, IT DOES NOT RUN. `isolationAvailable`
 * probes the flag rather than assuming it. On a runtime that does not
 * support it the answer is "the probe could not run", reported as such —
 * never a silent downgrade to executing a model's output unsandboxed
 * because the safe path was unavailable. */
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export interface StageInput {
  /** Repo-relative path -> JavaScript. Written under `app/`. */
  readonly modules: ReadonlyMap<string, string>;
  /** Extra files at the staging root, e.g. the harness and its input. */
  readonly rootFiles: ReadonlyMap<string, string>;
  /** Supplies `zod`, `react` and anything else the host carries. */
  readonly repoRoot: string;
}

export interface Stage {
  readonly dir: string;
  readonly appDir: string;
  readonly nodeModules: string;
  dispose(): Promise<void>;
}

/** ⭐ EVERY WRITE IS AWAITED BEFORE THE NEXT STEP, and a failed write
 * rejects. The staging tree is the input to a process that is about to be
 * spawned; a half-written tree would produce a probe result about a
 * program nobody wrote. There is no `.catch(log)` in this function on
 * purpose. */
export async function stage(input: StageInput): Promise<Stage> {
  const dir = await mkdtemp(join(tmpdir(), "flightdeck-verify-"));
  const appDir = join(dir, "app");
  let nodeModules = join(input.repoRoot, "node_modules");
  try {
    nodeModules = await realpath(nodeModules);
  } catch {
    // Left as the unresolved path; the spawn below reports the failure
    // truthfully when the modules cannot be read.
  }

  const cleanup = async (): Promise<void> => {
    await rm(dir, { recursive: true, force: true });
  };

  try {
    await writeFile(join(dir, "package.json"), '{ "type": "module", "private": true }\n', "utf8");
    await symlink(nodeModules, join(dir, "node_modules"), "junction").catch(() => symlink(nodeModules, join(dir, "node_modules")));
    await mkdir(appDir, { recursive: true });

    for (const [path, contents] of input.modules) {
      const target = join(appDir, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, contents, "utf8");
    }
    for (const [name, contents] of input.rootFiles) {
      await writeFile(join(dir, name), contents, "utf8");
    }
  } catch (error) {
    await cleanup();
    throw error;
  }

  return { dir, appDir, nodeModules, dispose: cleanup };
}

export interface SandboxOptions {
  readonly stage: Stage;
  /** Entry file name, relative to the staging root. */
  readonly entry: string;
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface SandboxRun {
  /** The process exited 0, on its own, within the deadline. */
  readonly ok: boolean;
  readonly exitCode: number | null;
  readonly killedBy: string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  /** Present when the process could not be started or isolated at all. */
  readonly unavailable: string | null;
}

let isolationFlag: Promise<string | null> | null = null;

/** The permission flag this runtime accepts, or `null` when it accepts
 * neither. Probed once, with a program that does nothing. */
export function isolationAvailable(): Promise<string | null> {
  isolationFlag ??= (async () => {
    for (const flag of ["--permission", "--experimental-permission"]) {
      const ok = await new Promise<boolean>((done) => {
        const child = spawn(process.execPath, [flag, "-e", "0"], { stdio: "ignore" });
        child.once("error", () => done(false));
        child.once("close", (code) => done(code === 0));
      });
      if (ok) return flag;
    }
    return null;
  })();
  return isolationFlag;
}

export async function runSandboxed(options: SandboxOptions): Promise<SandboxRun> {
  const started = Date.now();
  const flag = await isolationAvailable();
  if (flag === null) {
    return {
      ok: false,
      exitCode: null,
      killedBy: null,
      timedOut: false,
      aborted: false,
      stdout: "",
      stderr: "",
      durationMs: Date.now() - started,
      unavailable:
        `this Node runtime (${process.version}) supports neither --permission nor --experimental-permission, ` +
        "so the generated app cannot be isolated from the machine running the gate — the mount probe is skipped rather than run unsandboxed",
    };
  }

  const args = [
    flag,
    `--allow-fs-read=${options.stage.dir}`,
    `--allow-fs-read=${options.stage.dir}/*`,
    `--allow-fs-read=${options.stage.nodeModules}`,
    `--allow-fs-read=${options.stage.nodeModules}/*`,
    "--no-warnings",
    resolve(options.stage.dir, options.entry),
  ];

  return await new Promise<SandboxRun>((done) => {
    const child = spawn(process.execPath, args, {
      cwd: options.stage.dir,
      // ⛔ Not `process.env`. The generated app gets PATH and nothing
      // else: no tokens, no database URLs, no `SUBAPP_*` values from the
      // developer's own shell that would make the probe's answer depend
      // on their machine.
      env: { PATH: process.env["PATH"] ?? "" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let aborted = false;
    let settled = false;

    const cap = (existing: string, chunk: Buffer): string =>
      existing.length > 256_000 ? existing : existing + chunk.toString("utf8");

    child.stdout.on("data", (chunk: Buffer) => { stdout = cap(stdout, chunk); });
    child.stderr.on("data", (chunk: Buffer) => { stderr = cap(stderr, chunk); });

    // ⭐ A REAL KILL, not a flag. Both the deadline and the caller's abort
    // signal terminate the process; neither leaves it running while the
    // gate reports a verdict.
    const kill = (): void => { child.kill("SIGKILL"); };
    const deadline = setTimeout(() => { timedOut = true; kill(); }, options.timeoutMs);
    const onAbort = (): void => { aborted = true; kill(); };
    options.signal?.addEventListener("abort", onAbort, { once: true });
    if (options.signal?.aborted === true) onAbort();

    const finish = (exitCode: number | null, killedBy: string | null, startupError: string | null): void => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      options.signal?.removeEventListener("abort", onAbort);
      done({
        ok: startupError === null && exitCode === 0 && killedBy === null && !timedOut && !aborted,
        exitCode,
        killedBy,
        timedOut,
        aborted,
        stdout: redactSecrets(stdout),
        stderr: redactSecrets(stderr),
        durationMs: Date.now() - started,
        unavailable: startupError,
      });
    };

    child.once("error", (error) => { finish(null, null, `the probe process could not be started: ${error.message}`); });
    child.once("close", (code, signalName) => { finish(code, signalName, null); });
  });
}

const SECRET_PATTERNS: readonly RegExp[] = [
  /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{16,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bey[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /\b[Bb]earer\s+[A-Za-z0-9._~+/-]{12,}=*/g,
  /(["']?(?:password|passwd|secret|token|api[_-]?key|access[_-]?key)["']?\s*[:=]\s*["'])([^"']{4,})(["'])/gi,
];

/** ⭐ Captured output is shown to a person and fed back to a model for
 * repair. Neither of those is a place for a credential that happened to be
 * in a generated file or an error message. The child has no secrets in its
 * environment to begin with; this is the second layer, for the ones the
 * candidate brought with it. */
export function redactSecrets(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, (match, ...rest) => {
      const groups = rest.slice(0, -2);
      return groups.length === 3 ? `${String(groups[0])}[redacted]${String(groups[2])}` : "[redacted]";
    });
  }
  return out;
}
