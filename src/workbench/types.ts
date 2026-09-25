/** The workbench's view of the world, stated as its own types.
 *
 * ⭐ WHY THESE ARE COPIES AND NOT IMPORTS FROM `@codegen`/`@conformance`.
 * Two reasons, and the second is the load-bearing one.
 *
 * 1. The workbench is a RENDERER. It is handed a candidate sub-app and a
 *    list of findings and it draws them. Everything it needs is data with
 *    a shape; none of it is behaviour. Importing `SubAppPlan` — a type
 *    that carries `PlannedColumn.sqlType` and `registerFn` identifiers —
 *    would couple a pane of pixels to the internals of a code generator.
 *
 * 2. It keeps the UI honest about what it is allowed to assume. Every
 *    field below is one the workbench actually reads. When codegen grows a
 *    field, nothing here changes until somebody decides the screen should
 *    show it. The alternative — `import type { SubAppPlan }` — silently
 *    makes every generator internal part of the UI's contract, and the
 *    first person to rename one finds out in a React component.
 *
 * These are STRUCTURAL supertypes: a `GeneratedFile` from
 * `@codegen/invariants` and a `Finding` from `@conformance/finding`
 * already satisfy them, so `adopt()` in `candidate.ts` takes the real
 * objects with no mapping layer and no runtime cost. If codegen ever
 * narrows one of these fields, TypeScript reports it at the seam in
 * `candidate.ts` rather than deep inside a component. */

// ───────────────────────────── the candidate ─────────────────────────────

/** What `kind` a generated file is. Mirrors `@codegen`'s union, plus
 * `"unknown"` so a file the workbench was handed but does not recognise
 * still renders rather than crashing the tree. */
export type GeneratedFileKind =
  | "manifest"
  | "guard"
  | "routes-index"
  | "routes-domain"
  | "schema"
  | "web-module"
  | "host-test"
  | "patch"
  | "unknown";

export interface GeneratedFile {
  /** Repo-relative path in the HOST repository — `server/subapps/<id>/…`,
   * `web/src/subapps/<id>/…`, `tests/subapps/<id>/…`. Never a Studio path. */
  readonly path: string;
  readonly contents: string;
  readonly kind: GeneratedFileKind;
}

/** The parts of a `SubAppPlan` a screen has any business knowing. */
export interface CandidateManifest {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly summary: string | null;
  readonly icon: string;
  readonly navSection: string;
  readonly routePrefix: string;
  readonly webModuleId: string;
  readonly capabilities: readonly string[];
  readonly visibleToRoles: readonly string[];
  /** `SUBAPP_<ID>_ENABLED`. Contract §3. */
  readonly envVar: string;
  /** `subapp_<id>_`. Contract §3. */
  readonly tablePrefix: string;
}

/** One generation round: a prompt, an answer, and the sub-app that came
 * out of it. Rounds are append-only — the diff pane is a function of two
 * adjacent ones, so overwriting a round in place would destroy the only
 * record of what a turn actually changed. */
export interface Candidate {
  readonly manifest: CandidateManifest;
  readonly files: readonly GeneratedFile[];
  readonly findings: readonly Finding[];
  /** Rules the gate ran. A rule absent from `findings` AND absent from
   * here never ran — which is not the same as passing, and the gate pane
   * says so. */
  readonly rulesRun: readonly string[];
  /** Non-refusing notes from the generator (`GeneratedSubApp.warnings`). */
  readonly notes: readonly string[];
  /** The spec this candidate was generated from, when the driver has one —
   * what "Download spec" saves and `scripts/mount-into-worktree.sh` mounts.
   * Ruling 8: an app reaches the host by regenerating from its spec, never
   * from edited files. */
  readonly spec?: unknown;
}

// ───────────────────────────── the gate ──────────────────────────────────

export type Severity = "error" | "warning";

/** Structurally the same object `@conformance/finding` produces. */
export interface Finding {
  readonly rule: string;
  readonly severity: Severity;
  /** Repo-relative host path, or `"(candidate)"` when the finding is about
   * the file SET rather than one file. */
  readonly file: string;
  /** 1-based. `0` means "no line — this is about the file set". */
  readonly line: number;
  readonly column: number;
  readonly message: string;
  readonly evidence: string | null;
}

export const CANDIDATE_SCOPE = "(candidate)";

// ───────────────────────────── the chat ──────────────────────────────────

export type TurnRole = "you" | "studio";

/** A turn's lifecycle. `refused` is distinct from `failed`: a refusal is
 * Studio declining to generate something the contract forbids — a correct
 * outcome with a reason — while a failure is Studio breaking. Collapsing
 * them into one red state teaches people to ignore both.
 *
 * `aborted` is distinct from both, and it is the person's: they pressed
 * stop. Nothing went wrong and nothing was refused — the round simply
 * does not exist. A UI that files a cancelled round under "failed" makes
 * a person doubt their own hand on the button. */
export type TurnStatus = "streaming" | "settled" | "refused" | "failed" | "aborted";

export interface Turn {
  readonly id: string;
  readonly role: TurnRole;
  readonly text: string;
  readonly status: TurnStatus;
  /** Milliseconds since epoch. Injected, never `Date.now()` inside the
   * store — a store that reads the clock cannot be tested. */
  readonly at: number;
  /** Set on the `studio` turn that produced a candidate. */
  readonly roundId: string | null;
}

export interface Round {
  readonly id: string;
  /** 1-based, and the number a person sees. */
  readonly ordinal: number;
  readonly prompt: string;
  readonly candidate: Candidate;
  readonly at: number;
}

// ───────────────────────────── the panes ─────────────────────────────────

export type WorkbenchView = "run" | "files" | "diff" | "preview" | "gate";

/** Which layer of contract §4's three-layer AND is currently off. The
 * preview lets a person flip each one, because "what does a person see
 * when this app is switched off" is a question about the app's code and
 * the generated guard is the only thing that answers it. */
export interface EnableLayers {
  /** `SUBAPP_<ID>_ENABLED === "true"`. */
  readonly killSwitch: boolean;
  /** The ceiling row (`'*'`). Also the ONLY source of granted scopes. */
  readonly ceiling: boolean;
  /** This project's install row. May turn a sub-app off, never widen it. */
  readonly project: boolean;
}

export const ALL_ENABLED: EnableLayers = { killSwitch: true, ceiling: true, project: true };

/** Contract §4: fail-closed, default OFF, and an AND of all three. */
export function isEnabled(layers: EnableLayers): boolean {
  return layers.killSwitch && layers.ceiling && layers.project;
}

/** Which layer refused, for a message that names the actual cause instead
 * of "disabled". Returns `null` when nothing refused. */
export function refusingLayer(layers: EnableLayers): keyof EnableLayers | null {
  if (!layers.killSwitch) return "killSwitch";
  if (!layers.ceiling) return "ceiling";
  if (!layers.project) return "project";
  return null;
}
