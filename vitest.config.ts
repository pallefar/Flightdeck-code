import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import viteConfig from "./vite.config";

export default mergeConfig(viteConfig, defineConfig({
  test: {
    // These files use node:test and are run separately by the default test entry.
    exclude: [...configDefaults.exclude, "deploy/studio-docker/**"],
  },
}));
