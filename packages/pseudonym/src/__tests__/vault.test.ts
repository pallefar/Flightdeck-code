/**
 * THE VAULT IS THE RE-IDENTIFICATION KEY. These are the tests for "you cannot
 * send it by accident".
 */
import { describe, expect, it, vi } from "vitest";
import { VaultSealedError, VaultSerializationError } from "../errors";
import { tokenize } from "../tokenize";
import { Vault, internValue, vaultClasses, vaultTags } from "../vault";

const build = () => tokenize("a@x.de am 01.02.2024, Anna Berger", { names: ["Anna Berger"] });

describe("a vault refuses to be serialised", () => {
  it("throws on JSON.stringify(vault)", () => {
    const { vault } = build();
    expect(() => JSON.stringify(vault)).toThrow(VaultSerializationError);
  });

  it("throws on the accident that actually happens — stringifying the whole payload", () => {
    // This is the line the defence exists for:
    //   fetch(url, { body: JSON.stringify({ text, vault }) })
    const { text, vault } = build();
    expect(() => JSON.stringify({ text, vault })).toThrow(VaultSerializationError);
    // Nested arbitrarily deep, because `toJSON` is called at any depth.
    expect(() => JSON.stringify({ req: { facts: { ctx: [{ vault }] } } })).toThrow(VaultSerializationError);
  });

  it("does not quietly serialise to {} — which would look like it worked", () => {
    // The failure mode a plain object with hidden state would have.
    const { vault } = build();
    let out: string | null = null;
    try {
      out = JSON.stringify({ vault });
    } catch {
      out = null;
    }
    expect(out).toBeNull();
  });

  it("keeps its values out of string interpolation and out of console.log", () => {
    const { vault } = build();
    expect(`${vault}`).toBe("[Vault 3 entries]");
    expect(`${vault}`).not.toContain("@x.de");
    expect(`${vault}`).not.toContain("Anna");

    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    console.log(vault);
    const logged = spy.mock.calls.flat();
    spy.mockRestore();
    // Node's console.log runs util.inspect, which prints own enumerable
    // symbol keys. The store is non-enumerable AND there is an inspect hook.
    expect(JSON.stringify(logged.map(String))).not.toContain("Anna");
  });

  it("has no own enumerable property that could carry the store", () => {
    const { vault } = build();
    expect(Object.keys(vault)).toEqual([]);
    expect(Object.getOwnPropertySymbols(vault).filter((s) => Object.propertyIsEnumerable.call(vault, s))).toEqual([]);
    expect({ ...vault }).toEqual({});
  });

  it("tells you only counts, tags and class names about itself", () => {
    const { vault } = build();
    expect(vault.size).toBe(3);
    // `<number:2>`, not `<date:2>`: the host's array puts `digits` BEFORE
    // `date`, so a German date is claimed by the long-digit-run class first.
    // `redact()` produces `<number>` for the same input. Pinned here because
    // it is a place where being FAITHFUL to the host matters more than being
    // tidy — diverging would mean two scanners disagreeing about one string.
    expect(vaultTags(vault)).toEqual(["<email:1>", "<number:2>", "<person:3>"]);
    expect(vaultClasses(vault)).toEqual(["email", "number", "person"]);
    // A tag carries nothing about its value: same length whatever it stands for.
    expect(vaultTags(vault).join("")).not.toContain("Anna");
  });
});

describe("a vault is built once", () => {
  it("is sealed by tokenize, so nothing can be added behind an assessment's back", () => {
    const { vault } = build();
    expect(() => internValue(vault, "person", "Someone Else")).toThrow(VaultSealedError);
  });

  it("refuses more distinct values than its ceiling", () => {
    const vault = new Vault(2);
    internValue(vault, "email", "a@x.de");
    internValue(vault, "email", "b@x.de");
    expect(() => internValue(vault, "email", "c@x.de")).toThrow(/more than 2 distinct values/);
    // ...but a REPEAT of a value already held is not a new entry.
    expect(internValue(vault, "email", "a@x.de").tag).toBe("<email:1>");
  });
});
