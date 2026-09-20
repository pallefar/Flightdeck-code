/**
 * ⭐ "REDACTION SO A RECORDING IS COMMITTABLE" — MADE TRUE.
 *
 * `harness.ts`'s header gives that as the reason a live recording is safe to
 * check in. `redact.ts` matches api keys, tokens, passwords and cookies:
 * CREDENTIALS. It has never looked for a person. So a recording wrote the
 * request and the full response into a file destined for git, and whether it
 * contained someone's name depended entirely on what was in the prompt.
 *
 * A fixture is an emitted file, so it gets the rule emitted files already
 * have — `gateGeneratedArtifacts` refuses tier 3/4 outright, "because
 * personal data in emitted files is a bug in generation and the remedy for a
 * bug is to fix it".
 */
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { FixtureNotCommittableError, writeFixtureAt } from "../fixture";
import type { FixtureRecord } from "../fixture";

const dirs: string[] = [];
async function tempPath(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "fixture-guard-"));
  dirs.push(dir);
  return join(dir, "recording.json");
}
afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const record = (request: unknown, response: unknown = { text: "ok" }): FixtureRecord => ({
  format: 1,
  key: "e1781aa12f63383d2d288e4c5432e79e",
  model: "claude-opus-5",
  keyedFields: ["system", "messages"],
  recordedAt: "2026-09-20T09:00:00Z",
  durationMs: 1234,
  request: request as Readonly<Record<string, unknown>>,
  response,
});

const exists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  );

describe("a recording that carries a person is not written", () => {
  it("⭐ an IBAN in the request — refused, and NOTHING reaches disk", async () => {
    const path = await tempPath();
    const error = await writeFixtureAt(path, record({ messages: [{ text: "pay DE02120300000000202051" }] })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FixtureNotCommittableError);
    // The refusal must happen BEFORE the write, not after.
    expect(await exists(path)).toBe(false);
  });

  it("⭐ and in the RESPONSE — the model's reply is written down too", async () => {
    // The direction that is easy to forget: redaction was applied to both,
    // and looked for credentials in both.
    const path = await tempPath();
    const error = await writeFixtureAt(
      path,
      record({ messages: [{ text: "summarise" }] }, { text: "Contact anna.sorensen@example.dk about it" }),
    ).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FixtureNotCommittableError);
    expect(await exists(path)).toBe(false);
  });

  it("⭐ the refusal names CLASSES, never the value it found", async () => {
    const path = await tempPath();
    const error = (await writeFixtureAt(
      path,
      record({ messages: [{ text: "pay DE02120300000000202051 to anna.sorensen@example.dk" }] }),
    ).catch((e: unknown) => e)) as FixtureNotCommittableError;
    expect(error.classes.length).toBeGreaterThan(0);
    expect(error.message).not.toContain("DE02120300000000202051");
    expect(error.message).not.toContain("anna.sorensen");
    // And it says where to look instead.
    expect(error.message).toContain(path);
  });

  it("a declared name is found even as bare prose", async () => {
    const path = await tempPath();
    const error = await writeFixtureAt(path, record({ messages: [{ text: "ask Anna Sørensen to review" }] }), {
      declaredNames: ["Anna Sørensen"],
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FixtureNotCommittableError);
    expect(await exists(path)).toBe(false);
  });

  it("⭐ a PII FIELD NAME with no value pattern — which only `classify` sees", async () => {
    // The two checks are not redundant and this is the proof. Measured:
    //   { salaryEur: 92000 }   classify 4   assessTier 2
    // `assessTier` reads the JSON as text and finds no identifier in it;
    // `classify` walks the structure and knows what the KEY means. Removing
    // the classify check left every other case in this file green.
    const path = await tempPath();
    const error = await writeFixtureAt(path, record({ salaryEur: 92000, dateOfBirth: "unset" })).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(FixtureNotCommittableError);
    expect(await exists(path)).toBe(false);
  });
});

describe("⛔ and an ordinary recording still records", () => {
  it("a prompt with no personal data is written, bytes intact", async () => {
    // A guard that refused everything would have passed every case above.
    const path = await tempPath();
    await writeFixtureAt(path, record({ messages: [{ text: "list contract folders needing review" }] }));
    expect(await exists(path)).toBe(true);
    const parsed = JSON.parse(await readFile(path, "utf8")) as FixtureRecord;
    expect(parsed.model).toBe("claude-opus-5");
    expect(JSON.stringify(parsed.request)).toContain("contract folders");
  });

  it("⭐ the system's OWN planner exchange records — the measurement behind the threshold", async () => {
    // This is why the pseudonymiser's line here is 4 and not 3. A real
    // planner call assesses tier THREE, because "visible to legal and admin"
    // is a quasi-identifier signal and the draft mentions roles. Refusing
    // tier 3 would make the recorder unusable for the exact exchange it
    // exists to record, and a recorder nobody can run is a recorder that
    // gets switched off.
    //
    // Measured, not assumed:
    //   bare name in a prompt   classify 1   assessTier 4   → refused
    //   IBAN / email            classify 4   assessTier 4   → refused
    //   this exchange           classify 1   assessTier 3   → recorded
    //
    // ⚠ AND THE PAYLOAD HERE REALLY IS TIER 3. The first version of this case
    // assessed tier TWO, so tightening the threshold to 3 left it green —
    // mutation testing found that. "for HR reviewers and the works council
    // liaison" is what carries it: a named function is closer to a person
    // than a generic role.
    const path = await tempPath();
    await writeFixtureAt(
      path,
      record(
        {
          system: "You are a planner.",
          messages: [{ role: "user", text: "Show contract folders needing review, visible to legal and admin." }],
        },
        {
          text: '{"understanding":"Show contract folders needing review, for HR reviewers and the works council liaison.","spec":{"id":"works-council-gaps","label":"Works council gaps","purpose":"Flags contracts with no works-council consultation date."}}',
        },
      ),
    );
    expect(await exists(path)).toBe(true);
  });

  it("the harness's own metadata does not trip it", async () => {
    // Classifying the whole record reported tier 3 `digits` on 24 fixtures
    // whose only offence was a hex `key`, a `durationMs` and a token count —
    // structural metadata the harness wrote itself.
    const path = await tempPath();
    await writeFixtureAt(path, record({ max_tokens: 16000, temperature: 1 }, { usage: { input: 1234, output: 5678 } }));
    expect(await exists(path)).toBe(true);
  });
});
