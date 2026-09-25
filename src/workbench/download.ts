/** "Download candidate" — owner ruling 2026-09-22 (9).
 *
 * The workbench renders real generated source and a real gate verdict, and
 * until this file nothing could leave the browser: `Save` commits an edit
 * to the in-memory draft and writes no file (HANDOVER §6). This is the one
 * way out, and the ruling fixes its three limits:
 *
 *   1. ENABLED ONLY WHEN THE CONFORMANCE GATE PASSES ON THE EDITED FILES.
 *      The candidate's own `findings` describe Studio's text — the gate ran
 *      before the person touched anything. So the gate runs again here, over
 *      the saved overlay (`currentCandidate`), and that verdict decides. An
 *      unsaved buffer or an open conflict also disables it: either would make
 *      the download differ from what the panes show, silently.
 *   2. WRITES NOTHING ON THE SERVER. The file is built in memory and handed
 *      to the browser's own save through an object URL. There is no request
 *      of any kind in this module, and a test scans its source to keep it so.
 *   3. NEVER WRITES INTO THE HOST REPO. What it produces is a review copy
 *      that says, inside itself, that it is not a compliance record and
 *      installs nothing. `scripts/promote.sh` plus a passing
 *      `studio-compliance-record/1` remain the only path into the host.
 *
 * ── WHY JSON, NOT A TREE OF FILES ───────────────────────────────────────
 * A file set rooted at `server/subapps/<id>/` that unpacks in place is one
 * `tar -x` away from being written into a host checkout by hand — the path
 * the ruling closes. One self-describing JSON document carries the files AND
 * the verdict over exactly those bytes, and it has to be read to be used.
 * Its schema name is its own, not `studio-mini-app/1`, so nothing that files
 * bundles can mistake it for one.
 *
 * The gate is INJECTED (`FileGate`), like every other piece of behaviour the
 * workbench is handed: this package renders, it does not import the
 * generator or the gate (`types.ts` explains why). `src/wiring.ts` adapts
 * `runConformanceGate` into one and `main.tsx` passes it in;
 * `src/__tests__/wiring.test.ts` runs that adapter for real. Pure except
 * `saveInBrowser`, which takes its DOM as a parameter so it can be tested in
 * node. */
import type { EditSummary } from "./editing";
import type { Candidate, Finding, GeneratedFile } from "./types";

export const CANDIDATE_DOWNLOAD_SCHEMA = "studio-candidate-download/1";

/** What the injected gate answers — structurally `@conformance`'s
 * `GateReport` narrowed to what this needs: `ok` is "no ERROR finding". */
export interface FileGateVerdict {
  readonly ok: boolean;
  readonly findings: readonly Finding[];
  readonly rulesRun: readonly string[];
}

export type FileGate = (files: readonly GeneratedFile[]) => FileGateVerdict;

/** Runs the gate; `null` when it could not run. A gate that throws is a gate
 * that did not pass — the download fails closed, never open. */
export function runFileGate(gate: FileGate, files: readonly GeneratedFile[]): FileGateVerdict | null {
  try {
    return gate(files);
  } catch {
    return null;
  }
}

export type DownloadReadiness =
  | { readonly ready: true; readonly verdict: FileGateVerdict }
  | { readonly ready: false; readonly reason: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "it" for one, "them" for several — "fix them first" over one error reads wrong. */
const them = (n: number) => (n === 1 ? "it" : "them");

/** `FD-M003 server/subapps/wc-clock/manifest.ts:35 — <message>`: the rule, the
 * place a person opens, and the gate's own sentence. A finding about the file
 * set (line 0) has no line to name. */
function cite(finding: Finding): string {
  const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;
  return `${finding.rule} ${where} — ${finding.message}`;
}

/** Whether the button may be pressed, and when not, the sentence that says
 * why — the tooltip a person reads on a disabled button. */
export function downloadReadiness(input: {
  readonly candidate: Candidate | null;
  readonly edits: EditSummary;
  /** The gate over `candidate.files` — the EDITED set. `null`: it could not run. */
  readonly verdict: FileGateVerdict | null;
}): DownloadReadiness {
  if (input.candidate === null) return { ready: false, reason: "No candidate yet — nothing to download." };
  if (input.edits.conflicted > 0) {
    return {
      ready: false,
      reason: `${plural(input.edits.conflicted, "conflict")} open — resolve ${them(input.edits.conflicted)} first. While one is open the panes show Studio's text, not yours.`,
    };
  }
  if (input.edits.dirty > 0) {
    return {
      ready: false,
      reason: `${plural(input.edits.dirty, "unsaved edit")} — save or revert first, so the download is exactly what the panes show.`,
    };
  }
  if (input.verdict === null) {
    return { ready: false, reason: "The conformance gate could not run on the edited files, so nothing can be downloaded." };
  }
  if (!input.verdict.ok) {
    // ⭐ NAME THE ERROR, NOT JUST THE COUNT. A disabled button's tooltip is
    // read where the button is, not on the Gate tab (which now leads with
    // this same verdict once saved edits change the files). "Fix them first"
    // with no rule, file or line sent a person looking for the error.
    const errors = input.verdict.findings.filter((f) => f.severity === "error");
    const first = errors[0];
    const detail =
      first === undefined ? "" : `: ${cite(first)}${errors.length > 1 ? ` (and ${errors.length - 1} more)` : ""}`;
    return {
      ready: false,
      reason: `The conformance gate fails on the edited files (${plural(errors.length, "error")})${detail}. Fix ${them(errors.length)} first.`,
    };
  }
  return { ready: true, verdict: input.verdict };
}

export interface CandidateDownload {
  readonly filename: string;
  readonly mime: "application/json";
  readonly text: string;
}

const NOTICE =
  "A review copy of a Studio candidate, saved from the browser. It is not a compliance record and nothing installs it: " +
  "the only way into the host repo is scripts/promote.sh with a passing studio-compliance-record/1. " +
  "`gate` is Studio's conformance gate over exactly these files, as edited.";

/** The document the button saves. Refuses files the gate failed, so no
 * caller can produce a download the button itself would have refused. */
export function candidateDownload(input: {
  readonly candidate: Candidate;
  /** Studio's own text this round, to say which files the person changed. */
  readonly generated: readonly GeneratedFile[];
  readonly verdict: FileGateVerdict;
  /** The round's ordinal, as the person sees it. */
  readonly round: number;
}): CandidateDownload {
  if (!input.verdict.ok) {
    throw new Error("the conformance gate fails on these files — a candidate download is only built from files that pass");
  }
  const original = new Map(input.generated.map((f) => [f.path, f.contents]));
  const id = input.candidate.manifest.id;
  const body = {
    schema: CANDIDATE_DOWNLOAD_SCHEMA,
    notice: NOTICE,
    id,
    round: input.round,
    gate: { ok: input.verdict.ok, rulesRun: [...input.verdict.rulesRun], findings: [...input.verdict.findings] },
    edited: input.candidate.files.filter((f) => original.get(f.path) !== f.contents).map((f) => f.path),
    files: input.candidate.files.map((f) => ({ path: f.path, kind: f.kind, contents: f.contents })),
  };
  return {
    filename: `${id}-candidate-round-${input.round}.json`,
    mime: "application/json",
    text: `${JSON.stringify(body, null, 2)}\n`,
  };
}

/** The slice of the DOM `saveInBrowser` touches, so a test can supply it. */
export interface BrowserSaveHost {
  readonly document: {
    createElement(tag: "a"): { href: string; download: string; rel: string; click(): void; remove(): void };
    readonly body: { appendChild(node: never): unknown };
  };
  readonly URL: { createObjectURL(blob: Blob): string; revokeObjectURL(url: string): void };
}

/** Hands the bytes to the browser's own "save file". Local only: an object
 * URL over an in-memory Blob, a temporary `<a download>`, one click, and the
 * URL revoked — the only place the bytes go is the person's disk.
 *
 * The revoke waits one task: revoking in the same task as the click can
 * cancel the download in some browsers, before it has read the Blob. */
export function saveInBrowser(download: CandidateDownload, host?: BrowserSaveHost): void {
  const { document: doc, URL: urls } = host ?? (globalThis as unknown as BrowserSaveHost);
  const url = urls.createObjectURL(new Blob([download.text], { type: download.mime }));
  const link = doc.createElement("a");
  link.href = url;
  link.download = download.filename;
  link.rel = "noopener";
  doc.body.appendChild(link as never);
  try {
    link.click();
  } finally {
    link.remove();
    setTimeout(() => urls.revokeObjectURL(url), 0);
  }
}

/** The spec behind a candidate, as a file — or null when the round has none.
 * Mounting regenerates from this (ruling 8), so it is the one artifact a
 * person carries from the browser to `scripts/mount-into-worktree.sh`. */
export function specDownload(candidate: Candidate): CandidateDownload | null {
  if (candidate.spec === undefined) return null;
  return {
    filename: `${candidate.manifest.id}.spec.json`,
    mime: "application/json",
    text: `${JSON.stringify(candidate.spec, null, 2)}\n`,
  };
}
