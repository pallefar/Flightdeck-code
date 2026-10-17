import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const root = new URL("../", import.meta.url);
const json = (path: string) => JSON.parse(readFileSync(new URL(path, root), "utf8"));
const pkg = json("package.json");
const lock = json("package-lock.json");
const atLeast = (version: string, minimum: number[]) => {
  const parts = version.split(".").map(Number);
  for (const [index, required] of minimum.entries()) {
    const actual = parts[index];
    if (actual === undefined || !Number.isFinite(actual)) return false;
    if (actual !== required) return actual > required;
  }
  return true;
};

describe("patched development dependency graph", () => {
  it("pins the reviewed patched Vitest release in manifest, lock and actual installation", () => {
    expect(pkg.devDependencies.vitest).toBe("4.1.11");
    expect(lock.packages[""].devDependencies.vitest).toBe("4.1.11");
    expect(lock.packages["node_modules/vitest"].version).toBe("4.1.11");
    expect(json("node_modules/vitest/package.json").version).toBe("4.1.11");
  });

  it("has no affected nested mocker, Vite, esbuild, Tinypool or source-map packages", () => {
    const minimums: Record<string, number[]> = {
      "@vitest/mocker": [4, 1, 11], vite: [6, 4, 3], esbuild: [0, 25, 0],
      tinypool: [2, 1, 2], "source-map-js": [1, 2, 2],
    };
    for (const [path, entry] of Object.entries(lock.packages)) {
      const minimum = Object.entries(minimums).find(([name]) => path.endsWith(`node_modules/${name}`));
      if (!minimum) continue;
      const version = (entry as { version: string }).version;
      expect(atLeast(version, minimum[1]), `${path}@${version} is below reviewed security minimum`).toBe(true);
      expect((entry as { dev?: boolean }).dev, `${path} unexpectedly crossed the runtime boundary`)
        .toBe(minimum[0] === "esbuild" && path === "node_modules/esbuild" ? undefined : true);
    }
  });

  it("retains the production loader pin and separate default test families", () => {
    expect(pkg.dependencies.tsx).toBe("4.23.15");
    expect(pkg.dependencies.vitest).toBeUndefined();
    expect(lock.packages["node_modules/tsx"].dev).toBeUndefined();
    expect(lock.packages["node_modules/vitest"].dev).toBe(true);
    expect(pkg.scripts.test).toBe("node scripts/test-all.mjs");
    expect(pkg.scripts["test:docker"]).toBe("node --test deploy/studio-docker/*.test.mjs");
  });
});
