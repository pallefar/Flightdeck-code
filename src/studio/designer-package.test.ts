import {it} from 'vitest';
import {cases} from '../../designer-source/tests/cases.mjs';
// Ordinary regression discovery: no special exclusions or external replay hidden here.
for(const [name,run] of cases)it(name,run);
