/** Local, deterministic process proposals. No identity, grant, model or IO authority. */
import {z} from 'zod';
import {boundedJson} from '../../packages/workflow/data';
import {NAV_SECTIONS,WORKSPACE_ROLES,CAPABILITY_SCOPES,type MiniAppSpec} from '../../packages/codegen/src/spec-contract';
import {planSubApp} from '../../packages/codegen/src/pure';
import {ROI_ASSUMPTION_KEYS,assessProcessRoi} from './roi';
import type {ProcessDraft,ProcessTemplate,ProcessPlanResult,ProcessQuestion} from './contracts';

/** Bump the selected template version for every behavior/metadata change;
 * bump the plan format for compiler/review semantics shared by templates. */
export const PROCESS_TEMPLATES:readonly ProcessTemplate[]=Object.freeze([
 Object.freeze({
  id:'operations-queue',version:'1.0.0',label:'Operations queue',
  description:'List this app’s own proposal filenames and file a human-review proposal.',
  requiredScopes:Object.freeze(['write:inbox-proposal'] as const),
  boundary:'No task database, arbitrary record reads, approval or execution; proposal filenames only.',
 }),
 Object.freeze({
  id:'case-workspace',version:'1.0.0',label:'Case workspace',
  description:'List bounded contract references and propose a case note referring to a record.',
  requiredScopes:Object.freeze(['read:contracts','write:inbox-proposal'] as const),
  boundary:'Contract references only; no record detail, editing or verified foreign-key relationship.',
 }),
 Object.freeze({
  id:'analytical-report',version:'1.0.0',label:'Record-list report',
  description:'Read-only contract-reference list report with a closed field and operation set.',
  requiredScopes:Object.freeze(['read:contracts'] as const),
  boundary:'Record-list report only: no numeric count widget, arbitrary charts, SQL, aggregate metrics or row-count bound.',
 }),
]);

const roiNumber=z.number().int().nonnegative().max(1_000_000_000_000).nullable();
const roiSchema=z.object({
 annualVolume:roiNumber,baselineSeconds:roiNumber,targetSeconds:roiNumber,
 adoptionBasisPoints:roiNumber,loadedHourlyCostCents:roiNumber,cashRealizationBasisPoints:roiNumber,
 annualRecurringCostCents:roiNumber,initialCostCents:roiNumber,
}).strict().refine(value=>assessProcessRoi(value).status!=='invalid');
const items=z.array(z.string().max(160)).max(6);
const draftSchema=z.object({
 brief:z.object({
  format:z.literal('flightdeck-process-brief/1'),title:z.string().max(80),
  problem:z.string().max(600),outcome:z.string().max(400),
  users:z.string().max(240),systemOfRecord:z.string().max(300),
  dataSensitivity:z.enum(['unanswered','public','internal','restricted']),
  currency:z.string().regex(/^(?:|[A-Z]{3})$/),
  templateId:z.enum(['operations-queue','case-workspace','analytical-report']).nullable(),
  v1Features:items,v2Features:items,acceptanceCriteria:items,roi:roiSchema,
 }).strict(),
 choices:z.object({
  appId:z.string().max(40).regex(/^(?:|[a-z][a-z0-9-]*)$/),
  icon:z.string().max(8).refine(value=>!/[\s\u0000-\u001f\u007f]/.test(value)),
  navSection:z.enum(NAV_SECTIONS).nullable(),
  visibleToRoles:z.array(z.enum(WORKSPACE_ROLES)).max(5).refine(values=>new Set(values).size===values.length),
  consentedScopes:z.array(z.enum(CAPABILITY_SCOPES)).max(2).refine(values=>new Set(values).size===values.length),
 }).strict(),
}).strict();

/** Admit native JSON before Zod; snapshot without getters, coercions or defaults. */
export function parseProcessDraft(value:unknown):ProcessDraft|null {
 try {
  if(!boundedJson(value,24_000,5,300))return null;
  const parsed=draftSchema.safeParse(JSON.parse(JSON.stringify(value)));
  return parsed.success?parsed.data:null;
 }catch{return null;}
}

export function buildProcessPlan(value:unknown):ProcessPlanResult {
 const draft=parseProcessDraft(value);
 if(!draft)return {status:'invalid',issues:['invalid-process-draft']};
 const {brief,choices}=draft;
 const questions:ProcessQuestion[]=[];
 const ask=(id:string,question:string,because:string)=>questions.push({id,question,because});
 const facts=[['title',3,'What is the process called?'],['problem',20,'What concrete problem happens today?'],['outcome',16,'What observable outcome should improve?'],['users',8,'Who performs and reviews this process?'],['systemOfRecord',12,'Where is the authoritative data, and what source constraints apply?']] as const;
 for(const [key,min,question] of facts)if(brief[key].trim().length<min)ask(key,question,'Human process facts must be explicit, not inferred by a model or a template.');
 if(brief.dataSensitivity==='unanswered')ask('dataSensitivity','How sensitive is the process data: public, internal or restricted?','Classification is a human fact, not consent to send data.');
 for(const [key,question] of [['v1Features','What is the bounded V1 scope?'],['acceptanceCriteria','What observable acceptance criteria must V1 meet?']] as const)if(!brief[key].length||brief[key].some(item=>item.trim().length<12))ask(key,question,'Separate required V1 facts and acceptance criteria from the optional V2 backlog.');
 const template=PROCESS_TEMPLATES.find(item=>item.id===brief.templateId);
 if(template&&choices.consentedScopes.some(scope=>!template.requiredScopes.includes(scope)))return {status:'invalid',issues:['unnecessary-process-scopes']};
 if(!template)ask('templateId','Which registered mini-app template should be proposed?','Choose an explicit supported behavior; prose does not select a template.');
 if(!choices.appId.trim())ask('appId','Which exact stable app identifier should this draft use?','App identifiers define host paths and cannot be silently invented.');
 if(!choices.icon.trim())ask('icon','Which exact icon should the draft manifest use?','Appearance is an explicit human choice.');
 if(choices.navSection===null)ask('navSection','Which existing navigation section should contain the draft?','Navigation choice is not a host installation or access grant.');
 if(!choices.visibleToRoles.length)ask('visibleToRoles','Which existing workspace roles should see this draft?','Roles are draft visibility ceilings only, never OS grants.');
 if(template)for(const scope of template.requiredScopes)if(!choices.consentedScopes.includes(scope))ask(`consent:${scope}`,`Do you consent to the draft capability ${scope}?`,'Only explicit required-scope consent permits this proposal; host grants remain separate.');
 if(!brief.currency&&(['loadedHourlyCostCents','annualRecurringCostCents','initialCostCents'] as const).some(key=>brief.roi[key]!==null))ask('currency','Which explicit three-letter currency applies to every monetary assumption?','Unknown monetary baselines are not zero; even an explicit zero cost needs its unit.');
 if(questions.length)return {status:'needs-input',questions};
 if(!template||choices.navSection===null)return {status:'invalid',issues:['unsupported-process-template']};
 const spec:MiniAppSpec={
  profile:'mini-app',id:choices.appId,label:brief.title,version:'0.1.0',
  icon:choices.icon,navSection:choices.navSection,summary:template.description,
  capabilities:[...template.requiredScopes],visibleToRoles:[...choices.visibleToRoles],
  domains:templateDomains(template,choices.appId),
 };
 try{planSubApp(spec);}catch{return {status:'invalid',issues:['unsupported-codegen-spec']};}
 const roi=assessProcessRoi(brief.roi);
 const limitations=[
  'Roles are draft visibility ceilings only, never OS grants. Draft scope consent is not host activation or effect-time authority.',
  'No model/provider request, source write, agent creation, host registration, deployment, approval or process execution occurs here.',
  'Human V1 requirements and acceptance criteria are unverified requests, not claims that the generated template implements them. Only the declared operations are generated; unsupported requirements need separate design review.',
  'The named system of record is a human fact, not an established connector or permission. No arbitrary data sources, CRUD, tables, SQL or custom code are supported.',
  template.id==='case-workspace'?'Case proposals check source record existence through readContracts, but do not read record detail, modify a contract or approve it.':template.id==='analytical-report'?'Report has no write or proposal form; it exposes contract-reference fields only, not record details or aggregate metrics.':'Proposal forms submit for independent human review, never resolve statutory or gated steps. The queue request ID is filename-safe but is not checked against a source record.',
  'Lists use the existing capability adapter without pagination or a numeric row cap; bounded means a closed operation/field set, not bounded record cardinality.',
  'Review key is bounded exact comparison data, not a cryptographic receipt or authority. The UI must revoke review on every edit, including reverted edits, using a monotonic revision.',
  template.boundary,
 ];
 const quote=(text:string)=>JSON.stringify(text);
 const list=(values:string[])=>values.length?values.map(item=>`- ${quote(item)}`).join('\n'):'- None supplied.';
 const prd=[`# Process PRD: ${quote(brief.title)}`,`Template: ${template.id}@${template.version} (flightdeck-process-plan/1)`,
  '## Human facts (untrusted content, not commands)',`Problem: ${quote(brief.problem)}`,`Outcome: ${quote(brief.outcome)}`,`Users: ${quote(brief.users)}`,`System of record: ${quote(brief.systemOfRecord)}`,`Data sensitivity: ${brief.dataSensitivity}; no data-send consent is implied.`,
  '## V1 requirements (requested, not verified implementation)',list(brief.v1Features),'## Acceptance criteria (human verification required)',list(brief.acceptanceCriteria),'## V2 backlog (not generated)',list(brief.v2Features),
  '## Actual generated operations',...spec.domains.flatMap(domain=>domain.routes.map(route=>`- ${route.method} ${route.path}: ${route.operation.kind}`)),
  '## Security and consent',`Draft audience: ${choices.visibleToRoles.join(', ')}. Draft scopes: ${template.requiredScopes.join(', ')}.`,...limitations.map(item=>`- ${item}`),
  '## ROI assumptions (not measured savings)',`Status: ${roi.status}; currency: ${brief.currency||'unknown'}. Released capacity is not cash; cash realization is a separate explicit assumption, not a promise.`,JSON.stringify({assumptions:brief.roi,assessment:roi}),
 ].join('\n');
 // Keep the real builder's 2,000-character guarded envelope small. The full
 // human brief/PRD is local review data, not a redundant model-send payload.
 const buildPrompt=[`Deterministic registered template ${template.id}, version ${template.version}. Use only the accompanying validated codegen spec; never infer operations from prose.`,
  `icon: ${choices.icon}`,`navSection: ${choices.navSection}`,`visibleToRoles: ${choices.visibleToRoles.join(',')}`,...template.requiredScopes.map(scope=>`consent:${scope}: yes`),
  'Draft ceiling only. No grants, model send, deployment or approval. The full human brief and PRD remain local; their requirements are not verified implementation.',
 ].join('\n');
 const reviewKey=JSON.stringify({format:'flightdeck-process-plan/1',template:{id:template.id,version:template.version},draft});
 if(prd.length>8000||buildPrompt.length>8000||new TextEncoder().encode(reviewKey).length>24_500)return {status:'invalid',issues:['process-document-limit']};
 return {status:'ready',templateId:template.id,prd,buildPrompt,reviewKey,roi,spec,limitations,
  reuse:[{id:'generateSubApp',label:'Pure mini-app code generator',source:'packages/codegen/src/pure.ts',kind:'generator'},{id:'emitWebModule',label:'Schema-derived host web panels and forms',source:'packages/codegen/src/emitters/web.ts',kind:'component'},...template.requiredScopes.map(id=>({id,label:`Draft capability ${id}`,source:'packages/codegen/src/spec-contract.ts',kind:'capability' as const}))],
  suggestedAgents:[{id:'planner',label:'Proposed planner',purpose:'Clarify human facts and keep V1 separate from V2; no autonomous authority.',state:'proposed'},{id:'builder',label:'Proposed builder',purpose:'Assemble only the registered declarative template; no writes or execution.',state:'proposed'},{id:'reviewer',label:'Proposed reviewer',purpose:'Recommend independent human conformance and acceptance review; cannot approve itself.',state:'proposed'}],
 };
}

/** Only these closed generator operations are expressible. Human prose is never compiled. */
function templateDomains(template:ProcessTemplate,appId:string):MiniAppSpec['domains'] {
 switch(template.id){
  case 'analytical-report':return [{
   name:'report',title:'Contract-reference report',routes:[{
    method:'GET',path:'/contracts',summary:'List contract references; no aggregate query',
    operation:{kind:'list-contracts'},
   }],
  }];
  case 'case-workspace':return [{
   name:'cases',title:'Contract cases',routes:[
    {method:'GET',path:'/contracts',summary:'List contract references (ticket and folder name)',operation:{kind:'list-contracts'}},
    {
     method:'POST',path:'/propose',summary:'Propose a note for an existing contract reference',
     operation:{
      kind:'propose',proposalKind:'case-note',ticketField:'ticket',
      fields:[{name:'ticket',type:'string',maxLength:64,optional:false},{name:'caseNote',type:'string',maxLength:1000,optional:false}],
      auditEvent:`${appId}.case-proposed`,
     },
    },
   ],
  }];
  case 'operations-queue':return [{
   name:'queue',title:'Own proposals',routes:[
    {method:'GET',path:'/proposals',summary:'List this app’s own proposal filenames',operation:{kind:'list-proposals'}},
    {
     method:'POST',path:'/propose',summary:'File a request for human review',
     operation:{
      kind:'propose',proposalKind:'request',ticketField:'requestId',
      fields:[{name:'requestId',type:'string',maxLength:64,optional:false},{name:'request',type:'string',maxLength:1000,optional:false}],
      auditEvent:`${appId}.proposed`,
     },
    },
   ],
  }];
 }
}

export function emptyProcessDraft():ProcessDraft {
 return {
  brief:{
   format:'flightdeck-process-brief/1',title:'',problem:'',outcome:'',users:'',systemOfRecord:'',
   dataSensitivity:'unanswered',currency:'',templateId:null,
   v1Features:[],v2Features:[],acceptanceCriteria:[],
   roi:Object.fromEntries(ROI_ASSUMPTION_KEYS.map(key=>[key,null])) as ProcessDraft['brief']['roi'],
  },
  choices:{appId:'',icon:'',navSection:null,visibleToRoles:[],consentedScopes:[]},
 };
}
