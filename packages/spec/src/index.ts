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
  specStepSchema,
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
  SpecStep,
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
  proposalTemplateQuestion,
  rolesQuestion,
  stepsSectionQuestion,
  unknownCapabilityQuestion,
} from "./questions";
export type { ClarifyingQuestion, QuestionSeverity, SpecField } from "./questions";

export { TEMPLATE_ID_PATTERN, TEMPLATE_RULE } from "./templates";
export type { ProposalTemplateChoice } from "./templates";

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

/**
 * The Cowork-workflow input path. A workflow is a skill file - YAML frontmatter plus a
 * "## Procedure" of numbered steps - and it arrives as a string in the request body, because a
 * sub-app route has no filesystem read (contract §5.3). What comes out is a database-free
 * `MiniAppSpec` whose `steps` are the workflow's own steps.
 */
export { PROCEDURE_HEADING, flattenInline, parseWorkflowMarkdown } from "./workflow";
export type {
  ParseWorkflowOptions,
  WorkflowDoc,
  WorkflowFrontmatter,
  WorkflowParse,
  WorkflowSection,
  WorkflowStep,
} from "./workflow";

export { autoAdvanceSentence, planFromWorkflow } from "./workflowPlan";
export type { WorkflowPlanInput } from "./workflowPlan";

/**
 * The OS-workflow output path: `studio-workflow-definition/1`, the Workflow Builder body an
 * OS admin imports in the New-workflow wizard. A file's statutory set, empty or not, only with
 * a named human.
 */
export {
  STUDIO_ONLY_KEYS,
  WORKFLOW_DEFINITION_SCHEMA_ID,
  WORKFLOW_FIRST_STEP,
  WORKFLOW_INTAKE_FIELD_TYPES,
  WORKFLOW_LAST_STEP,
  WORKFLOW_SLUG_PATTERN,
  parseWorkflowDefinition,
  serializeWorkflowDefinition,
  workflowDefinitionFileSchema,
  workflowDefinitionSchema,
} from "./process-definition";
export type { WorkflowDefinition, WorkflowDefinitionParse, WorkflowIntakeField } from "./process-definition";
