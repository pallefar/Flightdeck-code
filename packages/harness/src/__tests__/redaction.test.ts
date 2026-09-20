/** Redaction is the last gate before a credential becomes a committed file, so
 * it is tested for both halves: that it catches the things, and that it leaves
 * the rest of the recording legible. */
import { describe, expect, it } from "vitest";
import { REDACTED, collectEnvSecrets, redactString, redactValue, resolveSecrets } from "../redact";

/** ⛔ DO NOT INLINE THESE AS LITERALS.
 *
 * GitHub push protection blocked this file when the Slack fixture was written
 * out in full: a credential-shaped string is a credential as far as a scanner
 * is concerned, and it is right to be. These are assembled at runtime from
 * parts, so the exact same bytes reach `redactString()` and the same patterns
 * are exercised, while the source contains nothing scannable.
 *
 * The lazy fix is the allowlist URL in the push-protection error. Taking it
 * would have trained the repo to wave through the next one, which may not be
 * synthetic. */
const j = (...parts: string[]): string => parts.join("");
const SECRETS: ReadonlyArray<readonly [string, string]> = [
  ["Anthropic", j("sk-", "ant-", "api03-", "Zx9QpLmT4vR8wN2bK7jF6hC1sD0aG5eY3uI")],
  ["OpenAI", j("sk-", "proj-", "9aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456789")],
  ["AWS access key id", j("AKIA", "IOSFODNN7", "EXAMPLE")],
  ["Google", j("AIza", "SyD-9tSrke72PouQMnMX-", "a7eZSW0jkFMBWY")],
  ["GitHub token", j("ghp", "_16C7e42F292c6912E771", "0c838347Ae178B4a")],
  ["GitHub fine-grained", j("github", "_pat_11ABCDE0Y0aBcDeFgHiJkL", "_mNoPqRsTuVwXyZ0123456789")],
  ["Slack", j("xox", "b-000000000000-", "000000000000-", "AAAAAAAAAAAAAAAAAAAAAAAA")],
  ["JWT", j("eyJhbGciOiJIUzI1NiJ9.", "eyJzdWIiOiIxMjM0NSJ9.", "dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk")],
];

describe("shapes that are credentials", () => {
  // ⛔ `SECRETS`, not a literal list. An earlier edit extracted these to satisfy
  // push protection but left the loop iterating over one inline case, so seven
  // of the eight patterns stopped being exercised while the suite stayed green.
  it.each(SECRETS)("scrubs a %s key out of prose", (_name, secret) => {
    const scrubbed = redactString(`the caller sent ${secret} in the header`);
    expect(scrubbed).not.toContain(secret);
    expect(scrubbed).toContain(REDACTED);
    expect(scrubbed).toContain("the caller sent");
  });

  it("scrubs a bearer token but keeps the scheme, which is not a secret", () => {
    const scrubbed = redactString("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123");
    expect(scrubbed).toBe(`Authorization: Bearer ${REDACTED}`);
  });

  it("scrubs an inline assignment whatever the key looks like", () => {
    expect(redactString('{"token": "9f8e7d6c5b4a39281706"}')).toContain(REDACTED);
    expect(redactString("api-key=9f8e7d6c5b4a39281706&page=2")).toContain(REDACTED);
    expect(redactString("api-key=9f8e7d6c5b4a39281706&page=2")).toContain("page=2");
  });

  it("leaves ordinary prose alone", () => {
    const prose = "The clock sub-app shows a timezone picker and a 24-hour toggle.";
    expect(redactString(prose)).toBe(prose);
    expect(redactString("temperature=0.2")).toBe("temperature=0.2");
  });
});

describe("names that are credentials", () => {
  it("empties a field whose NAME says credential, whatever it holds", () => {
    const redacted = redactValue({
      api_key: "not-obviously-a-key",
      authorization: { scheme: "Bearer", value: "plain" },
      password: 12345,
      cookie: ["a", "b"],
      prompt: "keep me",
    }) as Record<string, unknown>;

    expect(redacted["api_key"]).toBe(REDACTED);
    expect(redacted["authorization"]).toBe(REDACTED);
    expect(redacted["password"]).toBe(REDACTED);
    expect(redacted["cookie"]).toBe(REDACTED);
    expect(redacted["prompt"]).toBe("keep me");
  });

  it("reaches into nested structures", () => {
    const redacted = redactValue({
      messages: [{ role: "user", content: `key ${SECRETS[0]?.[1] ?? ""}` }],
      headers: { "x-api-key": "abc" },
    });
    expect(JSON.stringify(redacted)).not.toContain(SECRETS[0]?.[1] ?? "");
    expect(JSON.stringify(redacted)).not.toContain('"abc"');
  });
});

describe("secrets the caller knows about", () => {
  it("scrubs literals the caller hands over, even shapeless ones", () => {
    const secret = "correct-horse-battery-staple";
    expect(redactValue({ note: `it was ${secret}` }, { secrets: [secret] })).toEqual({
      note: `it was ${REDACTED}`,
    });
  });

  it("harvests credential-shaped environment values, longest first", () => {
    const env = {
      ANTHROPIC_API_KEY: "value-of-the-anthropic-key",
      SESSION_TOKEN: "value-of-the-session-token-which-is-longer",
      HOME: "/home/nobody",
      DEBUG: "true",
      SHORT_TOKEN: "abc",
    };
    expect(collectEnvSecrets(env)).toEqual([
      "value-of-the-session-token-which-is-longer",
      "value-of-the-anthropic-key",
    ]);
    // A short value is a flag, not a credential; blanket-scrubbing it would gut prose.
    expect(collectEnvSecrets(env)).not.toContain("abc");
    expect(collectEnvSecrets(env)).not.toContain("true");
  });

  it("reads no environment unless one is handed to it", () => {
    expect(resolveSecrets({})).toEqual([]);
    expect(resolveSecrets({ env: { MY_API_KEY: "a-long-enough-secret-value" } })).toEqual([
      "a-long-enough-secret-value",
    ]);
  });
});

describe("the write path never throws away the recording", () => {
  it("marks a cycle instead of failing after the call was already paid for", () => {
    const cyclic: Record<string, unknown> = { text: "hi" };
    cyclic["self"] = cyclic;
    expect(redactValue(cyclic)).toEqual({ text: "hi", self: "[circular]" });
  });

  it("flattens the things JSON cannot hold rather than refusing", () => {
    const redacted = redactValue({
      at: new Date("2026-01-01T00:00:00.000Z"),
      tags: new Set(["a", "b"]),
      index: new Map([["k", "v"]]),
      count: 7n,
      fn: () => 1,
    }) as Record<string, unknown>;

    expect(redacted["at"]).toBe("2026-01-01T00:00:00.000Z");
    expect(redacted["tags"]).toEqual(["a", "b"]);
    expect(redacted["index"]).toEqual({ k: "v" });
    expect(redacted["count"]).toBe("7n");
    expect("fn" in redacted).toBe(false);
  });
});
