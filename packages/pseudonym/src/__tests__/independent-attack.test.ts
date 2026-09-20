/**
 * MY OWN probe, written without reading the agent's vault-dump.test.ts.
 * The agent wrote the test that says its own work is safe. This one is mine.
 *
 * Four secrets go in. The question is whether ANY of them can be got back out
 * other than by the one legitimate exit: the restored text this caller asked for.
 */
import { describe, expect, it } from "vitest";
import * as pkg from "../index";

const SECRETS = ["Anna Sørensen", "anna@example.dk", "010180-1234", "+45 20 11 22 33"] as const;
const SOURCE =
  `Anna Sørensen (anna@example.dk), cpr 010180-1234, tlf +45 20 11 22 33, ` +
  `har bedt om aktindsigt.`;
const NAMES = ["Anna Sørensen"];

/** Every string reachable from a value, however deep, including keys. */
function harvest(v: unknown, seen = new Set<unknown>(), out: string[] = []): string[] {
  if (v == null) return out;
  if (typeof v === "string") { out.push(v); return out; }
  if (typeof v === "function") { out.push(String(v)); return out; }
  if (typeof v !== "object") return out;
  if (seen.has(v)) return out;
  seen.add(v);
  for (const k of Reflect.ownKeys(v)) {
    out.push(String(k));
    let child: unknown;
    try { child = (v as Record<PropertyKey, unknown>)[k]; } catch { continue; }
    harvest(child, seen, out);
  }
  const proto = Object.getPrototypeOf(v);
  if (proto && proto !== Object.prototype && proto !== Array.prototype) harvest(proto, seen, out);
  return out;
}

const leaks = (strings: string[]) =>
  SECRETS.filter((s) => strings.some((t) => t.includes(s)));

describe("my own attack on the narrowed surface", () => {
  it("ROUTE 1 — no PAIR of exports composes into a dump", async () => {
    // The first version of this probe called each export in isolation with a
    // tag, and PASSED with `tokenize`/`detokenize`/`Vault`/`vaultClasses` put
    // back on the surface — because the dump is a COMPOSITION: one export to
    // obtain a vault, a second to trade a tag against it. A probe that never
    // composes cannot see the hole it is looking for. So: every ordered pair.
    const { text } = await pkg.withPseudonymisation(SOURCE, { names: NAMES }, async (p) => p.text);
    expect(text).toBe(SOURCE); // the legitimate path still works

    const fns = Object.entries(pkg).filter(([, v]) => typeof v === "function") as
      [string, (...a: unknown[]) => unknown][];
    const TAGS = ["<PERSON_NAME:1>", "<EMAIL:1>", "<CPR:1>", "<PHONE:1>", "<ADDRESS:1>"];

    // Step one: anything any export hands back when shown the source text.
    const carriers: unknown[] = [];
    for (const [, a] of fns) {
      for (const args of [[SOURCE], [SOURCE, {}], [SOURCE, { names: NAMES }]]) {
        try {
          const r = a(...args);
          if (r && typeof (r as Promise<unknown>).then === "function") {
            carriers.push(await (r as Promise<unknown>).catch(() => null));
            continue;
          }
          carriers.push(r);
          // and one level down: a vault is usually a FIELD, not the return value
          if (r && typeof r === "object") {
            for (const k of Reflect.ownKeys(r)) {
              try { carriers.push((r as Record<PropertyKey, unknown>)[k]); } catch { /* getter */ }
            }
          }
        } catch { /* refused */ }
      }
    }

    // Step two: every carrier, against every export, with every tag. Each leak
    // is ATTRIBUTED to the function that produced it, because "something
    // leaked" is not a finding you can act on — and because the difference
    // between a text normaliser echoing its own argument and `detokenize`
    // trading a tag for a value is the entire question.
    const leakedFrom = new Set<string>();
    for (const [bName, b] of fns) {
      for (const carrier of carriers) {
        for (const tag of TAGS) {
          for (const args of [[tag, carrier], [carrier, tag], [tag, { vault: carrier }]]) {
            let out: string[] = [];
            try {
              const r = b(...args);
              if (r && typeof (r as Promise<unknown>).then === "function") {
                out = harvest(await (r as Promise<unknown>).catch(() => null));
              } else {
                out = harvest(r);
              }
            } catch { continue; /* a refusal is a pass */ }
            if (leaks(out).length) leakedFrom.add(bName);
          }
        }
      }
    }

    // The ONLY functions that may produce a secret are the two pinned text
    // normalisers, and only because they were handed the secret to normalise.
    // `detokenize` appearing in this set is the dump; so is `vaultEntries`,
    // `vaultTags`, `lookupOrdinal` or anything else that consults a vault.
    // Verified to break: re-export tokenize + detokenize from index.ts and this
    // assertion fails with "detokenize" in the received set.
    expect([...leakedFrom].sort()).toEqual(["foldForSignals", "signalStem"]);
  });

  it("ROUTE 1b — exactly two exports echo their own argument, and they are text transforms", async () => {
    // Found by this probe on its first run: calling every export with the
    // SOURCE text returns the secrets from `foldForSignals` and `signalStem`.
    // That is what they are — pure normalisers over the string you hand them —
    // and neither can be aimed at a vault, so handing one a secret means you
    // already had it. Pinned by name so that a THIRD export cannot start
    // echoing quietly: this assertion breaks the moment the set changes.
    const echoes: string[] = [];
    for (const [name, value] of Object.entries(pkg)) {
      if (typeof value !== "function") continue;
      try {
        const r = (value as (...a: unknown[]) => unknown)(SOURCE, { names: NAMES });
        if (r && typeof (r as Promise<unknown>).then === "function") {
          await (r as Promise<unknown>).catch(() => null);
          continue;
        }
        if (leaks(harvest(r)).length) echoes.push(name);
      } catch { /* refused */ }
    }
    expect(echoes.sort()).toEqual(["foldForSignals", "signalStem"]);

    // And the thing that makes them harmless, asserted rather than asserted-in-prose:
    // given a TAG they return no secret, because they hold no vault to consult.
    expect(leaks([pkg.foldForSignals("<EMAIL:1>"), pkg.signalStem("<EMAIL:1>")])).toEqual([]);
  });

  it("ROUTE 2 — a hostile send cannot reach a vault from what it is handed", async () => {
    let reachable: string[] = [];
    let callables: string[] = [];
    await pkg.withPseudonymisation(SOURCE, { names: NAMES }, async (payload) => {
      reachable = harvest(payload);
      // anything callable hanging off the payload, at any depth
      const walk = (v: unknown, seen = new Set<unknown>()) => {
        if (v == null || seen.has(v)) return;
        seen.add(v);
        if (typeof v === "function") { callables.push(String(v).slice(0, 80)); return; }
        if (typeof v !== "object") return;
        for (const k of Reflect.ownKeys(v)) {
          try { walk((v as Record<PropertyKey, unknown>)[k], seen); } catch { /* getter threw */ }
        }
      };
      walk(payload);
      return payload.text;
    });
    expect(leaks(reachable)).toEqual([]);
    expect(callables).toEqual([]); // no escape hatch, not even a bound method
  });

  it("ROUTE 3 — the one-tag-per-call loop, transcribed onto the new surface", async () => {
    // Last round this exact shape defeated the fix. Here it is again, aimed at
    // whatever the surface now offers.
    const dumped: string[] = [];
    for (const cls of ["PERSON_NAME", "EMAIL", "CPR", "PHONE", "ADDRESS"]) {
      for (let i = 1; i <= 8; i++) {
        const probe = `<${cls}:${i}>`;
        try {
          // The attacker's vault is built from the attacker's own text. That is
          // the whole point: there is no other vault to aim at.
          const { text } = await pkg.withPseudonymisation(probe, { names: [] }, async () => probe);
          if (text !== probe) dumped.push(text);
        } catch { /* refused */ }
      }
    }
    expect(leaks(dumped)).toEqual([]);
  });

  it("ROUTE 4 — the report is safe to log, as the header claims", async () => {
    const { report } = await pkg.withPseudonymisation(SOURCE, { names: NAMES }, async (p) => p.text);
    expect(leaks(harvest(report))).toEqual([]);
    expect(leaks([JSON.stringify(report)])).toEqual([]);
  });

  it("ROUTE 5 — a send that keeps its payload still holds nothing", async () => {
    // The realistic leak: send stashes what it got and reads it later.
    let stash: unknown;
    await pkg.withPseudonymisation(SOURCE, { names: NAMES }, async (p) => { stash = p; return p.text; });
    expect(leaks(harvest(stash))).toEqual([]);
  });
});
