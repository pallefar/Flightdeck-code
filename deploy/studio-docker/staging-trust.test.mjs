import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync,readFileSync} from 'node:fs';

const override=new URL('./staging.trust.compose.yml',import.meta.url);
test('private runtime CA trust is an explicit read-only override, never a TLS bypass or implicit host mount',()=>{
 assert(existsSync(override),'Explicit private runtime trust override is missing');
 const text=readFileSync(override,'utf8');
 assert.match(text,/NODE_EXTRA_CA_CERTS:\s*\/etc\/studio\/trust\/host-approved-public-ca\.pem/);
 assert.match(text,/source:\s*\$\{STUDIO_TRUSTED_PUBLIC_CA_FILE:\?/);
 assert.match(text,/target:\s*\/etc\/studio\/trust\/host-approved-public-ca\.pem/);
 assert.match(text,/type:\s*bind/);
 assert.match(text,/read_only:\s*true/);
 assert.match(text,/create_host_path:\s*false/);
 assert.doesNotMatch(text,/^\s*(?:image|build|ports|privileged|network_mode|STUDIO_OPERATOR_TOKEN|ANTHROPIC_API_KEY|NODE_TLS_REJECT_UNAUTHORIZED):/m);
 assert.doesNotMatch(text,/rejectUnauthorized\s*:\s*false/);
 const base=readFileSync(new URL('./staging.compose.yml',import.meta.url),'utf8');
 assert.doesNotMatch(base,/NODE_EXTRA_CA_CERTS/,'Runtime CA trust must remain a separate explicit opt-in');
 const ignore=readFileSync(new URL('../../.gitignore',import.meta.url),'utf8');
 assert.match(ignore,/^deploy\/studio-docker\/trust\/\*\.pem$/m,'Machine-approved public roots must not silently enter source control');
});
