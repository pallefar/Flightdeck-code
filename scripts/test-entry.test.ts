import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { configDefaults } from "vitest/config";
import { loadConfigFromFile } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));

describe("test discovery configuration", () => {
  it("retains Vite configuration and default exclusions, separating only Docker node:test files", async () => {
    const vite = await loadConfigFromFile({ command: "serve", mode: "test" }, `${root}vite.config.ts`);
    const loaded = existsSync(`${root}vitest.config.ts`)
      ? await loadConfigFromFile({ command: "serve", mode: "test" }, `${root}vitest.config.ts`)
      : null;
    expect(loaded, "a dedicated test config must separate the two runners").not.toBeNull();
    if (!loaded) throw new Error("Missing test configuration");
    const config = loaded.config as import("vite").UserConfig & { test: { exclude: string[]; include?: string[] } };
    expect(config.test.exclude).toEqual([...configDefaults.exclude, "deploy/studio-docker/**"]);
    expect(config.test.include).toBeUndefined();
    expect(config.resolve?.alias).toEqual(vite?.config.resolve?.alias);
    expect(config.plugins?.flat().map((plugin) => plugin && "name" in plugin ? plugin.name : null))
      .toEqual(vite?.config.plugins?.flat().map((plugin) => plugin && "name" in plugin ? plugin.name : null));
    expect(config.server).toEqual(vite?.config.server);
  });
});

describe("default test entry", () => {
  it("runs both frameworks rather than short-circuiting Docker after Vitest", async () => {
    const pkg = JSON.parse(readFileSync(`${root}package.json`, "utf8"));
    expect(pkg.scripts.test).toBe("node scripts/test-all.mjs");
    expect(pkg.scripts["test:vitest"]).toBe("vitest run");
    expect(pkg.scripts["test:docker"]).toBe("node --test deploy/studio-docker/*.test.mjs");
    expect(existsSync(`${root}scripts/test-all.mjs`)).toBe(true);
    const runner = await import(`${root}scripts/test-all.mjs`);
    const commands = runner.createTestCommands(["server", "--reporter=dot", "literal;echo forbidden"]);
    expect(commands).toEqual([
      [process.execPath, [`${root}node_modules/vitest/vitest.mjs`, "run", "server", "--reporter=dot", "literal;echo forbidden"]],
      [process.execPath, ["--test", "deploy/studio-docker/*.test.mjs"]],
    ]);
    const fixture = mkdtempSync(join(tmpdir(), "flightdeck-test-entry-"));
    const marker = join(fixture, "second-family-ran");
    try {
      const result = await runner.runTestCommands([
        [process.execPath, ["-e", "process.exit(1)"]],
        [process.execPath, ["-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`]],
      ]);
      expect(result).toBe(1);
      expect(readFileSync(marker, "utf8")).toBe("executed");
      expect(await runner.runTestCommands([
        [process.execPath, ["-e", "process.exit(0)"]],
        [process.execPath, ["-e", "process.exit(0)"]],
      ])).toBe(0);
      expect(await runner.runTestCommands([
        [process.execPath, ["-e", "process.exit(0)"]],
        [process.execPath, ["-e", "process.exit(2)"]],
      ])).toBe(1);
    } finally {
      rmSync(fixture, { recursive: true, force: true });
    }
  });
});
