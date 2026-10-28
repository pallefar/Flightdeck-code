import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it,vi} from 'vitest';
import {StudioApp} from '../StudioApp';
import {AnthropicConnectionSetup} from '../AnthropicConnectionSetup';
it('keeps technical configuration only in settings and puts reusable-source tools after the human prompt',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).not.toContain('class="studio-chat-setup"');
 const settings=html.slice(html.indexOf('<dialog class="studio-connection-panel"'));
 expect(settings).toContain('Server configuration &amp; connection help');
 expect(html.indexOf('What are we building?')).toBeLessThan(html.indexOf('class="studio-command"'));
 expect(html.indexOf('aria-label="Browse reusable sources"')).toBeGreaterThan(html.indexOf('</textarea>'));
 expect(html).toMatch(/<button[^>]*hidden=""[^>]*data-primary-action="false"[^>]*>Create draft<\/button>/);
});
it('offers a user-only Claude Console link without changing key transport or making a request',()=>{
 const fetcher=vi.fn<typeof fetch>();const html=renderToStaticMarkup(<AnthropicConnectionSetup token="NONSECRET_UNIT_OPERATOR" contextEpoch={0} active fetcher={fetcher} onMutationStarted={()=>{}} onChanged={()=>{}}/>);
 expect(html).toContain('href="https://platform.claude.com/settings/keys"');
 expect(html).toContain('target="_blank" rel="noopener noreferrer"');
 expect(html).toContain('Create API key in Claude Console');
 expect(html).toContain('workspace-scoped key');expect(fetcher).not.toHaveBeenCalled();
});
