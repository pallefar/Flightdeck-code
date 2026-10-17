import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';

describe('first-version test entry',()=>{
 it('exposes the safe check without silently consenting to credential copying',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8'));
  expect(manifest.scripts['studio:first-test']).toBe('node scripts/studio-first-test.mjs');
  expect(manifest.scripts['studio:first-test']).not.toMatch(/copy-operator-token|acknowledge-clipboard-risk/);
 });
});
