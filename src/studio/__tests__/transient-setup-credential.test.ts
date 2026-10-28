import {expect,it} from 'vitest';
import {TransientSetupCredential} from '../transient-setup-credential';
it('releases a held synthetic key before a stalled metadata read settles',()=>{
 const held=new TransientSetupCredential('NONSECRET_UNIT_KEY');held.release();expect(held.take()).toBe('');
});
it('takes a synthetic key exactly once and releases its stored reference',()=>{
 const held=new TransientSetupCredential('NONSECRET_UNIT_KEY');expect(held.take()).toBe('NONSECRET_UNIT_KEY');expect(held.take()).toBe('');
});
