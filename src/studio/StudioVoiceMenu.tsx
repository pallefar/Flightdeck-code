import {useEffect,useRef} from 'react';
import {VoiceControls,VoiceCore,useVoice} from '../voice';
import './StudioVoice.css';

/** One retained native voice surface; only the parent can insert composer text. */
export function StudioVoiceMenu({active,disabled,scopeKey,onDictation}:{active:boolean;disabled:boolean;scopeKey:string;onDictation:(text:string)=>void}){
 const voice=useVoice(),dialog=useRef<HTMLDialogElement>(null),opener=useRef<HTMLButtonElement>(null);
 const operating=voice.enabled&&['listening','preparing','speaking','queued'].includes(voice.status);
 function close(){voice.stop();dialog.current?.close();if(active)opener.current?.focus({preventScroll:true});}
 useEffect(()=>{if(dialog.current?.open)close();},[scopeKey,active]);
 return <div className="studio-voice-menu" hidden={!active}>
  <button ref={opener} type="button" className="studio-voice-open" aria-label="Open voice copilot" title="Optional voice feedback and draft dictation" onClick={()=>dialog.current?.showModal()}><VoiceCore/><span>Voice</span></button>
  {operating&&<button type="button" className="studio-voice-quick-stop" aria-label="Stop voice activity" title="Stop speech or dictation" onClick={()=>{voice.stop();opener.current?.focus({preventScroll:true});}}>■</button>}
  <dialog ref={dialog} className="studio-voice-dialog" aria-label="Voice settings" onCancel={event=>{event.preventDefault();close();}} onClose={()=>{voice.stop();if(active)opener.current?.focus({preventScroll:true});}}>
   <header><div><span className="studio-eyebrow">FLIGHTDECK / VOICE</span><h2>Voice copilot</h2></div><button type="button" aria-label="Close voice settings" onClick={close}>Close ×</button></header>
   <VoiceControls onDictation={onDictation} disabled={disabled} active={active}/>
  </dialog>
 </div>;
}
