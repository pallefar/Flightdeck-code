/** The recording on disk.
 *
 * One call, one file, named by the content address of its request:
 *
 *   <fixturesDir>/<model-slug>/<key>.json
 *
 * No index file, no manifest, no ordering. The directory listing IS the index —
 * which is what makes two branches that each record a new call merge without a
 * conflict, and what makes an inserted call cost exactly one new file.
 *
 * ⭐ EVERY WRITE IS A RENAME. A fixture is written to a temporary name in the
 * same directory and moved into place, so a crash, a full disk or two recorders
 * racing leave either the old file or the new one — never a half-written JSON
 * document that every later playback fails to parse. */
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import { assessTier } from "../../pseudonym/src/tier";
import { Vault } from "../../pseudonym/src/vault";
import { classify } from "../../guardrails/src/pure";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { canonicalStringify } from "./canonical";

export const FIXTURE_FORMAT = 1;

export interface FixtureRecord {
  /** Bumped when the on-disk shape changes; a mismatch is reported, not guessed at. */
  readonly format: number;
  /** Content address of the request. Authoritative: the stored request is redacted
   * and therefore may not re-hash to this value. */
  readonly key: string;
  readonly model: string;
  /** Which request fields the key covered when this was recorded. A change here
   * between two fixtures is harness drift, and `diffFixtures` says so. */
  readonly keyedFields: readonly string[];
  readonly recordedAt: string | null;
  readonly durationMs: number | null;
  /** The keyed fields of the request, redacted. */
  readonly request: Readonly<Record<string, unknown>>;
  /** The provider's full response, redacted. */
  readonly response: unknown;
}

export interface StoredFixture {
  readonly record: FixtureRecord;
  readonly path: string;
}

export class FixtureFormatError extends Error {
  readonly path: string;

  constructor(message: string, path: string) {
    super(`${message}\n  fixture: ${path}`);
    this.name = "FixtureFormatError";
    this.path = path;
  }
}

/** A directory name derived from a model id. Cosmetic — the key already covers
 * the model — but it makes the tree browsable, and it is defended against a
 * model id that would escape the fixtures directory. */
export function modelSlug(model: string): string {
  const slug = model
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/\.{2,}/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 80);
  return slug === "" ? "unknown-model" : slug;
}

export function fixturePath(fixturesDir: string, model: string, key: string): string {
  return join(fixturesDir, modelSlug(model), `${key}.json`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseFixture(value: unknown, path: string): FixtureRecord {
  if (!isRecord(value)) throw new FixtureFormatError("not a JSON object", path);
  const { format, key, model, keyedFields, recordedAt, durationMs, request, response } = value;

  if (typeof format !== "number") throw new FixtureFormatError("missing numeric `format`", path);
  if (format !== FIXTURE_FORMAT) {
    throw new FixtureFormatError(
      `fixture format ${String(format)}, this harness reads ${String(FIXTURE_FORMAT)} — re-record it`,
      path,
    );
  }
  if (typeof key !== "string" || key === "") throw new FixtureFormatError("missing `key`", path);
  if (typeof model !== "string") throw new FixtureFormatError("missing `model`", path);
  if (!Array.isArray(keyedFields) || keyedFields.some((field) => typeof field !== "string")) {
    throw new FixtureFormatError("missing `keyedFields`", path);
  }
  if (!isRecord(request)) throw new FixtureFormatError("missing `request` object", path);
  if (!("response" in value)) throw new FixtureFormatError("missing `response`", path);

  return {
    format,
    key,
    model,
    keyedFields: keyedFields as readonly string[],
    recordedAt: typeof recordedAt === "string" ? recordedAt : null,
    durationMs: typeof durationMs === "number" ? durationMs : null,
    request,
    response,
  };
}

export async function readFixtureAt(path: string): Promise<FixtureRecord> {
  const text = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch (error) {
    throw new FixtureFormatError(`not valid JSON: ${(error as Error).message}`, path);
  }
  return parseFixture(parsed, path);
}

/** `null` when there is no such fixture. Any other failure — unreadable file,
 * malformed JSON, wrong format — throws, because "absent" and "broken" call for
 * different fixes and collapsing them hides the second one. */
export async function tryReadFixtureAt(path: string): Promise<FixtureRecord | null> {
  try {
    return await readFixtureAt(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

/**
 * A recording that cannot be committed, refused before it reaches disk.
 *
 * Names CLASSES and sanitised locations — never the value that tripped it.
 * The whole point is that the value does not get written down.
 */
export class FixtureNotCommittableError extends Error {
  constructor(
    readonly path: string,
    readonly tier: number,
    readonly classes: readonly string[],
  ) {
    super(
      `refused: this recording assesses as tier ${tier} (${classes.join(", ")}) and was NOT written to ${path}. ` +
        `Fixtures are committed files; redaction covers credentials, not people. Re-record from input that does not carry personal data.`,
    );
    this.name = "FixtureNotCommittableError";
  }
}

export interface WriteFixtureOptions {
  /** Names the caller already knows are in play, so they are found as names
   * rather than as whatever shape they happen to take. */
  readonly declaredNames?: readonly string[];
}

export async function writeFixtureAt(
  path: string,
  record: FixtureRecord,
  options: WriteFixtureOptions = {},
): Promise<void> {
  // ⭐ "REDACTION SO A RECORDING IS COMMITTABLE" — NOW TRUE RATHER THAN SAID.
  //
  // This package's header claims a recording is committable because it is
  // redacted. `redact.ts` matches api keys, tokens, passwords and cookies:
  // CREDENTIALS. It has never looked for a person. So a live recording wrote
  // the request and the full response to a file that goes into git, and
  // whether that file contained someone's name depended entirely on what was
  // in the prompt.
  //
  // A fixture is an emitted file, so it gets the rule emitted files already
  // have: `gateGeneratedArtifacts` refuses tier 3/4 outright, "because
  // personal data in emitted files is a bug in generation and the remedy for
  // a bug is to fix it". There is deliberately no opt-out — an escape hatch
  // here would be used by the exact caller who most needs the refusal.
  // ⚠ THE PAYLOAD, NOT THE WHOLE RECORD. Classifying the record entire
  // reported tier 3 `digits` on 24 fixtures whose only offence was a hex
  // `key`, a `durationMs` and a token count — structural metadata this
  // harness wrote itself. What arrives from outside, and is therefore
  // capable of carrying a person, is the request and the response.
  // ── TWO RULES, BECAUSE THEY ANSWER TWO QUESTIONS ──────────────────────
  //
  // Both thresholds were MEASURED against real payloads, not chosen:
  //
  //   bare name in a prompt   classify tier 1   assessTier tier 4
  //   IBAN / email            classify tier 4   assessTier tier 4
  //   the REAL planner call   classify tier 1   assessTier tier 3
  //   harness metadata        classify tier 1   assessTier tier 2
  //
  // `classify` finds STRUCTURED identifiers — an email, an IBAN, a phone
  // number — and none of those belongs in a committed file, so tier 3 is the
  // line, the same one `gateGeneratedArtifacts` draws.
  //
  // `classify` does NOT find a bare person's name in prose; `declaredNames`
  // informs field-name checks and is not a name matcher. `assessTier` does
  // find one — `unverified-name-shaped-content` — but it also rates the
  // system's OWN ordinary planner exchange tier 3, because "visible to legal
  // and admin" is a quasi-identifier signal. Refusing that would make the
  // recorder unusable for the thing it exists to record.
  //
  // So the pseudonymiser's line here is 4, its own "do not transmit"
  // ceiling: a name nobody declared, or a special-category signal. Tier 3
  // from role words alone is not a reason to refuse a fixture.
  const payload = { request: record.request, response: record.response };
  const assessment = assessTier(JSON.stringify(payload), new Vault(), {
    ...(options.declaredNames === undefined ? {} : { names: [...options.declaredNames] }),
  });
  if (assessment.payloadTier >= 4) {
    const classes = [...new Set(assessment.reasons.filter((r) => r.floor >= 4).map((r) => r.code))].sort();
    throw new FixtureNotCommittableError(path, assessment.payloadTier, classes);
  }

  const classification = classify(payload, {
    ...(options.declaredNames === undefined ? {} : { declaredNames: [...options.declaredNames] }),
  });
  if (classification.tier >= 3) {
    const classes = [...new Set(classification.findings.map((f) => f.class))].sort();
    throw new FixtureNotCommittableError(path, classification.tier, classes);
  }

  await mkdir(dirname(path), { recursive: true });

  // Canonical bytes, indented: re-recording an unchanged call produces an
  // identical file, so a fixture only shows up in a diff when it really moved.
  const body = `${canonicalStringify(record, 2)}\n`;
  const temporary = `${path}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    await writeFile(temporary, body, "utf8");
    await rename(temporary, path);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Every fixture under a directory. Missing directory means none, which is the
 * ordinary state of a fresh checkout, not an error. */
export async function listFixtures(fixturesDir: string): Promise<StoredFixture[]> {
  let entries: string[];
  try {
    entries = await readdir(fixturesDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }

  const found: StoredFixture[] = [];
  for (const entry of entries.sort()) {
    const child = join(fixturesDir, entry);
    if (entry.endsWith(".json")) {
      found.push({ record: await readFixtureAt(child), path: child });
      continue;
    }
    if (entry.endsWith(".tmp")) continue;
    let nested: string[];
    try {
      nested = await readdir(child);
    } catch {
      continue; // a plain file that is not a fixture; not ours to complain about
    }
    for (const leaf of nested.sort()) {
      if (!leaf.endsWith(".json")) continue;
      const path = join(child, leaf);
      found.push({ record: await readFixtureAt(path), path });
    }
  }
  return found;
}

/** Locate a fixture by key alone — used when the model is not known up front,
 * as when comparing a recording against one made on a different model. */
export async function findFixtureByKey(fixturesDir: string, key: string): Promise<StoredFixture | null> {
  for (const stored of await listFixtures(fixturesDir)) {
    if (stored.record.key === key) return stored;
  }
  return null;
}
