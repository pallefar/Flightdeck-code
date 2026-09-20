/** What arrives at Studio's routes: one conversion bundle, as JSON.
 *
 * ⭐ WHY A BUNDLE AND NOT A WORKFLOW. Studio's engine — the `@spec` reader,
 * the `@codegen` emitters, the `@conformance` gate — is about twelve thousand
 * lines across forty-six modules, and it is authored for Studio's own
 * `moduleResolution: bundler` tsconfig. Mounting it inside a Flightdeck host
 * would mean copying all forty-six into the host's tree and getting them to
 * compile under the host's settings. That is not a sub-app; that is a fork of
 * Studio living in somebody else's repository, and the first host `npm run
 * typecheck` after the copy goes red. (It did. That is why this file exists.)
 *
 * So the line is drawn where the work actually is: GENERATION happens in
 * Studio, which is where the engine already lives and already has tests.
 * FILING happens here, in the host, because filing is the only half that
 * needs the host at all — the kill switch, the install row, the consent
 * screen, the audit chain and the Inbox are things Studio cannot provide for
 * itself. The bundle is the artefact that crosses between them.
 *
 * ⛔ AND NOTHING IN THIS BUNDLE IS BELIEVED. A bundle is a request body: it
 * arrives over HTTP from whoever can reach the route, and its `gate` block is
 * a CLAIM about a run that happened somewhere this server cannot see. The
 * host's own opinion of a bundle is `admit.ts`, which re-derives what it can
 * from the files themselves. This file only decides what is well-formed
 * enough to have an opinion about.
 *
 * ── EVERY BOUND HERE IS DELIBERATE ──────────────────────────────────────
 * An unbounded body is a trust boundary with no fence. A generated mini-app
 * is four files and about 30 KB; the ceilings below are roomy enough that a
 * real conversion never meets one and tight enough that a bundle cannot be
 * used to push a megabyte of anything into `memory/proposals/`.
 *
 * `.strict()` is load-bearing on every object. An unknown key that parsed
 * would be a silent widening — a caller who sent `install: true`, or a second
 * `files` array under a different name, and got a 200 back would reasonably
 * believe the server had read it. It did not, and a strict schema says so. */
import { z } from "zod";

/** The wire format's name and version, carried INSIDE the payload. A bundle
 * that does not say what it is gets refused rather than guessed at, and a
 * future second shape can be told from this one without a header. */
export const STUDIO_BUNDLE_SCHEMA = "studio-mini-app/1";

/** A mini-app is four files. Sixty is "a generator went wrong", not "a big
 * app". */
export const MAX_BUNDLE_FILES = 60;
/** The largest file `@codegen` emits is the web module, around 25 KB. */
export const MAX_FILE_BYTES = 200_000;
/** What the whole proposal may weigh, contents included. */
export const MAX_BUNDLE_BYTES = 1_000_000;
/** `@codegen`'s own `workflowStepSchema` caps step ordinals at 99. */
export const MAX_STEPS = 99;

/* ── The pieces ─────────────────────────────────────────────────────────── */

/** A gate finding, as Studio's `@conformance` reports one. Mirrored rather
 * than imported: importing it is what dragged the engine in here. The shape
 * is checked against the real one by Studio's own
 * `__tests__/bundle-contract.test.ts`, which CAN import both. */
const bundleFinding = z
  .object({
    rule: z.string().min(1).max(80),
    severity: z.enum(["error", "warning"]),
    file: z.string().min(1).max(400),
    /** `0` means "about the file set, not a line". */
    line: z.number().int().min(0).max(1_000_000),
    column: z.number().int().min(0).max(1_000_000),
    message: z.string().min(1).max(2_000),
    evidence: z.string().max(2_000).nullable(),
  })
  .strict();

export type BundleFinding = z.infer<typeof bundleFinding>;

const bundleStep = z
  .object({
    ordinal: z.string().min(1).max(8),
    title: z.string().min(1).max(200),
    kind: z.enum(["display", "read", "propose"]),
    /** The source says a PERSON decides this step. Rendered and stopped at;
     * never a licence to advance it. */
    gated: z.boolean(),
  })
  .strict();

/** A file the bundle proposes ADDING to the host repo. `path` is checked for
 * shape here and for CONTAINMENT in `admit.ts` — the two are different
 * questions and conflating them is how a `..` gets through. */
const bundleFile = z
  .object({
    path: z.string().min(1).max(400),
    kind: z.string().min(1).max(40),
    contents: z.string().min(1).max(MAX_FILE_BYTES),
  })
  .strict();

export type BundleFile = z.infer<typeof bundleFile>;

/** The manifest the generated app would declare. Every field is a string or a
 * list of strings on the wire; whether the VALUES are ones the host accepts is
 * `admit.ts`'s question, because that is where the host's own closed literal
 * lists live. */
const bundleSpec = z
  .object({
    id: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    icon: z.string().min(1).max(16),
    version: z.string().min(1).max(32),
    minHostVersion: z.string().min(1).max(32),
    navSection: z.string().min(1).max(64),
    routePrefix: z.string().min(1).max(128),
    webModuleId: z.string().min(1).max(64),
    enableEnvVar: z.string().min(1).max(128),
    purpose: z.string().max(2_000),
    capabilities: z.array(z.string().max(64)).max(8),
    visibleToRoles: z.array(z.string().max(32)).max(8),
    steps: z.array(bundleStep).max(MAX_STEPS),
  })
  .strict();

export type BundleSpec = z.infer<typeof bundleSpec>;

/** The `registry.ts` edit a human still has to make by hand. It travels as
 * DATA and is admitted as data: `admit.ts` refuses entry lines that are
 * anything other than a bare identifier or a comment, because these lines are
 * pasted into a host file by somebody who is trusting the proposal. */
const bundleRegistry = z
  .object({
    file: z.string().min(1).max(200),
    importLine: z.string().min(1).max(400),
    entryLines: z.array(z.string().max(200)).min(1).max(8),
  })
  .strict();

export type BundleRegistry = z.infer<typeof bundleRegistry>;

/** What Studio's gate REPORTED. Never what the host concluded — the host's own
 * verdict is the `admission` block, and the proposal keeps them apart by name
 * so nobody reading it later can mistake one for the other. */
const bundleGate = z
  .object({
    ok: z.boolean(),
    checks: z.array(z.string().min(1).max(80)).max(64),
    findings: z.array(bundleFinding).max(200),
    filesChecked: z.number().int().min(0).max(MAX_BUNDLE_FILES),
  })
  .strict();

export type BundleGate = z.infer<typeof bundleGate>;

/* ── The bundle ─────────────────────────────────────────────────────────── */

export const studioBundleSchema = z
  .object({
    bundle: z.literal(STUDIO_BUNDLE_SCHEMA),
    /** Which Studio produced it. Provenance for the reviewer, nothing else —
     * it grants no trust, because a string in a request body cannot. */
    producedBy: z.string().min(1).max(120),
    producedAt: z.string().min(1).max(64),
    subAppId: z.string().min(1).max(64),
    label: z.string().min(1).max(200),
    spec: bundleSpec,
    files: z.array(bundleFile).min(1).max(MAX_BUNDLE_FILES),
    registry: bundleRegistry,
    gate: bundleGate,
    /** Narrowings and omissions Studio made, in English. Never a refusal. */
    warnings: z.array(z.string().max(500)).max(64),
    /** Where the workflow came from. Provenance, rendered verbatim, never
     * opened — no capability here grants a filesystem read. */
    workflowSource: z
      .string()
      .max(200)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]*$/, "workflowSource must be a plain path-like label")
      .nullable(),
  })
  .strict();

export type StudioBundle = z.infer<typeof studioBundleSchema>;

/** Total bytes the bundle would put into one proposal file. Checked against
 * `MAX_BUNDLE_BYTES` separately from the per-file ceiling: sixty files of
 * 199 KB each pass every per-field bound and are still 12 MB. */
export function bundleBytes(bundle: StudioBundle): number {
  let total = 0;
  for (const file of bundle.files) total += file.contents.length + file.path.length;
  return total;
}
