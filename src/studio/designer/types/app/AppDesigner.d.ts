import type { DesignerDocumentHandle } from './public.js';
/** A mounted-instance request, never a creation, save or persistence receipt. */
export interface AppDesignerCreatePageRequestHandle {
    requestCreatePage(): void;
}
export interface AppDesignerProps {
    /** Host supplies surrounding chrome and theme tokens; never identity/authority. */ embedded?: boolean;
    /** Receives the committed instance handle, then null on release. Keep this callback stable.
     * StrictMode may acquire/release/acquire; released handles are permanently inert. */
    onCreatePageRequestHandle?: (handle: AppDesignerCreatePageRequestHandle | null) => void;
    /** Committed per-instance validated document/native adapter seam; no authority. */
    onDocumentHandle?: (handle: DesignerDocumentHandle | null) => void;
}
export declare function AppDesigner({ embedded, onCreatePageRequestHandle, onDocumentHandle }: AppDesignerProps): import("react").JSX.Element;
