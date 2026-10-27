import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {AnthropicSetupClient,AnthropicSetupError,type AnthropicSetupMetadata,type AnthropicSetupRequestContext} from './anthropic-setup-client';

export type AnthropicConnectionSetupProps={
  token:string;contextEpoch:number;active:boolean;fetcher:typeof fetch;
  onOpenChange:(open:boolean)=>void;
  onMutationStarted:()=>void;
  onChanged:(metadata:AnthropicSetupMetadata)=>void;
};
const uncertaintyMessage='Server state is uncertain. A cancelled or failed change may already have taken effect. Load setup status before making another change.';

/** An explicit launcher only. Opening never authenticates, fetches or selects a model. */
export function AnthropicConnectionSetup(props:AnthropicConnectionSetupProps){
  const [open,setOpen]=useState(false),[uncertain,setUncertain]=useState(false);
  const opener=useRef<HTMLButtonElement>(null);
  const scope=useRef({token:props.token,epoch:props.contextEpoch});
  const visible=open&&props.active&&!!props.token&&scope.current.token===props.token&&scope.current.epoch===props.contextEpoch;
  useLayoutEffect(()=>{if(open&&!visible){setOpen(false);props.onOpenChange(false);}},[open,visible,props.onOpenChange]);
  function close(){setOpen(false);props.onOpenChange(false);if(opener.current?.getClientRects().length)opener.current.focus({preventScroll:true});}
  return <div className="studio-anthropic-setup-launch">
    <button ref={opener} type="button" disabled={!props.token||!props.active} onClick={()=>{scope.current={token:props.token,epoch:props.contextEpoch};props.onOpenChange(true);setOpen(true);}}>Anthropic API key setup</button>
    {!props.token&&<small>Enter the operator token above to use session setup.</small>}
    {visible&&<SessionKeyDialog {...props} uncertain={uncertain} onUncertain={setUncertain} onClose={close}/>}
  </div>;
}

function SessionKeyDialog({token,fetcher,onMutationStarted,onChanged,uncertain,onUncertain,onClose}:AnthropicConnectionSetupProps&{uncertain:boolean;onUncertain:(value:boolean)=>void;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null),keyInput=useRef<HTMLInputElement>(null);
  const bindKeyInput=useCallback((field:HTMLInputElement|null)=>{
    if(keyInput.current&&keyInput.current!==field)keyInput.current.value='';
    keyInput.current=field;
  },[]);
  const [client]=useState(()=>new AnthropicSetupClient(fetcher));
  const [metadata,setMetadata]=useState<AnthropicSetupMetadata|null>(null);
  const [busy,setBusy]=useState<'load'|'save'|'remove'|null>(null);
  const [acknowledged,setAcknowledged]=useState(false),[hasKey,setHasKey]=useState(false);
  const [message,setMessage]=useState('Setup status has not been loaded.'),[error,setError]=useState('');
  const epoch=useRef(0),pending=useRef<AbortController|null>(null),alive=useRef(false);
  // Native disabling/removal can leave focus on body after an explicit metadata load.
  useLayoutEffect(()=>{
    const modal=dialog.current;
    if(!busy&&metadata&&modal?.open&&!modal.contains(document.activeElement))modal.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({preventScroll:true});
  },[busy,metadata]);
  function clearField(){if(keyInput.current)keyInput.current.value='';setHasKey(false);setAcknowledged(false);}
  useLayoutEffect(()=>{
    alive.current=true;const modal=dialog.current,field=keyInput.current;modal?.showModal();
    const leave=()=>close();
    window.addEventListener('pagehide',leave);window.addEventListener('popstate',leave);window.addEventListener('hashchange',leave);
    return()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('popstate',leave);window.removeEventListener('hashchange',leave);alive.current=false;epoch.current++;pending.current?.abort();pending.current=null;if(field)field.value='';modal?.close();};
  },[]);
  function close(){epoch.current++;pending.current?.abort();pending.current=null;clearField();dialog.current?.close();onClose();}
  function begin(kind:'load'|'save'|'remove'){
    if(pending.current||!alive.current)return null;
    const abort=new AbortController(),turn=++epoch.current;pending.current=abort;setBusy(kind);setError('');
    const context:AnthropicSetupRequestContext={signal:abort.signal,isCurrent:()=>alive.current&&epoch.current===turn&&pending.current===abort};
    return context;
  }
  async function settle(kind:'load'|'save'|'remove',request:Promise<AnthropicSetupMetadata>,context:AnthropicSetupRequestContext){
    try{
      const next=await request;
      if(context.signal.aborted||!context.isCurrent())return;
      setMetadata(next);onUncertain(false);
      setMessage(kind==='save'?'Session key configured — not probed.':kind==='remove'?'Session key removed.':'Setup status loaded — not probed.');
      if(kind!=='load'){
        if(context.signal.aborted||!context.isCurrent())return;
        onChanged(next);
      }
    }catch(cause){
      if(context.signal.aborted||!context.isCurrent())return;
      setMetadata(null);
      setError(cause instanceof AnthropicSetupError?cause.message:'Setup unavailable. Reload setup status.');
      setMessage(kind==='load'?'Setup status could not be loaded.':'Change not confirmed.');
    }finally{
      if(!context.signal.aborted&&context.isCurrent()){pending.current=null;setBusy(null);}
    }
  }
  function load(){
    if(pending.current)return;
    clearField();setMetadata(null);const context=begin('load');
    if(context)void settle('load',client.load(token,context),context);
  }
  function save(){
    // Never put the credential in React state, a value attribute, or a callback DTO.
    const credential=keyInput.current?.value??'';clearField();
    if(pending.current||!metadata?.available||uncertain||!acknowledged)return;
    if(!credential||credential.length>8192||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(credential)){setError('Enter a single-line API key of 1 to 8192 characters.');return;}
    const context=begin('save');if(!context)return;
    onUncertain(true);onMutationStarted();
    if(context.signal.aborted||!context.isCurrent())return;
    void settle('save',client.save(token,credential,metadata.revision,context),context);
  }
  function remove(){
    clearField();
    if(pending.current||!metadata?.available||uncertain||metadata.status!=='configured')return;
    const context=begin('remove');if(!context)return;
    onUncertain(true);onMutationStarted();
    if(context.signal.aborted||!context.isCurrent())return;
    void settle('remove',client.remove(token,metadata.revision,context),context);
  }
  const editable=!!metadata?.available&&!busy&&!uncertain;
  return <dialog ref={dialog} className="studio-anthropic-setup" aria-label="Anthropic session key setup" onKeyDown={event=>{
    if(event.key!=='Tab')return;
    const controls=[...event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),[tabindex="0"]')].filter(node=>node.getClientRects().length>0);
    const index=controls.indexOf(document.activeElement as HTMLElement);
    if(!controls.length){event.preventDefault();return;}
    if(index<0||(event.shiftKey?index===0:index===controls.length-1)){event.preventDefault();controls[event.shiftKey?controls.length-1:0]?.focus();}
  }} onCancel={event=>{event.preventDefault();close();}} onClose={()=>{if(alive.current&&!dialog.current?.open)close();}}>
    <header><div><span className="studio-eyebrow">MODEL / SESSION SETUP</span><h2>Anthropic API key</h2></div><button type="button" onClick={close}>Close key setup</button></header>
    <p>Private operator setup only. Load setup status to discover whether this connection supports session key changes. Voice and dictation are off while this dialog is open.</p>
    {metadata?.available!==false&&<><p>For session-owned keys saved here, the destination is the official Anthropic API and the model is chosen by the server. Saving only configures the connection: it does not call a model, select Anthropic or send your request.</p>
    <p>For session-owned keys saved here, the key is held in server memory until restart, then lost. It is not saved to a database or browser storage. This is not a vault or a claim of encrypted persistence.</p></>}
    <div className="studio-anthropic-actions"><button type="button" disabled={!!busy} onClick={load}>{busy==='load'?'Loading setup status…':'Load setup status'}</button><span>No automatic metadata loading</span></div>
    <p role="status">{message}</p>
    {metadata&&<p>Server model: <code>{metadata.model}</code> · {metadata.status} · not-probed · {metadata.persistence}</p>}
    {metadata?.available===false&&<section aria-label="Externally managed connection"><h3>Externally managed — session setup unavailable</h3><p>Change or remove this connection at its source. Its destination, credential retention and restart policy are unknown to this dialog; session-memory guarantees do not apply. No key is shown or editable here.</p></section>}
    {uncertain&&<p className="studio-anthropic-uncertain" role="status">{uncertaintyMessage}</p>}
    {error&&<p className="studio-anthropic-error" role="alert">{error}</p>}
    {metadata?.available!==false&&<form noValidate autoComplete="off" onSubmit={event=>{event.preventDefault();save();}}>
      <label>Anthropic API key<input ref={bindKeyInput} aria-label="Anthropic API key" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={8192} disabled={!editable} onInput={event=>setHasKey(event.currentTarget.value.length>0)}/></label>
      <label className="studio-anthropic-consent"><input type="checkbox" checked={acknowledged} disabled={!editable} onChange={event=>setAcknowledged(event.target.checked)}/>I understand the key stays in server memory until restart and saving does not call a model.</label>
      <div className="studio-anthropic-actions"><button type="submit" disabled={!editable||!hasKey||!acknowledged}>{busy==='save'?'Saving session key…':'Save session key'}</button><button type="button" disabled={!editable||metadata?.status!=='configured'} onClick={remove}>{busy==='remove'?'Removing session key…':'Remove session key'}</button></div>
    </form>}
    {metadata?.available!==false&&<p>After a confirmed change, close this dialog, explicitly Check connection &amp; project skills, then choose Anthropic. No model has been verified. Closing during a change cancels acceptance, not necessarily the server change; load setup status again.</p>}
  </dialog>;
}
