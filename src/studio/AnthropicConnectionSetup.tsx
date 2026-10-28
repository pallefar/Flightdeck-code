import {useCallback,useLayoutEffect,useRef,useState} from 'react';
import {TransientSetupCredential} from './transient-setup-credential';
import {AnthropicSetupClient,AnthropicSetupError,type AnthropicSetupMetadata,type AnthropicSetupRequestContext} from './anthropic-setup-client';

export type AnthropicConnectionSetupProps={
  token:string;contextEpoch:number;active:boolean;fetcher:typeof fetch;
  onMutationStarted:()=>void;
  onChanged:(metadata:AnthropicSetupMetadata)=>void;
  onMetadata?:(metadata:AnthropicSetupMetadata)=>void;
};
const uncertaintyMessage='Server state is uncertain. A cancelled or failed change may already have taken effect. Load setup status before making another change. No automatic retry is made.';

/** Direct uncontrolled entry. Mount, open and typing have no transport effects. */
export function AnthropicConnectionSetup({token,contextEpoch,active,fetcher,onMutationStarted,onChanged,onMetadata}:AnthropicConnectionSetupProps){
  const keyInput=useRef<HTMLInputElement>(null);
  const bindKeyInput=useCallback((field:HTMLInputElement|null)=>{
    if(keyInput.current&&keyInput.current!==field)keyInput.current.value='';
    keyInput.current=field;
  },[]);
  const [client]=useState(()=>new AnthropicSetupClient(fetcher));
  const [metadata,setMetadata]=useState<AnthropicSetupMetadata|null>(null);
  // Retained across close and context changes: abort is not rollback evidence.
  const [uncertain,setUncertain]=useState(false);
  const [busy,setBusy]=useState<'load'|'save'|'remove'|null>(null);
  const [acknowledged,setAcknowledged]=useState(false),[hasKey,setHasKey]=useState(false);
  const [message,setMessage]=useState('Setup status has not been loaded.'),[error,setError]=useState('');
  const epoch=useRef(0),pending=useRef<AbortController|null>(null),alive=useRef(false);
  const pendingCredential=useRef<TransientSetupCredential|null>(null);
  function releaseCredential(){pendingCredential.current?.release();pendingCredential.current=null;}
  function clearField(){if(keyInput.current)keyInput.current.value='';setHasKey(false);setAcknowledged(false);}
  useLayoutEffect(()=>{
    alive.current=active;epoch.current++;releaseCredential();pending.current?.abort();pending.current=null;
    clearField();setBusy(null);setMetadata(null);setError('');setMessage('Setup status has not been loaded.');
    const field=keyInput.current;
    const leave=()=>{alive.current=false;epoch.current++;releaseCredential();pending.current?.abort();pending.current=null;if(field)field.value='';setHasKey(false);setAcknowledged(false);};
    window.addEventListener('pagehide',leave);window.addEventListener('popstate',leave);window.addEventListener('hashchange',leave);
    return()=>{window.removeEventListener('pagehide',leave);window.removeEventListener('popstate',leave);window.removeEventListener('hashchange',leave);alive.current=false;epoch.current++;releaseCredential();pending.current?.abort();pending.current=null;if(field)field.value='';};
  },[active,token,contextEpoch]);
  function begin(kind:'load'|'save'|'remove'){
    if(pending.current||!alive.current||!token)return null;
    const abort=new AbortController(),turn=++epoch.current;pending.current=abort;setBusy(kind);setError('');
    return {signal:abort.signal,isCurrent:()=>alive.current&&epoch.current===turn&&pending.current===abort} satisfies AnthropicSetupRequestContext;
  }
  function current(context:AnthropicSetupRequestContext){return !context.signal.aborted&&context.isCurrent();}
  function failed(cause:unknown,context:AnthropicSetupRequestContext){
    if(!current(context))return;
    setMetadata(null);setError(cause instanceof AnthropicSetupError?cause.message:'Setup unavailable. Reload setup status.');setMessage('Change not confirmed.');
  }
  function finish(context:AnthropicSetupRequestContext){if(current(context)){pending.current=null;setBusy(null);}}
  async function load(){
    if(pending.current)return;clearField();const context=begin('load');if(!context)return;
    setMetadata(null);
    try{const next=await client.load(token,context);if(!current(context))return;setMetadata(next);setUncertain(false);setMessage('Setup status loaded — not probed.');onMetadata?.(next);}
    catch(cause){failed(cause,context);}finally{finish(context);}
  }
  async function save(){
    // The raw value lives only in this transient closure and the masked DOM field.
    let credential=keyInput.current?.value??'';
    const consent=acknowledged;clearField();
    if(pending.current||uncertain||!consent||metadata?.available===false){credential='';return;}
    if(!credential||credential.length>8192||/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(credential)){credential='';setError('Enter a single-line API key of 1 to 8192 characters.');return;}
    const context=begin('save');if(!context){credential='';return;}
    const held=new TransientSetupCredential(credential);credential='';pendingCredential.current=held;
    try{
      // A single explicit Save may read fresh metadata, then make one CAS write.
      const fresh=await client.load(token,context);if(!current(context))return;
      setMetadata(fresh);
      if(!fresh.available){setMessage('Externally managed — session setup unavailable.');return;}
      setUncertain(true);onMutationStarted();if(!current(context))return;
      const waiting=client.save(token,held.take(),fresh.revision,context);
      const next=await waiting;if(!current(context))return;
      setMetadata(next);setUncertain(false);setMessage('Session key configured — not probed.');
      if(current(context))onChanged(next);
    }catch(cause){failed(cause,context);}finally{held.release();if(pendingCredential.current===held)pendingCredential.current=null;finish(context);}
  }
  async function remove(){
    clearField();if(pending.current||uncertain||!metadata?.available||metadata.status!=='configured')return;
    const context=begin('remove');if(!context)return;
    setUncertain(true);onMutationStarted();
    try{
      if(!current(context))return;
      const next=await client.remove(token,metadata.revision,context);if(!current(context))return;
      setMetadata(next);setUncertain(false);setMessage('Session key removed.');if(current(context))onChanged(next);
    }catch(cause){failed(cause,context);}finally{finish(context);}
  }
  const editable=active&&!!token&&!busy&&!uncertain&&metadata?.available!==false;
  return <section className="studio-anthropic-inline" aria-label="Anthropic session key setup">
    <h3>Anthropic API key</h3>
    <p>Use your model key here, not in Operator token. Private operator authentication remains separate; this is not OS single sign-on.</p>
    {metadata?.available!==false&&<><p>For session-owned keys saved here, the destination is the official Anthropic API and the model is chosen by the server. The key stays in server memory until restart, then is lost. It is not saved to a database or browser storage; this is not a vault.</p><p>Save session key loads current setup metadata, then makes one revision-protected change. Saving does not probe a model, select Anthropic or send your draft. Nothing loads on open or while typing.</p></>}
    {metadata?.available!==false&&<p><a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Create API key in Claude Console</a>. Prefer a workspace-scoped key for this key-only setup. Connections requiring additional provider-workspace headers are not configured here. Open the console yourself; never paste a key into chat.</p>}
    {!token&&<p>Enter the operator token above to use session setup. Never enter a model API key there.</p>}
    {metadata?.available!==false&&<form noValidate autoComplete="off" onSubmit={event=>{event.preventDefault();void save();}}>
      <label>Anthropic API key<input ref={bindKeyInput} aria-label="Anthropic API key" type="password" autoComplete="off" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={8192} disabled={!editable} onInput={event=>setHasKey(event.currentTarget.value.length>0)}/></label>
      <label className="studio-anthropic-consent"><input type="checkbox" checked={acknowledged} disabled={!editable} onChange={event=>setAcknowledged(event.target.checked)}/>I understand the key stays in server memory until restart and saving does not call a model.</label>
      <div className="studio-anthropic-actions"><button type="submit" disabled={!editable||!hasKey||!acknowledged}>{busy==='save'?'Saving session key…':'Save session key'}</button><button type="button" disabled={!editable||metadata?.status!=='configured'} onClick={()=>void remove()}>{busy==='remove'?'Removing session key…':'Remove session key'}</button></div>
    </form>}
    <div className="studio-anthropic-actions"><button type="button" disabled={!active||!token||!!busy} onClick={()=>void load()}>{busy==='load'?'Loading setup status…':'Load setup status'}</button></div>
    <p role="status">{message}</p>
    {metadata&&<p>Server model: <code>{metadata.model}</code> · {metadata.status} · not-probed · {metadata.persistence}</p>}
    {metadata?.available===false&&<section aria-label="Externally managed connection"><h3>Externally managed — session setup unavailable</h3><p>Change or remove this connection at its source. Its destination, credential retention and restart policy are unknown here; session-memory guarantees do not apply. No key is shown or editable here.</p></section>}
    {uncertain&&<p className="studio-anthropic-uncertain" role="status">{uncertaintyMessage}</p>}
    {error&&<p className="studio-anthropic-error" role="alert">{error}</p>}
    <p>After a confirmed change, explicitly Check connection &amp; project skills, then choose Anthropic. Closing a pending change cancels acceptance, not necessarily the server change. Load setup status to resolve uncertainty; never retry automatically.</p>
  </section>;
}
