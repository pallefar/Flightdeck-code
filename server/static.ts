/**
 * ⭐ THE BUILT WORKBENCH, SAME-ORIGIN, BEHIND A STRICT CSP.
 *
 * Until this existed the server answered only `/api/studio/*`, so the only way
 * to open Studio was `npm run dev`: Vite's dev server, no CSP, and a second
 * process beside the one holding the key. `npm start` now builds once and this
 * serves `dist/` from the same Fastify process, so the page and the API share
 * one origin and `connect-src 'self'` is enough.
 *
 * ── WHY NOT @fastify/static ──────────────────────────────────────────────
 * Serving a directory is fifty lines, and those fifty lines are the whole of
 * the security question: can a URL name a file outside `dist/`? Owning them
 * means the containment check is right here, tested case by case in
 * `__tests__/static.test.ts`, instead of being a dependency's default.
 *
 * ── CONTAINMENT, IN THREE LAYERS ─────────────────────────────────────────
 *   1. The path is decoded ONCE, by us. A decode failure, a NUL, a backslash
 *      or any `..` segment is a 404 — before the filesystem is asked.
 *   2. The joined path is resolved and must stay under the dist root.
 *   3. The file's REAL path (symlinks followed) must also stay under the
 *      dist root's real path, and must be a regular file.
 * Any failure is a 404, never a fallback to index.html: a URL that tried to
 * leave `dist/` gets nothing that looks like success.
 *
 * ── HEADERS ──────────────────────────────────────────────────────────────
 * Set in a ROUTE-level onSend hook on each static route. Fastify runs
 * route-level onSend hooks after every instance-level one, however late that
 * was added, so a root-level header hook (baseline headers on every
 * response) cannot loosen the page's policy by running after it — this one
 * has the last word on these routes. Pinned in the tests.
 */
import fs from "node:fs";
import path from "node:path";

import type { FastifyInstance, FastifyReply } from "fastify";

/**
 * The page's policy.
 *
 * - `script-src 'self'`: no inline script at all. The pre-paint theme script
 *   lives in `public/theme-boot.js` for exactly this reason, and
 *   `scripts/__tests__/csp-inline.test.ts` fails on any `<script>` without
 *   `src` in `index.html` or in a real build of it.
 * - `style-src 'self' 'unsafe-inline'`: the workbench injects its stylesheet
 *   (`theme.ts` → WORKBENCH_CSS) and the preview frame's CSS as `<style>`
 *   elements, and `index.html` carries a small `<style>` for first paint.
 * - `frame-src 'self' http://127.0.0.1:*`: the preview frame, and a sub-app
 *   served on loopback.
 * - `frame-ancestors 'none'`: nothing frames the workbench.
 * - `base-uri 'none'`: no `<base>` can re-point relative URLs.
 */
export const WORKBENCH_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "frame-src 'self' http://127.0.0.1:*; frame-ancestors 'none'; base-uri 'none'";

const STATIC_HEADERS: Readonly<Record<string, string>> = {
  "content-security-policy": WORKBENCH_CSP,
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

const contentTypeOf = (file: string): string =>
  CONTENT_TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** Is `child` the directory `root` or somewhere under it? */
const within = (root: string, child: string): boolean =>
  child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * The file a URL path names inside `root`, or null. Null for anything that is
 * not a regular file whose real location is inside `root` — see the header.
 */
export function resolveInside(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter((s) => s !== "");
  if (segments.some((s) => s === ".." || s === ".")) return null;

  const rootResolved = path.resolve(root);
  const candidate = path.resolve(rootResolved, ...segments);
  if (!within(rootResolved, candidate)) return null;
  try {
    const real = fs.realpathSync(candidate);
    if (!within(fs.realpathSync(rootResolved), real)) return null;
    if (!fs.statSync(real).isFile()) return null;
    return real;
  } catch {
    return null;
  }
}

/** Whether there is a build to serve. The server registers nothing without one. */
export function hasBuiltWorkbench(distDir: string): boolean {
  try {
    return fs.statSync(path.join(distDir, "index.html")).isFile();
  } catch {
    return false;
  }
}

const isApiPath = (urlPath: string): boolean => urlPath === "/api" || urlPath.startsWith("/api/");

/**
 * Registers the workbench routes. A no-op when `distDir/index.html` does not
 * exist, so a server started before `vite build` is still the API it was.
 *
 * `/api` is never answered from here: a GET to an unknown `/api` path is a
 * 404 JSON, not the SPA — a client that mistypes an endpoint must get an
 * error, not a 200 of HTML. The API routes themselves, and their bearer
 * check, are registered by `createServer` and are untouched by this.
 */
export function registerWorkbench(app: FastifyInstance, distDir: string): void {
  if (!hasBuiltWorkbench(distDir)) return;
  const root = path.resolve(distDir);

  void app.register(async (scope) => {
    // A ROUTE-level hook: Fastify runs route-level onSend after every
    // instance-level one, whenever that was added.
    const onSend = async (_request: unknown, reply: FastifyReply, payload: unknown): Promise<unknown> => {
      reply.headers(STATIC_HEADERS);
      return payload;
    };

    const sendFile = (reply: FastifyReply, file: string, immutable: boolean): FastifyReply =>
      reply
        .code(200)
        .header("content-type", contentTypeOf(file))
        // Vite hashes every name under assets/, so those never change;
        // index.html must be re-read on every load or a rebuild is invisible.
        .header("cache-control", immutable ? "public, max-age=31536000, immutable" : "no-cache")
        .send(fs.readFileSync(file));

    const notFound = (reply: FastifyReply): FastifyReply => reply.code(404).send({ error: "not found" });

    const handler = async (request: { url: string }, reply: FastifyReply): Promise<FastifyReply> => {
      // The raw path, query stripped. Decoded exactly once, in resolveInside.
      const rawPath = request.url.split("?", 1)[0] ?? "/";
      if (isApiPath(rawPath)) return notFound(reply);

      const isRoot = rawPath === "/" || rawPath === "";
      if (!isRoot) {
        const file = resolveInside(root, rawPath);
        if (file !== null) return sendFile(reply, file, rawPath.startsWith("/assets/"));
        // Anything that TRIED to be a specific file and could not be served —
        // a missing hashed asset, a traversal, an undecodable path — is a 404.
        // Returning index.html there would hand HTML to a <script> tag, or
        // make a traversal look like it worked.
        if (!looksLikeClientRoute(rawPath)) return notFound(reply);
      }
      return sendFile(reply, path.join(root, "index.html"), false);
    };

    scope.get("/", { onSend }, handler);
    scope.get("/*", { onSend }, handler);
  });
}

/**
 * A path the SPA may own: it decodes, has no dot-segments, NUL or backslash,
 * is not under `/assets/`, and its last segment has no file extension (a
 * missing `/favicon.ico` or `/package.json` is a 404, not the page). Only
 * these fall back to index.html.
 */
function looksLikeClientRoute(rawPath: string): boolean {
  if (rawPath.startsWith("/assets/")) return false;
  let decoded: string;
  try {
    decoded = decodeURIComponent(rawPath);
  } catch {
    return false;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return false;
  const segments = decoded.split("/");
  if (segments.some((s) => s === ".." || s === ".")) return false;
  return !(segments[segments.length - 1] ?? "").includes(".");
}
