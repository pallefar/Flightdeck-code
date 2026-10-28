import type {ReactNode} from 'react';
/** Composition boundary only, not a PageDoc store, authorization or save contract.
 * Both halves are required: a stable mounted editor element and its actual public
 * creation action. The host must preserve editor identity and dirty-work guards.
 * A settled action is not a persistence receipt; Studio never claims creation or
 * save success on its behalf. Do not adapt this with hidden clicks or remounts.
 */
export type StudioPageWorkspacePort={
 readonly workspace:ReactNode;
 readonly createPage:()=>void|Promise<void>;
};
