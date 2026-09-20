/** The key is the whole contract between a recording and the call that wants it.
 * Everything here is a way that contract could silently break. */
import { describe, expect, it } from "vitest";
import { CanonicalizeError, canonicalDigest, canonicalStringify } from "../canonical";
import { KEYED_FIELDS, KEY_LENGTH, differingFields, keyFieldsFor, keyedView, requestKey } from "../keys";

describe("canonical bytes", () => {
  it("is insensitive to key order, at every depth", () => {
    const a = { model: "m", output_config: { b: 1, a: { y: [1, 2], x: true } } };
    const b = { output_config: { a: { x: true, y: [1, 2] }, b: 1 }, model: "m" };
    expect(canonicalStringify(a)).toBe(canonicalStringify(b));
    expect(canonicalDigest(a)).toBe(canonicalDigest(b));
  });

  it("is sensitive to array order, because a message list is not a set", () => {
    expect(canonicalStringify([1, 2])).not.toBe(canonicalStringify([2, 1]));
  });

  it("treats an absent field and an undefined field as the same request", () => {
    expect(canonicalStringify({ a: 1, b: undefined })).toBe(canonicalStringify({ a: 1 }));
  });

  it("keeps an undefined array element as a hole, so later elements do not shift", () => {
    expect(canonicalStringify([1, undefined, 3])).toBe("[1,null,3]");
  });

  it("normalises -0, because it is the same number to every provider", () => {
    expect(canonicalStringify({ t: -0 })).toBe(canonicalStringify({ t: 0 }));
  });

  it("refuses values JSON would silently drop or flatten", () => {
    // Each of these is a request that JSON.stringify would turn into a DIFFERENT
    // request, quietly, and then hash onto somebody else's fixture.
    expect(() => canonicalStringify({ tools: [{ name: "x", run: () => 1 }] })).toThrow(CanonicalizeError);
    expect(() => canonicalStringify({ temperature: Number.NaN })).toThrow(/no JSON representation/);
    expect(() => canonicalStringify({ limit: Number.POSITIVE_INFINITY })).toThrow(/no JSON representation/);
    expect(() => canonicalStringify({ id: 10n })).toThrow(/bigint/);
    expect(() => canonicalStringify({ at: new Date("nonsense") })).toThrow(/Invalid Date/);
  });

  it("names where the offending value is", () => {
    const error = (() => {
      try {
        canonicalStringify({ messages: [{ role: "user" }, { role: "user", send: () => 1 }] });
        return null;
      } catch (caught) {
        return caught as CanonicalizeError;
      }
    })();
    expect(error?.path).toBe("$.messages[1].send");
  });

  it("cuts a cycle instead of hanging", () => {
    const cyclic: Record<string, unknown> = { model: "m" };
    cyclic["self"] = cyclic;
    expect(() => canonicalStringify(cyclic)).toThrow(/circular/);
  });

  it("accepts a Date and a toJSON, canonicalising the result", () => {
    expect(canonicalStringify({ at: new Date("2026-01-01T00:00:00.000Z") })).toBe('{"at":"2026-01-01T00:00:00.000Z"}');
    const custom = { toJSON: () => ({ b: 2, a: 1 }) };
    expect(canonicalStringify({ custom })).toBe('{"custom":{"a":1,"b":2}}');
  });

  it("pretty-prints the same value it hashes", () => {
    const value = { b: 1, a: [1, { d: 2, c: 3 }] };
    expect(canonicalStringify(value, 2)).toBe(
      ['{', '  "a": [', "    1,", "    {", '      "c": 3,', '      "d": 2', "    }", "  ],", '  "b": 1', "}"].join("\n"),
    );
    expect(JSON.parse(canonicalStringify(value, 2))).toEqual(JSON.parse(canonicalStringify(value)));
  });
});

describe("what the key covers", () => {
  const request = {
    model: "m",
    system: "s",
    messages: [{ role: "user", content: "hi" }],
    tools: [{ name: "t" }],
    output_config: { format: "json" },
    apiKey: "sk-ant-api03-secretsecretsecret",
    requestId: "req-1",
  };

  it("covers exactly the five named fields by default", () => {
    expect(keyFieldsFor()).toEqual([...KEYED_FIELDS].sort());
    expect(Object.keys(keyedView(request, keyFieldsFor())).sort()).toEqual([
      "messages",
      "model",
      "output_config",
      "system",
      "tools",
    ]);
  });

  it("ignores everything outside them — credentials, ids, retry counters", () => {
    const key = requestKey(request);
    expect(requestKey({ ...request, apiKey: "sk-ant-api03-somethingelseentirely", requestId: "req-2" })).toBe(key);
    expect(key).toHaveLength(KEY_LENGTH);
    expect(key).toMatch(/^[0-9a-f]+$/);
  });

  it("changes when any keyed field changes", () => {
    const key = requestKey(request);
    expect(requestKey({ ...request, model: "m2" })).not.toBe(key);
    expect(requestKey({ ...request, system: "s2" })).not.toBe(key);
    expect(requestKey({ ...request, messages: [{ role: "user", content: "hi!" }] })).not.toBe(key);
    expect(requestKey({ ...request, tools: [{ name: "u" }] })).not.toBe(key);
    expect(requestKey({ ...request, output_config: { format: "text" } })).not.toBe(key);
  });

  it("extends the key for a peer whose request carries more meaning", () => {
    const options = { extraKeyedFields: ["temperature"] };
    const cold = { model: "m", messages: [], temperature: 0 };
    const warm = { ...cold, temperature: 1 };
    expect(requestKey(cold)).toBe(requestKey(warm)); // unkeyed: a silent collision
    expect(requestKey(cold, options)).not.toBe(requestKey(warm, options));
  });

  it("adding an extra keyed field does not invalidate fixtures that lack it", () => {
    // The field list itself is deliberately not hashed. Opting in must not
    // re-record a suite whose requests never set the field.
    const plain = { model: "m", messages: [{ role: "user", content: "hi" }] };
    expect(requestKey(plain, { extraKeyedFields: ["temperature"] })).toBe(requestKey(plain));
  });

  it("replaces the field set outright for a peer that names things differently", () => {
    const fields = { keyFields: ["model", "system", "messages", "tools", "outputConfig"] };
    expect(keyFieldsFor(fields)).toContain("outputConfig");
    const a = { model: "m", outputConfig: { format: "json" } };
    const b = { model: "m", outputConfig: { format: "text" } };
    expect(requestKey(a, fields)).not.toBe(requestKey(b, fields));
    expect(requestKey(a)).toBe(requestKey(b)); // and this is the drift it protects against
  });

  it("reports which fields two requests disagree on", () => {
    expect(differingFields({ model: "a", system: "s" }, { model: "b", system: "s" })).toEqual(["model"]);
    expect(differingFields({ a: { x: 1, y: 2 } }, { a: { y: 2, x: 1 } })).toEqual([]);
    expect(differingFields({ a: 1 }, { b: 1 })).toEqual(["a", "b"]);
  });
});
