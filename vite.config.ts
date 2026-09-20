import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@spec": fileURLToPath(new URL("./packages/spec/src", import.meta.url)),
      "@codegen": fileURLToPath(new URL("./packages/codegen/src", import.meta.url)),
      "@conformance": fileURLToPath(new URL("./packages/conformance/src", import.meta.url)),
    },
  },
  server: { port: 5180, proxy: { "/api": "http://localhost:4180" } },
});
