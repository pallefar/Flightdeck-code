/** A recorded run is a comparison artifact.
 *
 * This is the half of the package that exists because of a real failure, not
 * because of a design doc. The gauntlet judged four identical packages twice and
 * returned 4/4, then 1/4. The code did not change; the harness did — different
 * criteria, different bar scope, swapped sides. Nobody could prove that at the
 * time, because nothing was replayable: there was no artifact that could say
 * "the input to the judge changed" as distinct from "the judge changed its mind".
 *
 * ⭐ SO A DIFF HERE REPORTS THREE THINGS SEPARATELY, and the separation is the
 * whole point:
 *
 *   input-changed      the keyed request differs — you changed the prompt or model
 *   harness-changed    the recordings were made by harnesses that keyed on
 *                      DIFFERENT fields, so they are not comparable at all
 *   nondeterministic   byte-identical keyed request, different response — the
 *                      difference is not in the input, which is the gauntlet's
 *                      4/4-then-1/4 shape and the one you must never call a result
 */
import { canonicalStringify } from "./canonical";
import { differingFields, keyFieldsFor, keyedView, requestKey } from "./keys";
import type { KeyingOptions } from "./keys";
import { redactWithSecrets, resolveSecrets } from "./redact";
import type { RedactionOptions } from "./redact";
import { FIXTURE_FORMAT, fixturePath, findFixtureByKey, tryReadFixtureAt } from "./fixture";
import type { FixtureRecord } from "./fixture";
import type { HarnessCaller, ProviderCallShape } from "./provider-contract";

// ---------------------------------------------------------------- line diff

export interface LineDiff {
  readonly identical: boolean;
  readonly added: number;
  readonly removed: number;
  /** Unified-ish text: ` ` kept, `-` only in A, `+` only in B, `@@` elided run. */
  readonly unified: string;
}

/** Above this many cells the quadratic table is not worth it; the fallback still
 * reports the truth, just with a coarser middle. */
const LCS_CELL_BUDGET = 250_000;

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

type Op = readonly [" " | "-" | "+", string];

function lcsOps(a: readonly string[], b: readonly string[]): Op[] {
  const rows = a.length;
  const columns = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(columns + 1).fill(0));
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i] as number[];
    const next = table[i + 1] as number[];
    for (let j = columns - 1; j >= 0; j -= 1) {
      row[j] = a[i] === b[j] ? (next[j + 1] as number) + 1 : Math.max(next[j] as number, row[j + 1] as number);
    }
  }
  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (a[i] === b[j]) {
      ops.push([" ", a[i] as string]);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) {
      ops.push(["-", a[i] as string]);
      i += 1;
    } else {
      ops.push(["+", b[j] as string]);
      j += 1;
    }
  }
  for (; i < rows; i += 1) ops.push(["-", a[i] as string]);
  for (; j < columns; j += 1) ops.push(["+", b[j] as string]);
  return ops;
}

function coarseOps(a: readonly string[], b: readonly string[]): Op[] {
  let head = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head += 1;
  let tail = 0;
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) {
    tail += 1;
  }
  const ops: Op[] = [];
  for (let i = 0; i < head; i += 1) ops.push([" ", a[i] as string]);
  for (let i = head; i < a.length - tail; i += 1) ops.push(["-", a[i] as string]);
  for (let i = head; i < b.length - tail; i += 1) ops.push(["+", b[i] as string]);
  for (let i = a.length - tail; i < a.length; i += 1) ops.push([" ", a[i] as string]);
  return ops;
}

export function diffLines(a: string, b: string, context = 3): LineDiff {
  const left = splitLines(a);
  const right = splitLines(b);
  const ops =
    left.length * right.length > LCS_CELL_BUDGET ? coarseOps(left, right) : lcsOps(left, right);

  const changed = ops.map((op) => op[0] !== " ");
  const keep = new Array<boolean>(ops.length).fill(false);
  for (let i = 0; i < ops.length; i += 1) {
    if (!changed[i]) continue;
    for (let j = Math.max(0, i - context); j <= Math.min(ops.length - 1, i + context); j += 1) keep[j] = true;
  }

  const lines: string[] = [];
  let elided = 0;
  for (let i = 0; i < ops.length; i += 1) {
    const op = ops[i] as Op;
    if (keep[i]) {
      if (elided > 0) {
        lines.push(`@@ ${String(elided)} unchanged line${elided === 1 ? "" : "s"} @@`);
        elided = 0;
      }
      lines.push(`${op[0]}${op[1]}`);
    } else {
      elided += 1;
    }
  }
  if (elided > 0 && lines.length > 0) {
    lines.push(`@@ ${String(elided)} unchanged line${elided === 1 ? "" : "s"} @@`);
  }

  const added = ops.filter((op) => op[0] === "+").length;
  const removed = ops.filter((op) => op[0] === "-").length;
  return { identical: added === 0 && removed === 0, added, removed, unified: lines.join("\n") };
}

// ---------------------------------------------------------------- projection

/** How a stored response becomes text to diff. Picks a `text` field when the
 * response has one — the common provider shape — and otherwise pretty-prints
 * canonically, so key order cannot show up as a difference. */
export function defaultProjection(response: unknown): string {
  if (typeof response === "string") return response;
  if (typeof response === "object" && response !== null) {
    const text = (response as { text?: unknown }).text;
    if (typeof text === "string") return text;
  }
  try {
    return canonicalStringify(response, 2);
  } catch {
    return JSON.stringify(response, null, 2) ?? String(response);
  }
}

// ---------------------------------------------------------------- fixture diff

export type ComparisonVerdict = "identical" | "input-changed" | "harness-changed" | "nondeterministic";

export interface FieldDelta {
  readonly field: string;
  readonly a: unknown;
  readonly b: unknown;
}

export interface DiffSide {
  readonly key: string;
  readonly model: string;
  readonly keyedFields: readonly string[];
  readonly recordedAt: string | null;
}

export interface FixtureDiff {
  readonly verdict: ComparisonVerdict;
  readonly identical: boolean;
  readonly a: DiffSide;
  readonly b: DiffSide;
  readonly changedRequestFields: readonly string[];
  readonly requestDeltas: readonly FieldDelta[];
  /** Non-empty when the two recordings were not made under the same rules, in
   * which case a difference in their responses attributes to nothing. */
  readonly harnessDrift: readonly string[];
  readonly response: LineDiff;
  /** One line a human can paste into a result table. */
  readonly summary: string;
}

function sideOf(record: FixtureRecord): DiffSide {
  return {
    key: record.key,
    model: record.model,
    keyedFields: record.keyedFields,
    recordedAt: record.recordedAt,
  };
}

export interface DiffOptions {
  readonly project?: ((response: unknown) => string) | undefined;
  readonly context?: number | undefined;
}

export function diffFixtures(a: FixtureRecord, b: FixtureRecord, options: DiffOptions = {}): FixtureDiff {
  const project = options.project ?? defaultProjection;
  const changed = differingFields(a.request, b.request);
  const requestDeltas: FieldDelta[] = changed.map((field) => ({
    field,
    a: a.request[field] ?? null,
    b: b.request[field] ?? null,
  }));

  const harnessDrift: string[] = [];
  const fieldsA = [...a.keyedFields].sort().join(",");
  const fieldsB = [...b.keyedFields].sort().join(",");
  if (fieldsA !== fieldsB) {
    harnessDrift.push(`keyed fields: [${fieldsA}] vs [${fieldsB}]`);
  }
  if (a.format !== b.format) {
    harnessDrift.push(`fixture format: ${String(a.format)} vs ${String(b.format)}`);
  }

  const response = diffLines(project(a.response), project(b.response), options.context ?? 3);

  let verdict: ComparisonVerdict;
  if (harnessDrift.length > 0) verdict = "harness-changed";
  else if (requestDeltas.length > 0) verdict = "input-changed";
  else if (response.identical) verdict = "identical";
  else verdict = "nondeterministic";

  return {
    verdict,
    identical: response.identical && requestDeltas.length === 0 && harnessDrift.length === 0,
    a: sideOf(a),
    b: sideOf(b),
    changedRequestFields: changed,
    requestDeltas,
    harnessDrift,
    response,
    summary: summarize(verdict, changed, harnessDrift, response),
  };
}

function summarize(
  verdict: ComparisonVerdict,
  changed: readonly string[],
  harnessDrift: readonly string[],
  response: LineDiff,
): string {
  const output = response.identical
    ? "identical output"
    : `output ${String(response.added)}+/${String(response.removed)}-`;
  switch (verdict) {
    case "identical":
      return "identical: same keyed request, same response";
    case "input-changed":
      return `input-changed: ${changed.join(", ")} differ, ${output}`;
    case "harness-changed":
      return `harness-changed: ${harnessDrift.join("; ")} — these recordings are not comparable, ${output}`;
    case "nondeterministic":
      return `nondeterministic: keyed request is byte-identical, ${output} — the difference is not in the input`;
  }
}

// ---------------------------------------------------------------- replay a variant

export class MissingBaseline extends Error {
  readonly key: string;
  readonly path: string;

  constructor(key: string, path: string) {
    super(
      [
        "harness compare: the baseline has no recording, so there is nothing to compare against.",
        `  key:        ${key}`,
        `  looked for: ${path}`,
        "  Record the baseline first; a comparison against a live-only side compares two unrepeatable runs.",
      ].join("\n"),
    );
    this.name = "MissingBaseline";
    this.key = key;
    this.path = path;
  }
}

export interface ReplayVariantInput<Req extends ProviderCallShape, Res>
  extends KeyingOptions,
    RedactionOptions,
    DiffOptions {
  readonly fixturesDir: string;
  /** The request whose recording is the fixed side of the experiment. */
  readonly baseline: Req;
  /** The other side: a whole request, or an edit of the baseline. */
  readonly variant: Req | ((baseline: Req) => Req);
  /** Where the variant's response comes from. A live harness records it (so the
   * comparison itself becomes an artifact); a playback harness requires that it
   * was already recorded. */
  readonly harness: HarnessCaller<Req, Res>;
  readonly serializeResponse?: ((response: Res) => unknown) | undefined;
}

export interface VariantComparison<Req extends ProviderCallShape, Res> {
  readonly diff: FixtureDiff;
  readonly baseline: FixtureRecord;
  readonly variantRequest: Req;
  readonly variantResponse: Res;
}

/** Hold the fixture fixed and change ONE thing — the prompt, or the model — then
 * read the difference. This is the experiment the gauntlet needed and did not
 * have: one side is a committed recording that cannot drift underfoot. */
export async function replayVariant<Req extends ProviderCallShape, Res>(
  input: ReplayVariantInput<Req, Res>,
): Promise<VariantComparison<Req, Res>> {
  const fields = keyFieldsFor(input);
  const secrets = resolveSecrets({ secrets: input.secrets, env: input.env });

  const baselineKey = requestKey(input.baseline as unknown as Readonly<Record<string, unknown>>, input);
  const baselinePath = fixturePath(input.fixturesDir, input.baseline.model, baselineKey);
  const baseline = await tryReadFixtureAt(baselinePath);
  if (baseline === null) throw new MissingBaseline(baselineKey, baselinePath);

  const variantRequest =
    typeof input.variant === "function" ? input.variant(input.baseline) : input.variant;
  const variantResponse = await input.harness.call(variantRequest);

  const serialized =
    input.serializeResponse === undefined
      ? (variantResponse as unknown)
      : input.serializeResponse(variantResponse);

  const variantRecord: FixtureRecord = {
    format: FIXTURE_FORMAT,
    key: requestKey(variantRequest as unknown as Readonly<Record<string, unknown>>, input),
    model: variantRequest.model,
    keyedFields: fields,
    recordedAt: null,
    durationMs: null,
    request: redactWithSecrets(
      keyedView(variantRequest as unknown as Readonly<Record<string, unknown>>, fields),
      secrets,
    ) as Readonly<Record<string, unknown>>,
    response: redactWithSecrets(serialized, secrets),
  };

  return {
    diff: diffFixtures(baseline, variantRecord, input),
    baseline,
    variantRequest,
    variantResponse,
  };
}

/** Diff two recordings that are already on disk, by key. */
export async function diffRecorded(
  fixturesDir: string,
  keyA: string,
  keyB: string,
  options: DiffOptions = {},
): Promise<FixtureDiff> {
  const a = await findFixtureByKey(fixturesDir, keyA);
  if (a === null) throw new MissingBaseline(keyA, fixturesDir);
  const b = await findFixtureByKey(fixturesDir, keyB);
  if (b === null) throw new MissingBaseline(keyB, fixturesDir);
  return diffFixtures(a.record, b.record, options);
}
