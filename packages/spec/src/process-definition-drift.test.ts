/**
 * `studio-workflow-definition/1` against the body the OS Workflow Builder actually validates.
 *
 * Studio's schema is a TRANSCRIPTION of `definitionBody` in the host's
 * `flightdeck/server/routes/workflows.ts` (plus two Studio-only keys: `schema` and
 * `statutoryConfirmedBy`). A transcription drifts silently: the host adds an intake-field
 * type, tightens the slug, renames a key — and Studio goes on writing files the OS import
 * refuses, or, worse, never learns a rule the Builder now enforces. So this reads the host's
 * source text (same deliberately dumb parsing as `@guardrails/host-source`, no import: the
 * host file pulls in fastify, the db and a dozen siblings) and compares, in both directions:
 * field names (top level and intake field), each field's value type, whether it is optional
 * or nullable, the intake-field type enum, the slug regex and its flags, the first/last step
 * rule and every `.min`/`.max` bound.
 *
 * Studio is deliberately different in exactly three places, each listed below
 * (`STUDIO_TIGHTENED` / `STUDIO_NULLABLE`) and reported if it stops being a difference: `steps`
 * and `statutorySteps` are required (the host defaults them), and `by` may be null in a draft.
 * Any other optionality difference is drift — in particular a field the host requires is never
 * optional in Studio.
 *
 * RULE VOCABULARY. Everything else a Zod body can say — a new `.email()`, `.regex()` on step
 * names, a new `ctx.addIssue` rule in the `superRefine` — is not interpreted; it is PINNED.
 * `HOST_RULE_VOCABULARY` is the count of every `.method(` call in the whole `definitionBody`
 * statement; any change fails the test and makes a human transcribe the new rule into
 * Studio's schema (or record why Studio need not carry it) and re-pin.
 *
 * WHAT THIS CANNOT SEE: what a refine/superRefine predicate MEANS (the pin sees that one was
 * added or removed, not that `s[0] === "intake_received"`'s neighbour changed its logic),
 * error messages, the values of the host's `DEFAULT_STEPS`, anything outside `definitionBody`
 * (the manifest self-check, the route's RBAC), and a Builder body moved out of `workflows.ts`
 * (that fails loudly rather than passing).
 *
 * NON-VACUITY. A reader that finds nothing compares equal to nothing. The host body has 8
 * fields today; the parse must find at least 8, and a planted divergence must be caught.
 *
 * ABSENCE IS A FAILURE, not a skip, unless a human says otherwise with the exact
 * acknowledgement `@guardrails/host-source` defines — a skipped drift test behind exit 0 is
 * the control that reports green because it never ran.
 */

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  HOST_ABSENCE_ACK_ENV,
  HOST_ABSENCE_ACK_VALUE,
  HOST_ROOT,
  readRegexLiteral,
  stripCommentLines,
} from "../../guardrails/src/host-source";
import {
  STUDIO_ONLY_KEYS,
  WORKFLOW_FIRST_STEP,
  WORKFLOW_INTAKE_FIELD_TYPES,
  WORKFLOW_LAST_STEP,
  WORKFLOW_SLUG_PATTERN,
  workflowDefinitionSchema,
} from "./process-definition";

const HOST_WORKFLOWS = path.join(HOST_ROOT, "flightdeck", "server", "routes", "workflows.ts");
const present = fs.existsSync(HOST_WORKFLOWS);
const acknowledged = process.env[HOST_ABSENCE_ACK_ENV] === HOST_ABSENCE_ACK_VALUE;

// ─────────────────────────────────────────────────────────────────────────
// Reading the host's `definitionBody` as text
// ─────────────────────────────────────────────────────────────────────────

/** Index of the bracket that closes the one at `open`, skipping string literals. */
function closeOf(code: string, open: number): number {
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch) && --depth === 0) return i;
  }
  throw new Error(`unbalanced bracket at offset ${open}`);
}

/** `key: expr` members of an object-literal body, split at depth-0 commas. */
function members(body: string): Map<string, string> {
  const out = new Map<string, string>();
  let depth = 0;
  let start = 0;
  const take = (member: string) => {
    const m = /^\s*([A-Za-z_$][\w$]*)\s*:([\s\S]*)$/.exec(member);
    if (m?.[1] !== undefined && m[2] !== undefined) out.set(m[1], m[2].trim());
  };
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < body.length && body[j] !== ch) j += body[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === "," && depth === 0) {
      take(body.slice(start, i));
      start = i + 1;
    }
  }
  take(body.slice(start));
  return out;
}

/** The members of the first `z.object({ ... })` at or after `from`. */
function zodObjectAt(code: string, from: number): Map<string, string> {
  const head = /z\s*\.\s*object\(\s*\{/g;
  head.lastIndex = from;
  const m = head.exec(code);
  if (m === null) throw new Error("no z.object({ found");
  const open = m.index + m[0].length - 1;
  return members(code.slice(open + 1, closeOf(code, open)));
}

/** The expression with every bracket's contents removed: the depth-0 call chain only, so an
 * `.optional()` inside a nested `z.object` does not count for the array that holds it. */
function chainOf(expr: string): string {
  let out = "";
  let depth = 0;
  for (let i = 0; i < expr.length; i += 1) {
    const ch = expr[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== ch) j += expr[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if ("([{".includes(ch)) {
      if (depth === 0) out += ch;
      depth += 1;
    } else if (")]}".includes(ch)) {
      depth -= 1;
      if (depth === 0) out += ch;
    } else if (depth === 0) out += ch;
  }
  return out.replace(/\s+/g, "");
}

interface Modifiers {
  optional: boolean;
  nullable: boolean;
}

function hostModifiers(expr: string): Modifiers {
  const chain = chainOf(expr);
  return { optional: /\.(optional|default|nullish)\(/.test(chain), nullable: /\.(nullable|nullish)\(/.test(chain) };
}

/** `z.string()...` → "string"; `z.array(z.object(...))` → "array<object>". */
function hostType(expr: string): string {
  const m = /^\s*z\s*\.\s*([A-Za-z]+)\s*\(/.exec(expr);
  if (m?.[1] === undefined) throw new Error(`cannot read the value type of: ${expr.slice(0, 60)}`);
  if (m[1] !== "array") return m[1];
  const open = m.index + m[0].length - 1;
  return `array<${hostType(expr.slice(open + 1, closeOf(expr, open)))}>`;
}

/** Index just past the `;` that ends the statement starting at `from` (depth 0, strings skipped). */
function statementEnd(code: string, from: number): number {
  let depth = 0;
  for (let i = from; i < code.length; i += 1) {
    const ch = code[i] ?? "";
    if (ch === '"' || ch === "'" || ch === "`") {
      let j = i + 1;
      while (j < code.length && code[j] !== ch) j += code[j] === "\\" ? 2 : 1;
      i = j;
      continue;
    }
    if ("([{".includes(ch)) depth += 1;
    else if (")]}".includes(ch)) depth -= 1;
    else if (ch === ";" && depth === 0) return i + 1;
  }
  throw new Error(`no end of statement after offset ${from}`);
}

/** Every `.method(` call in a text, as sorted `method×count` tokens. */
function ruleVocabulary(text: string): string[] {
  const counts = new Map<string, number>();
  for (const m of text.matchAll(/\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) counts.set(m[1] ?? "", (counts.get(m[1] ?? "") ?? 0) + 1);
  return [...counts].map(([k, n]) => `${k}×${n}`).sort();
}

/**
 * The host `definitionBody`'s rule vocabulary as transcribed into Studio's schema on
 * 2026-09-24. A change here means the host's rules changed: transcribe them into
 * `process-definition.ts` first, THEN re-pin from the failure message.
 */
const HOST_RULE_VOCABULARY: readonly string[] = [
  "addIssue×1", // statutory step not in steps — Studio: the same rule
  "array×3",
  "at×1", // last step 'complete' — Studio: WORKFLOW_LAST_STEP
  "boolean×1",
  "default×2", // steps, statutorySteps — Studio REQUIRES both (STUDIO_TIGHTENED)
  "enum×1",
  "includes×1",
  "max×4",
  "min×7",
  "object×2",
  "optional×2", // entity, intakeFields.source
  "refine×2", // first/last step
  "regex×1", // slug
  "string×9",
  "superRefine×1",
];

/** Host-optional (defaulted) fields Studio deliberately REQUIRES: a Studio file states them. */
const STUDIO_TIGHTENED = ["statutorySteps", "steps"] as const;
/** Host-required fields Studio deliberately lets be null in a draft; the OS import sets them. */
const STUDIO_NULLABLE = ["by"] as const;

/** Every `.min(N` / `.max(N` in an expression, as sorted `min:N` tokens. */
function hostBounds(expr: string): string[] {
  return [...expr.matchAll(/\.(min|max)\(\s*(\d+)/g)].map((m) => `${m[1]}:${m[2]}`).sort();
}

interface DefinitionShape {
  keys: string[];
  intakeKeys: string[];
  types: string[];
  slug: string;
  slugFlags: string;
  first: string;
  last: string;
  bounds: Record<string, string[]>;
  /** Top-level keys and `intakeFields.<member>` keys. */
  valueTypes: Record<string, string>;
  modifiers: Record<string, Modifiers>;
  vocabulary: string[];
}

function hostShape(source: string): DefinitionShape {
  const code = stripCommentLines(source);
  const at = /const\s+definitionBody\s*=\s*z\s*\.\s*object\(/.exec(code);
  if (at === null) throw new Error(`no "const definitionBody = z.object(" in ${HOST_WORKFLOWS} — the host moved or renamed the Builder body`);
  const top = zodObjectAt(code, at.index);

  const intakeExpr = top.get("intakeFields");
  if (intakeExpr === undefined) throw new Error("definitionBody has no intakeFields");
  const intake = zodObjectAt(intakeExpr, 0);

  const typeExpr = intake.get("type") ?? "";
  const enumAt = /z\s*\.\s*enum\(\s*\[/.exec(typeExpr);
  if (enumAt === null) throw new Error("intakeFields.type is not a z.enum([...])");
  const enumOpen = enumAt.index + enumAt[0].length - 1;
  const types = [...typeExpr.slice(enumOpen, closeOf(typeExpr, enumOpen)).matchAll(/["']([^"']+)["']/g)].map((m) => m[1] ?? "");

  const slugExpr = top.get("slug") ?? "";
  const regexAt = slugExpr.indexOf(".regex(");
  if (regexAt < 0) throw new Error("slug has no .regex(");
  const slugRegex = readRegexLiteral(slugExpr, slugExpr.indexOf("/", regexAt));

  const stepsExpr = top.get("steps") ?? "";
  const first = /\[\s*0\s*\]\s*===\s*["']([^"']+)["']/.exec(stepsExpr)?.[1];
  const last = /\.at\(\s*-1\s*\)\s*===\s*["']([^"']+)["']/.exec(stepsExpr)?.[1];
  if (first === undefined || last === undefined) throw new Error("steps carries no first/last-step refine the reader recognises");

  const all: Array<[string, string]> = [...top, ...[...intake].map(([k, e]): [string, string] => [`intakeFields.${k}`, e])];

  return {
    keys: [...top.keys()].sort(),
    intakeKeys: [...intake.keys()].sort(),
    types: [...types].sort(),
    slug: slugRegex.source,
    slugFlags: slugRegex.flags,
    first,
    last,
    bounds: Object.fromEntries([...top].map(([k, expr]) => [k, hostBounds(expr)])),
    valueTypes: Object.fromEntries(all.map(([k, e]) => [k, hostType(e)])),
    modifiers: Object.fromEntries(all.map(([k, e]) => [k, hostModifiers(e)])),
    vocabulary: ruleVocabulary(code.slice(at.index, statementEnd(code, at.index))),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// The same shape, read off Studio's Zod schema
// ─────────────────────────────────────────────────────────────────────────

/** Zod v3 introspection: every string/array min/max under a type, as `min:N` tokens. */
function studioBounds(t: z.ZodTypeAny): string[] {
  const d = t._def as Record<string, unknown> & { typeName: string };
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return studioBounds(d["innerType"] as z.ZodTypeAny);
    case "ZodEffects":
      return studioBounds(d["schema"] as z.ZodTypeAny);
    case "ZodString":
      return (d["checks"] as Array<{ kind: string; value?: number }>)
        .filter((c) => c.kind === "min" || c.kind === "max")
        .map((c) => `${c.kind}:${c.value}`);
    case "ZodArray": {
      const own = (["minLength", "maxLength"] as const).flatMap((k) => {
        const v = d[k] as { value: number } | null;
        return v === null ? [] : [`${k === "minLength" ? "min" : "max"}:${v.value}`];
      });
      return [...own, ...studioBounds(d["type"] as z.ZodTypeAny)];
    }
    case "ZodObject":
      return Object.values((t as z.AnyZodObject).shape as Record<string, z.ZodTypeAny>).flatMap(studioBounds);
    default:
      return [];
  }
}

/** Zod v3 introspection: the value type under the wrappers, spelled as `hostType` spells it. */
function studioType(t: z.ZodTypeAny): string {
  const d = t._def as Record<string, unknown> & { typeName: string };
  switch (d.typeName) {
    case "ZodOptional":
    case "ZodNullable":
    case "ZodDefault":
      return studioType(d["innerType"] as z.ZodTypeAny);
    case "ZodEffects":
      return studioType(d["schema"] as z.ZodTypeAny);
    case "ZodArray":
      return `array<${studioType(d["type"] as z.ZodTypeAny)}>`;
    default:
      return d.typeName.replace(/^Zod/, "").toLowerCase();
  }
}

function unwrapObject(t: z.ZodTypeAny): z.AnyZodObject {
  let cur = t;
  for (;;) {
    const d = cur._def as Record<string, unknown> & { typeName: string };
    if (d.typeName === "ZodObject") return cur as z.AnyZodObject;
    if (d.typeName === "ZodEffects") cur = d["schema"] as z.ZodTypeAny;
    else if (d.typeName === "ZodArray") cur = d["type"] as z.ZodTypeAny;
    else if ("innerType" in d) cur = d["innerType"] as z.ZodTypeAny;
    else throw new Error(`cannot unwrap ${d.typeName} to an object`);
  }
}

function studioShape(): DefinitionShape {
  const shape = unwrapObject(workflowDefinitionSchema).shape as Record<string, z.ZodTypeAny>;
  const mirrored = Object.entries(shape).filter(([k]) => !(STUDIO_ONLY_KEYS as readonly string[]).includes(k));
  const intake = shape["intakeFields"];
  if (intake === undefined) throw new Error("Studio schema has no intakeFields");
  const intakeShape = unwrapObject(intake).shape as Record<string, z.ZodTypeAny>;
  const all: Array<[string, z.ZodTypeAny]> = [
    ...mirrored,
    ...Object.entries(intakeShape).map(([k, t]): [string, z.ZodTypeAny] => [`intakeFields.${k}`, t]),
  ];
  return {
    keys: mirrored.map(([k]) => k).sort(),
    intakeKeys: Object.keys(intakeShape).sort(),
    types: [...WORKFLOW_INTAKE_FIELD_TYPES].sort(),
    slug: WORKFLOW_SLUG_PATTERN.source,
    slugFlags: WORKFLOW_SLUG_PATTERN.flags,
    first: WORKFLOW_FIRST_STEP,
    last: WORKFLOW_LAST_STEP,
    bounds: Object.fromEntries(mirrored.map(([k, t]) => [k, studioBounds(t).sort()])),
    valueTypes: Object.fromEntries(all.map(([k, t]) => [k, studioType(t)])),
    modifiers: Object.fromEntries(all.map(([k, t]) => [k, { optional: t.isOptional(), nullable: t.isNullable() }])),
    vocabulary: [...HOST_RULE_VOCABULARY],
  };
}

/** Both directions, named. Empty = in step. */
function divergences(host: DefinitionShape, studio: DefinitionShape): string[] {
  const out: string[] = [];
  const both = (label: string, h: readonly string[], s: readonly string[]) => {
    const onlyHost = h.filter((x) => !s.includes(x));
    const onlyStudio = s.filter((x) => !h.includes(x));
    if (onlyHost.length) out.push(`${label}: HOST HAS, STUDIO DOES NOT: ${onlyHost.join(", ")}`);
    if (onlyStudio.length) out.push(`${label}: STUDIO HAS, HOST DOES NOT: ${onlyStudio.join(", ")}`);
  };
  both("fields", host.keys, studio.keys);
  both("intakeFields members", host.intakeKeys, studio.intakeKeys);
  both("intakeFields.type enum", host.types, studio.types);
  if (host.slug !== studio.slug) out.push(`slug regex: host /${host.slug}/, Studio /${studio.slug}/`);
  if (host.slugFlags !== studio.slugFlags) out.push(`slug regex flags: host '${host.slugFlags}', Studio '${studio.slugFlags}'`);
  if (host.first !== studio.first) out.push(`first step: host '${host.first}', Studio '${studio.first}'`);
  if (host.last !== studio.last) out.push(`last step: host '${host.last}', Studio '${studio.last}'`);
  for (const key of host.keys) {
    const h = (host.bounds[key] ?? []).join(" ");
    const s = (studio.bounds[key] ?? []).join(" ");
    if (studio.keys.includes(key) && h !== s) out.push(`bounds of ${key}: host [${h}], Studio [${s}]`);
  }
  const req = (o: boolean) => (o ? "optional" : "required");
  for (const [key, h] of Object.entries(host.modifiers)) {
    const s = studio.modifiers[key];
    if (s === undefined) continue; // a missing key is already reported above
    if (host.valueTypes[key] !== studio.valueTypes[key]) {
      out.push(`type of ${key}: host ${host.valueTypes[key]}, Studio ${studio.valueTypes[key]}`);
    }
    const tightened = (STUDIO_TIGHTENED as readonly string[]).includes(key);
    if (tightened ? !(h.optional && !s.optional) : h.optional !== s.optional) {
      out.push(
        `optionality of ${key}: host ${req(h.optional)}, Studio ${req(s.optional)}` +
          (tightened ? " (listed in STUDIO_TIGHTENED as host-optional, Studio-required — the list is stale or Studio drifted)" : ""),
      );
    }
    const loosened = (STUDIO_NULLABLE as readonly string[]).includes(key);
    if (loosened ? !(!h.nullable && s.nullable) : h.nullable !== s.nullable) {
      out.push(
        `nullability of ${key}: host ${h.nullable ? "nullable" : "not nullable"}, Studio ${s.nullable ? "nullable" : "not nullable"}` +
          (loosened ? " (listed in STUDIO_NULLABLE — the list is stale or Studio drifted)" : ""),
      );
    }
  }
  const hv = host.vocabulary.join(" ");
  const sv = studio.vocabulary.join(" ");
  if (hv !== sv) {
    out.push(
      `rule vocabulary of definitionBody changed — a host rule was added, removed or changed. Transcribe it into ` +
        `process-definition.ts, then re-pin HOST_RULE_VOCABULARY to: ${JSON.stringify(host.vocabulary)} (was ${JSON.stringify(studio.vocabulary)})`,
    );
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────

describe("the host's Workflow Builder source, or an acknowledged absence", () => {
  const reason =
    `HOST WORKFLOW BUILDER NOT READABLE at ${HOST_WORKFLOWS} — cannot verify studio-workflow-definition/1 against it. ` +
    `Set FLIGHTDECK_HOST_ROOT to the project-contract checkout, or, to run KNOWINGLY UNVERIFIED, set ` +
    `${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE}.`;
  const title = present
    ? `host present at ${HOST_ROOT}`
    : acknowledged
      ? `host ABSENT and acknowledged (${HOST_ABSENCE_ACK_ENV}=${HOST_ABSENCE_ACK_VALUE}) — the workflow definition schema is UNVERIFIED`
      : "host ABSENT and not acknowledged — FAILING";

  it(title, () => {
    if (!present && !acknowledged) expect.fail(reason);
  });
});

describe.skipIf(!present)("studio-workflow-definition/1 mirrors the host's definitionBody", () => {
  const source = present ? fs.readFileSync(HOST_WORKFLOWS, "utf8") : "";

  it("finds at least 8 host fields (non-vacuity) and every one of the Builder's rules the reader looks for", () => {
    const host = hostShape(source);
    expect(host.keys.length).toBeGreaterThanOrEqual(8);
    expect(host.intakeKeys.length).toBeGreaterThanOrEqual(3);
    expect(host.types.length).toBeGreaterThanOrEqual(5);
    expect(host.slug.length).toBeGreaterThan(0);
  });

  it("⭐ agrees with the host on field names, value types, optionality, the type enum, the slug regex and flags, the first/last rule, every bound and the pinned rule vocabulary", () => {
    const found = divergences(hostShape(source), studioShape());
    expect(
      found,
      `studio-workflow-definition/1 has DIVERGED from ${HOST_WORKFLOWS}:\n  ${found.join("\n  ")}\n` +
        "Update packages/spec/src/process-definition.ts (and the golden fixture) to the host's body.",
    ).toEqual([]);
  });

  it("the comparator bites: a host that gains an intake type, a field and a looser slug is reported", () => {
    const mutated = source
      .replace(`"boolean", "enum"]`, `"boolean", "enum", "file"]`)
      .replace("by: z.string()", "owner: z.string().optional(),\n  by: z.string()")
      .replace("{3,40}", "{2,40}");
    expect(mutated).not.toBe(source);
    const found = divergences(hostShape(mutated), studioShape()).join("\n");
    expect(found).toMatch(/intakeFields\.type enum: HOST HAS, STUDIO DOES NOT: file/);
    expect(found).toMatch(/fields: HOST HAS, STUDIO DOES NOT: owner/);
    expect(found).toMatch(/slug regex/);
  });

  // Each case is one host edit the name/enum/bound comparison alone would miss.
  it.each([
    ["a field the host now REQUIRES (entity loses .optional())", "entity: z.string().max(80).optional()", "entity: z.string().max(80)", /optionality of entity: host required, Studio optional/],
    ["an intake member the host now requires (source loses .optional())", "source: z.string().max(80).optional()", "source: z.string().max(80)", /optionality of intakeFields\.source: host required, Studio optional/],
    ["a value-type change (required: boolean → string)", "required: z.boolean()", "required: z.string()", /type of intakeFields\.required: host string, Studio boolean/],
    ["a slug regex flag", "{3,40}$/,", "{3,40}$/i,", /slug regex flags: host 'i', Studio ''/],
    ["a new check on by (.email())", `by: z.string().min(1, "named human required")`, `by: z.string().email().min(1, "named human required")`, /rule vocabulary/],
    ["a new check on step names (.regex())", ".array(z.string().min(2))", ".array(z.string().min(2).regex(/^[a-z_]+$/))", /rule vocabulary/],
    ["a new superRefine rule", "}).superRefine((d, ctx) => {", `}).superRefine((d, ctx) => {\n  if (new Set(d.intakeFields.map((f) => f.name)).size !== d.intakeFields.length) ctx.addIssue({ code: "custom", path: ["intakeFields"], message: "duplicate" });`, /rule vocabulary/],
  ] as const)("the comparator bites: %s", (_label, from, to, expected) => {
    const mutated = source.replace(from, to);
    expect(mutated, `the planted edit did not apply — the host text moved: ${from}`).not.toBe(source);
    expect(divergences(hostShape(mutated), studioShape()).join("\n")).toMatch(expected);
  });
});
