/** The local copy of `subAppManifestSchema`, checked against REALITY.
 *
 * ⭐ This is the test that makes the copy trustworthy. Codegen cannot import
 * the host's schema, so it carries its own; a carried copy is worthless
 * unless something forces it to keep agreeing. What forces it here is the
 * four hand-written manifests in `pallefar/project-contract`: they are read
 * off disk AS SOURCE, parsed by the same reader the generated manifest goes
 * through, and validated by this copy. If the host widens or narrows a
 * rule, a real manifest stops matching and this goes red.
 *
 * Skipped, loudly, when the checkout is not present — a test that silently
 * passes because it found no files is worse than one that says why. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertManifestWouldBoot, subAppManifestSchema } from "../manifest-rules";
import { NON_DATA_MEMBERS, readEmittedManifest } from "../testing/readEmittedManifest";
import { HOST_ROOT } from "../../../guardrails/src/host-source";

// ⚠ DERIVED, NOT HARDCODED. This was the literal Linux path, so on any
// machine whose checkout lives elsewhere the file was simply absent and
// this whole file skipped — silently, and on a MAC that is every run.
// `HOST_ROOT` is the one place that reads FLIGHTDECK_HOST_ROOT.
const CONTRACT_SUBAPPS = `${HOST_ROOT}/flightdeck/server/subapps`;
const REAL_MANIFESTS = ["shell-reference", "docusign", "maps", "advantage"];
const available = fs.existsSync(CONTRACT_SUBAPPS);

describe.skipIf(!available)("the local schema copy agrees with the host's real manifests", () => {
  for (const id of REAL_MANIFESTS) {
    it(`accepts the hand-written ${id} manifest, read from its source`, () => {
      const source = fs.readFileSync(path.join(CONTRACT_SUBAPPS, id, "manifest.ts"), "utf8");
      const data = readEmittedManifest(source);
      expect(data.id).toBe(id);
      // The real thing, boot rules and all — not just the Zod shape.
      expect(() => assertManifestWouldBoot(data)).not.toThrow();
    });
  }

  /** ⭐ THE READER'S SKIP LIST IS A TRANSCRIBED CONSTANT, SO IT GETS A DRIFT
   * TEST (HANDOVER §5.4). The reader skips exactly the members the host's
   * `SubAppManifest` interface declares on top of `SubAppManifestData` —
   * the ones `subAppManifestSchema` never sees. Read off the host's
   * `types.ts`, in both directions: a member the host adds and the reader
   * does not skip turns a real manifest red (that is how OS-04's
   * `contributions` surfaced); a member the reader skips and the host no
   * longer declares is a hole a computed field could hide in. */
  it("skips exactly the members the host's SubAppManifest adds beyond the Zod data", () => {
    const types = fs.readFileSync(path.join(CONTRACT_SUBAPPS, "types.ts"), "utf8");
    const hostMembers = interfaceMembers(types, "SubAppManifest");
    expect(hostMembers.length).toBeGreaterThan(0);
    expect([...NON_DATA_MEMBERS].sort()).toEqual([...hostMembers].sort());
    // And none of them is a field the Zod copy validates — skipping a
    // validated field would be exactly the weakening this list must not be.
    const validated = Object.keys(subAppManifestSchema.shape);
    expect(NON_DATA_MEMBERS.filter((m) => validated.includes(m))).toEqual([]);
  });
});

/** The member names of `export interface <name> ... { ... }`, read as text:
 * comments dropped, the body brace-matched, members split at depth-0 `;`.
 * Deliberately dumb, like `guardrails/src/host-source.ts` — and it throws
 * rather than returning an empty list, so a host rewrite that moves the
 * interface cannot pass as "no members". */
function interfaceMembers(source: string, name: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const head = new RegExp(`export\\s+interface\\s+${name}\\b[^{]*\\{`).exec(code);
  if (head === null) throw new Error(`no "export interface ${name}" in the host's types.ts`);
  const open = head.index + head[0].length - 1;
  let depth = 0;
  let close = -1;
  for (let i = open; i < code.length; i++) {
    if (code[i] === "{") depth++;
    else if (code[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) throw new Error(`interface ${name} is never closed`);
  const members: string[] = [];
  let level = 0;
  let current = "";
  const body = code.slice(open + 1, close);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i] ?? "";
    // `=>` is an arrow, not the end of a generic.
    if ("({[<".includes(ch)) level++;
    else if (")}]".includes(ch) || (ch === ">" && body[i - 1] !== "=")) level--;
    if (ch === ";" && level === 0) {
      members.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim() !== "") members.push(current);
  return members
    .map((m) => /^\s*(?:readonly\s+)?([A-Za-z_$][\w$]*)/.exec(m)?.[1])
    .filter((m): m is string => m !== undefined);
}

describe("the boot rules the host applies", () => {
  const base = {
    id: "demo-app",
    label: "Demo",
    version: "0.1.0",
    minHostVersion: "5.0.0",
    icon: "🧪",
    navSection: "Ops & insight",
    routePrefix: "/api/apps/demo-app",
    webModuleId: "demo-app",
    capabilities: [],
    visibleToRoles: ["admin"],
  };

  it("accepts a well-formed manifest", () => {
    expect(() => assertManifestWouldBoot(base)).not.toThrow();
  });

  it("refuses an empty visibleToRoles — the APP-03 zero-RBAC-coverage gap", () => {
    expect(() => assertManifestWouldBoot({ ...base, visibleToRoles: [] })).toThrow(/visibleToRoles/);
  });

  it("refuses a routePrefix with a sub-path", () => {
    expect(() => assertManifestWouldBoot({ ...base, routePrefix: "/api/apps/demo-app/v2" })).toThrow(/routePrefix/);
  });

  it("refuses a nav section the shell does not know", () => {
    expect(() => assertManifestWouldBoot({ ...base, navSection: "Mini apps" })).toThrow(/navSection/);
  });

  it("refuses an id the host's SUBAPP_ID_RE rejects", () => {
    expect(() => assertManifestWouldBoot({ ...base, id: "Demo_App" })).toThrow(/id/);
  });

  it("refuses a manifest asking for a newer host than this build", () => {
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "6.0.0" })).toThrow(/requires host >= 6\.0\.0/);
  });

  it("compares versions numerically, not lexically", () => {
    // "5.9.0" vs "5.10.0" is the case a string compare gets backwards.
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "5.9.0" }, "5.10.0")).not.toThrow();
    expect(() => assertManifestWouldBoot({ ...base, minHostVersion: "5.10.0" }, "5.9.0")).toThrow();
  });

  it("reports every violation at once, not just the first", () => {
    try {
      assertManifestWouldBoot({ ...base, id: "NOPE", visibleToRoles: [], icon: "" });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect((err as { issues: string[] }).issues.length).toBeGreaterThanOrEqual(3);
    }
  });

  it("tolerates the optional additive fields the host allows (widgets)", () => {
    expect(() => assertManifestWouldBoot({ ...base, widgets: [{ anything: true }] })).not.toThrow();
    expect(subAppManifestSchema.safeParse({ ...base, widgets: [] }).success).toBe(true);
  });
});
