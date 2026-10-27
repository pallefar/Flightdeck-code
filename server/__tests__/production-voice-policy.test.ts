import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../index';

const roots: string[] = [];
const apps: ReturnType<typeof createServer>[] = [];
const operator = { actor: 'Voice-policy development operator', token: 'development-only-voice-policy-token' };
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'studio-voice-policy-'));
  roots.push(root); mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><html><head><script type="module" src="/assets/index-AbCd1234.js"></script></head><body><div id="root"></div></body></html>');
  writeFileSync(join(root, 'assets/index-AbCd1234.js'), 'document.title="Studio voice-policy fixture";');
  return root;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(apps.splice(0).map(app => app.close()));
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

it('an explicit trusted false setting overrides the environment voice opt-in', async () => {
  vi.stubEnv('STUDIO_VOICE_INPUT', '1');
  const app = createServer({ operator, productionAssetRoot: fixture(), productionVoiceInput: false }); apps.push(app);
  const response = await app.inject('/');
  expect(String(response.headers['permissions-policy'])).toContain('microphone=()');
  expect(String(response.headers['permissions-policy'])).toContain('on-device-speech-recognition=()');
});

it.each(['0', 'true', 'yes', ' 1', '1 ', ''])('unknown or disabled voice environment value %j leaves microphone blocked', async value => {
  vi.stubEnv('STUDIO_VOICE_INPUT', value);
  const app = createServer({ operator, productionAssetRoot: fixture() }); apps.push(app);
  const response = await app.inject('/');
  expect(String(response.headers['permissions-policy'])).toContain('microphone=()');
  expect(String(response.headers['permissions-policy'])).toContain('on-device-speech-recognition=()');
});

it('the production default blocks microphone and local speech discovery', async () => {
  vi.stubEnv('STUDIO_VOICE_INPUT', undefined);
  const app = createServer({ operator, productionAssetRoot: fixture() }); apps.push(app);
  for (const url of ['/', '/demo', '/assets/index-AbCd1234.js']) {
    const response = await app.inject(url);
    expect(String(response.headers['permissions-policy'])).toContain('microphone=()');
    expect(String(response.headers['permissions-policy'])).toContain('on-device-speech-recognition=()');
  }
});

it('explicit trusted voice-input opt-in permits only same-origin document microphone without relaxing script or other device policies', async () => {
  vi.stubEnv('STUDIO_VOICE_INPUT', '1');
  const app = createServer({ operator, productionAssetRoot: fixture() }); apps.push(app);
  for (const url of ['/', '/demo']) {
    const response = await app.inject(url);
    const policy = String(response.headers['permissions-policy']);
    expect(policy).toContain('microphone=(self)');
    expect(policy).toContain('on-device-speech-recognition=(self)');
    for (const denied of ['camera=()', 'geolocation=()', 'payment=()', 'usb=()']) expect(policy).toContain(denied);
    const csp = String(response.headers['content-security-policy']);
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).not.toContain('allow-scripts');
  }
  const asset = await app.inject('/assets/index-AbCd1234.js');
  expect(String(asset.headers['permissions-policy'])).toContain('microphone=()');
});
