import type { PageDocAdapters } from '../mirror/flightdeck/pagedoc/adapters.js';
import { StatTile } from '../mirror/flightdeck/web/src/widgets/parts/StatTile.js';
import type { LocalDraft } from './model.js';
// Component rendering only, not EvalScore's live hooks or an authorised catalogue.
// The actual eval-score catalogue id and StatTile value/tone API are pinned in provenance.
export function sampleAdapters(sample:LocalDraft['sample']):PageDocAdapters{return {
 media:{resolve:()=>({status:'missing'})},resolvePage:()=>null,navigate:()=>{throw Error('Navigation unavailable');},
 widget:req=>req.widgetId==='eval-score'&&req.config===undefined?<div className="sample-widget"><span className="sample-tag">SAMPLE DATA</span><StatTile label="Eval score · sample" value={sample==='unknown'?null:sample==='pass'?'100%':'92%'} tone={sample==='pass'?'green':'amber'} testId="eval-score-sample"/></div>:<p>Widget unavailable in this sample library.</p>,
 appState:()=> 'unavailable',appAction:()=>{throw Error('Actions unavailable');},appCard:()=>null,visibleApps:()=>[]
};}
