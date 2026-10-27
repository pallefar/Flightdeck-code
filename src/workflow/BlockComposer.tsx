import type {DragEvent,ReactNode} from 'react';
import type {Graph} from '../../packages/workflow/graph';
import type {paletteEntries} from './WorkflowEditor';

/** Registry reuse and graph-local declarations are deliberately separate. */
export function BlockComposer({graph,entries,categories,category,search,onCategory,onSearch,onAdd,onDragStart,onDragEnd,onCustom,onClose,canRequest,templates}:{
 graph:Graph;entries:ReturnType<typeof paletteEntries>;categories:ReadonlyArray<{label:string;count:number}>;
 category:string;search:string;onCategory:(value:string)=>void;onSearch:(value:string)=>void;
 onAdd:(type:string)=>void;onDragStart:(event:DragEvent<HTMLButtonElement>,type:string)=>void;onDragEnd:()=>void;
 onCustom:()=>void;onClose:()=>void;canRequest:boolean;templates:ReactNode;
}) {
 return <section className="wf-composer" aria-label="Block composer">
  <header className="wf-composer-head"><button className="wf-composer-close" aria-label="Close block composer" onClick={onClose}>×</button><span className="wf-kicker">BLOCK COMPOSER</span><h3>Reuse a block</h3><p>Drag to place · Enter or click to add.</p>
   <label><span className="wf-sr-only">Search</span><input aria-label="Search blocks" value={search} onChange={event=>onSearch(event.target.value)} placeholder="Search blocks"/></label>
   <label><span className="wf-sr-only">Category</span><select aria-label="Filter block category" value={category} onChange={event=>onCategory(event.target.value)}><option value="All">All ({categories.reduce((sum,item)=>sum+item.count,0)})</option>{categories.map(item=><option key={item.label} value={item.label}>{item.label} ({item.count})</option>)}</select></label>
  </header>
  <div className="wf-composer-actions"><strong>Need different defaults?</strong><div><button onClick={onCustom} title="Compose a reviewed graph-local wrapper of an existing builtin base. No generated code.">Custom block</button><button disabled={!canRequest} onClick={onCustom} title={canRequest?'Request a declarative proposal, then review before adding it.':'Select a configured model connection in Studio to request a block.'}>Ask AI for a block</button></div><p>Graph-local only · no generated code.{!canRequest&&<span className="wf-sr-only"> Select a configured model connection in Studio to request a block. Local editing and reviewed declarative wrappers need no model.</span>}</p></div>
  <div className="wf-composer-list">{categories.map(({label})=>{const group=entries.filter(entry=>entry.category===label);return group.length>0&&<section className="wf-palette-group" aria-label={label} key={label}><h4>{label==='Reusable blocks'?'Graph-local wrappers':label}<span>{group.length}</span></h4>{label==='Reusable blocks'&&<p className="wf-composer-boundary">Not a published library or resource activation.</p>}{group.map(entry=>{
   const wrapper=graph.customBlocks.find(block=>block.id===entry.type),uses=graph.nodes.filter(node=>node.type===entry.type).length;
   return <button className="wf-palette-item" data-block-origin={wrapper?'local-wrapper':entry.type==='unconfigured'?'placeholder':'builtin'} key={entry.type} draggable onDragStart={event=>onDragStart(event,entry.type)} onDragEnd={onDragEnd} onClick={()=>onAdd(entry.type)}><strong><span className="wf-palette-label">{entry.label}</span><code>{entry.type}</code></strong><small title={entry.description}>{entry.description}</small><small className="wf-palette-provenance">{wrapper?`Local definition · base ${wrapper.baseType} · ${uses} in graph`:entry.type==='unconfigured'?'Placeholder · execution blocked':`Builtin · ${uses} in graph`}</small></button>;
  })}</section>;})}{entries.length===0&&<p role="status">No matching blocks. Try another category or compose reviewed defaults.</p>}</div>
  <details className="wf-composer-templates"><summary>Start from a template</summary><p>Opens a new draft document.</p>{templates}</details>
 </section>;
}
