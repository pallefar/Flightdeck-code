import type {BuiltinType} from '../../packages/workflow/graph';

export interface BlockControlProfile {
 readonly title:string;
 readonly purpose:string;
 /** Actual configuration schema keys, not editor-only draft aliases. */
 readonly quickKeys:readonly string[];
 readonly boundary:string;
}

const profiles = {
 manual:{title:'Manual trigger',purpose:'Starts execution with the original execution seed.',quickKeys:[],boundary:'No stored parameters. Supply input when running the workflow.'},
 set:{title:'Set fields',purpose:'Adds or replaces typed fields with a declarative merge into incoming data.',quickKeys:['fields'],boundary:'No expressions or executable code; nested values use bounded JSON.'},
 branch:{title:'Condition',purpose:'Tests incoming data and selects the true or false output port.',quickKeys:['field','operator','value'],boundary:'Equality compares JSON values; exists tests whether the field is present.'},
 output:{title:'Return output',purpose:'Returns incoming data as the workflow output.',quickKeys:[],boundary:'No stored parameters. Extended input mapping can shape the returned data.'},
 http:{title:'HTTP connector',purpose:'Dispatches a request through the configured trusted HTTP adapter port.',quickKeys:['url','method'],boundary:'Requires a trusted host adapter and a credential reference, never inline secrets. Service is metadata, not an integration.'},
 llm:{title:'LLM / agent',purpose:'Sends an instruction and input through the configured trusted model adapter port.',quickKeys:['instruction'],boundary:'No autonomous tools. The host must supply the model adapter; no provider fallback.'},
 resource:{title:'Resource invocation',purpose:'References a reviewed resource and function for trusted invocation.',quickKeys:['resourceId','functionId'],boundary:'References do not grant access. Active revision, independent server review and effect-time authorization are required.'},
 approval:{title:'Human approval',purpose:'Pauses execution for an independently authenticated human reviewer.',quickKeys:['reviewer'],boundary:'This editor cannot grant approval or authorize self-approval; a trusted verifier is required.'},
 unconfigured:{title:'Unconfigured step',purpose:'Describes a placeholder that must be configured before execution.',quickKeys:['description'],boundary:'Execution is blocked. A description does not implement an adapter or executable step.'},
} as const satisfies Record<BuiltinType,BlockControlProfile>;

/** Resolve reusable wrappers with resolveNode before looking up their builtin role. */
export function blockControlProfile(type:BuiltinType):BlockControlProfile {return profiles[type];}
