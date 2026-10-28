import {StrictMode,useCallback,useRef,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {AppDesigner} from '../designer/AppDesigner';
import type {AppDesignerCreatePageRequestHandle} from '../designer/AppDesigner';
import '../designer/AppDesigner.css';
function Host(){
 const current=useRef<AppDesignerCreatePageRequestHandle|null>(null),retired=useRef<AppDesignerCreatePageRequestHandle[]>([]);
 const [counts,setCounts]=useState({acquired:0,released:0}),[outcome,setOutcome]=useState('NOT_REQUESTED'),[mounted,setMounted]=useState(true),[hidden,setHidden]=useState(false),[strict,setStrict]=useState(false);
 const receive=useCallback((h:AppDesignerCreatePageRequestHandle|null)=>{if(h){current.current=h;setCounts(c=>({...c,acquired:c.acquired+1}));}else{if(current.current)retired.current.push(current.current);current.current=null;setCounts(c=>({...c,released:c.released+1}));}},[]);
 const request=()=>{if(!current.current){setOutcome('MISSING_PUBLIC_CREATE_API');return;}current.current.requestCreatePage();setOutcome('REQUEST_DISPATCHED_NOT_A_RECEIPT');};
 const editor=<AppDesigner embedded onCreatePageRequestHandle={receive}/>;
 return <div onKeyDownCapture={e=>{if(e.altKey&&e.key==='n'){e.preventDefault();request();}}}><nav aria-label="Isolated native host fixture"><strong>Controlled public callback lifecycle fixture — not default-main acceptance</strong><button data-host="create" onClick={request}>Host Create page</button><button data-host="hide" onClick={()=>setHidden(v=>!v)}>Hide/show mounted editor</button><button data-host="unmount" onClick={()=>setMounted(v=>!v)}>Mount/unmount editor</button><button data-host="strict" onClick={()=>setStrict(v=>!v)}>Toggle StrictMode</button><button data-host="stale" onClick={()=>{for(const h of retired.current)h.requestCreatePage();setOutcome('RETIRED_REQUESTS_DISPATCHED');}}>Invoke retired handles</button><output data-host="lifecycle" data-acquired={counts.acquired} data-released={counts.released} data-mounted={String(mounted)} data-strict={String(strict)}>{outcome}</output></nav><div data-host="workspace" hidden={hidden}>{mounted&&(strict?<StrictMode>{editor}</StrictMode>:editor)}</div></div>;
}
const root=document.getElementById('root');if(!root)throw Error('Fixture root missing');createRoot(root).render(<Host/>);
