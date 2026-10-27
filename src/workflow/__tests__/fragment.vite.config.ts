import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export default defineConfig({root,plugins:[react()],optimizeDeps:{entries:['src/workflow/__tests__/fragment.browser.html']},server:{host:'127.0.0.1',port:5297,strictPort:true,hmr:false}});
