import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
// Dedicated loopback fixture: no API proxy, host access, credentials or HMR reloads.
export default defineConfig({root,plugins:[react()],resolve:{alias:{'@spec':fileURLToPath(new URL('../../../packages/spec/src',import.meta.url)),'@codegen':fileURLToPath(new URL('../../../packages/codegen/src',import.meta.url)),'@conformance':fileURLToPath(new URL('../../../packages/conformance/src',import.meta.url))}},optimizeDeps:{entries:['src/workflow/__tests__/stacked.browser.html']},server:{host:'127.0.0.1',port:5298,strictPort:true,hmr:false}});
