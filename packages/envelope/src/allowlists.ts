/**
 * THE CLOSED LISTS. Everything an envelope is allowed to say, enumerated.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE IS THE CONTROL AND `classify()` IS NOT
 * ─────────────────────────────────────────────────────────────────────────
 * Three red-team rounds against `packages/guardrails` and `packages/pseudonym`
 * failed the same way, and the last one wrote the lesson out in full: five
 * nested `JSON.stringify` calls defeat `classify()` completely, and
 * `classify()` was the only scanner behind all four gates. That is not a bug
 * in `classify()` that a sixth unwrapping pass would fix. A scanner asked to
 * prove an ARBITRARY payload clean is unbounded by construction: the payload
 * can be spelled an unlimited number of ways, and the scanner has to lose
 * exactly once.
 *
 * The host had already solved it, in the opposite direction
 * (`flightdeck/server/services/ai/envelope.ts`). It does not scan a payload
 * and refuse. It CONSTRUCTS a request out of compiled-in lists:
 *
 *     AI_TASKS              a closed set of task ids
 *     VOCABULARIES          closed enums for values
 *     FIELD_NAME_ALLOWLIST  field NAMES that may be transmitted —
 *                           "tell the model WHICH field to look at without
 *                            telling it what is in the field"
 *     FACT_KEY_POLICY       per-key: which kind is allowed, and a max
 *     MAX_TEXT_CHARS / MAX_TEXT_FACTS / MAX_REQUEST_BYTES
 *
 * ⭐ THERE IS NO FREE-FORM PAYLOAD, SO THERE IS NOTHING TO NEST JSON INTO.
 * `JSON.stringify(JSON.stringify(...))` of a person's record is a string.
 * A string is expressible here in exactly three ways: as a member of a
 * compiled-in vocabulary, as a member of a compiled-in field-name list, or as
 * a bounded text fact that has already been through `packages/pseudonym` and
 * arrives with its coverage report (see `build.ts`, section D). A nested
 * stringify is none of those, so it is refused for the SAME reason an
 * ordinary unlisted string is refused — not because a scanner recognised it.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * HOST COPIES vs STUDIO ADDITIONS — the two halves are kept apart on purpose
 * ─────────────────────────────────────────────────────────────────────────
 * Every `HOST_*` list below is a TRANSCRIPTION of the host's file, held to it
 * by `__tests__/divergence.test.ts`, in both directions. The host says the
 * bargain out loud in its own gateway test
 * (`flightdeck/tests/aiProxyEdgeFunction.test.ts:12`):
 *
 *     "Two copies of a security list that can silently diverge is worse than
 *      one. These cases are the mechanism that makes the duplication safe —
 *      they FAIL on divergence, in either direction."
 *
 * Every `STUDIO_*` list is authored HERE, for work the host has no equivalent
 * of (a pasted Cowork workflow, a generated mini-app spec). It is excluded
 * from the divergence comparison BY CONSTRUCTION — a separate constant, not a
 * filter — because it is not a copy of anything. Editing a `HOST_*` entry
 * without the same edit in the host is not a fix; it is the divergence the
 * test exists to catch.
 *
 * ⛔ ADDING A KEY, A TASK, A VOCABULARY OR A FIELD NAME WIDENS WHAT MAY LEAVE
 * THIS PROCESS. It is a governance change, in the host's own words about its
 * own limits: "raising this is a governance change, not a tuning knob".
 */

import { DEFAULT_MODEL } from "../../providers/src/config";

// ─────────────────────────────────────────────────────────────────────────
// Kinds
// ─────────────────────────────────────────────────────────────────────────

/** The four shapes a fact may take. Transcribed from the host's `AiFact`.
 * NONE of them accepts a bare caller string: `enum` and `fieldName` take a
 * member of a compiled-in list, `count` takes a bounded non-negative integer,
 * and `text` is reachable only through the pseudonymised channel. */
export const FACT_KINDS = ["enum", "count", "fieldName", "text"] as const;
export type FactKind = (typeof FACT_KINDS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Limits — transcribed, and compared as NUMBERS by the divergence test
// ─────────────────────────────────────────────────────────────────────────

/** Transcribed from `envelope.ts`. "The point of `kind:"text"` is an
 * operator's typed question, and a limit is the difference between 'a prompt'
 * and 'a document channel'." */
export const MAX_TEXT_CHARS = 2000;
export const MAX_TEXT_FACTS = 2;
/** Transcribed from `envelope.ts`: 32 * 1024. */
export const MAX_REQUEST_BYTES = 32 * 1024;
/** Transcribed from `envelope.ts`. Default ceiling for a `count` whose key
 * declares none. */
export const MAX_COUNT = 10_000;

// ─────────────────────────────────────────────────────────────────────────
// Tasks
// ─────────────────────────────────────────────────────────────────────────

/** TRANSCRIBED from the host's `AI_TASKS`. */
export const HOST_AI_TASKS = ["map.suggest", "intake.fieldmap", "kb.question"] as const;

/**
 * STUDIO-AUTHORED. Every id is prefixed `studio.` so it can never collide
 * with a host id, and so a task id on the wire says which side minted it.
 *
 * Each one names work Studio actually does, and each is constrained by what
 * `FACT_KEY_POLICY` lets it carry rather than by its name:
 *
 *   studio.workflow.summarise  the pasted-Cowork-workflow path — the ONLY
 *                              task that has any business carrying a text
 *                              fact, and it still cannot auto-send one.
 *   studio.spec.draft          field NAMES plus counts, no values.
 *   studio.widget.suggest      a mini-app's STRUCTURE — widget kinds and
 *                              counts. The Studio analogue of the host's
 *                              `map.suggest`, and the same argument: process
 *                              design is not personal data.
 */
export const STUDIO_AI_TASKS = [
  "studio.workflow.summarise",
  "studio.spec.draft",
  "studio.widget.suggest",
] as const;

export const AI_TASKS: readonly string[] = [...HOST_AI_TASKS, ...STUDIO_AI_TASKS];
export type AiTaskId = (typeof HOST_AI_TASKS)[number] | (typeof STUDIO_AI_TASKS)[number];

// ─────────────────────────────────────────────────────────────────────────
// Vocabularies
// ─────────────────────────────────────────────────────────────────────────

/** TRANSCRIBED from the host's `VOCABULARIES`, entry for entry and member for
 * member. "Adding one whose members are derived from CONTRACT ROWS would
 * defeat the whole file, so don't." */
export const HOST_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  contractType: ["Permanent", "Fixed term"],
  country: ["DE"],
  lifecycleStage: ["input", "progress", "output"],
  confidence: ["explicit", "high", "guess", "none"],
  qcStatus: ["pending", "ready_for_qc", "approved", "flagged", "done"],
  nextAction: ["do", "wait_qc", "wait_human", "revise", "done"],
  wcRequired: ["yes", "no", "unknown"],
  mapNodeKind: ["start", "task", "gateway", "subprocess", "end", "unknown"],
  severity: ["info", "low", "medium", "high", "critical"],
};

/**
 * STUDIO-AUTHORED. Four closed enums drawn from THIS repo's own vocabulary —
 * the four data tiers, the three gate decisions, the kinds of file codegen
 * emits, and the phases of the Studio pipeline. Not one member of any of them
 * comes from a workflow, a record or a user.
 *
 * ⛔ The rule the host states applies here unchanged: a vocabulary whose
 * members are derived from DATA is not a vocabulary, it is a free-string
 * channel with a list around it.
 */
export const STUDIO_VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  dataTier: ["public", "internal", "confidential", "restricted"],
  gateDecision: ["allow", "refuse", "approval-required"],
  studioArtifactKind: ["component", "route", "test", "fixture", "migration", "doc"],
  studioPhase: ["intake", "spec", "codegen", "conformance", "registration"],
};

export const VOCABULARIES: Readonly<Record<string, readonly string[]>> = {
  ...HOST_VOCABULARIES,
  ...STUDIO_VOCABULARIES,
};

// ─────────────────────────────────────────────────────────────────────────
// Field names
// ─────────────────────────────────────────────────────────────────────────

/**
 * TRANSCRIBED from the host's `FIELD_NAME_ALLOWLIST`.
 *
 * ⚠ READ THE HOST'S COMMENT BEFORE BEING ALARMED BY `lastName` AND
 * `requesterEmail`. These are field NAMES, and the entire point of
 * `kind:"fieldName"` is to "tell the model WHICH field to look at without
 * telling it what is in the field". The string `"lastName"` is not a name;
 * it is the word a schema uses. A value can never arrive through this channel
 * because the value must be a member of THIS list.
 *
 * This is also why `packages/guardrails`' own field-name denylists are NOT
 * applied to the host half of this list: `lastName` is a tier-3 field name to
 * `nameHits()` and deliberately an allowlisted field name to the host. Both
 * are right about different things, and the host's judgement governs the
 * host's list. It governs Studio's copy too — see the divergence test.
 */
export const HOST_FIELD_NAME_ALLOWLIST: readonly string[] = [
  "reqNumber",
  "lastName",
  "firstName",
  "contractType",
  "country",
  "location",
  "requesterEmail",
  "startDate",
  "measure",
  "leitenderAngestellter",
  "internalPostingDate",
  "entity",
  "band",
  "site",
];

/**
 * STUDIO-AUTHORED. Structural names from Studio's own spec vocabulary — what
 * a mini-app spec calls its parts. None of them is an attribute OF A PERSON,
 * which is the property `__tests__/no-certificate.test.ts` asserts rather
 * than assumes: every entry here is run through `packages/guardrails`'
 * field-name denylists and must come back tier ≤ 2.
 */
export const STUDIO_FIELD_NAMES: readonly string[] = [
  "specId",
  "tableName",
  "columnName",
  "routePath",
  "widgetKind",
  "stepLabel",
  "ownerRole",
];

export const FIELD_NAME_ALLOWLIST: readonly string[] = [
  ...HOST_FIELD_NAME_ALLOWLIST,
  ...STUDIO_FIELD_NAMES,
];

// ─────────────────────────────────────────────────────────────────────────
// The key policy
// ─────────────────────────────────────────────────────────────────────────

export interface FactKeyPolicy {
  readonly kind: FactKind;
  readonly max?: number;
}

/**
 * TRANSCRIBED from the host's `FACT_KEY_POLICY`, which exists because a fact's
 * KEY was itself a free-text channel — "straight to (1) the wire, (2) the
 * append-only hash-chained audit event, (3) the refusal messages … and (4) the
 * edge function's 400 bodies" — and `salary_of_Jane_Doe_92000` "produces ZERO
 * findings under this module's own PII_PATTERNS".
 *
 * Binding key → kind → ceiling in ONE table is what makes a count
 * semantically pinned: "a ceiling alone cannot tell 4,200 documents from a
 * €4,200 monthly gross, but a ceiling attached to `gatewayCount` can."
 */
export const HOST_FACT_KEY_POLICY: Readonly<Record<string, FactKeyPolicy>> = {
  contractType: { kind: "enum" },
  country: { kind: "enum" },
  lifecycleStage: { kind: "enum" },
  confidence: { kind: "enum" },
  qcStatus: { kind: "enum" },
  nextAction: { kind: "enum" },
  wcRequired: { kind: "enum" },
  mapNodeKind: { kind: "enum" },
  severity: { kind: "enum" },
  field: { kind: "fieldName" },
  verifyField: { kind: "fieldName" },
  question: { kind: "text" },
  context: { kind: "text" },
  nodeCount: { kind: "count", max: 1000 },
  edgeCount: { kind: "count", max: 2000 },
  laneCount: { kind: "count", max: 100 },
  gatewayCount: { kind: "count", max: 500 },
  unlabelledCount: { kind: "count", max: 500 },
  fieldCount: { kind: "count", max: 100 },
  docCount: { kind: "count", max: MAX_COUNT },
  hitCount: { kind: "count", max: 100 },
};

/**
 * STUDIO-AUTHORED keys. The enum keys ARE the Studio vocabulary names, which
 * buys the same free invariant the host's do. The counts are pinned to what
 * Studio actually counts, with ceilings measured against this repo rather
 * than guessed: the largest package here is ~530 lines in one file, the
 * biggest spec in `fixtures/` is a handful of tables, and no mini-app Studio
 * has generated has had more than a dozen widgets.
 *
 * `workflow` is the ONE text key Studio adds, and it is the pasted Cowork
 * workflow — the case section D of `build.ts` exists for. A text key is not a
 * licence to send text: `buildEnvelope` admits a text fact only through the
 * pseudonymised channel, and never marks one ready to send.
 */
export const STUDIO_FACT_KEY_POLICY: Readonly<Record<string, FactKeyPolicy>> = {
  dataTier: { kind: "enum" },
  gateDecision: { kind: "enum" },
  studioArtifactKind: { kind: "enum" },
  studioPhase: { kind: "enum" },
  workflow: { kind: "text" },
  stepCount: { kind: "count", max: 500 },
  widgetCount: { kind: "count", max: 200 },
  artifactCount: { kind: "count", max: 500 },
  findingCount: { kind: "count", max: 1000 },
};

export const FACT_KEY_POLICY: Readonly<Record<string, FactKeyPolicy>> = {
  ...HOST_FACT_KEY_POLICY,
  ...STUDIO_FACT_KEY_POLICY,
};

/** Sorted key list. The whole of what may appear as a fact key. */
export const FACT_KEY_ALLOWLIST: readonly string[] = Object.keys(FACT_KEY_POLICY).sort();

/**
 * OWN-PROPERTY LOOKUP, and the host's reason for it verbatim: "a bare
 * `FACT_KEY_POLICY[key]` walks the prototype chain", so a key that merely
 * NAMES an `Object.prototype` member — `__proto__`, `toString`,
 * `constructor`, `valueOf`, `hasOwnProperty` — "resolved to a TRUTHY object
 * that is not a policy at all". `JSON.parse` creates a real own `__proto__`
 * data property, and JSON is how a request body arrives.
 */
export function factKeyPolicy(key: string): FactKeyPolicy | undefined {
  return Object.hasOwn(FACT_KEY_POLICY, key) ? FACT_KEY_POLICY[key] : undefined;
}

/** Same reason. `VOCABULARIES["__proto__"]` is truthy. */
export function vocabulary(name: string): readonly string[] | undefined {
  return Object.hasOwn(VOCABULARIES, name) ? VOCABULARIES[name] : undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// Provider and model
// ─────────────────────────────────────────────────────────────────────────

/**
 * The compiled-in provider → model lists, Studio's equivalent of the host's
 * `isSelectableProvider` / `isKnownModel`. Headers are validated against this
 * and therefore cannot carry caller data — which is what lets the residual
 * scan cover `facts` alone, exactly as the host's does. See `serialize()`.
 *
 * `DEFAULT_MODEL` is imported rather than copied: `packages/providers` owns
 * the model id, and the one thing worse than a second list is a second list
 * of the same thing in the same repo.
 */
export const PROVIDER_MODELS: Readonly<Record<string, readonly string[]>> = {
  anthropic: [DEFAULT_MODEL],
  fake: ["fake"],
};

export function isSelectableProvider(id: string): boolean {
  return Object.hasOwn(PROVIDER_MODELS, id);
}

export function isKnownModel(providerId: string, modelId: string): boolean {
  const models = Object.hasOwn(PROVIDER_MODELS, providerId) ? PROVIDER_MODELS[providerId] : undefined;
  return models !== undefined && models.includes(modelId);
}

// ─────────────────────────────────────────────────────────────────────────
// Load-time coherence — the tables must agree with each other
// ─────────────────────────────────────────────────────────────────────────

/**
 * ⚠ THESE RUN AT IMPORT AND THROW. A table that disagrees with itself is not a
 * condition to handle at request time; it is a build that should not start.
 * `packages/pseudonym/src/tags.ts` takes the same position for the same
 * reason.
 *
 * NOTE what is deliberately NOT asserted: that a fact's key equals the
 * vocabulary it declares. The host tried that and REMOVED it, because it made
 * the "unknown vocabulary" branch unreachable through any legal key — "a real
 * defensive check turned into dead, untestable code". This check is over the
 * COMPILED-IN TABLES only and blinds no runtime branch: `fact.vocabulary` is
 * caller data and is still checked against `VOCABULARIES` on every request.
 */
function assertTablesCohere(): void {
  for (const key of Object.keys(STUDIO_FACT_KEY_POLICY)) {
    if (Object.hasOwn(HOST_FACT_KEY_POLICY, key)) {
      throw new Error(`envelope: Studio fact key "${key}" shadows a host key — one of them would silently win`);
    }
  }
  for (const name of Object.keys(STUDIO_VOCABULARIES)) {
    if (Object.hasOwn(HOST_VOCABULARIES, name)) {
      throw new Error(`envelope: Studio vocabulary "${name}" shadows a host vocabulary`);
    }
  }
  for (const [key, policy] of Object.entries(FACT_KEY_POLICY)) {
    if (policy.kind === "enum" && vocabulary(key) === undefined) {
      throw new Error(`envelope: enum key "${key}" names no vocabulary`);
    }
    if (policy.kind === "count" && policy.max !== undefined && policy.max > MAX_COUNT) {
      throw new Error(`envelope: count key "${key}" has a ceiling above MAX_COUNT`);
    }
    if (policy.kind !== "count" && policy.max !== undefined) {
      throw new Error(`envelope: key "${key}" declares a max but is not a count`);
    }
  }
  for (const [name, members] of Object.entries(VOCABULARIES)) {
    if (members.length === 0) throw new Error(`envelope: vocabulary "${name}" is empty`);
  }
  if (FIELD_NAME_ALLOWLIST.length !== new Set(FIELD_NAME_ALLOWLIST).size) {
    throw new Error("envelope: FIELD_NAME_ALLOWLIST has a duplicate");
  }
  if (AI_TASKS.length !== new Set(AI_TASKS).size) {
    throw new Error("envelope: AI_TASKS has a duplicate");
  }
}

assertTablesCohere();
