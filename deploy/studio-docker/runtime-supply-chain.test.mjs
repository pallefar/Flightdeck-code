import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const root=new URL('../../',import.meta.url);
const read=p=>readFileSync(new URL(p,root),'utf8');
test('production runtime installs only its locked production dependency graph',()=>{
 const image=read('deploy/studio-docker/Dockerfile.production');
 const runtime=image.split(' AS runtime')[1];
 assert.ok(runtime,'distinct runtime stage');
 assert.match(runtime,/npm ci --ignore-scripts --omit=dev/);
 assert.doesNotMatch(runtime,/COPY --from=build \/app\/node_modules/);
 assert.match(runtime,/COPY package.json package-lock.json/);
 assert.match(image,/RUN npm run build && node deploy\/studio-docker\/prune-runtime-tests\.mjs/,'exclude test sources only after the complete build/typecheck');
 assert.match(runtime,/COPY --from=build \/app\/server/);
 assert.match(runtime,/COPY --from=build \/app\/packages/);
 const pkg=JSON.parse(read('package.json'));
 assert.match(pkg.dependencies.tsx,/^\d+\.\d+\.\d+$/,'actual TS loader is a pinned production dependency');
 assert.equal(pkg.devDependencies.tsx,undefined);
 const lock=JSON.parse(read('package-lock.json'));
 assert.equal(lock.packages[''].dependencies.tsx,pkg.dependencies.tsx);
 assert.notEqual(lock.packages['node_modules/tsx'].dev,true);
});
test('production context keeps complete typechecked sources but only explicit deployment utilities',()=>{
 const ignore=read('deploy/studio-docker/Dockerfile.production.dockerignore');
 assert.doesNotMatch(ignore,/!deploy\/studio-docker\/\*\*|!scripts\/\*\*/);
 for(const file of ['bootstrap.mjs','secrets.mjs','prune-runtime-tests.mjs'])assert.ok(ignore.includes('!deploy/studio-docker/'+file));
 assert.doesNotMatch(ignore,/\*\*\/__tests__|\*\*\/\*\.test\.ts/,'do not weaken the full build/typecheck');
});
test('every production image stage pins the same official base digest',()=>{
 const from=read('deploy/studio-docker/Dockerfile.production').split('\n').filter(l=>l.startsWith('FROM '));
 assert.equal(from.length,2);
 for(const line of from)assert.match(line,/^FROM node:22-slim@sha256:[a-f0-9]{64} AS (build|runtime)$/);
 assert.equal(from[0].split(' ')[1],from[1].split(' ')[1]);
});
