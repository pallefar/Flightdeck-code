import {describe, expect, it, vi} from 'vitest';
import {VoiceController} from './controller';
import type {Availability, RecognitionPort, UtterancePort, VoiceChoice, VoicePorts} from './ports';

const localVoice: VoiceChoice = {voiceURI: 'local-en-gb', name: 'Local UK voice', lang: 'en-GB', localService: true};
function speechHarness(voices = [localVoice]) {
  const utterances: UtterancePort[] = [];
  const spoken: string[] = [];
  let cancelled = 0;
  let foreignBusy = false;
  const ports: VoicePorts = {
    hidden: () => false, onVisibility: () => () => {},
    synthesis: {
      getVoices: () => voices, busy: () => foreignBusy,
      onVoicesChanged: () => () => {},
      createUtterance: text => {spoken.push(text); const utterance: UtterancePort = {voice: null, lang: '', rate: 1, onstart: null, onend: null, onerror: null}; utterances.push(utterance); return utterance;},
      speak: () => {}, cancel: () => {cancelled++;},
    },
  };
  const controller = new VoiceController();
  return {controller, ports, utterances, spoken, cancelled: () => cancelled, foreign: () => {foreignBusy = true;}};
}

it('selects an available local UK voice and drives speaking only from native events', () => {
  const h = speechHarness(); h.controller.connect(h.ports); h.controller.setEnabled(true);
  expect(h.utterances).toHaveLength(0);
  h.controller.speak('A newly accepted draft is ready.');
  expect(h.controller.getSnapshot().status).toBe('queued');
  expect(h.utterances[0]?.voice).toBe(localVoice);
  h.utterances[0]?.onstart?.();
  expect(h.controller.getSnapshot().status).toBe('speaking');
  h.utterances[0]?.onend?.();
  expect(h.controller.getSnapshot().status).toBe('idle');
  expect(h.cancelled()).toBe(0);
});

function dictationHarness(local = true, availability: () => Promise<Availability> = async () => 'available') {
  const h = speechHarness(); const sessions: RecognitionPort[] = []; let starts = 0; let aborts = 0;
  const ports: VoicePorts = {...h.ports, recognition: {local, available: availability, create: () => {
    const session: RecognitionPort = {lang: '', continuous: false, interimResults: false, maxAlternatives: 1,
      onstart: null, onend: null, onerror: null, onresult: null,
      start: () => {starts++;}, abort: () => {aborts++;},
    }; sessions.push(session); return session;
  }}};
  h.controller.connect(ports); h.controller.setEnabled(true);
  return {...h, ports, sessions, starts: () => starts, aborts: () => aborts};
}

it('checks local language availability without starting a mic and requires a second explicit start', async () => {
  const h = dictationHarness(); const texts: string[] = [];
  h.controller.startDictation(text => texts.push(text)); expect(h.starts()).toBe(0);
  await h.controller.checkLocalAvailability(); expect(h.starts()).toBe(0);
  expect(h.controller.getSnapshot().pack).toBe('available');
  h.controller.startDictation(text => texts.push(text));
  const session = h.sessions[0]!;
  expect(session.processLocally).toBe(true); expect(session.lang).toBe('en-GB');
  expect(h.controller.getSnapshot().status).toBe('preparing');
  session.onstart?.(); expect(h.controller.getSnapshot().status).toBe('listening');
  const first = {isFinal: true, 0: {transcript: 'A neutral draft.'}};
  session.onresult?.({resultIndex: 0, results: [first, {isFinal: false, 0: {transcript: 'In progress'}}]});
  expect(texts).toEqual(['A neutral draft.']); expect(h.controller.getSnapshot().interim).toBe('In progress');
  session.onresult?.({resultIndex: 0, results: [first, {isFinal: true, 0: {transcript: 'Another sentence.'}}]});
  session.onresult?.({resultIndex: 1, results: [first, {isFinal: true, 0: {transcript: 'Another sentence.'}}]});
  expect(texts).toEqual(['A neutral draft.', 'Another sentence.']);
  session.onend?.(); expect(h.controller.getSnapshot().status).toBe('idle');
  expect(h.controller.getSnapshot().interim).toBe(''); expect(h.starts()).toBe(1);
});

describe('dictation privacy and lifecycle', () => {
  it('does not silently fall back when a local pack is missing or unsupported', async () => {
    for (const availability of ['unavailable', 'downloadable', 'downloading'] as const) {
      const h = dictationHarness(true, async () => availability);
      await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {});
      expect(h.starts()).toBe(0); expect(h.controller.getSnapshot().message).toContain('on-device');
    }
    const unsupported = speechHarness(); unsupported.controller.connect(unsupported.ports); unsupported.controller.setEnabled(true);
    unsupported.controller.startDictation(() => {}); expect(unsupported.controller.getSnapshot().message).toContain('unavailable');
  });
  it('requires explicit disclosure consent for browser-managed dictation, even with local APIs present', () => {
    const h = dictationHarness(false); h.controller.setRecognitionMode('browser');
    h.controller.startDictation(() => {}); expect(h.starts()).toBe(0);
    h.controller.setRemoteRecognitionConsent(true); h.controller.startDictation(() => {});
    expect(h.starts()).toBe(1); expect(h.sessions[0]?.processLocally).not.toBe(true);
    h.controller.stop(); expect(h.aborts()).toBe(1); expect(h.starts()).toBe(1);
  });
  it('reports policy-denied separately from API-unsupported and does not request a mic', async () => {
    const h = dictationHarness(); h.controller.connect({...h.ports, microphoneAllowed: () => false}); h.controller.setEnabled(true);
    await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {});
    expect(h.starts()).toBe(0); expect(h.controller.getSnapshot().message).toContain('server');
    expect(h.controller.getSnapshot().recognitionSupported).toBe(true);
  });
  it('discards delayed language checks after disabling without starting any session', async () => {
    let resolve!: (availability: Availability) => void;
    const h = dictationHarness(true, () => new Promise(done => {resolve = done;}));
    const check = h.controller.checkLocalAvailability(); h.controller.setEnabled(false); resolve('available'); await check;
    expect(h.controller.getSnapshot().status).toBe('off'); expect(h.controller.getSnapshot().pack).not.toBe('available'); expect(h.starts()).toBe(0);
  });
  it.each(['stop', 'off', 'disabled', 'disconnect'] as const)('aborts once and discards stale final results after %s', async action => {
    const h = dictationHarness(); const texts: string[] = []; await h.controller.checkLocalAvailability();
    h.controller.startDictation(text => texts.push(text)); const session = h.sessions[0]!; const oldResult = session.onresult; const oldStart = session.onstart;
    if (action === 'stop') h.controller.stop();
    if (action === 'off') h.controller.setEnabled(false);
    if (action === 'disabled') h.controller.setDisabled(true);
    if (action === 'disconnect') h.controller.disconnect();
    h.controller.stop(); expect(h.aborts()).toBe(1);
    oldStart?.(); oldResult?.({resultIndex: 0, results: [{isFinal: true, 0: {transcript: 'stale'}}]});
    expect(texts).toEqual([]); expect(h.controller.getSnapshot().status).not.toBe('listening'); expect(h.starts()).toBe(1);
  });
  it('stops at a bounded recording deadline without auto-restarting', async () => {
    vi.useFakeTimers();
    try {const h = dictationHarness(); await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {}); h.sessions[0]?.onstart?.(); vi.advanceTimersByTime(60_001); expect(h.aborts()).toBe(1); expect(h.starts()).toBe(1); expect(h.controller.getSnapshot().status).toBe('idle');} finally {vi.useRealTimers();}
  });
  it('caps a session result list instead of appending an unbounded burst', async () => {
    const h = dictationHarness(); const texts: string[] = []; await h.controller.checkLocalAvailability(); h.controller.startDictation(text => texts.push(text));
    h.sessions[0]?.onresult?.({resultIndex: 0, results: Array.from({length: 129}, () => ({isFinal: true, 0: {transcript: 'neutral'}}))});
    expect(texts).toEqual([]); expect(h.aborts()).toBe(1); expect(h.controller.getSnapshot().message).toContain('limit');
  });
  it('reports denied permission without echoing vendor details and never restarts', async () => {
    const h = dictationHarness(); await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {});
    h.sessions[0]?.onerror?.({error: 'not-allowed'});
    expect(h.controller.getSnapshot().message).toContain('permission'); expect(h.controller.getSnapshot().status).toBe('error'); expect(h.aborts()).toBe(1); expect(h.starts()).toBe(1);
  });
});

describe('live environment changes', () => {
  it('aborts on document hidden and requires a fresh enable gesture on return', async () => {
    const h = dictationHarness(); let hidden = false; let changed = () => {};
    h.controller.connect({...h.ports, hidden: () => hidden, onVisibility: listener => {changed = listener; return () => {changed = () => {};};}});
    h.controller.setEnabled(true); await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {});
    hidden = true; changed(); expect(h.aborts()).toBe(1); expect(h.controller.getSnapshot().enabled).toBe(false);
    hidden = false; changed(); expect(h.controller.getSnapshot().enabled).toBe(false); expect(h.starts()).toBe(1);
  });
  it('refreshes delayed voices without choosing a remote voice or starting speech', () => {
    const h = speechHarness([]); let changed = () => {}; let voices: VoiceChoice[] = [];
    h.controller.connect({...h.ports, synthesis: {...h.ports.synthesis!, getVoices: () => voices, onVoicesChanged: listener => {changed = listener; return () => {};}}});
    h.controller.setEnabled(true); h.controller.speak('Ready.'); expect(h.utterances).toHaveLength(0);
    voices = [{...localVoice, localService: false, voiceURI: 'remote'}]; changed(); expect(h.controller.getSnapshot().voiceId).toBe('');
    voices = [localVoice]; changed(); expect(h.controller.getSnapshot().voiceId).toBe(localVoice.voiceURI); expect(h.utterances).toHaveLength(0);
  });
  it('leaves no Speaking state when the selected native voice disappears', () => {
    const h = speechHarness(); let voices: VoiceChoice[] = [localVoice]; let changed = () => {};
    h.controller.connect({...h.ports, synthesis: {...h.ports.synthesis!, getVoices: () => voices, onVoicesChanged: listener => {changed = listener; return () => {};}}}); h.controller.setEnabled(true); h.controller.speak('Safe status.'); h.utterances[0]?.onstart?.();
    voices = []; changed(); expect(h.cancelled()).toBe(1); expect(h.controller.getSnapshot().status).toBe('unavailable');
  });
  it('lets safe status narration continue while the composer is busy but blocks the mic', () => {
    const h = dictationHarness(); h.controller.setDisabled(true);
    h.controller.announce('requesting', 'Requesting a routed draft.');
    expect(h.utterances).toHaveLength(1); h.controller.startDictation(() => {}); expect(h.starts()).toBe(0);
  });
  it('bounds voice rate and resets language availability when a language changes', async () => {
    const h = dictationHarness(); await h.controller.checkLocalAvailability();
    h.controller.setRate(4); expect(h.controller.getSnapshot().rate).toBe(1.3);
    h.controller.setRate(Number.NaN); expect(h.controller.getSnapshot().rate).toBe(1.3);
    h.controller.setLanguage('en-US'); expect(h.controller.getSnapshot().pack).toBe('unchecked');
    h.controller.startDictation(() => {}); expect(h.starts()).toBe(0);
  });
});

describe('bounded native failure handling', () => {
  it('can enable feedback while dictation is disabled by composer busy state', () => {
    const h = speechHarness(); h.controller.connect(h.ports); h.controller.setDisabled(true); h.controller.setEnabled(true);
    h.controller.speak('Requesting a routed draft.'); expect(h.utterances).toHaveLength(1);
  });
  it('converts a failing native utterance constructor into a compact error', () => {
    const h = speechHarness(); h.controller.connect({...h.ports, synthesis: {...h.ports.synthesis!, createUtterance: () => {throw new Error('private native detail');}}}); h.controller.setEnabled(true);
    expect(() => h.controller.speak('Safe summary.')).not.toThrow(); expect(h.controller.getSnapshot().status).toBe('error'); expect(h.controller.getSnapshot().message).not.toContain('private');
  });
  it('expires an owned queue that never starts without inventing Speaking', () => {
    vi.useFakeTimers();
    try {const h = speechHarness(); h.controller.connect(h.ports); h.controller.setEnabled(true); h.controller.speak('Safe summary.'); vi.advanceTimersByTime(10_001); expect(h.controller.getSnapshot().status).toBe('error'); expect(h.cancelled()).toBe(1);} finally {vi.useRealTimers();}
  });
  it('invalidates pending availability when a safe speech test interrupts it', async () => {
    let resolve!: (availability: Availability) => void;
    const h = dictationHarness(true, () => new Promise(done => {resolve = done;}));
    const check = h.controller.checkLocalAvailability(); h.controller.speak('Safe test.'); const utterance = h.utterances[0]!; utterance.onstart?.(); resolve('available'); await check;
    expect(h.controller.getSnapshot().status).toBe('speaking'); h.controller.stop();
  });
  it('aborts and reports a bounded error if the parent draft sink throws', async () => {
    const h = dictationHarness(); await h.controller.checkLocalAvailability(); h.controller.startDictation(() => {throw new Error('sensitive parent detail');});
    expect(() => h.sessions[0]?.onresult?.({resultIndex: 0, results: [{isFinal: true, 0: {transcript: 'neutral'}}]})).not.toThrow();
    expect(h.aborts()).toBe(1); expect(h.controller.getSnapshot().message).not.toContain('sensitive');
  });
});

describe('speech ownership and privacy', () => {
  it('does not accept remote consent while voice is off or the document is hidden', () => {
    const h = speechHarness(); let hidden = false; h.controller.connect({...h.ports, hidden: () => hidden});
    h.controller.setRemoteSpeechConsent(true); h.controller.setRemoteRecognitionConsent(true);
    expect(h.controller.getSnapshot().remoteSpeechConsent).toBe(false); expect(h.controller.getSnapshot().remoteRecognitionConsent).toBe(false);
    h.controller.setEnabled(true); h.controller.setRemoteSpeechConsent(true); h.controller.setRemoteRecognitionConsent(true);
    h.controller.setEnabled(false);
    expect(h.controller.getSnapshot().remoteSpeechConsent).toBe(false); expect(h.controller.getSnapshot().remoteRecognitionConsent).toBe(false);
    h.controller.setEnabled(true); hidden = true;
    h.controller.setRemoteSpeechConsent(true); h.controller.setRemoteRecognitionConsent(true);
    expect(h.controller.getSnapshot().remoteSpeechConsent).toBe(false); expect(h.controller.getSnapshot().remoteRecognitionConsent).toBe(false);
  });
  it('never chooses an implicit or remote default, and requires explicit remote consent', () => {
    const remote = {...localVoice, voiceURI: 'remote', localService: false};
    const h = speechHarness([remote]); h.controller.connect(h.ports); h.controller.setEnabled(true);
    h.controller.speak('Ready.'); expect(h.utterances).toHaveLength(0);
    expect(h.controller.getSnapshot().message).toContain('voice');
    h.controller.setVoice('remote'); h.controller.speak('Ready.'); expect(h.utterances).toHaveLength(0);
    h.controller.setRemoteSpeechConsent(true); h.controller.speak('Ready.');
    expect(h.utterances[0]?.voice).toBe(remote);
  });
  it('caps summaries, replaces only its owned utterance, and ignores cancelled late events', () => {
    const h = speechHarness(); h.controller.connect(h.ports); h.controller.setEnabled(true);
    h.controller.speak('x'.repeat(900)); expect(h.spoken[0]?.length).toBeLessThanOrEqual(500);
    const oldStart = h.utterances[0]?.onstart;
    h.controller.speak('Latest status.'); expect(h.cancelled()).toBe(1);
    oldStart?.(); expect(h.controller.getSnapshot().status).toBe('queued');
    h.controller.stop(); h.controller.stop(); expect(h.cancelled()).toBe(2);
    h.utterances[1]?.onstart?.(); expect(h.controller.getSnapshot().status).toBe('idle');
    h.foreign(); h.controller.speak('Do not cancel the host.');
    expect(h.utterances).toHaveLength(2); expect(h.cancelled()).toBe(2);
  });
  it('records announcement identity while off so later enable never reads older history', () => {
    const h = speechHarness(); h.controller.connect(h.ports);
    h.controller.announce('old-1', 'Old accepted status.', true);
    h.controller.setEnabled(true); h.controller.announce('old-1', 'Old accepted status.', true);
    expect(h.utterances).toHaveLength(0);
    h.controller.announce('new-2', 'New accepted status.', true);
    h.controller.announce('new-2', 'New accepted status.', true);
    expect(h.utterances).toHaveLength(1);
  });
});

describe('VoiceController opt-in boundary', () => {
  it('is disabled on construction and makes no speech or microphone calls', () => {
    const controller = new VoiceController();
    expect(controller.getSnapshot().enabled).toBe(false);
    expect(controller.getSnapshot().status).toBe('off');
    controller.speak('A newly accepted draft is ready.');
    expect(controller.getSnapshot().status).toBe('off');
  });
});
