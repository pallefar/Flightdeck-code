import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it} from 'vitest';
import {VoiceProvider, VoiceControls, VoiceCore, VoiceNarration, useVoice} from './index';

function Reader() {const voice = useVoice(); return <span>{voice.enabled ? 'enabled' : 'disabled'}:{voice.status}</span>;}
describe('voice UI integration contract', () => {
  it('is safe outside a provider and SSR produces no active speech state', () => {
    const markup = renderToStaticMarkup(<><Reader/><VoiceCore variant="standby"/><VoiceControls onDictation={() => {}}/><VoiceNarration id="old" text="Older safe status."/></>);
    expect(markup).toContain('disabled:off');
    expect(markup).toContain('aria-label="Voice copilot"');
    expect(markup).toContain('data-voice-state="off"');
    expect(markup).toContain('Enable voice');
    expect(markup).not.toContain('data-voice-state="speaking"');
    expect(markup).not.toContain('Check dictation</button>');
  });
  it('defaults off under a scoped provider and explains that dictation cannot execute commands', () => {
    const markup = renderToStaticMarkup(<VoiceProvider scopeKey="project-epoch-1"><Reader/><VoiceControls onDictation={() => {}} disabled/></VoiceProvider>);
    expect(markup).toContain('disabled:off');
    expect(markup).toContain('never sends, runs, approves or deploys');
    expect(markup).toContain('Voice options');
    expect(markup).toContain('Dictation language');
    expect(markup).toContain('Speaking voice');
    expect(markup).toContain('Speaking rate');
    expect(markup).toContain('Test voice');
  });
});
