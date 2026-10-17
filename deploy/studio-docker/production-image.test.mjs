import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('optional production image builds a real frontend and retains private bootstrap without Vite runtime',()=>{
 const image=read('Dockerfile.production');
 assert.match(image,/FROM node:22-slim(?:@sha256:[a-f0-9]{64})? AS build/);
 assert.match(image,/type=secret,id=studio_ca/);
 assert.match(image,/npm ci --ignore-scripts --include=dev/);
 assert.match(image,/npm run build/);
 assert.match(image,/COPY --from=build \/app\/dist \.\/dist/);
 assert.match(image,/USER node/);
 assert.match(image,/STUDIO_FRONTEND_ASSET_ROOT=\/app\/dist/);
 assert.match(image,/"deploy\/studio-docker\/bootstrap.mjs"/);
 assert.doesNotMatch(image,/vite preview|vite --host|NODE_TLS_REJECT_UNAUTHORIZED|--network=host/);
 const ignore=read('Dockerfile.production.dockerignore');
 for(const input of ['!src/**','!index.html','!vite.config.ts','!tsconfig.json'])assert.ok(ignore.includes(input),input);
 assert.match(ignore,/\*\*\/\.env\*/);
});
test('complete build includes its imported recovery-drill helper without shipping scripts in runtime',()=>{
 const image=read('Dockerfile.production');
 const [build,runtime]=image.split(/FROM node:22-slim(?:@sha256:[a-f0-9]{64})? AS runtime/);
 assert.ok(build && runtime,'separate build/runtime stages');
 const helper='COPY scripts/studio-recovery-drill.ts ./scripts/';
 assert.ok(build.includes(helper),'include imported recovery helper before unchanged build');
 assert.ok(build.indexOf(helper)<build.indexOf('RUN npm run build'));
 const lines=read('Dockerfile.production.dockerignore').split('\n');
 assert.ok(lines.includes('!scripts/'),'admit only the helper parent');
 assert.ok(lines.includes('!scripts/studio-recovery-drill.ts'),'explicitly admit the imported helper');
 assert.ok(!lines.includes('!scripts/**'),'do not broaden script admission');
 assert.doesNotMatch(runtime,/^COPY[^\n]*(?:scripts|\/app\s)/m,'no scripts or whole build tree in runtime');
});
test('production override changes only image/build and opt-in assets, retaining base isolation',()=>{
 const override=read('production.compose.yml');
 assert.match(override,/flightdeck-studio-production:local/);
 assert.match(override,/Dockerfile.production/);
 assert.match(override,/STUDIO_FRONTEND_ASSET_ROOT: \/app\/dist/);
 assert.doesNotMatch(override,/ports:|volumes:|privileged:|read_only: false|network_mode:/);
});
