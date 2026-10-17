import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {StudioApp} from '../StudioApp';
import { createWorkflowTemplate } from '../../workflow';
import {workflow} from './fixtures';
import {StudioController} from '../controller';
it('renders one retained conversation beside named workflow and sub-app workspaces with a real unconfigured composer',()=>{
 const html=renderToStaticMarkup(<StudioApp/>);
 expect(html).toContain('aria-label="Draft builder conversation"');
 expect(html).toContain('aria-label="Conversation history"');
 expect(html).toContain('aria-label="Sub-app IDE area"');
 expect(html).toContain('Draft builder');
 expect(html).toContain('Open workflow example');
 expect(html).not.toContain('Voice recording');
 expect(html).toContain('data-motion="on"');
});
it('renders submitted prompt as escaped text and a receipt rather than fabricated streamed tool progress',async()=>{
 const controller=new StudioController(async()=>new Response(JSON.stringify({status:'invalid_determination',issues:['Ambiguous deliverable']})));
 await controller.submit({connectionId:'local',prompt:'<img src=x onerror=alert(1)>'},'sentinel');
 const html=renderToStaticMarkup(<StudioApp controller={controller}/>);
 expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
 expect(html).not.toContain('<img src=x');
 expect(html).toContain('Draft not accepted. Ambiguous deliverable');
 expect(html).not.toContain('Generating nodes');
});
it('reports graph-owned built-in and reusable counts only as proposed draft declarations',async()=>{
 const controller=new StudioController(async()=>new Response(JSON.stringify({...workflow,graph:createWorkflowTemplate('branch')})));
 await controller.submit({connectionId:'local',prompt:'Draft graph'},'sentinel');
 const html=renderToStaticMarkup(<StudioApp controller={controller}/>);
 expect(html).toContain('4 built-in blocks');
 expect(html).toContain('0 reusable wrapper instances');
 expect(html).toContain('0 wrapper definitions');
 expect(html).toContain('review required');
});
