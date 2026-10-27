import type {RecognitionPort, UtterancePort, VoiceChoice, VoicePorts} from './ports';

export type VoiceStatus = 'off' | 'idle' | 'preparing' | 'listening' | 'queued' | 'speaking' | 'error' | 'unavailable';
export interface VoiceState {
  enabled: boolean;
  status: VoiceStatus;
  message: string;
  voices: VoiceChoice[];
  voiceId: string;
  rate: number;
  language: string;
  interim: string;
  disabled: boolean;
  recognitionSupported: boolean;
  localRecognition: boolean;
  microphoneBlocked: boolean;
  localPolicyBlocked: boolean;
  recognitionMode: 'local' | 'browser';
  pack: 'unchecked' | 'checking' | 'available' | 'unavailable';
  remoteSpeechConsent: boolean;
  remoteRecognitionConsent: boolean;
}
const initial = (): VoiceState => ({
  enabled: false, status: 'off', message: 'Voice is off.', voices: [], voiceId: '',
  rate: 1, language: 'en-GB', interim: '', disabled: false,
  recognitionSupported: false, localRecognition: false, microphoneBlocked: false,
  localPolicyBlocked: false, recognitionMode: 'local', pack: 'unchecked',
  remoteSpeechConsent: false, remoteRecognitionConsent: false,
});
const plain = (text: string, bound: number) => text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, bound);

/** No audio recording, storage, network adapter, command dispatch or implicit fallback. */
export class VoiceController {
  private state = initial();
  private ports: VoicePorts | undefined;
  private listeners = new Set<() => void>();
  private cleanups: Array<() => void> = [];
  private owned: UtterancePort | undefined;
  private speechTimer: ReturnType<typeof setTimeout> | undefined;
  private recognition: RecognitionPort | undefined;
  private recordingTimer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  private announced = new Set<string>();

  getSnapshot = (): VoiceState => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {this.listeners.delete(listener);};
  };
  private update(patch: Partial<VoiceState>) {
    this.state = {...this.state, ...patch};
    this.listeners.forEach(listener => listener());
  }
  private permitted() {return !!this.ports && this.state.enabled && !this.ports.hidden();}
  private refreshVoices = () => {
    let voices: VoiceChoice[];
    try {voices = (this.ports?.synthesis?.getVoices() ?? []).slice(0, 128);} catch {voices = [];}
    const selected = voices.find(voice => voice.voiceURI === this.state.voiceId);
    const preferred = voices.find(voice => voice.localService && /^en-GB\b/i.test(voice.lang)) ?? voices.find(voice => voice.localService);
    if (this.owned && (!selected || (!selected.localService && !this.state.remoteSpeechConsent))) {
      this.cancelOwned();
      this.update({status: 'unavailable', message: 'The selected voice is no longer available under the current privacy choice. Speech was stopped.'});
    }
    this.update({voices, voiceId: selected?.voiceURI ?? preferred?.voiceURI ?? ''});
  };

  connect(ports: VoicePorts) {
    if (this.ports) this.disconnect();
    this.ports = ports;
    this.refreshVoices();
    this.update({recognitionSupported: !!ports.recognition,
      localRecognition: !!ports.recognition?.local, microphoneBlocked: ports.microphoneAllowed?.() === false,
      localPolicyBlocked: ports.onDeviceAllowed?.() === false});
    this.cleanups.push(ports.onVisibility(() => {
      if (ports.hidden()) {this.setEnabled(false); this.update({message: 'Voice paused because this page is hidden. Enable voice again when you return.'});}
    }));
    if (ports.synthesis) this.cleanups.push(ports.synthesis.onVoicesChanged(this.refreshVoices));
  }
  disconnect = () => {
    this.setEnabled(false);
    this.cleanups.splice(0).forEach(cleanup => cleanup());
    this.ports = undefined;
  };
  setEnabled = (enabled: boolean) => {
    if (enabled && (!this.ports || this.ports.hidden())) return;
    this.update({enabled});
    this.stop();
    if (!enabled) this.update({remoteSpeechConsent: false, remoteRecognitionConsent: false});
    this.update({status: enabled ? 'idle' : 'off', message: enabled ? 'Ready. Dictation starts only when you press Dictate.' : 'Voice is off.'});
  };
  setDisabled = (disabled: boolean) => {
    if (disabled === this.state.disabled) return;
    this.update({disabled});
    if (disabled) {
      ++this.generation;
      this.releaseRecognition(true);
      this.update({interim: '', pack: this.state.pack === 'checking' ? 'unchecked' : this.state.pack,
        status: this.owned ? this.state.status : this.state.enabled ? 'idle' : 'off',
        message: this.owned ? this.state.message : 'Dictation is paused while the composer is unavailable. Spoken status feedback remains opt-in.'});
    }
  };
  private clearRecordingTimer() {
    if (this.recordingTimer !== undefined) clearTimeout(this.recordingTimer);
    this.recordingTimer = undefined;
  }
  private releaseRecognition(abort: boolean) {
    this.clearRecordingTimer();
    const session = this.recognition;
    this.recognition = undefined;
    if (!session) return;
    session.onstart = null; session.onend = null; session.onerror = null; session.onresult = null;
    if (abort) {try {session.abort();} catch { /* Already stopped by the browser. */ }}
  }
  private clearSpeechTimer() {
    if (this.speechTimer !== undefined) clearTimeout(this.speechTimer);
    this.speechTimer = undefined;
  }
  private cancelOwned() {
    this.clearSpeechTimer();
    const utterance = this.owned;
    this.owned = undefined;
    if (!utterance) return;
    utterance.onstart = null; utterance.onend = null; utterance.onerror = null;
    try {this.ports?.synthesis?.cancel();} catch { /* No retry or interruption of another owner. */ }
  }
  stop = () => {
    ++this.generation; // Invalidate callbacks before touching browser resources.
    this.releaseRecognition(true);
    this.cancelOwned();
    this.update({status: this.state.enabled ? 'idle' : 'off', interim: '',
      pack: this.state.pack === 'checking' ? 'unchecked' : this.state.pack,
      message: this.state.enabled ? 'Stopped. Start again explicitly.' : 'Voice is off.'});
  };
  setVoice = (voiceId: string) => {
    this.stop();
    this.update({voiceId: this.state.voices.some(voice => voice.voiceURI === voiceId) ? voiceId : ''});
  };
  setRate = (rate: number) => {if (Number.isFinite(rate)) {this.stop(); this.update({rate: Math.max(0.7, Math.min(1.3, rate))});}};
  setLanguage = (language: string) => {
    if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,8}){0,2}$/.test(language)) return;
    this.stop(); this.update({language, pack: 'unchecked'});
  };
  setRemoteSpeechConsent = (consent: boolean) => {if (consent && !this.permitted()) return; this.stop(); this.update({remoteSpeechConsent: consent});};
  setRemoteRecognitionConsent = (consent: boolean) => {if (consent && !this.permitted()) return; this.stop(); this.update({remoteRecognitionConsent: consent});};
  setRecognitionMode = (recognitionMode: 'local' | 'browser') => {
    this.stop(); this.update({recognitionMode, remoteRecognitionConsent: false});
  };

  private dictationPolicyAllowed(local: boolean): boolean {
    if (this.ports?.microphoneAllowed?.() === false) {
      this.update({status: 'unavailable', microphoneBlocked: true, message: 'Microphone access is blocked by the server Permissions Policy. Ask the operator to enable voice input; the keyboard still works.'});
      return false;
    }
    if (local && this.ports?.onDeviceAllowed?.() === false) {
      this.update({status: 'unavailable', localPolicyBlocked: true, message: 'On-device recognition is blocked by the server Permissions Policy. No browser-managed fallback was started.'});
      return false;
    }
    return true;
  }
  checkLocalAvailability = async (): Promise<void> => {
    if (!this.permitted() || this.state.disabled || this.recognition || this.state.pack === 'checking') return;
    if (!this.dictationPolicyAllowed(true)) return;
    const recognition = this.ports?.recognition;
    if (!recognition?.local || !recognition.available) {
      this.update({status: 'unavailable', pack: 'unavailable', message: 'On-device dictation is unavailable. Keep typing, or explicitly review browser-managed dictation.'});
      return;
    }
    this.stop();
    const generation = this.generation;
    this.update({pack: 'checking', status: 'preparing', message: 'Checking the on-device language pack. The microphone is not running.'});
    try {
      const available = await recognition.available(this.state.language);
      if (generation !== this.generation || !this.permitted()) return;
      this.update({pack: available === 'available' ? 'available' : 'unavailable', status: available === 'available' ? 'idle' : 'unavailable',
        message: available === 'available' ? 'Language ready. Press Dictate to start the microphone.' : 'The on-device language pack is not installed or not ready. No download or browser-managed fallback was started.'});
    } catch {
      if (generation === this.generation && this.permitted()) this.update({pack: 'unavailable', status: 'error', message: 'The browser could not check the language pack. Keep using the keyboard.'});
    }
  };
  startDictation = (onDictation: (text: string) => void): void => {
    if (!this.permitted() || this.state.disabled || this.recognition) return;
    const recognition = this.ports?.recognition;
    if (!recognition) {this.update({status: 'unavailable', message: 'Browser dictation is unavailable. Keep using the keyboard.'}); return;}
    const local = this.state.recognitionMode === 'local';
    if (!this.dictationPolicyAllowed(local)) return;
    if (local && (!recognition.local || this.state.pack !== 'available')) {
      this.update({status: 'unavailable', message: 'Check the on-device language first, then press Dictate again. No browser-managed fallback was started.'}); return;
    }
    if (!local && !this.state.remoteRecognitionConsent) {
      this.update({status: 'unavailable', message: 'Browser-managed dictation may send audio to the browser vendor. Explicit consent is required before Dictate.'}); return;
    }
    this.stop();
    const generation = this.generation;
    let session: RecognitionPort;
    try {session = recognition.create();} catch {this.update({status: 'error', message: 'The browser could not create a dictation session. Keep typing.'}); return;}
    this.recognition = session;
    session.lang = this.state.language; session.continuous = true; session.interimResults = true; session.maxAlternatives = 1;
    if (recognition.local) session.processLocally = local;
    const finalIndices = new Set<number>();
    const current = () => this.recognition === session && generation === this.generation && !this.state.disabled && this.permitted();
    session.onstart = () => {
      if (current()) this.update({status: 'listening', message: 'Listening. Final text only is added to your draft; nothing is sent.'});
    };
    session.onresult = event => {
      if (!current()) return;
      if (!Number.isInteger(event.resultIndex) || event.resultIndex < 0 || event.results.length > 128) {
        this.stop(); this.update({status: 'error', message: 'The dictation result limit was reached. Review your draft and start again explicitly.'}); return;
      }
      let interim = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        if (!current()) return;
        const result = event.results[index]; if (!result) continue;
        const text = plain(result[0].transcript, 2000);
        if (result.isFinal) {
          if (!finalIndices.has(index)) {
            finalIndices.add(index);
            if (text) {
              try {onDictation(text);} catch {this.stop(); this.update({status: 'error', message: 'Dictation could not be added to the draft. Nothing was sent; keep typing.'}); return;}
            }
          }
        } else interim += `${text} `;
      }
      if (current()) this.update({interim: interim.trim().slice(0, 500)});
    };
    session.onend = () => {
      if (!current()) return;
      this.releaseRecognition(false);
      this.update({status: 'idle', interim: '', message: 'Dictation ended. Start again explicitly.'});
    };
    session.onerror = event => {
      if (!current()) return;
      this.releaseRecognition(true);
      const message = event.error === 'not-allowed' || event.error === 'service-not-allowed'
        ? 'Microphone permission or browser service access was denied. Review browser permissions and press Dictate again; keep typing meanwhile.'
        : event.error === 'language-not-supported'
          ? 'This dictation language is not available. No browser-managed fallback was started.'
          : event.error === 'audio-capture'
            ? 'The browser could not access a microphone. Keep using the keyboard.'
            : event.error === 'no-speech'
              ? 'No speech was detected. Start again explicitly, or keep typing.'
              : 'Browser dictation failed. Keep using the keyboard; no automatic restart was attempted.';
      this.update({status: 'error', interim: '', message});
    };
    this.update({status: 'preparing', message: 'Waiting for microphone permission and browser start.'});
    this.recordingTimer = setTimeout(() => {if (current()) {this.stop(); this.update({message: 'The 60-second dictation limit was reached. Review your draft; start again explicitly.'});}}, 60_000);
    try {session.start();} catch {session.onerror?.({});}
  };

  announce = (id: string, text: string, active = true) => {
    // Never evict and replay old identities. At the bound, suppress further automatic narration.
    if (!id || id.length > 200 || this.announced.has(id) || this.announced.size >= 4096) return;
    this.announced.add(id); // Consume BEFORE enabled/active checks, including StrictMode replay.
    if (active) this.speak(text);
  };
  speak = (text: string): void => {
    if (!this.permitted() || this.recognition) return; // Do not dictate our own spoken feedback.
    const synthesis = this.ports?.synthesis;
    if (!synthesis) {this.update({status: 'unavailable', message: 'Speech output is unavailable in this browser. Keep using text.'}); return;}
    const bounded = plain(text, 500); if (!bounded) return;
    const voice = this.state.voices.find(choice => choice.voiceURI === this.state.voiceId);
    if (!voice) {this.update({status: 'unavailable', message: 'No selected voice is available. Choose an available voice or keep using text.'}); return;}
    if (!voice.localService && !this.state.remoteSpeechConsent) {
      this.update({status: 'unavailable', message: 'This voice may send text to the browser vendor. Explicit remote voice consent is required.'}); return;
    }
    if (!this.owned && synthesis.busy()) {
      this.update({status: 'error', message: 'Another component is using browser speech. Flightdeck will not interrupt it.'}); return;
    }
    this.cancelOwned();
    if (this.state.pack === 'checking') {++this.generation; this.update({pack: 'unchecked'});}
    let utterance: UtterancePort;
    try {utterance = synthesis.createUtterance(bounded);} catch {this.update({status: 'error', message: 'The browser could not create speech output. Keep using text.'}); return;}
    utterance.voice = voice; utterance.lang = voice.lang; utterance.rate = this.state.rate;
    this.owned = utterance;
    const deadline = (milliseconds: number) => {
      this.clearSpeechTimer();
      this.speechTimer = setTimeout(() => {
        if (this.owned !== utterance) return;
        this.cancelOwned();
        this.update({status: 'error', message: 'Browser speech timed out and was stopped. Use the text controls or test the voice again.'});
      }, milliseconds);
    };
    utterance.onstart = () => {
      if (this.owned === utterance && this.permitted()) {deadline(60_000); this.update({status: 'speaking', message: 'Speaking a short status summary.'});}
    };
    utterance.onend = () => {if (this.owned === utterance) {this.clearSpeechTimer(); this.owned = undefined; this.update({status: 'idle', message: 'Ready.'});}};
    utterance.onerror = () => {if (this.owned === utterance) {this.clearSpeechTimer(); this.owned = undefined; this.update({status: 'error', message: 'The browser could not speak. Use the text controls.'});}};
    this.update({status: 'queued', message: 'Waiting for the browser to start speech.'});
    deadline(10_000);
    try {synthesis.speak(utterance);} catch {utterance.onerror?.({});}
  };
}
