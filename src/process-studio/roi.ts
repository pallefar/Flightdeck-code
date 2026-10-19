/** Explicit assumptions, not measured savings. Monetary values share one currency. */
export interface RoiAssumptions {
 annualVolume:number;baselineSeconds:number;targetSeconds:number;adoptionBasisPoints:number;
 loadedHourlyCostCents:number;cashRealizationBasisPoints:number;annualRecurringCostCents:number;initialCostCents:number;
}
export const ROI_ASSUMPTION_KEYS=['annualVolume','baselineSeconds','targetSeconds','adoptionBasisPoints','loadedHourlyCostCents','cashRealizationBasisPoints','annualRecurringCostCents','initialCostCents'] as const;
export function assessProcessRoi(value:unknown){
 const invalid=()=>({status:'invalid' as const,reason:'invalid-assumptions' as const});
 const v=Object.create(null) as RoiAssumptions;
 const missing:(typeof ROI_ASSUMPTION_KEYS[number])[]=[];
 try{
  const input=value===null||value===undefined?{}:value;
  if(typeof input!=='object'||Array.isArray(input))return invalid();
  const proto=Object.getPrototypeOf(input);if(proto!==null&&proto!==Object.prototype)return invalid();
  const keys=Reflect.ownKeys(input);if(keys.length>ROI_ASSUMPTION_KEYS.length||keys.some(key=>typeof key!=='string'||!(ROI_ASSUMPTION_KEYS as readonly string[]).includes(key)))return invalid();
  for(const key of ROI_ASSUMPTION_KEYS){
   const descriptor=Object.getOwnPropertyDescriptor(input,key);
   if(descriptor&&(!Object.hasOwn(descriptor,'value')||!descriptor.enumerable))return invalid();
   const number=descriptor?.value as unknown;
   if(number===null||number===undefined){missing.push(key);continue;}
   const maximum=key==='annualVolume'?1_000_000_000:key==='baselineSeconds'||key==='targetSeconds'?31_536_000:key==='adoptionBasisPoints'||key==='cashRealizationBasisPoints'?10000:1_000_000_000_000;
   if(typeof number!=='number'||!Number.isSafeInteger(number)||number<0||number>maximum)return invalid();
   v[key]=number;
  }
 }catch{return invalid();}
 if(missing.length)return {status:'incomplete' as const,missing};
 // Exact signed rational quantities until the reporting boundary below. In
 // particular, neither displayed seconds nor displayed cents feed later math.
 const capacityNumerator=BigInt(v.annualVolume)*(BigInt(v.baselineSeconds)-BigInt(v.targetSeconds))*BigInt(v.adoptionBasisPoints);
 const capacityDenominator=10000n;
 const valueNumerator=capacityNumerator*BigInt(v.loadedHourlyCostCents),valueDenominator=capacityDenominator*3600n;
 const cashNumerator=valueNumerator*BigInt(v.cashRealizationBasisPoints),cashDenominator=valueDenominator*10000n;
 const initial=BigInt(v.initialCostCents);
 const operatingNumerator=cashNumerator-BigInt(v.annualRecurringCostCents)*cashDenominator;
 const netNumerator=operatingNumerator-initial*cashDenominator;
 // Report whole seconds/cents/basis points by truncating towards zero, equally
 // for gains and losses. Payback is ceil(exact months * 1000), so never reports
 // recovery earlier than the assumptions imply. It exists only for strictly
 // positive exact operating cashflow; zero initial cost leaves ROI undefined.
 const capacity=capacityNumerator/capacityDenominator,capacityValue=valueNumerator/valueDenominator;
 const cash=cashNumerator/cashDenominator,operating=operatingNumerator/cashDenominator,net=netNumerator/cashDenominator;
 const roi=initial>0n?netNumerator*10000n/(cashDenominator*initial):null;
 const paybackNumerator=initial*12000n*cashDenominator;
 const payback=operatingNumerator>0n?(paybackNumerator+operatingNumerator-1n)/operatingNumerator:null;
 const limit=BigInt(Number.MAX_SAFE_INTEGER);
 if([capacity,capacityValue,cash,operating,net,roi,payback].some(number=>number!==null&&(number>limit||number< -limit)))return {status:'invalid' as const,reason:'unrepresentable-result' as const};
 return {status:'estimated' as const,annualCapacitySeconds:Number(capacity),annualCapacityValueCents:Number(capacityValue),annualCashBenefitCents:Number(cash),annualOperatingCashflowCents:Number(operating),firstYearNetCashCents:Number(net),firstYearRoiBasisPoints:roi===null?null:Number(roi),paybackMonthsMilli:payback===null?null:Number(payback)};
}
