import {useEffect,useRef} from 'react';
import type {StudioTurn} from './controller';

/** Safe text only. Follow actual turn arrival only while the reader stays near the end. */
export function ConversationHistory({turns,followTarget='end'}:{turns:readonly StudioTurn[];followTarget?:'end'|'questions'}){
 const history=useRef<HTMLDivElement>(null),nearEnd=useRef(true);
 useEffect(()=>{const scroller=history.current?.parentElement;if(!scroller)return;const track=()=>{nearEnd.current=scroller.scrollHeight-scroller.scrollTop-scroller.clientHeight<72;};scroller.addEventListener('scroll',track,{passive:true});return()=>scroller.removeEventListener('scroll',track);},[]);
 useEffect(()=>{
  const scroller=history.current?.parentElement;if(!scroller||!nearEnd.current||!turns.length)return;
  const question=followTarget==='questions'?scroller.querySelector<HTMLElement>('[data-studio-question]'):null;
  scroller.scrollTop=question?scroller.scrollTop+question.getBoundingClientRect().top-scroller.getBoundingClientRect().top-12:scroller.scrollHeight;
 },[turns,followTarget]);
 return <div ref={history} className="studio-conversation-history" role="log" aria-live="polite" aria-relevant="additions text" aria-label="Conversation history">{turns.map(turn=><article key={turn.id} className={`studio-chat-turn studio-chat-turn-${turn.role}`} data-status={turn.status} data-request-id={turn.requestId}><header><strong>{turn.role==='you'?'You':'Flightdeck Studio'}</strong><span>{turn.destination.connectionId}{turn.destination.projectId?` / ${turn.destination.projectId}`:''}</span></header><p>{turn.text}</p>{turn.status==='requesting'&&<small>No host changes are being made. Waiting for the actual routed response.</small>}</article>)}</div>;
}
