import {describe,it,expect} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {StudioDesignerApp} from '../StudioDesignerApp';
import {WORKFLOW_CSS} from '../../workflow/styles';
describe('actual reviewed designer host composition',()=>{
 it('renders the real embedded module and common creation action with local-only disclosure',()=>{
  const html=renderToStaticMarkup(<StudioDesignerApp initialAppearance="night"/>);
  expect(html.match(/class="fd-app-designer fd-embedded"/g)).toHaveLength(1);
  expect(html).toContain('studio-home-create');expect(html).toContain('not connected to Flightdeck OS');expect(html).not.toContain('data-standalone-chrome');
 });
 it('places explicit JSON transfer above retained quick controls without unmounting them',()=>{
  expect(WORKFLOW_CSS).toContain('.wf-editor>section[aria-label="Draft JSON transfer"]{position:relative;z-index:9;background:var(--wf-panel)}');
  expect(WORKFLOW_CSS).toContain('z-index:8;overflow:auto;overscroll-behavior:contain');
 });
});
