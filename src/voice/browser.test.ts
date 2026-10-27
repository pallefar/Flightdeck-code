import {afterEach, expect, it, vi} from 'vitest';
import {browserVoicePorts} from './browser';
afterEach(() => vi.unstubAllGlobals());
it('has no native effects in a server runtime', () => {
  const ports = browserVoicePorts();
  expect(ports.synthesis).toBeUndefined(); expect(ports.recognition).toBeUndefined();
});
it('discovers policy and local capabilities without constructing or starting recognition', async () => {
  let constructed = 0; let requested: unknown;
  class NativeRecognition {processLocally = false; constructor() {constructed++;} static available(options: unknown) {requested = options; return Promise.resolve('downloadable');}}
  Object.defineProperty(NativeRecognition.prototype, 'processLocally', {value: false, writable: true});
  vi.stubGlobal('window', {SpeechRecognition: NativeRecognition});
  vi.stubGlobal('document', {hidden: false, permissionsPolicy: {allowsFeature: (feature: string) => feature !== 'microphone'}, addEventListener: () => {}, removeEventListener: () => {}});
  const ports = browserVoicePorts(); expect(constructed).toBe(0); expect(ports.recognition?.local).toBe(true);
  expect(ports.microphoneAllowed?.()).toBe(false);
  expect(await ports.recognition?.available?.('en-GB')).toBe('downloadable');
  expect(requested).toEqual({langs: ['en-GB'], processLocally: true}); expect(constructed).toBe(0);
});
