import {renderToStaticMarkup} from 'react-dom/server';
import type {ComponentPropsWithRef,KeyboardEvent} from 'react';
import {readFileSync} from 'node:fs';
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {StudioShell,type StudioArea} from './StudioShell';

// Observe real shell handlers, without claiming SSR is mounted/native input.
const captured=vi.hoisted(()=>[] as Array<{type:unknown;props:Record<string,unknown>}>);
const effects=vi.hoisted(()=>[] as Array<()=>void|(()=>void)>);
const effectDependencies=vi.hoisted(()=>[] as Array<readonly unknown[]>);
vi.mock('react',async importOriginal=>{
 const react=await importOriginal<typeof import('react')>();
 return {...react,useEffect:(effect:()=>void|(()=>void),dependencies:readonly unknown[])=>{effects.push(effect);effectDependencies.push(dependencies);return react.useEffect(effect,dependencies);}};
});
vi.mock('react/jsx-runtime',async importOriginal=>{
 const runtime=await importOriginal<typeof import('react/jsx-runtime')>();
 function observe(type:unknown,props:unknown){if(typeof type==='string')captured.push({type,props:props as Record<string,unknown>});}
 return {...runtime,
  jsx:(...args:Parameters<typeof runtime.jsx>)=>{observe(args[0],args[1]);return runtime.jsx(...args);},
  jsxs:(...args:Parameters<typeof runtime.jsxs>)=>{observe(args[0],args[1]);return runtime.jsxs(...args);},
 };
});
vi.mock('react/jsx-dev-runtime',async importOriginal=>{
 const runtime=await importOriginal<typeof import('react/jsx-dev-runtime')>();
 return {...runtime,jsxDEV:(...args:Parameters<typeof runtime.jsxDEV>)=>{
  if(typeof args[0]==='string')captured.push({type:args[0],props:args[1] as Record<string,unknown>});
  return runtime.jsxDEV(...args);
 }};
});
function observed<T>(test:(node:typeof captured[number])=>boolean):T{
 const node=captured.find(test);expect(node,'the real shell renders the requested control').toBeDefined();return node!.props as T;
}
function setRef(ref:unknown,value:unknown){(ref as {current:unknown}).current=value;}
const props={area:'studio' as StudioArea,onNavigate:vi.fn(),onConnectionSettings:vi.fn(),project:'',model:'',graphName:'Untitled workflow'};
beforeEach(()=>{captured.length=0;effects.length=0;effectDependencies.length=0;vi.clearAllMocks();});
afterEach(()=>vi.unstubAllGlobals());

it('frames the chat-first workspace with Atlas sidebar navigation and a current-area breadcrumb',()=>{
 const html=renderToStaticMarkup(<StudioShell {...props}><section data-retained-editor="true">Retained child</section></StudioShell>);
 expect(html).toContain('class="studio-sidebar"');
 expect(html).toContain('aria-label="Studio areas"');
 expect(html).toContain('Process discovery');
 expect(html).toContain('aria-label="Studio breadcrumb"');
 expect(html).toContain('AI builder');
 expect(html).toContain('aria-label="Open Studio navigation"');
 expect(html.match(/data-retained-editor="true"/g)).toHaveLength(1);
 expect(html.match(/<main(?:\s|>)/g)).toHaveLength(1);
 expect(html).toContain('id="studio-main" tabindex="-1"');
 expect(html).toContain('Project: Not selected');
 expect(html).toContain('Model: Not selected');
});

it('scopes Atlas source tokens and sidebar geometry without changing inherited muted-text semantics',()=>{
 const css=readFileSync(new URL('./StudioShell.css',import.meta.url),'utf8');
 expect(css).toContain('--studio-sidebar-width:224px');
 expect(css).toContain('grid-template-columns:var(--studio-sidebar-width) minmax(0,1fr)');
 expect(css).toContain('grid-row:1 / -1');
 expect(css).toContain('--studio-muted-surface:var(--surface2,#e8eef1)');
 expect(css).toContain('--studio-muted-ink:var(--muted,#586e7c)');
 expect(css).toContain('--surface2: #e8eef1');
 expect(css).toContain('--muted: #586e7c');
 expect(css).toContain('--muted: #a7b6c3');
 expect(css).toContain('Arial,Helvetica,"Segoe UI",sans-serif');
 expect(css).toContain('.studio-shell .studio-navigation-dialog');
 expect(css).toContain('.studio-shell .studio-sidebar{display:none}');
 expect(css).toContain('min-height:44px');
 expect(css).not.toMatch(/(?:^|\})\s*(?:html|body|:root)\b/m);
 expect(css).not.toContain('flex-wrap:wrap;gap:0 12px');
});

it('opens mobile navigation as a native modal and closes Escape to the exact opener',()=>{
 const html=renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 expect(html).toContain('id="studio-navigation-dialog"');
 expect(html).not.toContain('id="studio-navigation-dialog" open');
 const trigger=observed<ComponentPropsWithRef<'button'>>(node=>node.props['aria-label']==='Open Studio navigation');
 const modal=observed<ComponentPropsWithRef<'dialog'>>(node=>node.props.id==='studio-navigation-dialog');
 const opener={focus:vi.fn(),getClientRects:()=>[{}]};
 const current={focus:vi.fn()};
 const dialog={open:false,showModal:vi.fn(()=>{dialog.open=true;}),close:vi.fn(()=>{dialog.open=false;}),querySelector:vi.fn(()=>current)};
 setRef(modal.ref,dialog);
 trigger.onClick?.({currentTarget:opener} as never);
 expect(dialog.showModal).toHaveBeenCalledOnce();
 expect(current.focus).toHaveBeenCalledWith({preventScroll:true});
 expect(props.onNavigate).not.toHaveBeenCalled();
 const preventDefault=vi.fn();
 modal.onCancel?.({preventDefault} as never);
 expect(preventDefault).toHaveBeenCalledOnce();
 expect(dialog.close).toHaveBeenCalledOnce();
 expect(opener.focus).toHaveBeenCalledWith({preventScroll:true});
 modal.onClose?.({} as never);
 expect(opener.focus).toHaveBeenCalledOnce();
});

type Control={tabIndex:number;disabled:boolean;hidden:boolean;inert:boolean;rects:number;visibility:string;focus:ReturnType<typeof vi.fn>;matches:(selector:string)=>boolean;closest:(selector:string)=>object|null;getClientRects:()=>object[]};
function keyboardFixture(){
 renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 const modal=observed<ComponentPropsWithRef<'dialog'>>(node=>node.props.id==='studio-navigation-dialog');
 const document={activeElement:null as Control|null};vi.stubGlobal('document',document);
 vi.stubGlobal('getComputedStyle',(element:Control)=>({visibility:element.visibility}));
 function control(options:Partial<Pick<Control,'tabIndex'|'disabled'|'hidden'|'inert'|'rects'|'visibility'>>={}):Control{
  const element:Control={tabIndex:0,disabled:false,hidden:false,inert:false,rects:1,visibility:'visible',...options,
   focus:vi.fn(()=>{document.activeElement=element;}),
   matches:selector=>selector===':disabled'&&element.disabled,
   closest:selector=>(selector.includes('[hidden]')&&element.hidden||selector.includes('[inert]')&&element.inert)?{}:null,
   getClientRects:()=>Array.from({length:element.rects},()=>({})),
  };return element;
 }
 const first=control(),last=control();
 const dialog={open:true,querySelectorAll:vi.fn(()=>[first,last])};
 function press(shiftKey=false,key='Tab'){
  expect(modal.onKeyDown,'the actual native navigation dialog binds a keyboard handler').toBeTypeOf('function');
  const event={key,shiftKey,currentTarget:dialog,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;}};
  modal.onKeyDown?.(event as unknown as KeyboardEvent<HTMLDialogElement>);return event;
 }
 return {document,control,first,last,dialog,press};
}
it.each([false,true])('contains navigation boundary Tab in the native modal (shift=%s)',shift=>{
 const {document,first,last,press}=keyboardFixture();document.activeElement=shift?first:last;
 expect(press(shift).defaultPrevented).toBe(true);
 expect(document.activeElement).toBe(shift?last:first);
 expect((shift?last:first).focus).toHaveBeenCalledWith({preventScroll:true});
});
it.each([
 ['disabled',{disabled:true}],['negative tab index',{tabIndex:-1}],['no layout boxes',{rects:0}],
 ['hidden ancestor',{hidden:true}],['inert ancestor',{inert:true}],['invisible',{visibility:'hidden'}],['collapsed',{visibility:'collapse'}],
] as const)('excludes %s navigation controls from the live keyboard boundary',(_name,options)=>{
 const {document,control,first,last,dialog,press}=keyboardFixture();
 const before=control(options),after=control(options);dialog.querySelectorAll.mockReturnValue([before,first,last,after]);
 for(const shift of [false,true]){
  document.activeElement=shift?first:last;expect(press(shift).defaultPrevented).toBe(true);expect(document.activeElement).toBe(shift?last:first);
 }
 expect(before.focus).not.toHaveBeenCalled();expect(after.focus).not.toHaveBeenCalled();
});
it('leaves closed navigation and interior keyboard traversal untrapped',()=>{
 const {document,control,first,last,dialog,press}=keyboardFixture(),middle=control();
 dialog.querySelectorAll.mockReturnValue([first,middle,last]);document.activeElement=middle;
 for(const shift of [false,true])expect(press(shift).defaultPrevented).toBe(false);
 for(const key of ['Escape','Enter','ArrowRight'])expect(press(false,key).defaultPrevented).toBe(false);
 dialog.open=false;document.activeElement=last;
 expect(press().defaultPrevented).toBe(false);
 expect(first.focus).not.toHaveBeenCalled();expect(last.focus).not.toHaveBeenCalled();
});
it('contains Tab with zero or one live controls and recovers lost modal focus',()=>{
 const {document,first,last,dialog,press}=keyboardFixture();
 dialog.querySelectorAll.mockReturnValue([]);
 expect(press().defaultPrevented).toBe(true);expect(document.activeElement).toBeNull();
 dialog.querySelectorAll.mockReturnValue([first]);
 for(const shift of [false,true]){
  document.activeElement=first;expect(press(shift).defaultPrevented).toBe(true);expect(document.activeElement).toBe(first);
 }
 dialog.querySelectorAll.mockReturnValue([first,last]);document.activeElement=null;
 expect(press().defaultPrevented).toBe(true);expect(document.activeElement).toBe(first);
 document.activeElement=null;expect(press(true).defaultPrevented).toBe(true);expect(document.activeElement).toBe(last);
});
it.each(['studio-tools','studio-context-details'])('dismisses the %s disclosure with Escape and returns focus to its summary',className=>{
 renderToStaticMarkup(<StudioShell {...props} area="editor">Retained workspace</StudioShell>);
 const disclosure=observed<ComponentPropsWithRef<'details'>>(node=>node.props.className===className);
 expect(disclosure.onKeyDown).toBeTypeOf('function');
 const summary={focus:vi.fn()},details={open:true,querySelector:vi.fn(()=>summary)};
 const event={key:'Escape',currentTarget:details,preventDefault:vi.fn(),stopPropagation:vi.fn()};
 disclosure.onKeyDown?.(event as never);
 expect(details.open).toBe(false);expect(event.preventDefault).toHaveBeenCalledOnce();
 expect(event.stopPropagation).toHaveBeenCalledOnce();expect(summary.focus).toHaveBeenCalledWith({preventScroll:true});
 details.open=true;disclosure.onKeyDown?.({...event,key:'Enter'} as never);expect(details.open).toBe(true);
});
function responsiveFixture(matches:boolean){
 renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 const modal=observed<ComponentPropsWithRef<'dialog'>>(node=>node.props.id==='studio-navigation-dialog');
 const trigger=observed<ComponentPropsWithRef<'button'>>(node=>node.props['aria-label']==='Open Studio navigation');
 const sidebar=observed<ComponentPropsWithRef<'aside'>>(node=>node.props.className==='studio-sidebar');
 const opener={focus:vi.fn()},current={focus:vi.fn()};
 const dialog={open:false,showModal:vi.fn(()=>{dialog.open=true;}),close:vi.fn(()=>{dialog.open=false;}),querySelector:vi.fn(()=>current)};
 const desktop={querySelector:vi.fn(()=>current),contains:vi.fn(()=>false)};
 expect(effects[0],'the real shell subscribes to responsive navigation changes').toBeTypeOf('function');
 setRef(modal.ref,dialog);setRef(trigger.ref,opener);setRef(sidebar.ref,desktop);
 const document={activeElement:null as unknown};vi.stubGlobal('document',document);
 let listener:(()=>void)|undefined;
 const media={matches,addEventListener:vi.fn((_name:string,callback:()=>void)=>{listener=callback;}),removeEventListener:vi.fn()};
 vi.stubGlobal('window',{matchMedia:vi.fn(()=>media)});
 expect(effects[0],'the real shell subscribes to responsive navigation changes').toBeTypeOf('function');
 const cleanup=effects[0]?.();
 return {modal,trigger,opener,current,dialog,desktop,document,media,cleanup,change(value:boolean){media.matches=value;listener?.();}};
}
it('closes a mobile modal at the desktop breakpoint and focuses visible desktop navigation',()=>{
 const {trigger,opener,current,dialog,media,cleanup,change}=responsiveFixture(true);
 trigger.onClick?.({currentTarget:opener} as never);current.focus.mockClear();
 change(false);
 expect(dialog.close).toHaveBeenCalledOnce();expect(current.focus).toHaveBeenCalledWith({preventScroll:true});expect(opener.focus).not.toHaveBeenCalled();
 expect(props.onNavigate).not.toHaveBeenCalled();
 cleanup?.();expect(media.removeEventListener).toHaveBeenCalledWith('change',media.addEventListener.mock.calls[0]?.[1]);
});
it('moves focus out of the now-hidden desktop sidebar when the viewport becomes compact',()=>{
 const {opener,desktop,change}=responsiveFixture(false);desktop.contains.mockReturnValue(true);
 change(true);expect(opener.focus).toHaveBeenCalledWith({preventScroll:true});expect(props.onNavigate).not.toHaveBeenCalled();
});
it.each([
 ['studio','AI builder'],['process','Process discovery'],['editor','Workflow builder'],['ide','Sub-app IDE'],['resources','Resources'],['approvals','Approvals'],
] as const)('routes %s only by its existing parent callback, retaining the exact workspace slot', (area,label)=>{
 const child=<section data-retained-editor="true">Retained editor</section>;
 const html=renderToStaticMarkup(<StudioShell {...props} area={area}>{child}</StudioShell>);
 expect(props.onNavigate).not.toHaveBeenCalled();
 const button=observed<ComponentPropsWithRef<'button'>>(node=>node.type==='button'&&node.props.children===label);
 expect(button['aria-current']).toBe('page');
 const main=observed<ComponentPropsWithRef<'main'>>(node=>node.props.id==='studio-main');
 expect(main.children).toBe(child);expect(html.match(/data-retained-editor="true"/g)).toHaveLength(1);
 const tools=observed<ComponentPropsWithRef<'details'>>(node=>node.props.className==='studio-tools');
 const disclosure={open:true};setRef(tools.ref,disclosure);
 button.onClick?.({} as never);
 expect(props.onNavigate).toHaveBeenCalledExactlyOnceWith(area);expect(disclosure.open).toBe(false);
 expect(props.onConnectionSettings).not.toHaveBeenCalled();
 expect(html).not.toMatch(/(?:Data connections|Connected database|Admin role|New project)/);
});
it('passes connection, voice, appearance and motion controls through without navigation or resets',()=>{
 const onAppearance=vi.fn(),onMotion=vi.fn(),voice=vi.fn();
 const html=renderToStaticMarkup(<StudioShell {...props} appearance="night" motion={false} onAppearance={onAppearance} onMotion={onMotion} voiceTools={<button type="button" aria-label="Fixture voice" onClick={voice}>Voice</button>}>Retained workspace</StudioShell>);
 const settings=observed<ComponentPropsWithRef<'button'>>(node=>node.props.className==='studio-settings-button');
 settings.onClick?.({} as never);expect(props.onConnectionSettings).toHaveBeenCalledOnce();
 const appearance=observed<ComponentPropsWithRef<'select'>>(node=>node.props['aria-label']==='Studio appearance');
 appearance.onChange?.({target:{value:'day'}} as never);expect(onAppearance).toHaveBeenCalledExactlyOnceWith('day');
 const motion=observed<ComponentPropsWithRef<'button'>>(node=>node.props.className==='studio-motion');
 expect(motion['aria-pressed']).toBe(false);motion.onClick?.({} as never);expect(onMotion).toHaveBeenCalledOnce();
 observed<ComponentPropsWithRef<'button'>>(node=>node.props['aria-label']==='Fixture voice').onClick?.({} as never);
 expect(voice).toHaveBeenCalledOnce();expect(props.onNavigate).not.toHaveBeenCalled();
 expect(html).toContain('data-appearance="night"');expect(html).toContain('data-motion="off"');
});
it('keeps the skip action on the same main focus target without changing navigation',()=>{
 renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 const main=observed<ComponentPropsWithRef<'main'>>(node=>node.props.id==='studio-main'),target={focus:vi.fn()};setRef(main.ref,target);
 const skip=observed<ComponentPropsWithRef<'a'>>(node=>node.props.className==='studio-skip'),preventDefault=vi.fn();
 skip.onClick?.({preventDefault} as never);expect(preventDefault).toHaveBeenCalledOnce();expect(target.focus).toHaveBeenCalledOnce();expect(props.onNavigate).not.toHaveBeenCalled();
});
it('does not let an old native close event dismiss a newly reopened drawer',()=>{
 renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 const trigger=observed<ComponentPropsWithRef<'button'>>(node=>node.props['aria-label']==='Open Studio navigation');
 const modal=observed<ComponentPropsWithRef<'dialog'>>(node=>node.props.id==='studio-navigation-dialog');
 const opener={focus:vi.fn()},current={focus:vi.fn()};
 const dialog={open:false,showModal:vi.fn(()=>{dialog.open=true;}),close:vi.fn(()=>{dialog.open=false;}),querySelector:vi.fn(()=>current)};setRef(modal.ref,dialog);
 trigger.onClick?.({currentTarget:opener} as never);modal.onCancel?.({preventDefault:vi.fn()} as never);
 trigger.onClick?.({currentTarget:opener} as never);modal.onClose?.({} as never);
 expect(dialog.open).toBe(true);expect(dialog.close).toHaveBeenCalledOnce();expect(opener.focus).toHaveBeenCalledOnce();
});
it('releases modal navigation when an actual parent area change takes ownership of workspace focus',()=>{
 renderToStaticMarkup(<StudioShell {...props}>Retained workspace</StudioShell>);
 expect(effects[1],'the shell reacts to parent-owned area changes, not only sidebar clicks').toBeTypeOf('function');
 expect(effectDependencies[1]).toEqual([props.area]);
 const trigger=observed<ComponentPropsWithRef<'button'>>(node=>node.props['aria-label']==='Open Studio navigation');
 const modal=observed<ComponentPropsWithRef<'dialog'>>(node=>node.props.id==='studio-navigation-dialog');
 const main=observed<ComponentPropsWithRef<'main'>>(node=>node.props.id==='studio-main');
 const opener={focus:vi.fn()},target={focus:vi.fn()},current={focus:vi.fn()};
 const dialog={open:false,showModal:vi.fn(()=>{dialog.open=true;}),close:vi.fn(()=>{dialog.open=false;}),querySelector:vi.fn(()=>current)};
 setRef(modal.ref,dialog);setRef(main.ref,target);trigger.onClick?.({currentTarget:opener} as never);
 effects[1]?.();
 expect(dialog.close).toHaveBeenCalledOnce();expect(target.focus).toHaveBeenCalledWith({preventScroll:true});expect(opener.focus).not.toHaveBeenCalled();
 expect(props.onNavigate).not.toHaveBeenCalled();
});
