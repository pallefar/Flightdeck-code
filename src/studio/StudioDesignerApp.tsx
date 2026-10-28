import { useCallback, useMemo, useRef, type ComponentProps } from 'react';
import { StudioApp } from './StudioApp';
import { AppDesigner, type AppDesignerCreatePageRequestHandle } from './designer/AppDesigner';
import type { StudioPageWorkspacePort } from './page-workspace';
import './designer/AppDesigner.css';
import './StudioDesignerHost.css';

/** Real local-only designer composition; not an OS persistence/authority adapter. */
export function StudioDesignerApp(props: Omit<ComponentProps<typeof StudioApp>, 'pageWorkspace'>) {
  const current = useRef<AppDesignerCreatePageRequestHandle | null>(null);
  const receive = useCallback((handle: AppDesignerCreatePageRequestHandle | null) => {
    current.current = handle;
  }, []);
  // Stable element, callback and port: normal navigation hides, never replaces, the editor.
  const workspace = useMemo(() => <AppDesigner embedded onCreatePageRequestHandle={receive} />, [receive]);
  const pageWorkspace = useMemo<StudioPageWorkspacePort>(() => ({
    workspace,
    createPage() {
      const handle = current.current;
      if (!handle) throw new Error('Page designer request is unavailable.');
      // This is a request only. The module owns replacement confirmation and creation.
      handle.requestCreatePage();
    },
  }), [workspace]);
  return <StudioApp {...props} pageWorkspace={pageWorkspace} />;
}
