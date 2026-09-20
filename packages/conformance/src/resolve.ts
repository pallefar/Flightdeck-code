/** Where does an import specifier actually point, in the HOST repo?
 *
 * ⭐ WHY RESOLVE AND NOT MATCH. The obvious sibling check is
 * `specifier.includes("../docusign/")`, and it is worth exactly as much as
 * the list of spellings whoever wrote it thought of. `../../subapps/docusign/guard.js`,
 * `./../docusign/guard.js` and `../docusign/../docusign/guard.js` are the
 * same edge and only one of them is on that list. Resolving the specifier
 * against the importing file's directory collapses all of them into one
 * repo-relative path, and the rules are then stated once, about paths.
 *
 * It also means a NEW forbidden module needs no new pattern: the host
 * modules a sub-app may reach are an ALLOWLIST of nine leaves, and
 * anything else that resolves into the host is reported whether or not
 * anyone had thought of it. (`registry.ts` and `installRoutes.ts` are
 * named separately only so the message can say why THOSE two are the ones
 * the contract calls out.)
 *
 * Resolution is textual. There is no filesystem here by design — the gate
 * runs BEFORE anything is written, on a candidate that exists only in
 * memory, which is the whole point of it being a gate. */
import type { ImportRef } from "./scan";

/** The host modules a sub-app's mounted code may import, extensionless and
 * repo-relative. Every one of them is a LEAF: it imports no sub-app, so it
 * cannot drag a sibling into the closure (contract §5.4). */
export const HOST_LEAF_MODULES: readonly string[] = [
  "server/subapps/types",
  "server/subapps/installRow",
  "server/subapps/killSwitch",
  "server/subapps/capabilities",
  "server/db",
  "server/lib/flightdeckAudit",
  "server/project/types",
  "server/workspace/types",
  "web/src/subapps/registry",
];

/** Named by the contract: importing either pulls every sibling sub-app
 * into this file's import closure. */
export const FORBIDDEN_HOST_MODULES: readonly string[] = [
  "server/subapps/registry",
  "server/subapps/installRoutes",
];

export const SERVER_SUBAPPS_ROOT = "server/subapps";
export const WEB_SUBAPPS_ROOT = "web/src/subapps";

export type Tier = "server" | "web" | "other";

export type ImportTarget =
  | { readonly kind: "internal"; readonly path: string }
  | { readonly kind: "missing-internal"; readonly path: string }
  | { readonly kind: "sibling"; readonly path: string; readonly siblingId: string }
  | { readonly kind: "registry"; readonly path: string }
  | { readonly kind: "host-leaf"; readonly path: string }
  | { readonly kind: "host-other"; readonly path: string }
  | { readonly kind: "cross-tier"; readonly path: string }
  | { readonly kind: "package"; readonly name: string }
  | { readonly kind: "unresolvable"; readonly raw: string };

export interface ResolvedImport {
  readonly ref: ImportRef;
  readonly target: ImportTarget;
}

/** Leading `./`, duplicate slashes and Windows separators removed. */
export function normalizePath(path: string): string {
  const unified = path.replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  return unified.startsWith("./") ? unified.slice(2) : unified;
}

export function dirname(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

/** POSIX-style join with `..` collapsing. Returns `null` when the path
 * climbs above the repo root, which is a specifier no host file could
 * resolve either. */
export function joinPath(base: string, relative: string): string | null {
  const parts = base.length === 0 ? [] : base.split("/");
  for (const segment of relative.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (parts.length === 0) return null;
      parts.pop();
      continue;
    }
    parts.push(segment);
  }
  return parts.join("/");
}

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"];

export function withoutExtension(path: string): string {
  for (const ext of SOURCE_EXTENSIONS) {
    if (path.endsWith(ext)) return path.slice(0, -ext.length);
  }
  return path;
}

export function tierOf(path: string): Tier {
  if (path.startsWith("server/")) return "server";
  if (path.startsWith("web/")) return "web";
  return "other";
}

/** The sub-app id owning a path under either subapps root, or null. */
export function subAppIdOf(path: string): string | null {
  for (const root of [SERVER_SUBAPPS_ROOT, WEB_SUBAPPS_ROOT]) {
    if (!path.startsWith(`${root}/`)) continue;
    const rest = path.slice(root.length + 1);
    const at = rest.indexOf("/");
    // `server/subapps/types.ts` is a leaf, not a sub-app directory.
    if (at === -1) return null;
    return rest.slice(0, at);
  }
  return null;
}

export interface ResolveScope {
  /** The manifest's own id, which owns `server/subapps/<id>/`. */
  readonly id: string;
  /** The manifest's `webModuleId`, which owns `web/src/subapps/<it>/`. */
  readonly webModuleId: string;
  /** Repo-relative paths of every file in the candidate. */
  readonly files: ReadonlySet<string>;
}

/** The candidate file a resolved specifier names, trying the extension
 * substitutions the host's bundler makes: an emitted `./routes/index.js`
 * is `routes/index.ts` on disk, and a directory specifier means its
 * `index`. */
export function resolveCandidateFile(resolved: string, files: ReadonlySet<string>): string | null {
  if (files.has(resolved)) return resolved;
  const bare = withoutExtension(resolved);
  for (const ext of SOURCE_EXTENSIONS) {
    if (files.has(bare + ext)) return bare + ext;
  }
  for (const ext of SOURCE_EXTENSIONS) {
    if (files.has(`${bare}/index${ext}`)) return `${bare}/index${ext}`;
  }
  return null;
}

export function classifyImport(fromPath: string, ref: ImportRef, scope: ResolveScope): ImportTarget {
  const specifier = ref.specifier;

  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    return { kind: "package", name: specifier };
  }

  const resolved = specifier.startsWith("/")
    ? normalizePath(specifier.slice(1))
    : joinPath(dirname(normalizePath(fromPath)), specifier);
  if (resolved === null) return { kind: "unresolvable", raw: specifier };

  // The tier line is checked BEFORE ownership, because a server file
  // reaching this same sub-app's web module is still a server file
  // importing browser code — the two halves are built separately and meet
  // only over HTTP at the route prefix.
  const fromTier = tierOf(normalizePath(fromPath));
  const toTier = tierOf(resolved);
  if (fromTier !== "other" && toTier !== "other" && fromTier !== toTier) {
    return { kind: "cross-tier", path: resolved };
  }

  const ownDirs = [`${SERVER_SUBAPPS_ROOT}/${scope.id}/`, `${WEB_SUBAPPS_ROOT}/${scope.webModuleId}/`];
  if (ownDirs.some((dir) => resolved.startsWith(dir))) {
    const hit = resolveCandidateFile(resolved, scope.files);
    return hit === null ? { kind: "missing-internal", path: resolved } : { kind: "internal", path: hit };
  }

  const bare = withoutExtension(resolved);

  if (FORBIDDEN_HOST_MODULES.includes(bare)) return { kind: "registry", path: bare };
  if (HOST_LEAF_MODULES.includes(bare)) return { kind: "host-leaf", path: bare };

  const sibling = subAppIdOf(resolved);
  if (sibling !== null && sibling !== scope.id && sibling !== scope.webModuleId) {
    return { kind: "sibling", path: resolved, siblingId: sibling };
  }

  return { kind: "host-other", path: resolved };
}
