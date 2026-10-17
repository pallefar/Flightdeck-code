/** Isolated local browser fixture only; no API proxy or production serving. */
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../../../", import.meta.url));
export default defineConfig({
  root,
  plugins: [react()],
  resolve: { alias: {
    "@spec": `${root}packages/spec/src`,
    "@codegen": `${root}packages/codegen/src`,
    "@conformance": `${root}packages/conformance/src`,
  } },
  server: { host: "127.0.0.1", port: 5182, strictPort: true, hmr: false },
});
