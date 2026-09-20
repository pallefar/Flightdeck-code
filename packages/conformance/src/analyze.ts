/** Turning a bag of files into something the checks can interrogate:
 * which file is the manifest, what id does it claim, what does each file
 * import, and — the load-bearing one — which files the host would actually
 * reach if this app were mounted.
 *
 * ⭐ REACHABILITY IS THE ORGANISING IDEA. The host mounts a sub-app
 * through exactly two doors: `registry.ts` imports `manifest.ts`, and the
 * web loader globs `index.tsx`. Everything the sub-app can do at runtime
 * is therefore what those two files reach transitively, and everything
 * else in the candidate is inert. So the gate computes that closure once
 * and every runtime rule below is scoped to it. Two things fall out of
 * that for free:
 *
 *   • A candidate's own vitest file, which legitimately imports `node:fs`
 *     and the host registry to assert things about them, is not in the
 *     closure and is not judged by the runtime rules. That exemption is a
 *     consequence of what the host loads, not a special case somebody
 *     wrote into the capability rule and might get wrong.
 *   • A file NOTHING reaches gets reported (FD-I005). It would be written
 *     into the host repo and never imported, which is at best dead code in
 *     someone else's repository. */
import type { Finding } from "./finding";
import { CANDIDATE_SCOPE, NO_POSITION, finding } from "./finding";
import { SUBAPP_ID_RE, serverDir, webDir } from "./derive";
import { readManifestSource, type ManifestReadResult, type ManifestSource } from "./manifest-read";
import { classifyImport, normalizePath, type ResolvedImport, type ResolveScope } from "./resolve";
import { scanFile, type ScannedFile } from "./scan";

export interface CandidateFile {
  /** Repo-relative path in the HOST repo, e.g.
   * `server/subapps/wc-clock/manifest.ts`. */
  readonly path: string;
  readonly contents: string;
}

/** Everything Studio proposes to write, before any of it is written. */
export interface CandidateSubApp {
  readonly files: readonly CandidateFile[];
}

export type FileRole =
  | "manifest"
  | "guard"
  | "schema"
  | "route"
  | "server-other"
  | "web-module"
  | "web-other"
  | "test"
  | "patch"
  | "foreign";

export interface AnalyzedFile {
  readonly path: string;
  readonly role: FileRole;
  readonly scan: ScannedFile;
  readonly imports: readonly ResolvedImport[];
  /** Reachable from `manifest.ts` or the web module — i.e. the host would
   * load it. */
  readonly reachable: boolean;
}

export interface AnalyzedSubApp {
  /** The id the manifest CLAIMS, which is what everything derives from.
   * Falls back to the directory name when the manifest does not state a
   * usable one, so the remaining checks still have something to derive
   * against instead of silently not running. */
  readonly id: string;
  readonly webModuleId: string;
  /** The directory the manifest sits in — compared against `id`. */
  readonly directoryId: string;
  readonly manifestPath: string;
  readonly manifestRead: ManifestReadResult;
  readonly manifest: ManifestSource | null;
  readonly files: readonly AnalyzedFile[];
  readonly roots: readonly string[];
  fileAt(path: string): AnalyzedFile | null;
}

export type AnalysisResult =
  | { readonly ok: true; readonly app: AnalyzedSubApp }
  | { readonly ok: false; readonly findings: readonly Finding[] };

const MANIFEST_PATH_RE = /^server\/subapps\/([^/]+)\/manifest\.tsx?$/;

export function analyzeCandidate(candidate: CandidateSubApp): AnalysisResult {
  const files = candidate.files.map((file) => ({ ...file, path: normalizePath(file.path) }));

  const duplicates = files.map((f) => f.path).filter((path, i, all) => all.indexOf(path) !== i);
  if (duplicates.length > 0) {
    return {
      ok: false,
      findings: [
        finding(
          "FD-M001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `the candidate lists ${duplicates[0] ?? "a file"} twice — the gate judges the files that would be written, so it cannot tell which of the two that is`,
        ),
      ],
    };
  }

  const manifests = files.filter((file) => MANIFEST_PATH_RE.test(file.path));
  if (manifests.length === 0) {
    return {
      ok: false,
      findings: [
        finding(
          "FD-M001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          "no `server/subapps/<id>/manifest.ts` in the candidate — a sub-app is code-declared through its manifest, so there is nothing here registry.ts could import",
        ),
      ],
    };
  }
  if (manifests.length > 1) {
    return {
      ok: false,
      findings: [
        finding(
          "FD-M001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `the candidate carries ${manifests.length} manifests (${manifests.map((m) => m.path).join(", ")}) — the gate proves ONE sub-app at a time, because the rules it checks are all derived from one id`,
        ),
      ],
    };
  }

  const manifestFile = manifests[0] as CandidateFile;
  const directoryId = MANIFEST_PATH_RE.exec(manifestFile.path)?.[1] ?? "";
  const manifestScan = scanFile(manifestFile.path, manifestFile.contents);
  const manifestRead = readManifestSource(manifestScan);
  const manifest = manifestRead.ok ? manifestRead.manifest : null;

  const claimedId = stringField(manifest, "id");
  const id = claimedId !== null && SUBAPP_ID_RE.test(claimedId) ? claimedId : directoryId;
  const webModuleId = stringField(manifest, "webModuleId") ?? id;

  const fileSet = new Set(files.map((file) => file.path));
  const scope: ResolveScope = { id, webModuleId, files: fileSet };

  const scanned = files.map((file) => {
    const scan = file.path === manifestFile.path ? manifestScan : scanFile(file.path, file.contents);
    const role = roleOf(file.path, manifestFile.path, id, webModuleId);
    const imports: ResolvedImport[] = scan.imports.map((ref) => ({
      ref,
      target: classifyImport(file.path, ref, scope),
    }));
    return { path: file.path, role, scan, imports };
  });

  const byPath = new Map(scanned.map((file) => [file.path, file]));
  const roots = [manifestFile.path, ...scanned.filter((f) => f.role === "web-module").map((f) => f.path)];
  const reachable = walkClosure(roots, byPath);

  const analyzed: AnalyzedFile[] = scanned.map((file) => ({ ...file, reachable: reachable.has(file.path) }));

  return {
    ok: true,
    app: {
      id,
      webModuleId,
      directoryId,
      manifestPath: manifestFile.path,
      manifestRead,
      manifest,
      files: analyzed,
      roots,
      fileAt: (path: string) => analyzed.find((file) => file.path === normalizePath(path)) ?? null,
    },
  };
}

export function stringField(manifest: ManifestSource | null, key: string): string | null {
  const value = manifest?.data[key];
  return typeof value === "string" ? value : null;
}

interface ScannedEntry {
  readonly path: string;
  readonly imports: readonly ResolvedImport[];
}

function walkClosure(roots: readonly string[], byPath: ReadonlyMap<string, ScannedEntry>): Set<string> {
  const seen = new Set<string>();
  const queue = [...roots];
  while (queue.length > 0) {
    const path = queue.shift() as string;
    if (seen.has(path)) continue;
    seen.add(path);
    const file = byPath.get(path);
    if (file === undefined) continue;
    for (const imported of file.imports) {
      if (imported.target.kind === "internal" && !seen.has(imported.target.path)) {
        queue.push(imported.target.path);
      }
    }
  }
  return seen;
}

function roleOf(path: string, manifestPath: string, id: string, webModuleId: string): FileRole {
  if (path === manifestPath) return "manifest";
  if (/\.(patch|diff)$/.test(path)) return "patch";
  if (/\.(test|spec)\.tsx?$/.test(path) || path.startsWith("tests/")) return "test";

  const server = `${serverDir(id)}/`;
  const web = `${webDir(webModuleId)}/`;

  if (path.startsWith(server)) {
    const rest = path.slice(server.length);
    if (rest === "guard.ts" || rest === "guard.tsx") return "guard";
    if (rest === "schema.ts") return "schema";
    if (rest === "routes.ts" || rest.startsWith("routes/")) return "route";
    return "server-other";
  }

  if (path.startsWith(web)) {
    const rest = path.slice(web.length);
    return rest === "index.tsx" || rest === "index.ts" ? "web-module" : "web-other";
  }

  return "foreign";
}

/** The files the host would load: everything in the mount closure, minus
 * the manifest's own directory-mates that nothing imports. */
export function mountedFiles(app: AnalyzedSubApp): AnalyzedFile[] {
  return app.files.filter((file) => file.reachable);
}

/** Mounted SERVER code — where every runtime rule applies. */
export function mountedServerFiles(app: AnalyzedSubApp): AnalyzedFile[] {
  return mountedFiles(app).filter(
    (file) => file.role === "manifest" || file.role === "guard" || file.role === "schema" || file.role === "route" || file.role === "server-other",
  );
}
