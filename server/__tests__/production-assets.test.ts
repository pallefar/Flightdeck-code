import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, truncateSync, realpathSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "../index";

const roots: string[] = [];
const apps: ReturnType<typeof createServer>[] = [];
const operator = { actor: "Production serving development operator", token: "development-only-static-serving-token" };
function fixture() {
  const root = mkdtempSync(join(realpathSync(tmpdir()), "studio-assets-")); roots.push(root);
  mkdirSync(join(root, "assets"));
  writeFileSync(join(root, "index.html"), '<!doctype html><html><head><script type="module" src="/assets/index-AbCd1234.js"></script><link rel="stylesheet" href="/assets/index-EfGh5678.css"></head><body><div id="root"></div></body></html>');
  writeFileSync(join(root, "assets/index-AbCd1234.js"), 'document.title="Studio";');
  writeFileSync(join(root, "assets/index-EfGh5678.css"), "body{color:black}");
  return root;
}
function serve(root?: string) {
  const app = createServer({ operator, ...(root ? { productionAssetRoot: root } : {}) });
  apps.push(app); return app;
}
afterEach(async () => { vi.unstubAllEnvs(); await Promise.all(apps.splice(0).map(app => app.close())); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("existing private bootstrap can explicitly enable the startup build through environment", async () => {
  vi.stubEnv("STUDIO_FRONTEND_ASSET_ROOT", fixture());
  expect((await serve().inject("/")).statusCode).toBe(200);
  vi.stubEnv("STUDIO_FRONTEND_ASSET_ROOT", "");
  expect(() => serve()).toThrow("Production assets refused");
});

it.each([
  "source file", "map", "unhashed", "directory", "asset symlink", "root symlink", "parent symlink", "index symlink", "oversized", "total", "file count", "missing reference", "empty index", "relative root",
])("refuses an untrusted or unbounded startup build: %s", kind => {
  const root = fixture(); let chosen = root;
  if (kind === "source file") writeFileSync(join(root, "assets/source.ts"), "private source");
  if (kind === "map") writeFileSync(join(root, "assets/index-AbCd1234.js.map"), "{}");
  if (kind === "unhashed") writeFileSync(join(root, "assets/plain.js"), "source");
  if (kind === "directory") mkdirSync(join(root, "assets/nested-AbCd1234.js"));
  if (kind === "asset symlink") { rmSync(join(root, "assets/index-AbCd1234.js")); symlinkSync(join(root, "index.html"), join(root, "assets/index-AbCd1234.js")); }
  if (kind === "index symlink") { rmSync(join(root, "index.html")); symlinkSync(join(root, "assets/index-AbCd1234.js"), join(root, "index.html")); }
  if (kind === "root symlink" || kind === "parent symlink") {
    const holder = mkdtempSync(join(realpathSync(tmpdir()), "studio-link-")); roots.push(holder);
    symlinkSync(kind === "root symlink" ? root : dirname(root), join(holder, "alias"));
    chosen = kind === "root symlink" ? join(holder, "alias") : join(holder, "alias", basename(root));
  }
  if (kind === "oversized") truncateSync(join(root, "assets/index-AbCd1234.js"), 8 * 1024 * 1024 + 1);
  if (kind === "total") for (let i = 0; i < 3; i++) { const file = join(root, `assets/chunk${i}-AbCd1234.js`); writeFileSync(file, ""); truncateSync(file, 8 * 1024 * 1024); }
  if (kind === "file count") for (let i = 0; i < 129; i++) writeFileSync(join(root, `assets/chunk${i}-AbCd1234.js`), "x");
  if (kind === "missing reference") rmSync(join(root, "assets/index-AbCd1234.js"));
  if (kind === "empty index") writeFileSync(join(root, "index.html"), "");
  if (kind === "relative root") chosen = "dist";
  expect(() => serve(chosen)).toThrow("Production assets refused");
});

it('admits only the emitted hashed worker JavaScript shape with immutable canonical delivery', async () => {
  const root = fixture();
  const name = 'subapp-source-validation.worker-AbCd1234.js';
  const bytes = 'self.onmessage=()=>self.postMessage({developmentOnly:true});';
  writeFileSync(join(root, 'assets', name), bytes);
  const app = serve(root);
  const response = await app.inject(`/assets/${name}`);
  expect(response.statusCode).toBe(200);
  expect(response.body).toBe(bytes);
  expect(response.headers['content-type']).toContain('application/javascript');
  expect(response.headers['cache-control']).toBe('public, max-age=31536000, immutable');
  expect(response.headers['content-security-policy']).toContain("script-src 'self'");
  expect(response.headers['content-security-policy']).not.toContain('unsafe-eval');
  const head = await app.inject({ method: 'HEAD', url: `/assets/${name}` });
  expect(head.statusCode).toBe(200); expect(head.body).toBe('');
  expect(head.headers['content-length']).toBe(response.headers['content-length']);
  writeFileSync(join(root, 'assets', name), 'unexpected replacement');
  expect((await app.inject(`/assets/${name}`)).body).toBe(bytes);
  for (const path of [`/assets/%73${name.slice(1)}`, `/assets/${name}.map`, `/assets/${name}/`, '/assets/source.worker.js'])
    expect((await app.inject(path)).statusCode, path).toBe(404);
});

it.each([
  'source.worker.js',
  'source.worker-short.js',
  `source.worker-${'A'.repeat(33)}.js`,
  'source.worker-AbCd1234.ts',
  'source.worker-AbCd1234.js.map',
  'source.worker-AbCd1234.css',
  'source.other.worker-AbCd1234.js',
  `${'A'.repeat(102)}.worker-AbCd1234.js`,
])('refuses malformed worker-like startup asset: %s', name => {
  const root = fixture(); writeFileSync(join(root, 'assets', name), 'untrusted asset');
  expect(() => serve(root)).toThrow('Production assets refused');
});

it("retains a bounded memory snapshot after files are replaced", async () => {
  const root = fixture(); const app = serve(root);
  const before = await app.inject("/assets/index-AbCd1234.js");
  writeFileSync(join(root, "assets/index-AbCd1234.js"), "unexpected replacement");
  rmSync(join(root, "index.html"));
  expect((await app.inject("/assets/index-AbCd1234.js")).body).toBe(before.body);
  expect((await app.inject("/")).statusCode).toBe(200);
});

it("keeps exact public routes canonical with security headers and no SPA/API fallback", async () => {
  const app = serve(fixture());
  for (const url of ["/", "/demo", "/assets/index-AbCd1234.js"]) {
    const response = await app.inject(url);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["permissions-policy"]).toContain("camera=()");
    const csp = String(response.headers["content-security-policy"]);
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    for (const directive of ["object-src 'none'", "base-uri 'none'", "frame-ancestors 'none'", "connect-src 'self'", "frame-src 'self' about:"]) expect(csp).toContain(directive);
    expect(response.headers["strict-transport-security"]).toBeUndefined();
  }
  for (const url of ["/unknown", "/api/bogus", "/server/index.ts", "/package.json", "/.studio/workflow-workspace.json", "/index.html", "/demo/", "/assets/../index.html", "/assets/%2e%2e/index.html", "/assets/%252e%252e/index.html", "/assets%2findex-AbCd1234.js", "/assets/%69ndex-AbCd1234.js", "/%64emo", "/assets/index-AbCd1234.js%00", "/assets/__proto__", "/assets/constructor", "/assets/index-AbCd1234.js.map"]) {
    const response = await app.inject(url);
    expect(response.statusCode, url).toBe(404);
    expect(response.headers["content-type"], url).not.toContain("text/html");
  }
  expect((await app.inject({ method: "POST", url: "/" })).statusCode).toBe(404);
  expect((await serve().inject("/")).statusCode).toBe(404);
});

it("opt-in serves the exact production entry and bundles through the real API composition", async () => {
  const app = serve(fixture());
  for (const url of ["/", "/demo"]) {
    const page = await app.inject(url);
    expect(page.statusCode).toBe(200);
    expect(page.headers["content-type"]).toContain("text/html");
    expect(page.headers["cache-control"]).toBe("no-cache");
    expect(page.body).toContain("/assets/index-AbCd1234.js");
    const head = await app.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200); expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe(page.headers["content-length"]);
  }
  const bundle = await app.inject("/assets/index-AbCd1234.js");
  expect(bundle.statusCode).toBe(200);
  expect(bundle.headers["content-type"]).toContain("application/javascript");
  expect(bundle.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  expect((await app.inject("/api/studio/health")).json()).toEqual({ ok: true });
  expect((await app.inject("/api/studio/model-connections")).statusCode).toBe(401);
  expect((await app.inject("/api/bogus")).statusCode).toBe(404);
});
