/**
 * `planFromWorkflow` - one Cowork workflow in, one outcome out.
 *
 * The sibling of `planFromPrompt`, and deliberately not the same shape underneath: there is no
 * model here. A workflow already names its own steps, so converting one is a reading of a
 * document, not an act of authorship, and every decision below is a pure function of the
 * markdown plus the answers a person has given. That is what makes the refusal at the bottom
 * of this file worth anything - it cannot be talked out of.
 *
 * What comes out is a **database-free** `MiniAppSpec`: `tables` is always `[]`, and the schema
 * refuses a spec that has steps and tables at once. The floor being generated to is
 * `shell-reference` - `manifest.ts`, `routes.ts`, `web/src/subapps/<id>/index.tsx`, an
 * `initSchema` that does nothing. Table support is a different product; a converted workflow
 * does not get one, and a workflow that asks for one does not get one either.
 *
 * The rules that are not negotiable, in the order they run:
 *
 *  1. **Refuse an auto-advance.** A step that would advance, approve or resolve a gated or
 *     statutory step by itself is refused outright (contract §5.7). Not narrowed, not asked
 *     about - refused, naming the sentence. A generated mini app must never be the thing that
 *     closes a works-council clock.
 *  2. **Propose, don't mutate.** A step that would write host state is narrowed to a proposal
 *     and the narrowing is reported. Studio-as-a-sub-app can only ever write one thing, an
 *     inbox proposal, so a mini app it generates can only ever write that either.
 *  3. **Least privilege.** Capabilities are the union of what the steps actually do, grounded
 *     in the workflow's own sentences. A workflow whose steps only display things gets `[]`.
 *  4. **Ask, never guess.** `navSection` is an exact-match join key against five host literals
 *     (contract §2) and no workflow carries it, so it is always asked. Roles and the icon are
 *     asked unless the document really says.
 */

import {
  CONTRACT_RULES,
  HOST_VERSION,
  ROLES,
  SUBAPP_ID_PATTERN,
  derivationsFor,
  isRole,
  normalizeNavSection,
} from "./vocabulary";
import type { Capability, NavSection, Role } from "./vocabulary";
import { isLikelyEmoji, normalizeForMatch, quoteIsGrounded, slugify, truncate } from "./text";
import { iconSchema, labelSchema, miniAppSpecSchema, formatIssues } from "./schema";
import type { MiniAppSpec, SpecRoute, SpecStep } from "./schema";
import { draftSchema } from "./draft";
import type { PlannerDraft } from "./draft";
import { readConsentAnswers } from "./gates";
import { DEFAULT_APP_VERSION } from "./gates";
import {
  capabilityConsentQuestion,
  idCollisionQuestion,
  missingFieldQuestion,
  navSectionQuestion,
  orderQuestions,
  rolesQuestion,
  stepsSectionQuestion,
} from "./questions";
import type { ClarifyingQuestion } from "./questions";
import type { PlanOutcome, PlanWarning, WarningCode } from "./outcome";
import { parseWorkflowMarkdown } from "./workflow";
import type { WorkflowDoc, WorkflowStep } from "./workflow";

export interface WorkflowPlanInput {
  /**
   * The workflow's markdown, as posted. Not a path: a sub-app route reaches the host only
   * through the injected capability adapter, which has no filesystem read, so Studio cannot
   * open a skill file even if it wanted to (contract §5.3).
   */
  readonly workflow: string;
  /** Answers to questions from an earlier `needs_input`, keyed by question id. */
  readonly answers?: Readonly<Record<string, string>>;
  readonly existingSubAppIds?: readonly string[];
  readonly hostVersion?: string;
  readonly appVersion?: string;
}

/* ------------------------------------------------------------------------------------------
 * Reading a step
 *
 * Every cue below is a pair: a verb and the thing it acts on, matched inside one sentence. A
 * verb on its own is not evidence of anything - "check" in "check the box" is not a contract
 * read - and a lone noun is not either. Anything that matches nothing stays `display`, which
 * is the narrowest possible reading and costs no capability.
 * ---------------------------------------------------------------------------------------- */

const READ_VERB =
  /\b(reads?|loads?|lists?|pulls?|fetch(?:es)?|inspects?|reconciles?|compares?|checks?|reviews?|validates?|confirms?|surfaces?)\b/i;
/**
 * Deliberately narrow: the scope is `read:contracts`, so the object has to be a contract
 * record. "list the four mandatory clauses" is a page reading its own text out loud, not a
 * host read, and it must not buy a scope. Under-declaring only makes the app do less;
 * over-declaring puts a line on the consent screen nobody asked for (contract §5.9).
 */
const READ_OBJECT = /\b(contracts?|manifest|folders?|records?|artifacts?|tickets?)\b/i;

const PROPOSE_VERB =
  /\b(proposes?|proposals?|files?|flags?|raises?|submits?|requests?|notif(?:y|ies)|pings?|drafts?|sends?|posts?|delivers?|escalates?|routes?)\b/i;
const PROPOSE_OBJECT =
  /\b(reviewers?|reviews?|approvals?|approve|humans?|inbox|proposals?|teams|outlook|cards?|channel|hand-?offs?|digests?|reports?|liaison|legal)\b/i;

/** A step that would change host state. Narrowed to a proposal, never performed. */
const STATE_WRITE_VERB = /\b(writes?|updates?|records?|appends?|stores?|persists?|saves?|sets?|marks?)\b/i;
const STATE_OBJECT =
  /\b(state|manifest|memory|audit|status|entry|entries|transitions?|rows?|tables?|database|db)\b/i;

/** A step a person decides. The page shows it and stops there. */
const GATED_CUE =
  /\b(gates?|gated|statutory|works[- ]council|approvals?|approve[ds]?|approver|sign-?off|wet-?ink|human review|authenticated human|review policy|hand-?offs?)\b/i;

/**
 * The refusal. An autonomy marker AND a gated action in the same sentence, with nothing
 * forbidding it - that is a mini app being asked to close a gate by itself.
 */
const AUTONOMY_MARKER =
  /\b(automatic(?:ally)?|auto-?(?:advanc\w+|approv\w+|resolv\w+|complet\w+|finali[sz]\w+|sign\w*)|self-?approv\w*|unattended|without (?:a |any )?human(?: review)?|without (?:human )?review|no human|on its own|skip(?:s|ping)? (?:the )?review)\b/i;
const GATED_ACTION =
  /\b(advanc\w+|approv\w+|resolv\w+|finali[sz]\w+|sign-?off|issues?|releases?|graduates?|statutory|works[- ]council|wet-?ink|gates?)\b/i;
/**
 * Only markers that forbid the action, never a bare "not" - a sentence reading "approve
 * automatically when the reviewer has not replied" must still be refused.
 */
const PROHIBITION =
  /\bnever\b|\bmust not\b|\bmay not\b|\bcannot\b|\bcan'?t\b|\bdoes not\b|\bdo not\b|\bdon'?t\b|\bnot allowed\b|\bnot permitted\b|\bforbidden\b|\bprohibit\w*|\breject\w*|\brefus\w*|\bnon-statutory\b|\bonly (?:an? )?(?:authenticated )?humans?\b/i;

function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence !== "");
}

const matchesPair = (text: string, verb: RegExp, object: RegExp): boolean =>
  sentences(text).some((sentence) => verb.test(sentence) && object.test(sentence));

/** The first sentence that triggered a cue - the quote a capability is justified by. */
function evidenceSentence(text: string, verb: RegExp, object: RegExp): string | null {
  return sentences(text).find((sentence) => verb.test(sentence) && object.test(sentence)) ?? null;
}

/** The sentence that asks for an auto-advance, or null when the step asks for nothing of the sort. */
export function autoAdvanceSentence(text: string): string | null {
  for (const sentence of sentences(text)) {
    if (PROHIBITION.test(sentence)) {
      continue;
    }
    if (AUTONOMY_MARKER.test(sentence) && GATED_ACTION.test(sentence)) {
      return sentence;
    }
  }
  return null;
}

interface ReadStep {
  readonly source: WorkflowStep;
  readonly reads: boolean;
  readonly proposes: boolean;
  /** True when the step asked to write host state and was narrowed to a proposal instead. */
  readonly narrowed: boolean;
  readonly gated: boolean;
  readonly readEvidence: string | null;
  readonly proposeEvidence: string | null;
}

function classify(step: WorkflowStep): ReadStep {
  const text = step.text;
  const reads = matchesPair(text, READ_VERB, READ_OBJECT);
  const proposesDirectly = matchesPair(text, PROPOSE_VERB, PROPOSE_OBJECT);
  const writesState = !proposesDirectly && matchesPair(text, STATE_WRITE_VERB, STATE_OBJECT);
  return {
    source: step,
    reads,
    proposes: proposesDirectly || writesState,
    narrowed: writesState,
    gated: GATED_CUE.test(text),
    readEvidence: reads ? evidenceSentence(text, READ_VERB, READ_OBJECT) : null,
    proposeEvidence: proposesDirectly
      ? evidenceSentence(text, PROPOSE_VERB, PROPOSE_OBJECT)
      : writesState
        ? evidenceSentence(text, STATE_WRITE_VERB, STATE_OBJECT)
        : null,
  };
}

/* ------------------------------------------------------------------------------------------
 * Identity
 * ---------------------------------------------------------------------------------------- */

const answerFor = (answers: Readonly<Record<string, string>>, key: string): string =>
  typeof answers[key] === "string" ? (answers[key] ?? "").trim() : "";

/** `orchestrate-workflow` -> `Orchestrate workflow`. Mechanical, so it runs without asking. */
function humanize(name: string): string {
  const words = name.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (words === "") {
    return "";
  }
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The first emoji anywhere in the document's own metadata, or null. Never invented. */
function emojiIn(values: readonly (string | null)[]): string | null {
  for (const value of values) {
    if (!value) {
      continue;
    }
    for (const segment of [...value]) {
      if (isLikelyEmoji(segment)) {
        return segment;
      }
    }
  }
  return null;
}

function firstSentence(text: string, limit: number): string {
  const trimmed = text.replace(/\s+/g, " ").trim();
  const [first] = sentences(trimmed);
  const candidate = first ?? trimmed;
  return candidate.length <= limit ? candidate : truncate(candidate, limit);
}

/** A role counts as named when the workflow writes the host's own literal, e.g. `wc_liaison`. */
function rolesNamedIn(sources: readonly string[]): Role[] {
  const haystack = sources.map(normalizeForMatch);
  return ROLES.filter((role) => {
    const needle = normalizeForMatch(role);
    return haystack.some((source) => source.includes(needle));
  });
}

function rolesFromAnswer(raw: string): { roles: Role[]; unknown: string[] } {
  const parts = raw
    .split(/[,;/]|\s+/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "" && part !== "and");
  const roles: Role[] = [];
  const unknown: string[] = [];
  for (const part of parts) {
    if (isRole(part)) {
      if (!roles.includes(part)) {
        roles.push(part);
      }
    } else {
      unknown.push(part);
    }
  }
  return { roles, unknown };
}

/* ------------------------------------------------------------------------------------------
 * The conversion
 * ---------------------------------------------------------------------------------------- */

const MAX_DETAIL = 600;

/** Mirrors the prompt path's draft, so a review screen can prefill either outcome the same way. */
function draftFor(
  doc: WorkflowDoc,
  understanding: string,
  fields: {
    id: string;
    label: string;
    icon: string;
    navSection: string;
    purpose: string;
    roles: readonly Role[];
    capabilities: readonly { capability: Capability; evidence: string }[];
    routes: readonly SpecRoute[];
  },
): PlannerDraft {
  return draftSchema.parse({
    understanding,
    spec: {
      id: fields.id === "" ? null : fields.id,
      label: fields.label === "" ? null : fields.label,
      icon: fields.icon === "" ? null : fields.icon,
      navSection: fields.navSection === "" ? null : fields.navSection,
      purpose: fields.purpose === "" ? null : fields.purpose,
      visibleToRoles:
        fields.roles.length > 0
          ? { roles: [...fields.roles], evidence: doc.frontmatter.name }
          : null,
      capabilities: fields.capabilities.map((entry) => ({
        capability: entry.capability,
        evidence: entry.evidence,
      })),
      routes: fields.routes.map((route) => ({
        id: route.id,
        method: route.method,
        path: route.path,
        summary: route.summary,
        kind: route.kind,
        capabilities: [...route.capabilities],
      })),
      tables: [],
      widgets: [],
    },
  });
}

export function planFromWorkflow(input: WorkflowPlanInput): PlanOutcome {
  const answers = input.answers ?? {};
  const existingSubAppIds = input.existingSubAppIds ?? [];
  const hostVersion = input.hostVersion ?? HOST_VERSION;
  const appVersion = input.appVersion ?? DEFAULT_APP_VERSION;

  const chosenSection = answerFor(answers, "steps:section");
  const parsed = parseWorkflowMarkdown(
    input.workflow,
    chosenSection === "" ? {} : { stepsSection: chosenSection },
  );
  if (!parsed.ok) {
    return {
      status: "invalid_draft",
      issues: parsed.issues,
      raw: typeof input.workflow === "string" ? truncate(input.workflow, 2000) : null,
      attempts: 1,
    };
  }

  const doc = parsed.doc;
  const consent = readConsentAnswers(answers);
  const consentSources = [doc.source, ...consent.quotableSources];

  const workflowName = doc.frontmatter.name?.trim() ?? doc.title?.trim() ?? "";
  const understanding =
    workflowName === ""
      ? `Converted a Cowork workflow into a ${doc.steps.length}-step mini app.`
      : `Converted the Cowork workflow "${workflowName}" into a ${doc.steps.length}-step mini app that walks a person through its procedure.`;

  // --- the section the steps came from ------------------------------------------------------
  if (doc.stepsSection === null) {
    return {
      status: "needs_input",
      questions: [stepsSectionQuestion(doc.stepSectionCandidates)],
      understanding,
      warnings: [],
      draft: draftSchema.parse({ understanding, spec: {} }),
    };
  }

  const warnings: PlanWarning[] = [];
  const warn = (code: WarningCode, message: string): void => {
    warnings.push({ code, message });
  };
  if (doc.stepsSection.inferred) {
    warn(
      "steps-section-inferred",
      `this workflow has no "## Procedure" heading, so the steps were read from its only numbered section, "${doc.stepsSection.heading}"`,
    );
  }

  // --- 1. the refusal, before anything else --------------------------------------------------
  for (const step of doc.steps) {
    const sentence = autoAdvanceSentence(step.text);
    if (sentence !== null) {
      const title = step.title === "" ? `step ${step.ordinal}` : `"${step.title}"`;
      return {
        status: "blocked",
        rule: "propose-not-mutate",
        explanation:
          `Step ${step.ordinal} ${title} would have the mini app advance or resolve a gated step on its own. ` +
          "A generated mini app may show that step and file a proposal about it; only an authenticated person may " +
          "advance it. Rewrite the step so the app proposes and a person decides, and this converts.",
        evidence: sentence,
        evidenceGrounded: quoteIsGrounded(sentence, [doc.source]),
        contractRule: CONTRACT_RULES.proposeDontMutate,
        understanding,
      };
    }
  }

  const questions: ClarifyingQuestion[] = [];

  // --- 2 & 3. steps, and the capabilities they actually use ----------------------------------
  const readSteps = doc.steps.map(classify);
  const steps: SpecStep[] = [];
  const usedKeys = new Set<string>();
  let wantsRead = false;
  let wantsPropose = false;
  let readEvidence: string | null = null;
  let proposeEvidence: string | null = null;
  let sawStateWrite = false;

  for (const entry of readSteps) {
    const step = entry.source;
    if (step.title.trim() === "") {
      warn("step-dropped", `dropped step ${step.ordinal}: it has no readable text`);
      continue;
    }

    let key = slugify(step.title).slice(0, 48).replace(/-+$/, "");
    if (key === "" || !SUBAPP_ID_PATTERN.test(key)) {
      key = `step-${step.ordinal}`;
    }
    if (usedKeys.has(key)) {
      let suffix = 2;
      while (usedKeys.has(`${key}-${suffix}`)) {
        suffix += 1;
      }
      key = `${key}-${suffix}`;
    }
    usedKeys.add(key);

    let detail = step.detail;
    if (detail.length > MAX_DETAIL) {
      warn("step-detail-truncated", `shortened step ${step.ordinal} to the first ${MAX_DETAIL} characters`);
      detail = truncate(detail, MAX_DETAIL);
    }

    // A denied scope narrows the step to a display: the page still shows the instruction, it
    // just no longer offers to act on it. Narrowing never needs permission.
    const reads = entry.reads && !consent.denied.has("read:contracts");
    const proposes = entry.proposes && !consent.denied.has("write:inbox-proposal");
    if (entry.reads && !reads) {
      warn("step-narrowed", `step ${step.ordinal} now only displays its instruction: read:contracts was declined`);
    }
    if (entry.proposes && !proposes) {
      warn(
        "step-narrowed",
        `step ${step.ordinal} now only displays its instruction: write:inbox-proposal was declined`,
      );
    }
    if (entry.narrowed && proposes) {
      warn(
        "step-narrowed",
        `step ${step.ordinal} asks to write host state; the mini app will file a proposal instead (${CONTRACT_RULES.proposeDontMutate})`,
      );
    }
    if (entry.narrowed) {
      sawStateWrite = true;
    }

    const capabilities: Capability[] = [];
    if (reads) {
      capabilities.push("read:contracts");
      wantsRead = true;
      readEvidence = readEvidence ?? entry.readEvidence;
    }
    if (proposes) {
      capabilities.push("write:inbox-proposal");
      wantsPropose = true;
      proposeEvidence = proposeEvidence ?? entry.proposeEvidence;
    }

    steps.push({
      key,
      ordinal: step.ordinal,
      title: step.title.slice(0, 120).trim(),
      detail,
      kind: proposes ? "propose" : reads ? "read" : "display",
      gated: entry.gated,
      capabilities,
    });
  }

  if (steps.length === 0) {
    return {
      status: "invalid_draft",
      issues: [`no usable steps under "${doc.stepsSection.heading}" - every numbered item was unreadable`],
      raw: truncate(doc.source, 2000),
      attempts: 1,
    };
  }

  if (sawStateWrite) {
    warn(
      "tables-omitted",
      "this workflow keeps state, but a mini app is database-free: no table is declared and nothing is stored - the steps propose, a person decides",
    );
  }

  // Every capability is justified by a sentence of the workflow itself. The check is not
  // ceremony: it is the same grounding rule the prompt path applies to a model's claims, and
  // a cue that fires without a quotable sentence behind it becomes a question, not a scope.
  const claimed: { capability: Capability; evidence: string }[] = [];
  const capabilities: Capability[] = [];
  const consider = (capability: Capability, evidence: string | null, wanted: boolean): void => {
    if (!wanted) {
      return;
    }
    const quote = evidence ?? "";
    claimed.push({ capability, evidence: quote });
    if (consent.granted.has(capability) || quoteIsGrounded(quote, consentSources)) {
      capabilities.push(capability);
      return;
    }
    questions.push(
      capabilityConsentQuestion(
        capability,
        `The workflow's steps look like they ${capability === "read:contracts" ? "read contract records" : "file something for review"}, but no sentence of it says so plainly.`,
      ),
    );
  };
  consider("read:contracts", readEvidence, wantsRead);
  consider("write:inbox-proposal", proposeEvidence, wantsPropose);

  for (const capability of consent.denied) {
    warn("capability-denied", `did not declare ${capability}: consent was declined`);
  }

  // A step may not hold a scope the manifest does not declare - strip rather than widen.
  const declared = new Set<Capability>(capabilities);
  const finalSteps: SpecStep[] = steps.map((step) => {
    const kept = step.capabilities.filter((capability) => declared.has(capability));
    if (kept.length === step.capabilities.length) {
      return step;
    }
    return {
      ...step,
      capabilities: kept,
      kind: kept.includes("write:inbox-proposal") ? "propose" : kept.includes("read:contracts") ? "read" : "display",
    };
  });

  // --- routes: the three-file floor ----------------------------------------------------------
  const routes: SpecRoute[] = [
    {
      id: "steps",
      method: "GET",
      path: "/steps",
      summary: "The workflow steps this mini app walks a person through",
      kind: "read",
      capabilities: [],
    },
  ];
  if (declared.has("read:contracts")) {
    routes.push({
      id: "contracts",
      method: "GET",
      path: "/contracts",
      summary: "Contract folders the reading steps show",
      kind: "read",
      capabilities: ["read:contracts"],
    });
  }
  if (declared.has("write:inbox-proposal")) {
    routes.push({
      id: "propose",
      method: "POST",
      path: "/proposals",
      summary: "File a proposal for a step that needs a person",
      kind: "propose",
      capabilities: ["write:inbox-proposal"],
    });
  }

  // --- 4. identity: derive what the document says, ask for the rest ---------------------------
  let id: string | null = null;
  const answeredId = answerFor(answers, "id:collision") || answerFor(answers, "id");
  const rawId = answeredId !== "" ? answeredId : workflowName;
  if (rawId === "") {
    questions.push(
      missingFieldQuestion(
        "id",
        "This workflow has no name to derive an id from - what lowercase, hyphenated id should the mini app have?",
        "idLocked",
      ),
    );
  } else {
    const candidate = SUBAPP_ID_PATTERN.test(rawId) ? rawId : slugify(rawId);
    if (candidate !== rawId) {
      warn("id-normalized", `normalized "${rawId}" to the sub-app id "${candidate}"`);
    }
    if (candidate.length < 3 || candidate.length > 32 || !SUBAPP_ID_PATTERN.test(candidate)) {
      questions.push(
        missingFieldQuestion(
          "id",
          `"${rawId}" cannot be a sub-app id - what lowercase, hyphenated id should it have?`,
          "idLocked",
        ),
      );
    } else if (existingSubAppIds.includes(candidate)) {
      questions.push(idCollisionQuestion(candidate));
    } else {
      id = candidate;
    }
  }

  const answeredLabel = answerFor(answers, "label");
  const label = answeredLabel !== "" ? answeredLabel : humanize(workflowName);
  if (label === "" || !labelSchema.safeParse(label).success) {
    questions.push(
      missingFieldQuestion("label", "What should this mini app be called in the nav?", "failLoud"),
    );
  } else if (answeredLabel === "") {
    warn("label-from-workflow-name", `took the nav label "${label}" from the workflow's own name`);
  }

  const answeredIcon = answerFor(answers, "icon");
  const icon =
    answeredIcon !== ""
      ? answeredIcon
      : emojiIn([doc.frontmatter.name, doc.frontmatter.description, doc.title]) ?? "";
  if (icon === "" || !iconSchema.safeParse(icon).success) {
    questions.push(
      missingFieldQuestion(
        "icon",
        icon === ""
          ? "This workflow carries no emoji to use as an icon - which emoji should the mini app use?"
          : `"${icon}" is not an emoji - which emoji should this mini app use as its icon?`,
        "failLoud",
      ),
    );
  }

  const description = doc.frontmatter.description?.trim() ?? "";
  let purpose = "";
  if (description !== "") {
    purpose = firstSentence(description, 280);
    warn("purpose-from-description", "took the purpose line from the workflow's own description");
  }
  if (purpose === "") {
    questions.push(
      missingFieldQuestion("purpose", "In one sentence, what should this mini app do?", "failLoud"),
    );
  }

  // navSection is an exact-match join key against five host literals and no workflow carries
  // one, so this is always a question unless a person has already answered it.
  let navSection: NavSection | null = null;
  const rawNav = answerFor(answers, "navSection") || (doc.frontmatter.keys["navSection"] ?? "").trim();
  if (rawNav === "") {
    questions.push(navSectionQuestion(null));
  } else {
    const normalizedNav = normalizeNavSection(rawNav);
    if (normalizedNav === null) {
      questions.push(navSectionQuestion(rawNav));
    } else {
      if (normalizedNav !== rawNav) {
        warn("nav-section-normalized", `matched nav section "${rawNav}" to "${normalizedNav}"`);
      }
      navSection = normalizedNav;
    }
  }

  let visibleToRoles: Role[] = [];
  const answeredRoles = answerFor(answers, "visibleToRoles");
  if (answeredRoles !== "") {
    const { roles, unknown } = rolesFromAnswer(answeredRoles);
    if (roles.length === 0 || unknown.length > 0) {
      questions.push(rolesQuestion(unknown.length > 0 ? unknown : []));
    } else {
      visibleToRoles = roles;
    }
  } else {
    const named = rolesNamedIn([doc.source]);
    if (named.length === 0) {
      // Who sees HR data is a disclosure decision the document does not make.
      questions.push(rolesQuestion([]));
    } else {
      visibleToRoles = named;
    }
  }

  // --- decide ---------------------------------------------------------------------------------
  if (questions.length > 0) {
    return {
      status: "needs_input",
      questions: orderQuestions(questions),
      understanding,
      warnings,
      draft: draftFor(doc, understanding, {
        id: id ?? "",
        label,
        icon,
        navSection: rawNav,
        purpose,
        roles: visibleToRoles,
        capabilities: claimed,
        routes,
      }),
    };
  }

  if (id === null || navSection === null) {
    // Unreachable: both paths above push a question. Fail loudly rather than emit half a spec.
    return {
      status: "invalid_draft",
      issues: ["internal: a required field was missing but no question was raised"],
      raw: null,
      attempts: 1,
    };
  }

  const candidate: MiniAppSpec = {
    specVersion: 1,
    id,
    label,
    version: appVersion,
    minHostVersion: hostVersion,
    icon,
    navSection,
    purpose,
    sourcePrompt: doc.source,
    capabilities,
    visibleToRoles,
    derived: derivationsFor(id),
    routes,
    // Never a table. `shell-reference` is the floor: three files, `initSchema: () => {}`.
    tables: [],
    widgets: [],
    settingsPanel: null,
    steps: finalSteps,
  };

  const validated = miniAppSpecSchema.safeParse(candidate);
  if (!validated.success) {
    return { status: "invalid_draft", issues: formatIssues(validated.error), raw: null, attempts: 1 };
  }

  return { status: "planned", spec: validated.data, understanding, warnings };
}
