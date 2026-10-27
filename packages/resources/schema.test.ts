import { it,expect } from 'vitest';
import { validateValue } from './transport';
it('rejects unsupported schema keywords instead of silently ignoring them',()=>{
  expect(validateValue('abc',{type:'string',pattern:'^xyz$'} as never)).toBe(false);
  expect(validateValue({}, {type:'object',properties:{},required:[],additionalProperties:false,$schema:'https://evil'} as never)).toBe(false);
});
it('does not execute accessor-backed array elements',()=>{
  let accesses=0;const values:string[]=[];
  Object.defineProperty(values,'0',{get(){accesses++;return 'secret';},enumerable:true});
  expect(validateValue(values,{type:'array',items:{type:'string'},maxItems:2})).toBe(false);
  expect(accesses).toBe(0);
});
