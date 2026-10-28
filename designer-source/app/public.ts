import type {PageDocV2} from '../mirror/flightdeck/pagedoc/schema/index.js';
import type {PageDocAdapters} from '../mirror/flightdeck/pagedoc/adapters.js';
import type {WidgetDescriptor} from '../contracts/os/flightdeck/server/widgets/types.js';
import type {NativeBinding,NativeSession,NativeSaveResult} from './native.js';
export interface DesignerNativeOptions {
 binding:NativeBinding;
 /** Only the current authenticated /api/widgets response, NEVER /library.
  * Descriptors/labels are availability metadata, not permission grants. */
 catalogue:readonly {descriptor:WidgetDescriptor;label:string}[];
 /** The host's actual adapter v3, with its WidgetHost/navigation/data policy. */
 renderer:PageDocAdapters;
}
export type DesignerSaveResult=NativeSaveResult|{status:'local';reason:string};
export interface DesignerDocumentSnapshot {doc:PageDocV2;hasUnappliedChanges:boolean;dirty:boolean;native:ReturnType<NativeSession['snapshot']>|null}
/** Per-committed-instance commands. Released handles are permanently inert.
 * A request to bind/reopen/create can open a replacement confirmation; it is
 * not a save, publication, execution, auth or implementation-progress receipt. */
export interface DesignerDocumentHandle {
 getSnapshot():DesignerDocumentSnapshot|null;
 requestCreatePage():void;
 requestReopen():void;
 requestBindNative(options:DesignerNativeOptions):void;
 requestSave():Promise<DesignerSaveResult>;
 reconcileSave():Promise<NativeSaveResult>;
}
