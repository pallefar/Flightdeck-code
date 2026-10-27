import type {Availability, RecognitionPort, UtterancePort, VoicePorts} from './ports';

type RecognitionConstructor = {
  new(): RecognitionPort;
  prototype: object;
  available?: (options: {langs: string[]; processLocally: boolean}) => Promise<Availability>;
};
type SpeechWindow = Window & {
  SpeechRecognition?: RecognitionConstructor;
  webkitSpeechRecognition?: RecognitionConstructor;
  SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
};
type PolicyDocument = Document & {
  permissionsPolicy?: {allowsFeature: (feature: string) => boolean};
  featurePolicy?: {allowsFeature: (feature: string) => boolean};
};

/** Capability discovery is passive; recognition is constructed only inside explicit Dictate. */
export function browserVoicePorts(): VoicePorts {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return {hidden: () => true, onVisibility: () => () => {}};
  }
  const host = window as SpeechWindow;
  const page = document as PolicyDocument;
  const policyAllowed = (feature: string): boolean | undefined => {
    const policy = page.permissionsPolicy ?? page.featurePolicy;
    try {return policy?.allowsFeature(feature);} catch {return undefined;}
  };
  const ports: VoicePorts = {
    hidden: () => page.hidden,
    onVisibility: listener => {page.addEventListener('visibilitychange', listener); return () => page.removeEventListener('visibilitychange', listener);},
    microphoneAllowed: () => policyAllowed('microphone'),
    onDeviceAllowed: () => policyAllowed('on-device-speech-recognition'),
  };
  const synthesis = host.speechSynthesis;
  const Utterance = host.SpeechSynthesisUtterance;
  if (synthesis && Utterance) ports.synthesis = {
    getVoices: () => synthesis.getVoices(),
    createUtterance: text => new Utterance(text) as unknown as UtterancePort,
    speak: utterance => synthesis.speak(utterance as unknown as SpeechSynthesisUtterance),
    cancel: () => synthesis.cancel(),
    busy: () => synthesis.speaking || synthesis.pending,
    onVoicesChanged: listener => {synthesis.addEventListener('voiceschanged', listener); return () => synthesis.removeEventListener('voiceschanged', listener);},
  };
  const Recognition = host.SpeechRecognition ?? host.webkitSpeechRecognition;
  if (Recognition) {
    ports.recognition = {local: 'processLocally' in Recognition.prototype, create: () => new Recognition()};
    if (typeof Recognition.available === 'function') {
      ports.recognition.available = language => Recognition.available!({langs: [language], processLocally: true});
    }
  }
  return ports;
}
