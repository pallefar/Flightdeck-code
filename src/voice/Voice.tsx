import {createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore} from 'react';
import type {ReactNode} from 'react';
import {VoiceController} from './controller';
import {browserVoicePorts} from './browser';
import type {VoicePorts} from './ports';
import './voice.css';

const Context = createContext<VoiceController | null>(null);
const inactive = new VoiceController();
const noop = () => {};
const inactiveSubscribe = () => noop;

/** Internal injection seam used by explicitly labelled DEVELOPMENT event fixtures. */
export function VoiceSession({controller, ports, children}: {controller: VoiceController; ports?: VoicePorts; children: ReactNode}) {
  useLayoutEffect(() => {
    controller.connect(ports ?? browserVoicePorts());
    return controller.disconnect;
  }, [controller, ports]);
  return <Context.Provider value={controller}>{children}</Context.Provider>;
}
export function VoiceProvider({scopeKey, children}: {scopeKey: string; children: ReactNode}) {
  // A fresh controller masks prior scope immediately; layout cleanup aborts old resources at commit.
  const controller = useMemo(() => new VoiceController(), [scopeKey]);
  return <VoiceSession controller={controller}>{children}</VoiceSession>;
}
export function useVoice() {
  const controller = useContext(Context);
  const state = useSyncExternalStore(controller?.subscribe ?? inactiveSubscribe, controller?.getSnapshot ?? inactive.getSnapshot, inactive.getSnapshot);
  return {...state, speak: controller?.speak ?? noop, stop: controller?.stop ?? noop};
}

export function VoiceCore({variant = 'compact'}: {variant?: 'compact' | 'standby'}) {
  const {status, enabled} = useVoice();
  const state = enabled ? status : 'off';
  return <span className={`fd-voice fd-voice-core fd-voice-core--${variant}`} data-voice-state={state} role="img" aria-label={`Voice activity: ${state}`}>
    <span className="fd-voice-grid" aria-hidden="true"/>
    <svg className="fd-voice-orbits" viewBox="0 0 200 200" fill="none" aria-hidden="true">
      <circle className="fd-voice-track" cx="100" cy="100" r="86"/>
      <circle className="fd-voice-ring fd-voice-ring--outer" cx="100" cy="100" r="86" strokeDasharray="60 14 4 14 30 14 4 14"/>
      <circle className="fd-voice-ring fd-voice-ring--inner" cx="100" cy="100" r="65" strokeDasharray="90 20 4 20"/>
      <path className="fd-voice-marks" d="M100 6v10m0 168v10M6 100h10m168 0h10M35 35l7 7m116 116 7 7M35 165l7-7m116-116 7-7"/>
      <path className="fd-voice-reticle" d="M75 72H62v13m63-13h13v13M62 115v13h13m50 0h13v-13"/>
    </svg>
    <span className="fd-voice-heart" aria-hidden="true"><i/><i/><i/><i/><i/></span>
    {variant === 'standby' && <span className="fd-voice-core-caption" aria-hidden="true">{state === 'off' ? 'VOICE · OFF' : `VOICE · ${state.toUpperCase()}`}</span>}
  </span>;
}

export interface VoiceControlsProps {
  onDictation: (text: string) => void;
  /** Busy/non-composer: abort/block dictation only; safe opted-in status speech may continue. */
  disabled?: boolean;
  /** Hidden/inactive surface: stop all voice, revoke consents, require a new enable gesture. */
  active?: boolean;
}
export function VoiceControls({onDictation, disabled = false, active = true}: VoiceControlsProps) {
  const controller = useContext(Context);
  const state = useVoice();
  const sink = useRef({onDictation, disabled, active});
  sink.current = {onDictation, disabled, active};
  useLayoutEffect(() => {controller?.setDisabled(disabled || !active);}, [controller, disabled, active]);
  useLayoutEffect(() => {if (!active) controller?.setEnabled(false);}, [controller, active]);
  useLayoutEffect(() => () => {controller?.setEnabled(false);}, [controller]);
  const selected = state.voices.find(voice => voice.voiceURI === state.voiceId);
  const speechAvailable = !!selected && (selected.localService || state.remoteSpeechConsent);
  const micActive = state.status === 'listening' || state.status === 'preparing';
  const stopAvailable = micActive || state.status === 'speaking' || state.status === 'queued';
  const blocked = !state.enabled || disabled || !active || state.microphoneBlocked || !state.recognitionSupported || state.pack === 'checking';
  const localCheck = state.recognitionMode === 'local' && state.pack !== 'available';
  const dictate = () => {
    if (localCheck) {void controller?.checkLocalAvailability(); return;}
    controller?.startDictation(text => {if (!sink.current.disabled && sink.current.active) sink.current.onDictation(text);});
  };
  return <div className="fd-voice fd-voice-controls" role="group" aria-label="Voice copilot" data-voice-state={state.enabled ? state.status : 'off'}>
    <div className="fd-voice-toolbar">
      <VoiceCore/>
      <div className="fd-voice-state"><strong>Voice <span>{state.enabled ? state.status : 'off'}</span></strong><small>{state.enabled ? 'Opt-in feedback · draft-only dictation' : 'Optional speech · keyboard always available'}</small></div>
      <button type="button" className="fd-voice-toggle" disabled={!controller || !active} aria-pressed={state.enabled} onClick={() => controller?.setEnabled(!state.enabled)}>{state.enabled ? 'Turn voice off' : 'Enable voice'}</button>
      {state.enabled && <><button type="button" disabled={blocked || micActive || (state.recognitionMode === 'browser' && !state.remoteRecognitionConsent)} onClick={dictate}>{localCheck ? 'Check dictation' : 'Dictate'}</button>
      <button type="button" className="fd-voice-stop" disabled={!stopAvailable} onClick={state.stop}>Stop</button></>}
    </div>
    <p className="fd-voice-message" role="status" aria-live="polite">{state.enabled ? state.message : state.message === 'Voice is off.' ? 'Draft text only. Voice never sends, runs, approves or deploys.' : state.message}</p>
    {state.interim && <p className="fd-voice-interim"><b>Interim preview · not added:</b> {state.interim}</p>}
    <details className="fd-voice-options"><summary>Voice options <span>privacy · language · sound</span></summary>
      <div className="fd-voice-options-grid">
        <label>Speaking voice<select aria-label="Speaking voice" value={state.voiceId} disabled={!active} onChange={event => controller?.setVoice(event.target.value)}><option value="">{state.voices.length ? 'Choose an explicit voice' : 'No browser voices available'}</option>{state.voices.map((voice, index) => <option key={`${voice.voiceURI}-${index}`} value={voice.voiceURI}>{voice.name} · {voice.lang} · {voice.localService ? 'local' : 'remote'}</option>)}</select></label>
        <label>Speaking rate<select aria-label="Speaking rate" value={state.rate} disabled={!active} onChange={event => controller?.setRate(Number(event.target.value))}><option value={0.8}>Calm · 0.8×</option><option value={1}>Natural · 1×</option><option value={1.2}>Brisk · 1.2×</option></select></label>
        <label>Dictation language<select aria-label="Dictation language" value={state.language} disabled={!active || disabled} onChange={event => controller?.setLanguage(event.target.value)}>{['en-GB', 'en-US', 'da-DK', 'de-DE', 'fr-FR', 'es-ES'].map(language => <option key={language} value={language}>{language}</option>)}</select></label>
        <label>Dictation processing<select aria-label="Dictation processing" value={state.recognitionMode} disabled={!active || disabled} onChange={event => controller?.setRecognitionMode(event.target.value === 'browser' ? 'browser' : 'local')}><option value="local">On-device only · no fallback</option><option value="browser">Browser-managed · may be remote</option></select></label>
      </div>
      <p>Available local UK-English voices are preferred. Choose your actual installed voice and dictation language; browser support and language packs vary. No actor voice imitation. No voice download is started here.</p>
      {selected && !selected.localService && <label className="fd-voice-consent"><input type="checkbox" checked={state.remoteSpeechConsent} disabled={!active || !state.enabled} onChange={event => controller?.setRemoteSpeechConsent(event.target.checked)}/>I allow this remote browser voice to process short status text; text may leave this device.</label>}
      {state.recognitionMode === 'browser' && <label className="fd-voice-consent"><input type="checkbox" checked={state.remoteRecognitionConsent} disabled={!active || disabled || !state.enabled} onChange={event => controller?.setRemoteRecognitionConsent(event.target.checked)}/>I allow browser-managed dictation; audio may leave this device for the browser vendor. This mode does not guarantee remote service availability.</label>}
      <div className="fd-voice-test"><button type="button" disabled={!state.enabled || !active || !speechAvailable || micActive} onClick={() => state.speak('Flightdeck voice feedback is ready. Dictation adds text to your draft. You remain in control.')}>Test voice</button><span>{!state.voices.length ? 'No voices reported yet. Speech is unavailable; no default remote voice will be used.' : 'The test speaks a fixed, neutral sentence, not your draft.'}</span></div>
      {state.microphoneBlocked && <p>Microphone access is blocked by the server Permissions Policy, not an unsupported speech API. Ask the operator to enable voice input.</p>}
      {!state.recognitionSupported && <p>This browser has not exposed a dictation API. Use your keyboard; try a supported browser if you need dictation.</p>}
      {state.recognitionMode === 'local' && !state.localRecognition && <p>On-device dictation is not exposed here. There is no automatic switch to browser-managed recognition.</p>}
      <p>Press Check dictation to check a local pack without opening the microphone, then press Dictate again to grant microphone access. Dictation stops after 60 seconds. It never sends, runs, approves or deploys; no wake word, background listening, audio storage or transcript logging.</p>
      <p>Animated arcs indicate browser listening/speaking events, not measured audio levels. Browser speech has a shared global queue: another host component can interfere if it queues audio during Flightdeck speech. Flightdeck will not interrupt a queue it does not own.</p>
    </details>
  </div>;
}

/** Caller supplies only fixed safe accepted-event summaries, never prompt/source/skill/approval payloads. */
export function VoiceNarration({id, text, active = true}: {id: string; text: string; active?: boolean}) {
  const controller = useContext(Context);
  useEffect(() => {controller?.announce(id, text, active);}, [controller, id, text, active]);
  return null;
}
