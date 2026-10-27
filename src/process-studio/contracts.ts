import type {CapabilityScope,NavSection,WorkspaceRole,MiniAppSpec} from '../../packages/codegen/src/spec-contract';
import type {ROI_ASSUMPTION_KEYS,assessProcessRoi} from './roi';

export type ProcessTemplateId='operations-queue'|'case-workspace'|'analytical-report';
export interface ProcessBrief {
 format:'flightdeck-process-brief/1';
 title:string;problem:string;outcome:string;users:string;systemOfRecord:string;
 dataSensitivity:'unanswered'|'public'|'internal'|'restricted';
 currency:string;
 templateId:ProcessTemplateId|null;
 v1Features:string[];v2Features:string[];acceptanceCriteria:string[];
 roi:{[K in typeof ROI_ASSUMPTION_KEYS[number]]:number|null};
}
export interface ProcessBuildChoices {
 appId:string;icon:string;navSection:NavSection|null;
 visibleToRoles:WorkspaceRole[];consentedScopes:CapabilityScope[];
}
export interface ProcessDraft {brief:ProcessBrief;choices:ProcessBuildChoices}
export interface ProcessQuestion {id:string;question:string;because:string}
export interface ProcessTemplate {id:ProcessTemplateId;version:string;label:string;description:string;requiredScopes:readonly CapabilityScope[];boundary:string}
export interface ProcessPlan {
 status:'ready';prd:string;buildPrompt:string;reviewKey:string;templateId:ProcessTemplateId;
 roi:ReturnType<typeof assessProcessRoi>;spec:MiniAppSpec;
 reuse:readonly {id:string;label:string;source:string;kind:'generator'|'capability'|'component'}[];
 suggestedAgents:readonly {id:string;label:string;purpose:string;state:'proposed'}[];
 limitations:readonly string[];
}
export type ProcessPlanResult=ProcessPlan|{status:'needs-input';questions:readonly ProcessQuestion[]}|{status:'invalid';issues:readonly string[]};

/** Exact comparison only, never a cryptographic receipt or an authorization grant. */
export type ProcessReviewKey=string;
