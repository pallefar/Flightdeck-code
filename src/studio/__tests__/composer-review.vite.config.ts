/** Owned DEVELOPMENT-only browser fixture: no HMR and no API proxy. */
import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
export default defineConfig({root,plugins:[react(),{
 name:'development-only-disabled-setup-response',
 configureServer(server){server.middlewares.use((request,response,next)=>{
  if(request.url==='/api/studio/model-connections/anthropic/setup'){response.statusCode=404;response.end('DEVELOPMENT static disabled setup fixture');return;}
  next();
 });},
}],resolve:{alias:{'@spec':`${root}packages/spec/src`,'@codegen':`${root}packages/codegen/src`,'@conformance':`${root}packages/conformance/src`}},server:{host:'127.0.0.1',port:5298,strictPort:true,hmr:false}});
