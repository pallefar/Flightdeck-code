/**
 * `@spec` - prompt in, validated `MiniAppSpec` out.
 *
 * Downstream (codegen, conformance) should import from here and treat a `planned` spec as
 * final: every manifest field is present and already checked against the host contract.
 */

export {
  CAPABILITIES,
  CONTRACT_RULES,
  HOST_VERSION,
  MAX_TABLE_NAME_LENGTH,
  NAV_SECTIONS,
  ROLES,
  ROUTE_PREFIX_PATTERN,
  SUBAPP_ID_PATTERN,
  compareSemver,
  derivationsFor,
  enableEnvVarFor,
  isCapability,
  isNavSection,
  isRole,
  navPathFor,
  normalizeNavSection,
  parseSemver,
  routePrefixFor,
  satisfiesHostCeiling,
  tablePrefixFor,
  webModuleIdFor,
} from "./vocabulary";
export type { Capability, ContractRule, Derivations, NavSection, Role, Semver } from "./vocabulary";

export {
  capabilitySchema,
  derivationsSchema,
  formatIssues,
  iconSchema,
  labelSchema,
  miniAppSpecSchema,
  navSectionSchema,
  parseMiniAppSpec,
  roleSchema,
  routePathSchema,
  routeSchema,
  settingsPanelSchema,
  subAppIdSchema,
  tableColumnSchema,
  tableSchema,
  toManifestFields,
  widgetSchema,
} from "./schema";
export type {
  ManifestFields,
  MiniAppSpec,
  SettingsPanel,
  SpecRoute,
  SpecTable,
  SpecTableColumn,
  SpecWidget,
} from "./schema";

export { BLOCKED_RULES, draftSchema } from "./draft";
export type { BlockedRule, DraftBody, DraftRoute, DraftTable, PlannerDraft } from "./draft";

export { EXAMPLE_DRAFT, EXAMPLE_DRAFT_JSON, buildRepairPrompt, buildSystemPrompt, buildUserPrompt } from "./prompt";
export type { PromptInput } from "./prompt";

export {
  QUESTION_SEVERITIES,
  capabilityConsentQuestion,
  consentQuestionId,
  idCollisionQuestion,
  missingFieldQuestion,
  navSectionQuestion,
  orderQuestions,
  rolesQuestion,
  unknownCapabilityQuestion,
} from "./questions";
export type { ClarifyingQuestion, QuestionSeverity, SpecField } from "./questions";

export { DEFAULT_APP_VERSION, defaultGateContext, evaluateDraft, readConsentAnswers } from "./gates";
export type { GateContext } from "./gates";

export { WARNING_CODES } from "./outcome";
export type {
  BlockedOutcome,
  InvalidDraftOutcome,
  NeedsInputOutcome,
  PlanOutcome,
  PlanWarning,
  PlannedOutcome,
  WarningCode,
} from "./outcome";

export { MIN_PROMPT_WORDS, planFromPrompt } from "./planner";
export type { PlanInput, PlannerCompletion, PlannerLlm, PlannerRequest } from "./planner";

export { extractJsonObject } from "./json";
export type { JsonExtraction } from "./json";
