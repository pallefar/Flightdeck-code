import {expect,it} from 'vitest';
import {assessProcessRoi} from './roi';

it('R1: values fractional adopted seconds before currency quantization',()=>{
 expect(assessProcessRoi({annualVolume:1,baselineSeconds:10,targetSeconds:1,adoptionBasisPoints:1000,loadedHourlyCostCents:100000,cashRealizationBasisPoints:10000,annualRecurringCostCents:0,initialCostCents:1})).toMatchObject({status:'estimated',annualCapacitySeconds:0,annualCapacityValueCents:25,annualCashBenefitCents:25,annualOperatingCashflowCents:25,firstYearNetCashCents:24,firstYearRoiBasisPoints:240000,paybackMonthsMilli:480});
});

const facts={annualVolume:1200,baselineSeconds:600,targetSeconds:300,adoptionBasisPoints:10000,loadedHourlyCostCents:6000,cashRealizationBasisPoints:10000,annualRecurringCostCents:20000,initialCostCents:100000};
it.each([
 [600,300,120087,200146,180146,80146,8014,6662],
 [300,600,-120087,-200146,-220146,-320146,-32014,null],
] as const)('retains realistic 1201-volume fractional adoption through positive/negative cash (%s to %s)',(baselineSeconds,targetSeconds,capacity,cash,operating,net,roi,payback)=>{
 expect(assessProcessRoi({...facts,annualVolume:1201,baselineSeconds,targetSeconds,adoptionBasisPoints:3333})).toEqual({status:'estimated',annualCapacitySeconds:capacity,annualCapacityValueCents:cash,annualCashBenefitCents:cash,annualOperatingCashflowCents:operating,firstYearNetCashCents:net,firstYearRoiBasisPoints:roi,paybackMonthsMilli:payback});
});
it('keeps the negative fractional-second loss symmetric with the positive 25-cent gain',()=>{
 expect(assessProcessRoi({...facts,annualVolume:1,baselineSeconds:1,targetSeconds:10,adoptionBasisPoints:1000,loadedHourlyCostCents:100000,annualRecurringCostCents:0,initialCostCents:1})).toEqual({status:'estimated',annualCapacitySeconds:0,annualCapacityValueCents:-25,annualCashBenefitCents:-25,annualOperatingCashflowCents:-25,firstYearNetCashCents:-26,firstYearRoiBasisPoints:-260000,paybackMonthsMilli:null});
});
it('does not use the displayed capacity-value cents to calculate cash realization',()=>{
 expect(assessProcessRoi({...facts,annualVolume:1,baselineSeconds:3,targetSeconds:0,adoptionBasisPoints:1000,cashRealizationBasisPoints:6667,annualRecurringCostCents:0,initialCostCents:1})).toEqual({status:'estimated',annualCapacitySeconds:0,annualCapacityValueCents:0,annualCashBenefitCents:0,annualOperatingCashflowCents:0,firstYearNetCashCents:0,firstYearRoiBasisPoints:-6666,paybackMonthsMilli:35999});
});
it.each([
 [0,0,0,-5000,24000],
 [1,0,-1,-15000,null],
] as const)('derives operating/net/ROI/payback from exact half-cent cash with %s recurring cents',(annualRecurringCostCents,operating,net,roi,payback)=>{
 expect(assessProcessRoi({...facts,annualVolume:1,baselineSeconds:3,targetSeconds:0,adoptionBasisPoints:1000,annualRecurringCostCents,initialCostCents:1})).toEqual({status:'estimated',annualCapacitySeconds:0,annualCapacityValueCents:0,annualCashBenefitCents:0,annualOperatingCashflowCents:operating,firstYearNetCashCents:net,firstYearRoiBasisPoints:roi,paybackMonthsMilli:payback});
});
it('calculates a transparent cash case from explicit assumptions without a model call',()=>{
 expect(assessProcessRoi(facts)).toEqual({status:'estimated',annualCapacitySeconds:360000,annualCapacityValueCents:600000,annualCashBenefitCents:600000,annualOperatingCashflowCents:580000,firstYearNetCashCents:480000,firstYearRoiBasisPoints:48000,paybackMonthsMilli:2069});
 expect(facts.targetSeconds).toBe(300);
});
it('does not invent a monetary result when a required assumption is unknown',()=>{
 expect(assessProcessRoi({...facts,loadedHourlyCostCents:null})).toEqual({status:'incomplete',missing:['loadedHourlyCostCents']});
 expect(assessProcessRoi({annualVolume:100})).toMatchObject({status:'incomplete'});
});
it.each([-1,1.5,NaN,Infinity,Number.MAX_SAFE_INTEGER,'100',true])('refuses malformed or unbounded annual volumes without throwing (%s)',annualVolume=>{
 expect(assessProcessRoi({...facts,annualVolume})).toEqual({status:'invalid',reason:'invalid-assumptions'});
});
it('does not execute accessors or accept inherited, symbolic or unknown assumption fields',()=>{
 let reads=0;const getter={...facts};Object.defineProperty(getter,'annualVolume',{enumerable:true,get(){reads++;return 1200;}});
 const symbol={...facts,[Symbol('foreign')]:100};
 for(const input of [getter,symbol,Object.create(facts),{...facts,grant:true},[],false,'process'])expect(assessProcessRoi(input)).toEqual({status:'invalid',reason:'invalid-assumptions'});
 expect(reads).toBe(0);
});
it.each(['adoptionBasisPoints','cashRealizationBasisPoints'])('caps the %s assumption at 100 percent',key=>{
 expect(assessProcessRoi({...facts,[key]:10001})).toEqual({status:'invalid',reason:'invalid-assumptions'});
});
it('refuses a result that cannot be represented safely in the JSON DTO',()=>{
 expect(assessProcessRoi({...facts,annualVolume:1_000_000_000,baselineSeconds:31_536_000,targetSeconds:0,loadedHourlyCostCents:1_000_000_000_000})).toEqual({status:'invalid',reason:'unrepresentable-result'});
});
it('keeps released capacity separate from realizable cash and never promises a payback from capacity alone',()=>{
 const result=assessProcessRoi(Object.freeze({...facts,cashRealizationBasisPoints:0}));
 expect(result).toMatchObject({status:'estimated',annualCapacitySeconds:360000,annualCapacityValueCents:600000,annualCashBenefitCents:0,annualOperatingCashflowCents:-20000,firstYearNetCashCents:-120000,firstYearRoiBasisPoints:-12000,paybackMonthsMilli:null});
});
it('keeps slower target processes negative rather than inventing positive savings',()=>{
 expect(assessProcessRoi({...facts,targetSeconds:900})).toMatchObject({status:'estimated',annualCapacitySeconds:-360000,annualCashBenefitCents:-600000,paybackMonthsMilli:null});
});
it('treats zero initial cost as an undefined ROI ratio, not an infinite return',()=>{
 expect(assessProcessRoi({...facts,initialCostCents:0})).toMatchObject({status:'estimated',firstYearRoiBasisPoints:null,paybackMonthsMilli:0});
});
it('accepts a null-prototype data record but keeps an empty intake incomplete',()=>{
 expect(assessProcessRoi(Object.assign(Object.create(null),facts))).toEqual(assessProcessRoi(facts));
 expect(assessProcessRoi(null)).toMatchObject({status:'incomplete'});
});
