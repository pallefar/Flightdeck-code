import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { StudioApp } from '../StudioApp';
import { WorkflowApprovals } from '../WorkflowApprovals';
it('mounts retained Approvals beside existing areas without automatic requests or fake queue', () => {
 let requests = 0;
 const html = renderToStaticMarkup(<StudioApp fetcher={async () => { requests++; throw new Error('must not request'); }} />);
 expect(html).toContain('Approvals'); expect(html).toContain('aria-label="Approvals area"');
 expect(html).toContain('aria-label="Resources area"'); expect(html).toContain('aria-label="Workflow editor area"');
 expect(requests).toBe(0); expect(html).toContain('Independent reviewer sign-in');
 expect(html).not.toContain('No approvals in this checked project');
});
it('missing credentials disables refresh and never mounts enabled approve actions', () => {
 const html = renderToStaticMarkup(<WorkflowApprovals projectId="development" token="" />);
 expect(html).toMatch(/aria-label="Refresh approvals" disabled/);
 expect(html).toContain('Inbox not checked'); expect(html).not.toContain('Approve and resume');
 expect(html).toContain('identity provider'); expect(html).not.toContain('body{');
});
