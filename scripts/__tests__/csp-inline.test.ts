/**
 * ⛔ NO INLINE SCRIPT IN THE WORKBENCH PAGE.
 *
 * The server sends `script-src 'self'` with the built page (`server/static.ts`).
 * That policy blocks every `<script>` without a `src`, and it blocks it
 * silently from the page's point of view: the pre-paint theme script simply
 * does not run, and a dark-mode reload flashes light first. Nothing else
 * would notice.
 *
 * So this reads the SOURCE `index.html` and a REAL `vite build` of it (into a
 * throwaway directory — this checkout's own `dist/` is never read or
 * written), and fails on any `<script>` without `src`.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const STUDIO = path.resolve(__dirname, "..", "..");
const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "studio-csp-dist-"));
afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

interface ScriptTag {
  readonly open: string;
  readonly body: string;
}

/** Every `<script …>…</script>` in a document. HTML comments are removed
 * first, so a commented-out tag neither passes nor fails anything. */
function scripts(html: string): ScriptTag[] {
  const stripped = html.replace(/<!--[\s\S]*?-->/g, "");
  return [...stripped.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)].map((m) => ({
    open: m[1] ?? "",
    body: m[2] ?? "",
  }));
}

const hasSrc = (tag: ScriptTag): boolean => /(^|\s)src\s*=/i.test(tag.open);

function inlineOffenders(html: string): string[] {
  return scripts(html)
    .filter((tag) => !hasSrc(tag))
    .map((tag) => `<script${tag.open}>${tag.body.trim().slice(0, 80)}…`);
}

describe("the offender check itself", () => {
  it("catches an inline script and passes a src one", () => {
    expect(inlineOffenders('<script>var a=1</script><script src="/x.js"></script>')).toHaveLength(1);
    expect(inlineOffenders('<script type="module">import "x"</script>')).toHaveLength(1);
    expect(inlineOffenders('<script src="/a.js"></script><script type="module" src="/b.js"></script>')).toEqual([]);
    expect(inlineOffenders("<!-- <script>x</script> -->")).toEqual([]);
  });
});

describe("⛔ index.html (source)", () => {
  const html = fs.readFileSync(path.join(STUDIO, "index.html"), "utf8");

  it("has no <script> without src", () => {
    expect(inlineOffenders(html)).toEqual([]);
  });

  it("⭐ loads the theme boot script synchronously, in <head>, so it still runs before first paint", () => {
    const head = /<head\b[^>]*>([\s\S]*?)<\/head>/i.exec(html)?.[1] ?? "";
    const boot = scripts(head).find((tag) => /src\s*=\s*"\/theme-boot\.js"/.test(tag.open));
    expect(boot, "no <script src=\"/theme-boot.js\"> in <head>").toBeDefined();
    // async/defer/module would all run it AFTER first paint — the flash is back.
    expect(boot?.open ?? "").not.toMatch(/\b(async|defer)\b|type\s*=\s*"module"/i);
  });

  it("the boot script reads the same key the driver writes (THEME_STORAGE_KEY)", async () => {
    const { THEME_STORAGE_KEY } = await import("../../src/workbench/theme");
    const boot = fs.readFileSync(path.join(STUDIO, "public", "theme-boot.js"), "utf8");
    expect(boot).toContain(`"${THEME_STORAGE_KEY}"`);
  });
});

describe("⛔ dist/index.html (a real vite build)", () => {
  beforeAll(async () => {
    const { build } = await import("vite");
    await build({ root: STUDIO, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  }, 120_000);

  it("has no <script> without src", () => {
    const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(scripts(html).length).toBeGreaterThan(0);
    expect(inlineOffenders(html)).toEqual([]);
  });

  it("ships theme-boot.js at the root the page asks for it", () => {
    const html = fs.readFileSync(path.join(outDir, "index.html"), "utf8");
    expect(html).toContain('src="/theme-boot.js"');
    expect(fs.existsSync(path.join(outDir, "theme-boot.js"))).toBe(true);
  });
});
