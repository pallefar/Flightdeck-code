import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { SubappSourceValidation } from '../SubappSourceValidation';
import { generatedStore } from './subapp-workspace.fixture';
import { createHash } from 'node:crypto';
import { SourceValidationController, type WorkingSourceValidator } from '../subapp-source-validation-controller';
import { checkWorkingSource } from '../subapp-source-validation';

const direct: WorkingSourceValidator = async snapshot => ({ ...checkWorkingSource(snapshot), sourceHash: createHash('sha256').update(JSON.stringify(snapshot.files)).digest('hex') });

it('shows fresh working-source findings separately, without echoing source or accepting old-scope evidence before effects', async () => {
  const store = generatedStore();
  const file = store.effectiveFiles().find(file => file.kind === 'web-module')!;
  store.editFile(file.path, 'import fs from "node:fs";\n// PRIVATE-COMMENT-DEVELOPMENT\n' + file.contents); store.saveFile(file.path);
  const controller = new SourceValidationController(store, direct);
  const cleanup = controller.connect(); controller.setScope('demo', 'old-development', true); await controller.check();
  const props = { store, projectId: 'demo', token: 'old-development', active: true, validate: direct, controller };
  const html = renderToStaticMarkup(<SubappSourceValidation {...props}/>);
  expect(html).toContain('Static conformance needs attention'); expect(html).toContain('FD-C001');
  expect(html).toContain('7 static checks ran'); expect(html).toContain(controller.getState().report!.sourceHash);
  expect(html).not.toContain('PRIVATE-COMMENT-DEVELOPMENT'); expect(html).not.toContain('Synthetic retained evidence');
  for (const change of [{projectId: 'other'}, {token: 'new-development'}, {active: false}]) {
    const hidden = renderToStaticMarkup(<SubappSourceValidation {...props} {...change}/>);
    expect(hidden).not.toContain('FD-C001'); expect(hidden).not.toContain(controller.getState().report!.sourceHash);
  }
  cleanup();
});

it('offers an explicit local static check with truthful boundaries and no automatic validator call', () => {
  let calls = 0;
  const html = renderToStaticMarkup(<SubappSourceValidation store={generatedStore()} projectId="demo" token="development-private-sentinel" active validate={async () => { calls++; throw new Error('No automatic check'); }}/>);
  expect(calls).toBe(0);
  expect(html).toContain('Check working source'); expect(html).toContain('not checked');
  expect(html).toContain('No source is executed'); expect(html).toContain('not a typecheck');
  expect(html).not.toContain('development-private-sentinel'); expect(html).not.toContain('<dialog');
});
