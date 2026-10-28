import {useLayoutEffect,useRef,type ReactNode} from 'react';
import './ConnectionSettingsPanel.css';

type Props={open:boolean;onClose:()=>void;children:ReactNode;fallbackFocus?:()=>HTMLElement|null;focusSelector?:string;focusRequest?:number};
/** Retained alongside authoring, never a route or a replacement workspace. */
export function ConnectionSettingsPanel({open,onClose,children,fallbackFocus,focusSelector,focusRequest}:Props){
  const dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLElement|null>(null);
  const requestedOpen=useRef(open);requestedOpen.current=open;
  useLayoutEffect(()=>{
    const modal=dialog.current;if(!modal)return;
    if(open){
      opener.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
      if(!modal.open)modal.showModal();
      modal.querySelector<HTMLButtonElement>('[data-settings-close]')?.focus({preventScroll:true});
      const leave=()=>onClose();
      window.addEventListener('pagehide',leave);window.addEventListener('popstate',leave);window.addEventListener('hashchange',leave);
      return()=>{
        window.removeEventListener('pagehide',leave);window.removeEventListener('popstate',leave);window.removeEventListener('hashchange',leave);
        modal.close();
        // Only a requested dismissal restores focus. StrictMode/reopen/unmount
        // cleanup must not steal focus; onboarding may remove its own opener.
        if(!requestedOpen.current&&modal.isConnected){
          const owner=modal.closest('.studio-shell');
          const eligible=(node:HTMLElement|null):node is HTMLElement=>!!node&&node.isConnected&&!!owner?.contains(node)&&!node.matches(':disabled')&&!node.closest('[hidden],[inert]')&&node.getClientRects().length>0&&getComputedStyle(node).visibility==='visible';
          const target=eligible(opener.current)?opener.current:fallbackFocus?.()??null;
          if(eligible(target))target.focus({preventScroll:true});
        }
      };
    }
    modal.close();
  },[open]);
  useLayoutEffect(()=>{
    if(!open||!focusSelector)return;
    const target=dialog.current?.querySelector<HTMLElement>(focusSelector);
    if(target&&!target.matches(':disabled')){target.scrollIntoView({block:'center',inline:'nearest'});target.focus({preventScroll:true});}
  },[open,focusRequest]);
  return <dialog ref={dialog} className="studio-connection-panel" aria-label="Connection settings" onCancel={event=>{event.preventDefault();onClose();}} onClose={()=>{
    // StrictMode can queue close after the same retained dialog has reopened.
    if(requestedOpen.current&&!dialog.current?.open)onClose();
  }} onClick={event=>{
    if(event.target!==event.currentTarget||event.detail===0)return;
    const box=event.currentTarget.getBoundingClientRect();
    if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)onClose();
  }} onKeyDown={event=>{
    if(event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,a[href],[tabindex="0"]')].filter(node=>!node.closest('[hidden],[inert]')&&node.getClientRects().length>0);
    const index=controls.indexOf(document.activeElement as HTMLElement);
    if(!controls.length){event.preventDefault();event.currentTarget.focus();return;}
    if(index<0||(event.shiftKey?index===0:index===controls.length-1)){
      event.preventDefault();controls[event.shiftKey?controls.length-1:0]?.focus({preventScroll:true});
    }
  }}>
    <header className="studio-connection-panel-header"><div><span className="studio-eyebrow">FLIGHTDECK / CONFIGURE</span><h2>Connection settings</h2></div><button data-settings-close type="button" onClick={onClose}>Close</button></header>
    <div className="studio-connection-panel-body">{children}</div>
    <footer className="studio-connection-panel-footer"><small>Opening settings does not connect, select a model or send a draft.</small><button type="button" onClick={onClose}>Done</button></footer>
  </dialog>;
}
