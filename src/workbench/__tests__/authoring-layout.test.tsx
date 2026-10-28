import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {Workbench} from '../Workbench';
import {createStore} from '../store';
import {candidate} from './fixtures';

it('keeps the full walkthrough mounted in an explicit out-of-flow disclosure instead of spending source rows',()=>{
 const store=createStore();store.settle(store.prompt('QA source candidate')??'',candidate());
 const before=store.getState();
 const html=renderToStaticMarkup(<Workbench store={store} hideChat onPrompt={()=>{throw Error('No model send in layout test');}}/>).replace(/<style>[\s\S]*?<\/style>/g,'');
 expect(html).toContain('class="fd-architecture"');
 expect(html).toContain('Architecture &amp; received modules');
 expect(html).not.toContain('<details class="fd-architecture" open');
 expect(html).toContain('aria-label="Sub-app architecture walkthrough"');
 expect(html).toContain('aria-label="Play walkthrough"');
 expect(html).toContain('Page/PANELS only · other pages source-only');
 expect(store.getState()).toBe(before);
});
