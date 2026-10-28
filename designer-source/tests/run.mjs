// Finite pure package runner: one process, no worker/browser/native fixture.
import test from 'node:test';
import {cases} from './cases.mjs';
const selected=process.argv[2]===undefined?cases:[cases[Number(process.argv[2])]];
for(const [name,run] of selected)test(name,run);
if(process.argv[2]===undefined){
 await import('./retained-model.node.mjs');
 await import('./retained-save-boundary.node.mjs');
 await import('./retained-native.node.mjs');
 await import('./build-closure.node.mjs');
}
