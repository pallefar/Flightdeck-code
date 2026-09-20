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
  // ⚠ THIS PROXY POINTED AT 4180 AND THE SERVER LISTENS ON 8787.
  //
  // They never met. It is latent today — nothing in `src/` fetches `/api`
  // yet, so no request has ever taken this path — and it would have broken
  // the first time anyone wired the workbench to the server, with a 504 and
  // no obvious cause.
  //
  // Derived from the same `PORT` the server reads (`server/index.ts`), so the
  // two stay in step when it is overridden instead of drifting apart again.
  server: {
    port: 5180,
    proxy: { "/api": `http://localhost:${process.env["PORT"] ?? 8787}` },
  },
});
