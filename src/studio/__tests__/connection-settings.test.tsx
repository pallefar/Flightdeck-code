import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {AnthropicConnectionSetup} from '../AnthropicConnectionSetup';

it('offers the masked key directly before metadata with no nested setup or request',()=>{
  const fetcher=vi.fn<typeof fetch>();
  const html=renderToStaticMarkup(<AnthropicConnectionSetup token="NONSECRET_OPERATOR_FIXTURE" active contextEpoch={0} fetcher={fetcher} onMutationStarted={()=>{}} onChanged={()=>{}}/>);
  expect(html).toContain('aria-label="Anthropic API key"');
  expect(html).toContain('type="password"');
  expect(html).toContain('Save session key');
  expect(html).not.toContain('Anthropic API key setup</button>');
  expect(html).not.toContain('<dialog');
  expect(html).not.toMatch(/aria-label="Anthropic API key"[^>]*value=/);
  expect(fetcher).not.toHaveBeenCalled();
});

it('provides a dedicated closable Connection settings dialog without an automatic request',async()=>{
  const module=await import('../ConnectionSettingsPanel').catch(()=>({ConnectionSettingsPanel:undefined}));
  expect(module.ConnectionSettingsPanel,'Dedicated settings surface is missing').toBeTypeOf('function');
  const Panel=module.ConnectionSettingsPanel!;
  const close=vi.fn(),html=renderToStaticMarkup(<Panel open={false} onClose={close}><p>Connection controls</p></Panel>);
  expect(html).toContain('aria-label="Connection settings"');
  expect(html).toContain('Close');
  expect(html).toContain('Done');
  expect(html).not.toContain(' open=""');
  expect(close).not.toHaveBeenCalled();
});
