// DEVELOPMENT ONLY. Native mode uses real browser ports; events mode is explicitly injected, never acoustic evidence.
import {StrictMode, useEffect, useMemo, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {VoiceControls, VoiceCore, VoiceNarration, VoiceProvider, useVoice} from '../index';
import {VoiceSession} from '../Voice';
import {VoiceController} from '../controller';
import type {RecognitionEvent, RecognitionPort, UtterancePort, VoicePorts} from '../ports';
import './fixture.css';

const events = new URLSearchParams(location.search).get('mode') === 'events';
const evidence = {mode: events ? 'injected-events-not-acoustic' : 'native-browser', starts: 0, aborts: 0, speaks: 0, cancels: 0, appends: 0, statuses: [] as string[], errors: [] as string[], cspViolations: [] as string[], checks: [] as string[]};
document.addEventListener('securitypolicyviolation', event => evidence.cspViolations.push(event.violatedDirective));
window.addEventListener('error', event => evidence.errors.push(event.message));
let recognition: RecognitionPort | undefined;
let utterance: UtterancePort | undefined;
let staleResult: ((event: RecognitionEvent) => void) | null = null;
const injected: VoicePorts = {
  hidden: () => document.hidden,
  onVisibility: callback => {document.addEventListener('visibilitychange', callback); return () => document.removeEventListener('visibilitychange', callback);},
  microphoneAllowed: () => true, onDeviceAllowed: () => true,
  synthesis: {
    getVoices: () => [{voiceURI: 'development-local-en-GB', name: 'DEVELOPMENT event voice — no audio', lang: 'en-GB', localService: true}],
    createUtterance: () => {utterance = {voice: null, lang: '', rate: 1, onstart: null, onend: null, onerror: null}; return utterance;},
    speak: () => {evidence.speaks++;}, cancel: () => {evidence.cancels++;}, busy: () => false,
    onVoicesChanged: () => () => {},
  },
  recognition: {local: true, available: async () => 'available', create: () => {
    recognition = {lang: '', continuous: false, interimResults: false, maxAlternatives: 1, onstart: null, onend: null, onerror: null, onresult: null,
      start: () => {evidence.starts++;}, abort: () => {evidence.aborts++;}};
    return recognition;
  }},
};
function Observer() {
  const state = useVoice();
  useEffect(() => {evidence.statuses.push(state.status);}, [state.status]);
  return <output id="native-status" data-status={state.status}>{state.message}</output>;
}
function Surface() {
  const [scope, setScope] = useState(1);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(true);
  const [text, setText] = useState('');
  const [receipt, setReceipt] = useState(0);
  const controller = useMemo(() => new VoiceController(), [scope]);
  const contents = <>
    <div className="fixture-layout"><section className="fixture-composer"><h2>Describe a draft</h2><p>Voice adds plain text here. This fixture has no model, send, approval or execution action.</p><textarea aria-label="Development composer" value={text} onChange={event => setText(event.target.value)}/><VoiceControls disabled={busy} active={active} onDictation={value => {evidence.appends++; setText(current => `${current}${current ? ' ' : ''}${value}`);}}/><VoiceNarration id={`receipt-${receipt}`} text="A newly accepted development draft is ready for review." active={receipt > 0}/></section><aside className="fixture-standby"><VoiceCore variant="standby"/><h2>Voice is your co-pilot.</h2><p>Explicit speech feedback.<br/>You keep command authority.</p><Observer/></aside></div>
    <nav aria-label="Development fixture controls"><button onClick={() => setScope(current => current + 1)}>Change scope</button><button onClick={() => setBusy(current => !current)}>Toggle composer busy</button><button onClick={() => setActive(current => !current)}>Toggle surface active</button><button onClick={() => setReceipt(current => current + 1)}>Accept neutral receipt</button><button onClick={() => {document.getElementById('fixture')?.toggleAttribute('data-motion'); const root = document.getElementById('fixture'); if (root?.hasAttribute('data-motion')) root.setAttribute('data-motion', 'off');}}>Toggle motion off</button></nav>
    {events && <nav aria-label="Injected DEVELOPMENT events"><button onClick={() => utterance?.onstart?.()}>Emit speaking event · no audio</button><button onClick={() => utterance?.onend?.()}>Emit speech end</button><button onClick={() => recognition?.onstart?.()}>Emit listening event · no mic</button><button onClick={() => {staleResult = recognition?.onresult ?? null; recognition?.onresult?.({resultIndex: 0, results: [{isFinal: true, 0: {transcript: 'A neutral development draft.'}}]});}}>Emit neutral final result</button><button onClick={() => recognition?.onerror?.({error: 'not-allowed'})}>Emit denied error</button><button onClick={() => staleResult?.({resultIndex: 1, results: [{isFinal: true, 0: {transcript: 'prior final'}}, {isFinal: true, 0: {transcript: 'stale final must not append'}}]})}>Emit stale result</button></nav>}
  </>;
  return <main className="fixture-shell"><header><strong>FLIGHTDECK / VOICE</strong><span>DEVELOPMENT verification · {events ? 'Injected event lifecycle — no audio or acoustic transcription' : 'Native browser APIs — no automatic microphone start'}</span></header>{events ? <VoiceSession controller={controller} ports={injected}>{contents}</VoiceSession> : <VoiceProvider scopeKey={`development-scope-${scope}`}>{contents}</VoiceProvider>}</main>;
}
const root = createRoot(document.getElementById('fixture')!);
root.render(<StrictMode><Surface/></StrictMode>);
function assert(condition: unknown, label: string) {if (!condition) throw new Error(label); evidence.checks.push(label);}
function button(label: string) {const item = [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent === label); if (!item) throw new Error(`Missing button: ${label}`); return item;}
const pause = () => new Promise(resolve => setTimeout(resolve, 35));
async function runEvents() {
  if (!events) throw new Error('Injected checks require ?mode=events. Never count these as acoustic verification.');
  await pause();
  assert(evidence.starts === 0 && evidence.speaks === 0, 'StrictMode mount never starts mic or speech');
  button('Accept neutral receipt').click(); await pause();
  button('Enable voice').click(); await pause();
  assert(evidence.speaks === 0 && evidence.starts === 0, 'Enabling does not replay old receipt or start mic');
  button('Check dictation').click(); await pause();
  assert(evidence.starts === 0, 'Language check does not start mic');
  button('Dictate').click(); await pause();
  assert(evidence.starts === 1 && document.querySelector('[data-status="preparing"]'), 'Explicit Dictate queues start but does not claim Listening');
  button('Emit listening event · no mic').click(); await pause();
  assert(document.querySelector('.fd-voice-core--standby')?.getAttribute('data-voice-state') === 'listening', 'Listening core follows injected start event');
  button('Emit neutral final result').click(); button('Emit neutral final result').click(); await pause();
  assert(evidence.appends === 1, 'Final result is appended once, no automatic send');
  button('Toggle composer busy').click(); await pause(); button('Emit stale result').click(); await pause();
  assert(evidence.aborts === 1 && evidence.appends === 1, 'Busy aborts dictation and discards late final result');
  button('Accept neutral receipt').click(); await pause();
  assert(evidence.speaks === 1, 'Safe actual-event narration can queue while composer busy');
  assert(document.querySelector('.fd-voice-core--standby')?.getAttribute('data-voice-state') === 'queued', 'Queue is static until a speech event');
  button('Emit speaking event · no audio').click(); await pause();
  assert(document.querySelector('.fd-voice-core--standby')?.getAttribute('data-voice-state') === 'speaking', 'Speaking core follows injected utterance start');
  button('Stop').click(); await pause();
  assert(evidence.cancels === 1, 'Stop cancels only owned utterance');
  button('Change scope').click(); await pause();
  assert(button('Enable voice').getAttribute('aria-pressed') === 'false', 'Scope change resets opt-in');
  button('Emit stale result').click(); await pause();
  assert(evidence.appends === 1, 'Prior scope cannot append delayed dictation');
  const width = document.documentElement.scrollWidth;
  assert(width <= innerWidth, 'No document horizontal overflow');
  assert([...document.querySelectorAll<HTMLElement>('.fd-voice-controls button')].every(node => !node.getClientRects().length || node.getBoundingClientRect().height >= 44), 'Voice controls have 44px targets');
  assert(evidence.errors.length === 0, 'No uncaught browser errors');
  return {...evidence, viewport: {width: innerWidth, height: innerHeight, documentWidth: width}};
}
function probe() {
  const scope = window as unknown as {SpeechRecognition?: {prototype: object; available?: unknown}; webkitSpeechRecognition?: {prototype: object; available?: unknown}};
  const Recognition = scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
  const policy = (document as unknown as {permissionsPolicy?: {allowsFeature: (feature: string) => boolean}; featurePolicy?: {allowsFeature: (feature: string) => boolean}}).permissionsPolicy ?? (document as unknown as {featurePolicy?: {allowsFeature: (feature: string) => boolean}}).featurePolicy;
  return {mode: evidence.mode, secure: isSecureContext, recognition: !!Recognition, localRecognition: !!Recognition && 'processLocally' in Recognition.prototype, availability: typeof Recognition?.available === 'function', synthesis: !!window.speechSynthesis, voices: window.speechSynthesis?.getVoices().map(voice => ({name: voice.name, language: voice.lang, local: voice.localService})), microphonePolicy: policy?.allowsFeature('microphone'), onDevicePolicy: policy?.allowsFeature('on-device-speech-recognition'), status: document.querySelector('#native-status')?.textContent, evidence: events ? evidence : {mode: evidence.mode, statuses: evidence.statuses, errors: evidence.errors, cspViolations: evidence.cspViolations, checks: evidence.checks}};
}
Object.assign(window, {__voiceEvidence: evidence, __voiceFixture: {runEvents, probe, unmount: () => root.unmount()}});
