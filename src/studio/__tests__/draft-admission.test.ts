import {expect,it} from 'vitest';
import {createDraft} from '../client';
it.each([[429,'Studio is busy — request not accepted'],[503,'Studio authoring is unavailable — no draft accepted']])('reports HTTP %s without pretending a draft or provider call was accepted',async(status,text)=>{
 let calls=0;
 await expect(createDraft({connectionId:'local',prompt:'plan'},'sentinel',new AbortController().signal,async()=>{calls++;return new Response('private-provider-error',{status:Number(status)});})).rejects.toThrow(String(text));
 expect(calls).toBe(1);
});
it('rejects an oversized prompt before network',async()=>{
 let calls=0;
 await expect(createDraft({connectionId:'local',prompt:'x'.repeat(8001)},'sentinel',new AbortController().signal,async()=>{calls++;return new Response('{}');})).rejects.toThrow('Request must contain 1–8000 characters');
 expect(calls).toBe(0);
});
