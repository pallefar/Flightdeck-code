/**
 * The built workbench, served by the same Fastify process as `/api/studio/*`.
 *
 * ⭐ WHY THIS EXISTS. The server answered only `/api/studio/*` and there was no
 * `npm start`, so the only way to open Studio was `npm run dev` — Vite's dev
 * server, with no CSP at all, beside a second process holding the key. These
 * pin the production shape: one origin, a strict CSP on the page, and a file
 * server that cannot be walked out of `dist/`.
 *
 * Every case builds a THROWAWAY dist, so nothing here depends on whether
 * `npm run build` has been run in this checkout.
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";

import type { FastifyReply, FastifyRequest } from "fastify";
import { afterAll, describe, expect, it } from "vitest";

import { createServer } from "../index";
import { WORKBENCH_CSP } from "../static";

const TOKEN = "a-sufficiently-long-operator-token";
const OPERATOR = { actor: "Karsten Haldan", token: TOKEN };

const EXPECTED_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "frame-src 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "studio-static-"));
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

const INDEX = '<!doctype html><html><head><script src="/theme-boot.js"></script></head><body>studio-index</body></html>';

/** A dist that looks like `vite build` output, one directory BELOW a file
 * that must never be reachable from it. */
function makeDist(name: string): string {
  const root = path.join(tmp, name);
  const dist = path.join(root, "dist");
  fs.mkdirSync(path.join(dist, "assets"), { recursive: true });
  fs.writeFileSync(path.join(root, "package.json"), '{"secret":"outside-dist"}');
  fs.writeFileSync(path.join(dist, "index.html"), INDEX);
  fs.writeFileSync(path.join(dist, "theme-boot.js"), "/* boot */");
  fs.writeFileSync(path.join(dist, "assets", "x.js"), "export const x = 1;");
  fs.writeFileSync(path.join(dist, "assets", "x.css"), "body{}");
  return dist;
}

const dist = makeDist("app");
const serve = (distDir: string = dist) =>
  createServer({ operator: OPERATOR, llm: async () => ({ text: "{}" }), distDir });

describe("GET / — the workbench, with its headers", () => {
  it("⭐ returns index.html with the strict CSP, nosniff and no-referrer", async () => {
    const res = await serve().inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toContain("studio-index");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
    expect(WORKBENCH_CSP).toBe(EXPECTED_CSP);
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
  });

  it("serves /index.html the same way", async () => {
    const res = await serve().inject({ method: "GET", url: "/index.html" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("studio-index");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
  });

  it("⭐ the strict CSP survives a root-level onSend hook that writes a weaker one", async () => {
    // A global header hook (baseline headers on every response) must not be
    // able to loosen the page's policy by running after it.
    const app = serve();
    app.addHook("onSend", async (_request: FastifyRequest, reply: FastifyReply, payload: unknown) => {
      reply.header("content-security-policy", "default-src *");
      return payload;
    });
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
  });
});

describe("static files", () => {
  it("serves /assets/x.js as JavaScript and /assets/x.css as CSS", async () => {
    const app = serve();
    const js = await app.inject({ method: "GET", url: "/assets/x.js" });
    expect(js.statusCode).toBe(200);
    expect(js.headers["content-type"]).toMatch(/^text\/javascript/);
    expect(js.body).toBe("export const x = 1;");
    expect(js.headers["x-content-type-options"]).toBe("nosniff");
    const css = await app.inject({ method: "GET", url: "/assets/x.css" });
    expect(css.headers["content-type"]).toMatch(/^text\/css/);
  });

  it("serves the out-of-line theme boot script from the dist root", async () => {
    const res = await serve().inject({ method: "GET", url: "/theme-boot.js" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/javascript/);
  });

  it("a missing file under /assets/ is 404, not index.html dressed as a script", async () => {
    const res = await serve().inject({ method: "GET", url: "/assets/missing.js" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("studio-index");
  });
});

describe("⛔ nothing outside dist/ is reachable", () => {
  const attempts = [
    "/assets/../../package.json",
    "/../package.json",
    "/assets/%2e%2e/%2e%2e/package.json",
    "/assets/..%2f..%2fpackage.json",
    "/assets/%2E%2E%2F%2E%2E%2Fpackage.json",
    "/%2e%2e/package.json",
    "/assets/..%5c..%5cpackage.json",
    "/assets/%252e%252e/%252e%252e/package.json",
    "/assets/x.js%00.html",
    "/package.json",
  ];
  for (const url of attempts) {
    it(`404 for ${url}`, async () => {
      const res = await serve().inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.body, url).not.toContain("outside-dist");
      expect(res.body, url).not.toContain("studio-index");
    });
  }

  it("an undecodable path is refused, not served", async () => {
    // Fastify's router refuses it (400) before any handler runs.
    const res = await serve().inject({ method: "GET", url: "/assets/%zz" });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
    expect(res.statusCode).toBeLessThan(500);
    expect(res.body).not.toContain("studio-index");
  });

  it("⭐ over a REAL socket, where the raw path is not normalised first", async () => {
    // `inject` parses the URL, which folds `..` away before routing. A client
    // on the wire (`curl --path-as-is`) sends it verbatim, so check that too.
    const app = serve();
    await app.listen({ port: 0, host: "127.0.0.1" });
    try {
      const address = app.server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      const get = (rawPath: string) =>
        new Promise<{ status: number; body: string }>((resolve, reject) => {
          const req = http.request({ host: "127.0.0.1", port: address.port, path: rawPath, method: "GET" }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => (body += chunk));
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
          });
          req.on("error", reject);
          req.end();
        });
      for (const rawPath of [
        "/assets/../../package.json",
        "/../package.json",
        "/assets/../../../package.json",
        "/assets/..%2f..%2fpackage.json",
        "/assets/%2e%2e/%2e%2e/package.json",
      ]) {
        const res = await get(rawPath);
        expect(res.status, rawPath).toBe(404);
        expect(res.body, rawPath).not.toContain("outside-dist");
        expect(res.body, rawPath).not.toContain("studio-index");
      }
      expect((await get("/assets/x.js")).status).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("a symlink inside dist/ that points out of it is not followed", async () => {
    const linked = makeDist("linked");
    fs.symlinkSync(path.join(linked, "..", "package.json"), path.join(linked, "assets", "leak.json"));
    const res = await serve(linked).inject({ method: "GET", url: "/assets/leak.json" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("outside-dist");
  });
});

describe("routing: the SPA fallback and /api", () => {
  it("an unknown non-/api path falls back to index.html, with the CSP", async () => {
    const res = await serve().inject({ method: "GET", url: "/projects/some-thing?tab=diff" });
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/^text\/html/);
    expect(res.body).toContain("studio-index");
    expect(res.headers["content-security-policy"]).toBe(EXPECTED_CSP);
  });

  it("⭐ an unknown /api path is a 404 JSON, never index.html", async () => {
    const app = serve();
    for (const url of ["/api/studio/nope", "/api", "/api/", "/api/other/thing"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(404);
      expect(res.headers["content-type"], url).toMatch(/^application\/json/);
      expect(res.body, url).not.toContain("studio-index");
    }
    const post = await app.inject({ method: "POST", url: "/api/studio/nope", payload: {} });
    expect(post.statusCode).toBe(404);
    expect(post.headers["content-type"]).toMatch(/^application\/json/);
  });

  it("the API routes still answer: health is JSON", async () => {
    const res = await serve().inject({ method: "GET", url: "/api/studio/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });
});

describe("auth: static needs no bearer, the API loses none", () => {
  it("no static route asks for the bearer", async () => {
    const app = serve();
    for (const url of ["/", "/index.html", "/assets/x.js", "/theme-boot.js", "/deep/link"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(200);
    }
  });

  it("⭐ /api/studio/build still refuses without the operator token", async () => {
    const res = await serve().inject({ method: "POST", url: "/api/studio/build", payload: { prompt: "hello" } });
    expect(res.statusCode).toBe(401);
  });

  it("a GET to /api/studio/build is not answered with the workbench", async () => {
    const res = await serve().inject({ method: "GET", url: "/api/studio/build" });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toContain("studio-index");
  });
});

describe("registration", () => {
  it("serves nothing when dist/index.html does not exist (no build yet)", async () => {
    const empty = path.join(tmp, "empty-dist");
    fs.mkdirSync(empty, { recursive: true });
    const app = serve(empty);
    const res = await app.inject({ method: "GET", url: "/" });
    expect(res.statusCode).toBe(404);
    const health = await app.inject({ method: "GET", url: "/api/studio/health" });
    expect(health.statusCode).toBe(200);
  });
});
