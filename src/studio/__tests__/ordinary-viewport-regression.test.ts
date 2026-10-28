import {readFileSync} from 'node:fs';
import postcss, {type Rule} from 'postcss';
import {expect,it} from 'vitest';

const builder=postcss.parse(readFileSync(new URL('../StudioBuilder.css',import.meta.url),'utf8'));
const shell=postcss.parse(readFileSync(new URL('../StudioShell.css',import.meta.url),'utf8'));
const home='.studio-shell .studio-builder-grid[data-area=studio][data-home=empty] .studio-chat';
// Finite source-cascade proof only. Does not emulate geometry, native hit tests,
// touch, CSSOM or safe-alignment layout. The old clip observation stays unwaived.
function applies(rule:Rule,width:number,height:number){
 for(let parent:import('postcss').Node|undefined=rule.parent;parent;parent=parent.parent){
  if(parent.type!=='atrule')continue;
  const at=parent as import('postcss').AtRule;
  expect(at.name).toBe('media');
  const clauses=at.params.split(/\s+and\s+/);
  if(!clauses.every(clause=>{
   const m=/^\((min|max)-(width|height):\s*(\d+)px\)$/.exec(clause.trim());
   if(!m)throw Error(`Unsupported relevant media query: ${at.params}`);
   const value=m[2]==='width'?width:height;
   return m[1]==='min'?value>=Number(m[3]):value<=Number(m[3]);
  }))return false;
 }
 return true;
}
function effective(root:ReturnType<typeof postcss.parse>,selectors:string[],width:number,height:number){
 const result=new Map<string,{value:string;rank:number;important:boolean}>();
 root.walkRules(rule=>{
  const matches=rule.selectors.filter(s=>selectors.includes(s));
  if(!matches.length||!applies(rule,width,height))return;
  const rank=Math.max(...matches.map(s=>selectors.indexOf(s)));
  rule.walkDecls(d=>{
   const old=result.get(d.prop),important=!!d.important;
   if(!old||Number(important)>Number(old.important)||important===old.important&&rank>=old.rank)result.set(d.prop,{value:d.value,rank,important});
  });
 });
 return (property:string)=>result.get(property)?.value;
}
it.each([[390,568],[390,844],[500,650],[850,650],[851,650],[1100,651],[1440,900],[1600,450]])('retains the effective safe-centering/main-scroll source contract at %ix%i', (width,height)=>{
 const chat=effective(builder,['.studio-shell .studio-chat',home],width,height);
 expect(chat('justify-content')).toBe('safe center');
 expect(chat('overflow')).toBe('visible');
 expect(chat('height')).toBe('100%');expect(chat('min-height')).toBe('0');
 expect(chat('display')).toBe('flex');expect(chat('flex-direction')).toBe('column');
 const command=effective(builder,['.studio-shell .studio-command',home.replace(/ \.studio-chat$/, ' .studio-command')],width,height);
 expect(command('flex')).toBe('none');
 expect(effective(shell,['.studio-shell .studio-main'],width,height)('overflow')).toBe('auto');
});
it('retains mobile control sizing and the actual main scroller; never hides the home entry',()=>{
 const css=builder.toString(),shellCss=shell.toString();
 expect(shellCss).toContain('.studio-shell .studio-main :is(button,summary):not(:where(.wf-editor *,.fd-wb *)){min-height:44px}');
 expect(css).toContain('.studio-composer-tools .reuse-picker-entry>button{border:0;background:transparent;font-size:12px;padding:4px 0;min-height:44px');
 const chat=effective(builder,['.studio-shell .studio-chat',home],390,568);
 expect(chat('display')).not.toBe('none');expect(chat('visibility')).not.toBe('hidden');
});
