import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Workbench } from "../workbench/Workbench";
import { StudioController } from "./controller";
import { checkConnection, MODEL_CONNECTION_IDS, type ModelConnectionId, type ConnectionStatus } from "./connection";
import type { WorkflowResult, EditableWorkflowResult } from "./result";
import { WorkflowEditor, createGraphFromWorkflowSteps, createWorkflowTemplate, builtinRegistry, type Graph } from "../workflow";
import { proposeBlock } from './client';
import { readAuthoringAvailability, type AuthoringAvailability } from './authoring';
import { WorkflowWorkspace } from "./WorkflowWorkspace";
import { SubappWorkspace } from './SubappWorkspace';
import {WorkspaceController} from './workspace-controller';
import { ResourceLibrary } from "./ResourceLibrary";
import { WorkflowApprovals } from "./WorkflowApprovals";
import type {WorkflowEditorHandle} from '../workflow/WorkflowEditor';
import {StudioShell,type StudioArea,type StudioAppearance} from './StudioShell';
import {ConversationHistory} from './ConversationHistory';
import {AcceptedHandoff,type ReceivedHandoff} from './AcceptedHandoff';
import {VoiceProvider,VoiceNarration,useVoice} from '../voice';
import {StudioVoiceMenu} from './StudioVoiceMenu';
import {AnthropicConnectionSetup} from './AnthropicConnectionSetup';
import {ProcessStudio,type ProcessBuild} from '../process-studio/ProcessStudio';
import {buildProcessDraft} from '../process-studio/build-client';
import {buildProcessPlan,PROCESS_TEMPLATES} from '../process-studio/plan';
import {isEmptyDraft} from '../workbench/editing';
import type {Round} from '../workbench/types';
import './StudioBuilder.css';

export function reviewedHandoff(result: WorkflowResult) {
  return { format: "flightdeck-studio-handoff/1", status: "draft-not-deployed", suggestedProjectId: result.projectId, targets: { workflow: "/api/workflows", pages: "/api/ui/pages" }, workflowDraft: result.workflow, pageSuggestions: result.pages, skillSources: result.skillSources, warnings: result.warnings, requiresHumanReview: ["Verify the active host project before scoping pages.", "Set workflow by from the actual authenticated human operator, never the model.", "Review statutory steps, access roles and page sources in the host builders before saving or publishing."] };
}

export function WorkflowReview({ result, onOpenGraph }: { result: WorkflowResult; onOpenGraph?: (graph: Graph) => void }) {
  const [reviewed, setReviewed] = useState(false);
  function download() {
    if (!reviewed) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(reviewedHandoff(result), null, 2)], { type: "application/json" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `${result.workflow.slug}.draft-handoff.json`; anchor.click(); URL.revokeObjectURL(url);
  }
  return <section className="studio-review" aria-label="Workflow review">
    <div className="studio-card"><span className="studio-eyebrow">WORKFLOW DRAFT</span><h2>Workflow draft · {result.workflow.name}</h2><p>{result.workflow.country} · {result.workflow.slug}</p><p className="studio-notice">Draft — not deployed</p>
      {onOpenGraph && <button type="button" onClick={() => onOpenGraph(result.graph ?? createGraphFromWorkflowSteps(result.workflow))}>Edit workflow graph</button>}
      <h3>Intake</h3><ul>{result.workflow.intakeFields.map((field, index) => <li key={index}>{field.name} · {field.type} · {field.required ? "Required" : "Optional"}{field.source && ` · Source: ${field.source}`}</li>)}</ul>
      <h3>Ordered steps</h3><ol>{result.workflow.steps.map((step, index) => <li key={index}><code>{step}</code>{result.workflow.statutorySteps.includes(step) && <span className="studio-badge">Human gate · statutory</span>}</li>)}</ol>
      <h3>Statutory review requirements</h3><ul>{result.workflow.statutorySteps.map((step, index) => <li key={index}>{step} <span className="studio-badge">Human gate</span></li>)}</ul>
    </div>
    <div className="studio-card"><span className="studio-eyebrow">PROJECT EXPERIENCE</span><h2>Suggested project pages</h2><p>Suggested project: <code>{result.projectId}</code>. This is not verified host context. Confirm the active project in the host before creating pages.</p>
      {result.pages.length === 0 && <p>No pages suggested.</p>}{result.pages.map((page, index) => <article className="studio-page" key={index}><h3>{page.title}</h3><p>{page.purpose}</p><p><code>{page.slug}</code> · {page.icon} · Navigation: {page.navSection}</p><p>Skill sources: {page.sourceSkillIds.join(", ") || "None supplied"}</p><p>Workflow steps: {page.stepIds.join(", ") || "None supplied"}</p><p>Visible to roles: {page.visibleToRoles.join(", ") || "None supplied"}</p></article>)}
      <h3>Project skills used</h3>{result.skillSources.length === 0 ? <p>No project skills supplied by the server.</p> : <ul>{result.skillSources.map((skill, index) => <li key={index}><code>{skill.id}</code> · {skill.version} · Content hash: <code>{skill.contentHash}</code></li>)}</ul>}
      {result.warnings.length > 0 && <div role="status"><h3>Warnings</h3><ul>{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></div>}
    </div>
    <div className="studio-card studio-handoff"><h3>Human-reviewed handoff only</h3><p>No host mutation, deployment or publication occurs here. Host targets: <code>POST /api/workflows</code> and <code>POST /api/ui/pages</code>. An authenticated human must verify the project and set workflow attribution in the host; the model cannot supply identity.</p><label><input type="checkbox" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} /> I reviewed this draft and its page suggestions for a manual host handoff.</label><button type="button" disabled={!reviewed} onClick={download}>Download reviewed handoff</button></div>
  </section>;
}

function SkillSendReview({ review, disabled, onSend }: { review: { hash: string; preview: string; unchecked: string[] }; disabled: boolean; onSend: () => void }) {
  const [reviewed, setReviewed] = useState(false);
  return <section className="studio-card" aria-label="Skill send review"><h2>Review skill context before sending</h2><p>Imported project skills are third-party content. This explicit action sends only the bounded masked context shown below to the configured model. It does not approve workflow execution or publication.</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{review.preview}</pre><p>Partial scan limitations: {review.unchecked.join(", ") || "None reported"}. A scanner is not a guarantee of anonymisation; review the context yourself.</p><p>Review fingerprint: <code>{review.hash}</code></p><label><input type="checkbox" checked={reviewed} onChange={event => setReviewed(event.target.checked)} /> I reviewed this exact context and accept the stated scan limitations.</label><button type="button" disabled={disabled || !reviewed} onClick={onSend}>Send reviewed context to model</button></section>;
}

type StudioAppProps={controller?:StudioController;fetcher?:typeof fetch;initialAppearance?:StudioAppearance};
export function StudioApp(props:StudioAppProps){
  const [voiceEpoch,setVoiceEpoch]=useState(0);
  const rotateVoiceScope=useCallback(()=>setVoiceEpoch(epoch=>epoch+1),[]);
  const voiceScopeKey=`authoring:${voiceEpoch}`;
  return <VoiceProvider scopeKey={voiceScopeKey}><StudioSession {...props} voiceScopeKey={voiceScopeKey} rotateVoiceScope={rotateVoiceScope}/></VoiceProvider>;
}
function StudioSession({ controller: supplied, fetcher = (...args)=>fetch(...args),initialAppearance='inherit',voiceScopeKey,rotateVoiceScope }:StudioAppProps&{voiceScopeKey:string;rotateVoiceScope:()=>void}) {
  const voice=useVoice();
  const [controller] = useState(() => supplied ?? new StudioController(fetcher));
  const [workspaceController] = useState(()=>new WorkspaceController((...args)=>fetcher(...args)));
  // One entry for every person: the real request determines the builder.
  // Examples/editors are explicit actions, never a pathname-based default.
  const [view,setView] = useState<StudioArea>('studio');
  const [appearance,setAppearance]=useState<StudioAppearance>(initialAppearance);
  const [chatCollapsed,setChatCollapsed]=useState(false),[compact,setCompact]=useState(false),[chatFocus,setChatFocus]=useState(0);
  useEffect(()=>{if(typeof window==='undefined'||!window.matchMedia)return;const query=window.matchMedia('(max-width:850px)');const update=()=>setCompact(query.matches);update();query.addEventListener('change',update);return()=>query.removeEventListener('change',update);},[]);
  const [editorGraph,setEditorGraph] = useState<Graph | undefined>(undefined);
  const [editorRevision,setEditorRevision] = useState(0),[workspaceDocumentKey,setWorkspaceDocumentKey] = useState(0);
  const [buildReveal,setBuildReveal] = useState(false),[motion,setMotion] = useState(true);
  const editorHandle = useRef<WorkflowEditorHandle|null>(null);
  const workflowArea = useRef<HTMLElement|null>(null),ideArea = useRef<HTMLElement|null>(null),resourcesArea=useRef<HTMLElement|null>(null),approvalsArea=useRef<HTMLElement|null>(null);
  const [focusTurn,setFocusTurn] = useState(0),handledRequest = useRef<string|null>(null);
  const [handoff,setHandoff]=useState<ReceivedHandoff|null>(null);
  const dismissHandoff=useCallback((requestId:string)=>setHandoff(current=>current?.requestId===requestId?null:current),[]);
  const [pendingHandoff,setPendingHandoff] = useState<{requestId:string;result:EditableWorkflowResult}|null>(null);
  const [openedRequest,setOpenedRequest] = useState<string|null>(null),[resourceInsertError,setResourceInsertError] = useState('');
  const state = useSyncExternalStore(controller.subscribe,controller.getState,controller.getState);
  const workbenchState=useSyncExternalStore(controller.workbench.subscribe,controller.workbench.getState,controller.workbench.getState);
  const [token,setToken] = useState(''),[projectId,setProjectId] = useState(''),[prompt,setPrompt] = useState('');
  const [processScopeEpoch,setProcessScopeEpoch]=useState(0),[processPending,setProcessPending]=useState(false);
  const processEpoch=useRef(0),processAbort=useRef<AbortController|null>(null);
  const [processArtifact,setProcessArtifact]=useState<{artifactId:string;round:Round;epoch:number}|null>(null);
  const processView=useRef(view);processView.current=view;
  function cancelProcessBuild(){const abort=processAbort.current;processAbort.current=null;abort?.abort();setProcessPending(false);}
  function editPrompt(value:string|((current:string)=>string)){
    controller.invalidateSkillSendReview();
    setPrompt(value);
  }
  const tokenInput = useRef<HTMLInputElement>(null),composer = useRef<HTMLTextAreaElement>(null);
  const [connectionHelp,setConnectionHelp] = useState(false),[connectionFocus,setConnectionFocus] = useState(0);
  const [anthropicSetupOpen,setAnthropicSetupOpen]=useState(false),[setupContextEpoch,setSetupContextEpoch]=useState(0);
  const requireExplicitModel=useRef(false);
  function setupOpenChanged(open:boolean){if(open){voice.stop();rotateVoiceScope();}setAnthropicSetupOpen(open);}
  function setupMutation(){requireExplicitModel.current=true;invalidateContext(true);}
  const focusIntent=useRef<'connection'|'workspace'|'conversation'>('workspace');
  function openConnectionSettings(){cancelProcessBuild();processView.current='studio';focusIntent.current='connection';setView('studio');setConnectionHelp(true);setConnectionFocus(turn=>turn+1);}
  useEffect(()=>{if(connectionFocus&&focusIntent.current==='connection'&&view==='studio')tokenInput.current?.focus();},[connectionFocus,view]);
  const [connection,setConnection] = useState<ConnectionStatus|null>(null),[checking,setChecking] = useState(false);
  const [connectionId,setConnectionId] = useState<ModelConnectionId|''>(''),[connectionError,setConnectionError] = useState<string|null>(null);
  const [authoringEngine,setAuthoringEngine] = useState<'json-planner'|'native-v1'>('json-planner');
  const [authoringAvailability,setAuthoringAvailability] = useState<AuthoringAvailability|null>(null),[authoringChecking,setAuthoringChecking] = useState(false),[authoringError,setAuthoringError] = useState<string|null>(null);
  const authoringTurn=useRef(0),authoringAbort=useRef<AbortController|null>(null);
  function cancelAuthoringAvailability(){
    authoringTurn.current++;authoringAbort.current?.abort();authoringAbort.current=null;
    setAuthoringChecking(false);setAuthoringAvailability(null);setAuthoringError(null);
  }
  const resourceScope=useRef({projectId,token});resourceScope.current={projectId,token};
  const [answers,setAnswers] = useState<Record<string,string>>({});
  const checkTurn=useRef(0),checkAbort=useRef<AbortController|null>(null),blockAbort=useRef<AbortController|null>(null);
  function invalidateContext(clearDescriptors=false){
    // Revoke before notifying controller/store listeners, not in a later effect.
    processEpoch.current++;setProcessScopeEpoch(processEpoch.current);cancelProcessBuild();setProcessArtifact(null);
    rotateVoiceScope();
    authoringTurn.current++;authoringAbort.current?.abort();authoringAbort.current=null;setAuthoringChecking(false);setAuthoringAvailability(null);setAuthoringError(null);
    controller.reset();setAnswers({});setHandoff(null);setPendingHandoff(null);setOpenedRequest(null);setResourceInsertError('');
    handledRequest.current=null;blockAbort.current?.abort();blockAbort.current=null;
    if(clearDescriptors){checkTurn.current++;checkAbort.current?.abort();checkAbort.current=null;setChecking(false);setConnection(null);setConnectionId('');setConnectionError(null);}
  }
  useEffect(()=>()=>{processEpoch.current++;processAbort.current?.abort();processAbort.current=null;controller.reset();checkTurn.current++;checkAbort.current?.abort();blockAbort.current?.abort();authoringTurn.current++;authoringAbort.current?.abort();},[controller]);
  const nativeReady=authoringAvailability?.enabled===true&&connectionId==='anthropic';
  const usableSelection=!!token&&!checking&&!anthropicSetupOpen&&connection!==null&&connection.connections.some(d=>d.id===connectionId&&d.status==='configured')&&(authoringEngine==='json-planner'||!authoringChecking&&nativeReady);
  const aiBusy=state.phase==='requesting',busy=aiBusy||processPending,result=state.result;
  // Own pending is deliberately excluded: changing buildAvailable during the
  // request would revoke ProcessReviewGate's otherwise-current receipt.
  const processAvailable=!!token&&connection?.projectId===projectId&&connection.processBuild==='registered-templates-v1'&&!checking&&!anthropicSetupOpen&&!aiBusy&&!workbenchState.busy;
  const outcome=result?.status==='subapp-result'?result.outcome:result;
  const selectedModel=connection?.connections.find(item=>item.id===connectionId);
  function navigate(area:StudioArea,received:ReceivedHandoff|null=null){if(area!=='process')cancelProcessBuild();processView.current=area;setSetupContextEpoch(epoch=>epoch+1);setHandoff(received);if(area==='studio')setChatCollapsed(false);if((view==='resources'||view==='approvals')!==(area==='resources'||area==='approvals'))rotateVoiceScope();focusIntent.current='workspace';setView(area);setFocusTurn(turn=>turn+1);}
  const buildProcess:ProcessBuild=async(draft,reviewKey,signal)=>{
    const compiled=buildProcessPlan(draft),epoch=processEpoch.current;
    if(!processAvailable||processView.current!=='process'||signal.aborted||processAbort.current||controller.getState().phase==='requesting'||controller.workbench.getState().busy||compiled.status!=='ready'||compiled.reviewKey!==reviewKey)throw new Error('Current process review required.');
    const template=PROCESS_TEMPLATES.find(item=>item.id===compiled.templateId);
    if(!template)throw new Error('Registered template unavailable.');
    const before=controller.workbench.getState(),abort=new AbortController();processAbort.current=abort;setProcessPending(true);
    const forwardAbort=()=>{abort.abort();if(processAbort.current===abort){processAbort.current=null;setProcessPending(false);}};
    signal.addEventListener('abort',forwardAbort,{once:true});
    const current=()=>processEpoch.current===epoch&&processView.current==='process'&&processAbort.current===abort&&!signal.aborted&&!abort.signal.aborted&&controller.getState().phase!=='requesting'&&controller.workbench.getState()===before;
    try{
      const receipt=await buildProcessDraft({projectId,draft,reviewKey,templateVersion:template.version},token,abort.signal,fetcher);
      if(!current())throw new Error('Process context changed.');
      if(before.locks.size||[...before.drafts.values()].some(item=>!isEmptyDraft(item))){
        const confirmed=globalThis.confirm('Admit a new generated source round alongside your edited source? Saved changes, unsaved buffers and locked files are retained as conflicts where needed; review them in the IDE. Nothing is deployed.');
        if(!current()||!confirmed)throw new Error('Source replacement not accepted.');
      }
      if(!controller.acceptRegisteredTemplate(receipt.outcome,{projectId,templateId:receipt.templateId,templateVersion:receipt.templateVersion,artifactId:receipt.artifactId,prd:compiled.prd}))throw new Error('Source admission refused.');
      const round=controller.workbench.getState().rounds.at(-1);
      if(!round)throw new Error('Source admission unconfirmed.');
      setProcessArtifact({artifactId:receipt.artifactId,round,epoch});
      // Do not navigate: ProcessReviewGate must accept this exact returned receipt.
      return {artifactId:receipt.artifactId,label:receipt.outcome.generated.plan.label};
    }finally{signal.removeEventListener('abort',forwardAbort);if(processAbort.current===abort){processAbort.current=null;setProcessPending(false);}}
  };
  const processSourceCurrent=!!processArtifact&&processArtifact.epoch===processEpoch.current&&workbenchState.rounds.at(-1)===processArtifact.round&&workbenchState.selectedRoundId===processArtifact.round.id;
  function openProcessSource(artifactId:string){
    const now=controller.workbench.getState();
    if(processView.current!=='process'||!processArtifact||processArtifact.epoch!==processEpoch.current||processArtifact.artifactId!==artifactId||now.rounds.at(-1)!==processArtifact.round||now.selectedRoundId!==processArtifact.round.id)return;
    navigate('ide');
  }
  useEffect(()=>{if(!focusTurn||focusIntent.current!=='workspace')return;const target=view==='editor'?workflowArea.current:view==='ide'?ideArea.current:view==='studio'?composer.current:view==='resources'?resourcesArea.current:view==='approvals'?approvalsArea.current:null;target?.focus({preventScroll:true});},[focusTurn,view]);
  function openWorkflow(proposal:EditableWorkflowResult,requestId:string){
    if(controller.getState().acceptedRequestId!==requestId||controller.getState().result!==proposal)return;
    if(!editorHandle.current?.confirmReplacement()){setPendingHandoff({requestId,result:proposal});return;}
    setPendingHandoff(null);setEditorGraph(proposal.status==='workflow-graph-proposed'?proposal.graph:proposal.graph??createGraphFromWorkflowSteps(proposal.workflow));
    setEditorRevision(revision=>revision+1);setWorkspaceDocumentKey(key=>key+1);setBuildReveal(true);setOpenedRequest(requestId);navigate('editor',{requestId,result:proposal,target:'editor'});
  }
  useEffect(()=>{
    const requestId=state.acceptedRequestId;
    if(!requestId||!result||handledRequest.current===requestId||controller.getState().result!==result)return;
    handledRequest.current=requestId;
    if(result.status==='workflow-proposed'||result.status==='workflow-graph-proposed')openWorkflow(result,requestId);
    else if(result.status==='subapp-result'&&result.outcome.status==='proposed'){setOpenedRequest(requestId);setPendingHandoff(null);navigate('ide',{requestId,result,target:'ide'});}
  },[state.acceptedRequestId,result,controller]);
  function openExample(){if(!editorHandle.current?.confirmReplacement())return;setEditorGraph(createWorkflowTemplate('branch'));setEditorRevision(revision=>revision+1);setWorkspaceDocumentKey(key=>key+1);setBuildReveal(false);setOpenedRequest(null);navigate('editor');}
  const chatActive=view==='studio'||view==='editor'||view==='ide';
  const inBuilder=view==='editor'||view==='ide';
  const chatHidden=!chatActive||(inBuilder&&(compact||chatCollapsed));
  useEffect(()=>{if(chatFocus&&!chatHidden&&focusIntent.current==='conversation'){composer.current?.focus({preventScroll:true});focusIntent.current='workspace';}},[chatFocus,chatHidden]);
  useEffect(()=>{if(chatHidden&&composer.current?.closest('.studio-chat')?.contains(document.activeElement)){focusIntent.current='workspace';setFocusTurn(turn=>turn+1);}},[chatHidden]);
  function toggleConversation(){if(compact){navigate('studio');return;}setChatCollapsed(value=>!value);if(chatCollapsed){focusIntent.current='conversation';setChatFocus(turn=>turn+1);}else{focusIntent.current='workspace';setFocusTurn(turn=>turn+1);}}
  const currentPending=pendingHandoff&&pendingHandoff.requestId===state.acceptedRequestId&&pendingHandoff.result===result?pendingHandoff:null;
  // Speak only fixed status/count summaries, never prompt/skill/source/approval payloads.
  const voiceReceipt=(()=>{
    if(busy)return 'Requesting a routed draft. This does not run or deploy a workflow or application.';
    if(state.phase==='cancelled')return 'Request cancelled. No draft was accepted. Remote work already started may still finish.';
    if(state.phase==='error')return 'The draft request failed. Review the message in the chat before trying again.';
    if(result?.status==='workflow-proposed'||result?.status==='workflow-graph-proposed')return result.graph?`Workflow draft received: ${result.graph.nodes.length} blocks and ${result.graph.edges.length} connections. Review required. It has not been executed or deployed.`:'Workflow draft received. Review required. It has not been executed or deployed.';
    if(result?.status==='subapp-result'&&result.outcome.status==='proposed')return `Sub-app draft received: ${result.outcome.generated.files.filter(file=>file.kind!=='standalone').length} generated files. Review its sources and checks. Nothing has been installed or deployed.`;
    if(outcome?.status==='needs_input')return 'More information is needed. Review the clarifying questions in the chat.';
    if(result?.status==='model-request-refused'&&result.review)return 'Review the exact context-send request in the chat before continuing. This is not execution or deployment approval.';
    if(result)return 'This draft was not accepted. Review the reason in the chat.';
    return 'Describe a workflow or sub-app. Creating an AI draft requires a configured model.';
  })();
  function send(){if(busy||processAbort.current||!usableSelection||!connectionId||!prompt.trim())return;setAnswers({});setConnectionHelp(false);void controller.submit({connectionId,prompt,...(projectId?{projectId}:{}),...(authoringEngine==='native-v1'?{authoringEngine:'native-v1' as const}:{})},token);}
  return <StudioShell area={view} onNavigate={navigate} onConnectionSettings={openConnectionSettings} project={projectId} model={selectedModel?`${selectedModel.label} · ${selectedModel.status} · not-probed${selectedModel.model?` · ${selectedModel.model}`:''}`:''} graphName={editorGraph?.name??'Untitled workflow'} motion={motion} onMotion={()=>setMotion(value=>!value)} appearance={appearance} onAppearance={setAppearance} voiceTools={<StudioVoiceMenu active={chatActive&&!anthropicSetupOpen} disabled={busy||connectionHelp||anthropicSetupOpen} scopeKey={voiceScopeKey} onDictation={text=>{editPrompt(current=>`${current}${current.trim()?' ':''}${text}`.slice(0,8000));navigate('studio');}}/>}>
    <VoiceNarration id={`${state.transcript.at(-1)?.requestId??'idle'}:${state.phase}`} text={voiceReceipt} active={chatActive&&!anthropicSetupOpen}/><style>{STUDIO_CSS}</style><div className="studio-builder-grid" data-entry="chat-first" data-home={state.transcript.length===0?'empty':'conversation'} data-area={view} data-conversation={chatHidden?'hidden':'visible'} hidden={!chatActive} inert={!chatActive}>
      {handoff&&handoff.requestId===state.acceptedRequestId&&handoff.result===result&&view===handoff.target&&<AcceptedHandoff receipt={handoff} onDismiss={dismissHandoff}/>}
      <section className="studio-chat" aria-label="Draft builder conversation" hidden={chatHidden} inert={chatHidden}>
        <header className="studio-chat-header" hidden={state.transcript.length===0&&view==='studio'}><h1>Conversation</h1><span className="studio-session-state">{busy?'Awaiting response':'Session only'}</span></header>
        <div className="studio-chat-scroll"><ConversationHistory turns={state.transcript} followTarget={outcome?.status==='needs_input'?'questions':'end'}/>

          <div className="studio-chat-review">
    {outcome?.status === "needs_input" && <form className="studio-card" onSubmit={(event) => { event.preventDefault(); if (usableSelection) void controller.answer(answers, token); }}><h2>Input needed</h2><p>{outcome.understanding}</p>{outcome.questions.map((question) => <label key={question.id} data-studio-question={question.id}>{question.question}<small>{question.because}</small>{question.options ? <select required value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })}><option value="">Choose…</option>{question.options.map((option) => <option key={option}>{option}</option>)}</select> : <input required maxLength={2000} value={answers[question.id] ?? ""} onChange={(event) => setAnswers({ ...answers, [question.id]: event.target.value })} />}</label>)}<button disabled={busy || !usableSelection} type="submit">Submit answers</button></form>}
    {outcome && outcome.status !== "needs_input" && outcome.status !== "proposed" && outcome.status !== "workflow-proposed" && outcome.status !== "workflow-graph-proposed" && <section className="studio-card" role="status"><h2>Studio declined this draft</h2><p><code>{outcome.status}</code></p>{"issues" in outcome && <ul>{outcome.issues.map((issue, index) => <li key={index}>{issue}</li>)}</ul>}{"decision" in outcome && <p>{outcome.decision.reason} · {outcome.status === "grant-refused" ? "grant refused" : "model/artifact refused"}</p>}{"explanation" in outcome && <p>{outcome.rule}: {outcome.explanation}</p>}{"refusals" in outcome && <ul>{outcome.refusals.map((refusal, index) => <li key={index}>{refusal.at}: {refusal.needs}</li>)}</ul>}<p>No draft accepted or deployed. Review the refusal or server configuration before trying again.</p></section>}
    {result?.status === "model-request-refused" && result.review && (controller.skillSendReviewCurrent ? <SkillSendReview key={result.review.hash} review={result.review} disabled={busy || !usableSelection} onSend={() => { if (usableSelection) void controller.approveSkillSend(token); }} /> : <p role="status">Skill-send review revoked because the request was edited. Create a draft again to review the current request; reverting text does not restore approval. Nothing was sent automatically.</p>)}

            {result?.status==='workflow-proposed'&&<div className="studio-artifact-receipt"><span className="studio-eyebrow">DRAFT RECEIVED / WORKFLOW</span><h3>{result.workflow.name}</h3><p>{result.graph?`${result.graph.nodes.length} graph nodes · ${result.graph.nodes.filter(node=>builtinRegistry.some(block=>block.type===node.type)).length} built-in blocks · ${result.graph.nodes.filter(node=>result.graph?.customBlocks.some(block=>block.id===node.type)).length} reusable wrapper instances · ${result.graph.customBlocks.length} wrapper definitions`:'Legacy intent ladder · unconfigured steps block execution'} · review required</p><button type="button" onClick={()=>openedRequest===state.acceptedRequestId?navigate('editor'):state.acceptedRequestId&&openWorkflow(result,state.acceptedRequestId)}>{currentPending?'Review / open workflow builder':'Open workflow builder'}</button>{currentPending&&<p role="status">Existing graph kept. This received draft is pending handoff; opening it requires confirming replacement of edited or unapplied settings.</p>}<details className="studio-artifact-details"><summary>Workflow &amp; page review</summary><WorkflowReview result={result}/></details></div>}
            {result?.status==='workflow-graph-proposed'&&<div className="studio-artifact-receipt"><span className="studio-eyebrow">DRAFT RECEIVED / WORKFLOW</span><h3>{result.graph.name}</h3><p>{result.graph.nodes.length} graph nodes · {result.graph.edges.length} connections · local declarative draft · review required</p><p>No host process scaffold or project pages were created.</p><button type="button" onClick={()=>openedRequest===state.acceptedRequestId?navigate('editor'):state.acceptedRequestId&&openWorkflow(result,state.acceptedRequestId)}>{currentPending?'Review / open workflow builder':'Open workflow builder'}</button>{currentPending&&<p role="status">Existing graph kept. Confirm replacement of edited or unapplied settings before opening this received draft.</p>}{result.warnings.map((warning,index)=><p key={index}>{warning}</p>)}</div>}
            {result?.status==='subapp-result'&&result.outcome.status==='proposed'&&<div className="studio-artifact-receipt"><span className="studio-eyebrow">DRAFT RECEIVED / SUB-APP</span><h3>{result.outcome.generated.plan.label}</h3><p>{result.outcome.generated.files.filter(file=>file.kind!=='standalone').length} source files · server conformance evidence received · review required</p><p>Host typecheck and mount not run by this frontend.</p><button type="button" onClick={()=>navigate('ide')}>Open sub-app IDE</button></div>}
          </div>
        </div>
        <div className="studio-command">
        {state.transcript.length===0&&<div className="studio-command-intro"><span className="studio-eyebrow">IDEA → DRAFT → WORKSPACE</span><h2>What are we building?</h2><p>Ask for a workflow or a sub-app.</p></div>}
        <section className="studio-compose" aria-label="Studio connection and request"><form onSubmit={event=>{event.preventDefault();send();}}><label><span className="studio-request-label">Your request</span><textarea ref={composer} required maxLength={8000} value={prompt} onChange={event=>editPrompt(event.target.value)} placeholder="What should this project help people do?" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter'){event.preventDefault();send();}}}/></label><div className="studio-composer-meta"><span>{prompt.length}/8000 <kbd>⌘ / Ctrl ↵</kbd></span><button type="button" disabled={!prompt} onClick={()=>editPrompt('')}>Clear request</button></div><div className="studio-send-row"><p role="status">{checking?'Loading server configuration — no model probe.':usableSelection?`${selectedModel?.label} · configured · not-probed · ${authoringEngine==='native-v1'?'Native draft harness':'JSON planner'}`:'Select a configured model in Connection settings before creating a draft.'}</p><button type="submit" disabled={busy||!usableSelection||!prompt.trim()} data-primary-action={usableSelection}>Create draft</button>{busy&&<button type="button" onClick={()=>controller.cancel()}>Cancel request</button>}{!usableSelection&&<button type="button" data-primary-action="true" onClick={openConnectionSettings}>Set up connection</button>}</div><details className="studio-request-boundary"><summary>Fresh draft · not deployed</summary><p className="studio-composer-boundary">Authoring only — saved-revision execution is separate in Workflow workspace. Each new request creates a fresh draft; it does not patch the open document.</p></details></form></section>
        {state.transcript.length===0&&<div className="studio-command-starters"><button type="button" onClick={()=>navigate('process')}>Start from a process / template</button><div className="studio-suggestions"><button type="button" data-kind="workflow" aria-label="Workflow suggestion: Governed intake workflow" onClick={()=>{editPrompt('Create a governed intake workflow with an independent human review before completion.');composer.current?.focus();}}>Governed intake workflow <span aria-hidden="true">↗</span></button><button type="button" data-kind="subapp" aria-label="Sub-app suggestion: Project review application" onClick={()=>{editPrompt('Create an isolated sub-app for tracking project review requests, with a list and a submission form.');composer.current?.focus();}}>Project review application <span aria-hidden="true">↗</span></button></div><p className="studio-chat-boundary">Suggestions only fill your request. Nothing is sent.</p><div className="studio-home-example"><button type="button" onClick={openExample}>Open workflow example</button><small>Local template · no AI request</small></div></div>}
        </div>
        <div className="studio-chat-setup">
      <details className="studio-connection-help" open={connectionHelp} onToggle={event => setConnectionHelp(event.currentTarget.open)}><summary>Project &amp; model setup</summary><div className="studio-connection"><label>Operator token<input ref={tokenInput} aria-label="Operator token" type="password" autoComplete="off" value={token} onChange={(event) => { setSetupContextEpoch(epoch=>epoch+1); invalidateContext(true); setToken(event.target.value); }} placeholder="STUDIO_OPERATOR_TOKEN" /></label><label>Project ID<input value={projectId} onChange={(event) => { setSetupContextEpoch(epoch=>epoch+1); invalidateContext(true); setProjectId(event.target.value); }} pattern="[a-z0-9][a-z0-9-]*" maxLength={64} placeholder="For project skills and page suggestions" /></label><p>The operator token stays in memory only. Never enter a model API key here.</p><AnthropicConnectionSetup token={token} contextEpoch={setupContextEpoch} active={view==='studio'&&connectionHelp} fetcher={fetcher} onOpenChange={setupOpenChanged} onMutationStarted={setupMutation} onChanged={setupMutation}/>
      <button type="button" disabled={busy || checking || !token || !projectId} onClick={async () => {
        invalidateContext(true);
        const turn = ++checkTurn.current; const abort = new AbortController(); checkAbort.current = abort;
        setChecking(true);
        try {
          const status = await checkConnection(projectId, token, fetcher, abort.signal);
          if (turn !== checkTurn.current || abort.signal.aborted) return;
          setConnection(status); setConnectionId(requireExplicitModel.current?'':status.selectedId ?? '');
        } catch { if (turn === checkTurn.current && !abort.signal.aborted) setConnectionError('Connection check refused or unavailable. Verify the operator token, project and server configuration; no model connection verified.'); }
        finally { if (turn === checkTurn.current) { setChecking(false); checkAbort.current = null; } }
      }}>{checking ? "Checking…" : "Check connection & project skills"}</button>
      <label>Model connection<select aria-label="Model connection" value={connectionId} onChange={event => { setSetupContextEpoch(epoch=>epoch+1); requireExplicitModel.current=false; invalidateContext(); setConnectionId(event.target.value as ModelConnectionId | ''); }}><option value="">Select a model connection…</option>{MODEL_CONNECTION_IDS.map(id => {
        const d = connection?.connections.find(item => item.id === id);
        const labels = { 'codex-chatgpt': 'ChatGPT subscription (native Codex)', flightdeck: 'Flightdeck model service', local: 'Local / OpenAI-compatible model', anthropic: 'Anthropic API' };
        return <option key={id} value={id} disabled={!d || d.status !== 'configured'}>{d?.label ?? labels[id]} · {d ? `${d.status} · not-probed${d.model ? ` · ${d.model}` : ''}${d.reason ? ` · ${d.reason}` : ''}` : 'not checked — authenticate to load configuration'}</option>;
      })}</select></label>
      <details className="studio-authoring-options"><summary>Authoring engine</summary>
        <label>Authoring engine<select aria-label="Authoring engine" value={authoringEngine} disabled={busy} onChange={event=>{
          const next=event.target.value;if(next!=='json-planner'&&next!=='native-v1'||next==='native-v1'&&!nativeReady)return;
          if(authoringChecking)cancelAuthoringAvailability();
          controller.clearReceivedHandoff();setAnswers({});setHandoff(null);setPendingHandoff(null);setOpenedRequest(null);handledRequest.current=null;rotateVoiceScope();setAuthoringEngine(next);
        }}><option value="json-planner">JSON planner · existing default</option><option value="native-v1" disabled={!nativeReady}>Native draft harness · Anthropic only</option></select></label>
        <button type="button" disabled={busy||checking||authoringChecking||anthropicSetupOpen||!token||connectionId!=='anthropic'||!connection?.connections.some(item=>item.id==='anthropic'&&item.status==='configured')} onClick={async()=>{
          authoringAbort.current?.abort();const abort=new AbortController();const turn=++authoringTurn.current;authoringAbort.current=abort;setAuthoringChecking(true);setAuthoringAvailability(null);setAuthoringError(null);
          try{const metadata=await readAuthoringAvailability(token,abort.signal,fetcher);if(turn===authoringTurn.current&&!abort.signal.aborted)setAuthoringAvailability(metadata);}
          catch{if(turn===authoringTurn.current&&!abort.signal.aborted)setAuthoringError('Native authoring configuration unavailable. No native request or fallback was made.');}
          finally{if(turn===authoringTurn.current){setAuthoringChecking(false);authoringAbort.current=null;}}
        }}>{authoringChecking?'Checking authoring configuration…':'Check native authoring availability'}</button>
        {authoringChecking&&<button type="button" onClick={cancelAuthoringAvailability}>Cancel native availability check</button>}
        <p>Native drafting needs explicit server opt-in and the Anthropic connection. Checking reads configuration only; it never calls a model or selects an engine. Choose Native explicitly after checking. No automatic fallback.</p>
        <p role="status">{authoringChecking?'Reading server authoring metadata.':authoringAvailability?.enabled?'Native draft harness available · at most 6 total model sends and 16 authoring tools per request · drafts only.':authoringAvailability?'Native draft harness is disabled on this server.':'Native authoring not checked or unavailable on this server.'}</p>
        {authoringEngine==='native-v1'&&!nativeReady&&<p role="alert">Native authoring is not available for the current context. Check the Anthropic connection and native availability again, or explicitly choose JSON planner. No fallback is attempted.</p>}
        {authoringError&&<p role="alert">{authoringError}</p>}
      </details>
      <p>Model configuration is server-only; configured does not mean connected. All connections are not-probed; checking does not call a model.</p>
      {!token && <p role="status">No backend credentials supplied. The local editor is usable without a model selection.</p>}
      {connection && <div role="status"><p>Operator-authenticated server configuration loaded. {connection.selectedId ? `Explicit server default: ${connection.selectedId}.` : 'No server default; choose a destination explicitly.'}</p>{connection.connections.map(d => <p key={d.id}>{d.label}: {d.status} · {d.verification}{d.model && ` · ${d.model}`}{d.reason && ` — ${d.reason}`}</p>)}</div>}
      {connectionError && <p role="alert">{connectionError}</p>}
      <p role="status">{connection ? `Project skills: ${connection.skillSourceState} — ${connection.skillSources.length} source(s) for ${connection.projectId}.` : result?.skillSourceState ? `Project skills: ${result.skillSourceState} — reported by the server.` : result?.status === "workflow-proposed" ? `Project skills: ${result.skillSources.length} source(s) returned by server for ${result.projectId}.` : "Project skills: not checked — loaded server-side for the requested project; no arbitrary local paths are accepted."}</p></div></details>
    <details className="studio-config"><summary>Server configuration &amp; connection help</summary><p>Production: the built Studio app and backend share the same origin when your deployment enables built-asset serving. Use your deployment’s Studio URL; Vite is not a production serving requirement. API routes remain under <code>/api/studio</code>. Serving the app does not configure a model, authenticate an operator or grant host project access.</p><p>Development only: run <code>npm run dev:server</code> and <code>npm run dev</code>. The Vite development server proxies same-origin Studio API requests to port 8787 (or configured PORT); this proxy is not needed for the production same-origin built app.</p><p>Server environment: <code>STUDIO_OPERATOR</code> (actual named human), <code>STUDIO_OPERATOR_TOKEN</code> (at least 24 characters) and a server-owned model connection. Choose one of ChatGPT subscription / native Codex, Flightdeck service, local model or Anthropic API; unavailable destinations remain visible with reasons. Codex requires a verified zero-tool boundary and Flightdeck requires an approved Studio bridge. Local configuration uses <code>STUDIO_LOCAL_BASE_URL</code> / <code>STUDIO_LOCAL_MODEL</code>; Anthropic uses <code>ANTHROPIC_API_KEY</code> (server only). Optional <code>STUDIO_MODEL_CONNECTION</code> is an explicit operator default, never a fallback. Project skills require a configured server-side ProjectSkillSource or <code>STUDIO_PROJECT_SKILLS_FILE</code>. A project ID does not itself establish skill availability or host authorization.</p></details>

        </div>
      </section>

      <section className="studio-technical-area" ref={workflowArea} tabIndex={-1} hidden={view!=='editor'} inert={view!=='editor'} aria-label="Workflow editor area"><div className="studio-workspace-heading"><div><span className="studio-eyebrow">WORKSPACE / WORKFLOW</span><strong>{editorGraph?.name??'Untitled workflow'}</strong></div><div className="studio-workspace-actions">{!compact&&<button type="button" aria-expanded={!chatCollapsed} onClick={toggleConversation}>{chatCollapsed?'Show conversation':'Hide conversation'}</button>}<button type="button" onClick={()=>navigate('studio')}>Discuss draft</button></div></div><div className="studio-editor-note"><p role="status">Local graph draft · no automatic save.</p><details className="studio-editor-help"><summary>Local run &amp; draft help</summary><p>Server saves and execution require an operator credential and project.</p>{!token&&<p>No backend credentials supplied. Local editing and deterministic local execution need no model connection.</p>}<p>Try <code>{'{"approved":true}'}</code> in Local execution input, then Run locally; the condition follows the true branch. This boolean is routing data, not a human-approval authorization. HTTP/LLM adapters are not configured.</p><p>Graph JSON export contains your edits. Project-page suggestions remain tied to the original AI draft; regenerate them if you change its steps.</p></details></div>
        <WorkflowEditor ref={editorHandle} key={editorRevision} active={view==='editor'} narration={{enabled:voice.enabled,speak:voice.speak,stop:voice.stop}} buildReveal={buildReveal} {...(editorGraph===undefined?{}:{initialGraph:editorGraph})} onChange={setEditorGraph} {...(!usableSelection||!connectionId?{}:{onRequestBlock:async({prompt:blockPrompt}:{prompt:string})=>{blockAbort.current?.abort();const abort=new AbortController();blockAbort.current=abort;try{const block=await proposeBlock(blockPrompt,connectionId,token,abort.signal,fetcher);if(abort.signal.aborted||blockAbort.current!==abort)throw new DOMException('Cancelled','AbortError');return block;}finally{if(blockAbort.current===abort)blockAbort.current=null;}}})}/>
        <WorkflowWorkspace controller={workspaceController} {...(editorGraph===undefined?{}:{graph:editorGraph})} projectId={projectId} token={token} documentKey={workspaceDocumentKey} onLoadGraph={graph=>{setEditorGraph(graph);setEditorRevision(revision=>revision+1);setBuildReveal(false);}}/>
      </section>
      <section className="studio-technical-area studio-ide-area" ref={ideArea} tabIndex={-1} hidden={view!=='ide'} inert={view!=='ide'} aria-label="Sub-app IDE area"><div className="studio-workspace-heading"><div><span className="studio-eyebrow">WORKSPACE / SUB-APP IDE</span><details className="studio-ide-help"><summary>Draft · scriptless preview</summary><p className="studio-ide-boundary">Draft — not deployed. The preview is scriptless; generated source is not evaluated. In-session Save applies an editor buffer; use Saved sub-app to Save draft and reopen durable source separately.</p></details></div><div className="studio-workspace-actions"><SubappWorkspace store={controller.workbench} projectId={projectId} token={token} active={view==='ide'&&!busy} fetcher={fetcher} onLoaded={()=>{controller.clearReceivedHandoff();setHandoff(null);setPendingHandoff(null);setOpenedRequest(null);handledRequest.current=null;}}/>{!compact&&<button type="button" aria-expanded={!chatCollapsed} onClick={toggleConversation}>{chatCollapsed?'Show conversation':'Hide conversation'}</button>}<button type="button" onClick={()=>navigate('studio')}>Discuss draft</button></div></div><Workbench store={controller.workbench} hideChat buildReveal active={view==='ide'} onPrompt={(text,turnId)=>{if(!usableSelection||!connectionId){controller.workbench.abort(turnId,'Select a usable model connection.');return;}void controller.submit({connectionId,prompt:text,...(projectId?{projectId}:{}),...(authoringEngine==='native-v1'?{authoringEngine:'native-v1' as const}:{})},token,turnId);}} onStop={()=>controller.cancel()}/></section>
    </div>
    <ProcessStudio active={view==='process'} scopeEpoch={processScopeEpoch} projectId={projectId} buildAvailable={processAvailable} buildUnavailableReason={aiBusy||workbenchState.busy?'Wait for current AI authoring to settle before building a process draft.':connection?.projectId===projectId&&connection.processBuild!=='registered-templates-v1'?'This server does not advertise registered-template builds. No model fallback or automatic request is made.':'Authenticate and check the current project to enable registered-template builds. No model is required.'} onBuild={buildProcess} onOpenStudio={()=>navigate('studio')} onConnectionSettings={openConnectionSettings} {...(processSourceCurrent?{onOpenGeneratedSource:openProcessSource}:{})}/>
    <section ref={resourcesArea} tabIndex={-1} hidden={view!=='resources'} inert={view!=='resources'} aria-label="Resources area"><ResourceLibrary projectId={projectId} token={token} fetcher={fetcher} onCredentials={openConnectionSettings} onSelectResource={selection=>{if(!token||!projectId||resourceScope.current.token!==token||resourceScope.current.projectId!==projectId)return;const inserted=editorHandle.current?.insertResource(selection);if(inserted?.ok){setResourceInsertError('');navigate('editor');}else setResourceInsertError(inserted?.error??'Workflow editor unavailable. Resource was not inserted.');}}/>{resourceInsertError&&<p role="alert">{resourceInsertError}</p>}</section>
    <section ref={approvalsArea} tabIndex={-1} hidden={view!=='approvals'} inert={view!=='approvals'} aria-label="Approvals area"><WorkflowApprovals projectId={projectId} token={token} fetcher={fetcher} active={view==='approvals'} onCredentials={openConnectionSettings}/></section>
  </StudioShell>;
}

const STUDIO_CSS = `
.studio{min-height:100vh;background:var(--bg,#f3f6f7);color:var(--ink,#253d4b);font:14px/1.6 Arial,Helvetica,"Segoe UI",sans-serif}
.studio *{box-sizing:border-box}
.studio{max-width:1500px;margin:0 auto;padding:36px}
.studio-header{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;margin-bottom:26px}
.studio h1{font-size:36px;letter-spacing:-1px;margin:12px 0}
.studio h2{font-size:22px}
.studio h3{font-size:16px}
.studio p,.studio li{line-height:1.6;color:var(--muted,#586e7c)}
.studio code{color:var(--ink,#253d4b);overflow-wrap:anywhere}
.studio-eyebrow{font-size:11px;font-weight:700;letter-spacing:2px;color:var(--te,#e98300)}
.studio-notice,.studio-badge{display:inline-block;color:var(--amber,#806620)!important;background:color-mix(in srgb,var(--amber,#806620) 8%,var(--surface,#fff));border:1px solid color-mix(in srgb,var(--amber,#806620) 35%,var(--line,#d5dfe5));border-radius:6px;padding:7px 12px;font-size:12px}
.studio-compose{display:grid;grid-template-columns:minmax(240px,1fr) minmax(300px,2fr);gap:28px;border:1px solid var(--line,#d5dfe5);background:var(--surface,#fff);padding:24px;border-radius:12px}
.studio label{display:flex;flex-direction:column;gap:8px;font-size:13px;margin-bottom:16px}
.studio input,.studio textarea,.studio select{font:inherit;color:var(--ink,#253d4b);background:var(--bg,#f3f6f7);border:1px solid var(--line,#d5dfe5);border-radius:6px;padding:12px;width:100%}
.studio textarea{min-height:160px;resize:vertical}
.studio input[type=checkbox]{width:auto}
.studio button{font:inherit;font-size:13px;border:1px solid var(--line,#d5dfe5);background:var(--surface,#fff);color:var(--ink,#253d4b);border-radius:6px;padding:11px 16px;cursor:pointer}
.studio button:disabled{opacity:.45;cursor:not-allowed}
.studio button:focus-visible,.studio input:focus-visible,.studio textarea:focus-visible{outline:2px solid var(--te,#e98300);outline-offset:2px}
.studio-actions{display:flex;gap:4px;flex-wrap:wrap;border-bottom:1px solid var(--line,#d5dfe5);padding-bottom:8px}
.studio-actions button{background:transparent;border-color:transparent;border-radius:8px}
.studio-actions button[aria-pressed=true]{color:var(--ink,#253d4b);border-color:var(--line,#d5dfe5);background:var(--surface,#fff);box-shadow:var(--shadow,none)}
.studio-actions button:hover{background:var(--surface2,#f8fafb)}
.studio-connection p,.studio-config{font-size:12px;color:var(--muted,#586e7c)}
.studio-config{margin:16px 0;padding:14px 0}
.studio summary{cursor:pointer}
.studio-status [role=alert]{padding:16px;border:1px solid var(--red,#aa3122);background:color-mix(in srgb,var(--red,#aa3122) 8%,var(--surface,#fff));border-radius:8px;color:var(--red,#aa3122)}
.studio-determination{padding:20px 0;border-top:1px solid var(--line,#d5dfe5)}
.studio-review{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.studio-card{background:var(--surface,#fff);border:1px solid var(--line,#d5dfe5);border-radius:10px;padding:24px}
.studio-card li{margin:8px 0}
.studio-badge{margin-left:12px;padding:3px 8px}
.studio-page{border-bottom:1px solid var(--line,#d5dfe5);padding:8px 0}
.studio-handoff{grid-column:1/-1}
.studio-handoff label{flex-direction:row;align-items:flex-start}
.studio small{color:var(--muted,#586e7c)}
.studio .fd-wb{height:760px;border:1px solid var(--line,#d5dfe5);border-radius:10px;overflow:hidden}
@media(max-width:850px){.studio{padding:20px}
.studio-header{display:block}
.studio-compose,.studio-review{grid-template-columns:1fr}
.studio h1{font-size:28px}
.studio .fd-wb{height:850px}}
`;