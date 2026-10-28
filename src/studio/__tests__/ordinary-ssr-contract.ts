// Finite SSR-token ancestry, not a browser DOM, accessibility tree or layout.
// Keep visibility assertions separate from CSS/native acceptance.
export interface SsrTag {tag:string;attrs:Record<string,string>;ancestors:SsrTag[]}
export function ssrTags(html:string):SsrTag[]{
 const result:SsrTag[]=[],stack:SsrTag[]=[];
 const markup=html.replace(/<(style|script)\b[^>]*>[\s\S]*?<\/\1>/g,'');
 for(const match of markup.matchAll(/<(\/?)([a-zA-Z][\w-]*)\b([^>]*)>/g)){
  const closing=match[1]==='/',tag=match[2]!.toLowerCase();
  if(closing){const index=stack.map(n=>n.tag).lastIndexOf(tag);if(index>=0)stack.length=index;continue;}
  const attrs:Record<string,string>={};
  for(const a of match[3]!.matchAll(/([^\s=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))attrs[a[1]!]=a[2]??a[3]??a[4]??'';
  const node={tag,attrs,ancestors:[...stack]};result.push(node);
  if(!/^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/.test(tag)&&!match[3]!.endsWith('/'))stack.push(node);
 }
 return result;
}
export function hasClass(node:SsrTag,name:string){return (node.attrs.class??'').split(/\s+/).includes(name);}
export function semanticBlockers(node:SsrTag){return [node,...node.ancestors].filter(n=>'hidden'in n.attrs||'inert'in n.attrs||n.attrs['aria-hidden']==='true'||n.tag==='dialog'&&!('open'in n.attrs)||n.tag==='details'&&!('open'in n.attrs));}
