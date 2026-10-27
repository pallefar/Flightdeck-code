/** Nonsecret development fixture; source is data and must never be evaluated. */
export function snapshotFixture() {
  const files = [{ path: 'server/subapps/demo/manifest.ts', contents: 'export const fixture = true;\r\n', kind: 'manifest' as const }];
  return {
    baseline: {
      manifest: { id: 'demo', label: 'Demo', version: '0.1.0', summary: null, icon: 'box', navSection: 'tools', routePrefix: '/api/demo', webModuleId: 'demo', capabilities: ['demo.read'], visibleToRoles: ['admin'], envVar: 'SUBAPP_DEMO_ENABLED', tablePrefix: 'subapp_demo_' },
      files: files.map(f => ({ ...f })), findings: [], rulesRun: ['fixture-rule'], notes: ['Development-only generated baseline'],
    },
    files: files.map(f => ({ ...f })),
  };
}
