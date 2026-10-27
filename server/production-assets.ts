import { closeSync, constants, fstatSync, lstatSync, openSync, opendirSync, readSync } from "node:fs";
import { isAbsolute, join, parse } from "node:path";
import type { FastifyInstance } from "fastify";

const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_FILES = 128;
// Existing hashed JS/CSS plus Vite's explicit hashed `.worker` JavaScript suffix.
// No general dotted stems, unhashed workers, worker CSS, source files or maps.
const HASHED_ASSET = /^[A-Za-z0-9][A-Za-z0-9_-]{0,100}(?:-[A-Za-z0-9_-]{8,32}\.(?:js|css)|\.worker-[A-Za-z0-9_-]{8,32}\.js)$/;
const CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; frame-src 'self' about:; form-action 'none'";
const refused = () => new Error("Production assets refused");
type Asset = { readonly bytes: Buffer; readonly mime: string; readonly cache: string };

function checkedDirectory(path: string): void {
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) throw refused();
}
function boundedNames(path: string, max: number): string[] {
  checkedDirectory(path);
  const dir = opendirSync(path); const names: string[] = [];
  try {
    for (let entry = dir.readSync(); entry !== null; entry = dir.readSync()) {
      if (names.length >= max) throw refused();
      names.push(entry.name);
    }
  } finally { dir.closeSync(); }
  return names;
}
function readRegular(path: string, limit: number): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.size < 1 || before.size > limit) throw refused();
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = readSync(fd, bytes, length, bytes.length - length, length);
      if (read === 0) break;
      length += read;
    }
    const after = fstatSync(fd);
    if (length !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw refused();
    return bytes.subarray(0, length);
  } finally { closeSync(fd); }
}

/** Trusted, read-only startup build snapshot. Not a generic file server or HTML sanitizer.
 * All parent directories must be real directories; callers must keep the build tree
 * immutable during startup. Requests never open files, even if the tree later changes. */
export function registerProductionAssets(app: FastifyInstance, root: string, voiceInput = false): void {
  const files = new Map<string, Asset>();
  try {
    if (!isAbsolute(root) || root.length > 4096 || root.includes("\0") || root.split(/[\\/]/).some(part => part === "." || part === "..") || root.includes("\\")) throw refused();
    let parent = parse(root).root;
    checkedDirectory(parent);
    for (const part of root.slice(parent.length).split("/").filter(Boolean)) { parent = join(parent, part); checkedDirectory(parent); }
    const names = boundedNames(root, 2);
    if (names.length !== 2 || !names.includes("index.html") || !names.includes("assets")) throw refused();
    const index = readRegular(join(root, "index.html"), 128 * 1024);
    const entry: Asset = { bytes: index, mime: "text/html; charset=utf-8", cache: "no-cache" };
    files.set("/", entry); files.set("/demo", entry);
    let total = index.length;
    for (const name of boundedNames(join(root, "assets"), MAX_FILES)) {
      if (!HASHED_ASSET.test(name)) throw refused();
      const bytes = readRegular(join(root, "assets", name), Math.min(MAX_ASSET_BYTES, MAX_TOTAL_BYTES - total));
      total += bytes.length;
      files.set(`/assets/${name}`, { bytes, mime: name.endsWith(".js") ? "application/javascript; charset=utf-8" : "text/css; charset=utf-8", cache: "public, max-age=31536000, immutable" });
    }
    const html = new TextDecoder("utf-8", { fatal: true }).decode(index);
    const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)];
    if (scripts.length === 0) throw refused();
    for (const script of scripts) {
      const src = /\bsrc=["']([^"']+)["']/i.exec(script[1] ?? "")?.[1];
      if (!src || !files.has(src) || !src.endsWith(".js") || script[2]?.trim()) throw refused();
    }
    for (const match of html.matchAll(/\b(?:src|href)=["']([^"']+)["']/gi)) if (!match[1] || !files.has(match[1])) throw refused();
  } catch { throw refused(); }

  // Register only after complete validation; no wildcard, redirects or SPA fallback.
  for (const [url, file] of files) app.route({
    method: ["GET", "HEAD"], url,
    handler: async (request, reply) => {
      // Fastify may decode route characters; admit only the literal canonical URI.
      const rawPath = (request.raw.url ?? "").split("?", 1)[0];
      if (rawPath !== url || (request.raw.url?.length ?? 0) > 2048) return reply.code(404).send({ error: "Not Found" });
      return reply.type(file.mime)
        .header("x-content-type-options", "nosniff")
        .header("referrer-policy", "no-referrer")
        .header("permissions-policy", voiceInput === true && (url === "/" || url === "/demo")
          ? "camera=(), microphone=(self), on-device-speech-recognition=(self), geolocation=(), payment=(), usb=()"
          : "camera=(), microphone=(), on-device-speech-recognition=(), geolocation=(), payment=(), usb=()")
        .header("content-security-policy", CSP)
        .header("cache-control", file.cache).header("content-length", file.bytes.length)
        .send(request.method === "HEAD" ? undefined : file.bytes);
    },
  });
}
