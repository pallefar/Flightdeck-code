import {emptyProcessDraft,PROCESS_TEMPLATES,buildProcessPlan} from '../../process-studio/plan';
import type {ProcessTemplateId} from '../../process-studio/contracts';

/** Public DEVELOPMENT facts only. Never a production account, source dataset or provider reply. */
export function completeProcessDraft(templateId:ProcessTemplateId='operations-queue'){
 const draft=emptyProcessDraft();
 Object.assign(draft.brief,{title:'Process review',problem:'Review requests are scattered across a manual intake queue.',outcome:'Prepare a reviewable request without changing source records.',users:'Operations staff and independent human reviewers',systemOfRecord:'Workspace contract references; no external connector is configured.',dataSensitivity:'internal',templateId,v1Features:['Prepare one bounded human-review proposal'],v2Features:['Explore additional sources only after separate review'],acceptanceCriteria:['A proposal is not an approval or a completed process step']});
 Object.assign(draft.choices,{appId:'process-review',icon:'📋',navSection:'Ops & insight',visibleToRoles:['legal'],consentedScopes:[...PROCESS_TEMPLATES.find(template=>template.id===templateId)!.requiredScopes]});
 return draft;
}
export function processBuildRequest(templateId:ProcessTemplateId='operations-queue'){
 const draft=completeProcessDraft(templateId),plan=buildProcessPlan(draft);
 if(plan.status!=='ready')throw new Error('Development process fixture must have a real complete plan.');
 return {projectId:'development-process',draft,reviewKey:plan.reviewKey};
}
