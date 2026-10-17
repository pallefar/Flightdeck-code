// Structural ports keep the state machine testable without pretending to hear audio.
export interface VoiceChoice {voiceURI: string; name: string; lang: string; localService: boolean}
export interface UtterancePort {
  voice: VoiceChoice | null; lang: string; rate: number;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: {error?: string}) => void) | null;
}
export interface RecognitionResult {isFinal: boolean; 0: {transcript: string}}
export interface RecognitionEvent {resultIndex: number; results: ArrayLike<RecognitionResult>}
export interface RecognitionPort {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  processLocally?: boolean;
  onstart: (() => void) | null; onend: (() => void) | null;
  onerror: ((event: {error?: string}) => void) | null;
  onresult: ((event: RecognitionEvent) => void) | null;
  start: () => void; abort: () => void;
}
export type Availability = 'available' | 'unavailable' | 'downloadable' | 'downloading';
export interface VoicePorts {
  synthesis?: {
    getVoices: () => VoiceChoice[]; createUtterance: (text: string) => UtterancePort;
    speak: (utterance: UtterancePort) => void; cancel: () => void;
    busy: () => boolean; onVoicesChanged: (listener: () => void) => () => void;
  };
  recognition?: {
    local: boolean; create: () => RecognitionPort;
    available?: (language: string) => Promise<Availability>;
  };
  microphoneAllowed?: () => boolean | undefined;
  onDeviceAllowed?: () => boolean | undefined;
  hidden: () => boolean;
  onVisibility: (listener: () => void) => () => void;
}
