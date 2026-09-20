/** The file tree, built for a file set that is not a project.
 *
 * ── WHY THIS IS NOT A PROJECT TREE ───────────────────────────────────
 * The reference implementation renders one rooted tree because its target
 * is a project: everything lives under one root and the root is where you
 * would `cd`. A generated Flightdeck sub-app has no root. It is a set of
 * files that land in THREE separate places inside somebody else's repo —
 *
 *   server/subapps/<id>/…      the routes, guard, manifest, schema
 *   web/src/subapps/<id>/…     the page (contract §3)
 *   tests/subapps/<id>/…       the tests (contract §10 — a layout fence,
 *                              not a convention: the flat `tests/` root
 *                              is rejected)
 *
 * — plus a fourth thing that is not a file at all: the edit to the host's
 * own `registry.ts` (contract §7). Flattening those into one alphabetical
 * tree puts `registry.ts.patch` between `manifest.ts` and `routes/` as if
 * it were another file to read, and that is exactly how somebody ships a
 * sub-app that is never mounted. So `host-edit` is its own tier, listed
 * last and labelled as an edit rather than a file.
 *
 * ── AND WHY ORDER IS NOT ALPHABETICAL ────────────────────────────────
 * Alphabetical opens `guard.ts` first. `guard.ts` is the same text in
 * every generated sub-app — the one file in the set that tells a reviewer
 * nothing. `manifest.ts` is the file that decides whether the host boots
 * (contract §2 is fail-loud: one bad manifest takes the server down), so
 * it sorts first. `RANK` is that judgement, written down.
 *
 * Pure and DOM-free — `tree.test.ts` runs it in node. */
import type { GeneratedFile, GeneratedFileKind } from "./types";

export type Tier = "server" | "web" | "tests" | "host-edit" | "other";

export interface TierInfo {
  readonly id: Tier;
  readonly label: string;
  /** One line saying what this tier IS, shown under the label. A person
   * looking at a generated sub-app for the first time should not have to
   * already know the host's layout to read the tree. */
  readonly blurb: string;
  /** Render paths as single rows rather than building directories out of
   * them. True for `host-edit`, where the one entry is a change to
   * `server/subapps/registry.ts` — expanding that into `server/ >
   * subapps/ > registry.ts.patch` spends three rows implying a directory
   * tree that this tier does not have, and buries the one thing a person
   * must not forget to apply. */
  readonly flat: boolean;
}

export const TIERS: Readonly<Record<Tier, TierInfo>> = {
  server: {
    id: "server",
    label: "Server",
    blurb: "Drops into server/subapps/ — routes, guard, manifest.",
    flat: false,
  },
  web: {
    id: "web",
    label: "Web",
    blurb: "Drops into web/src/subapps/ — the page the host lazy-mounts.",
    flat: false,
  },
  tests: {
    id: "tests",
    label: "Tests",
    blurb: "Drops into tests/subapps/<id>/ — never the flat tests/ root.",
    flat: false,
  },
  "host-edit": {
    id: "host-edit",
    label: "Host edits",
    blurb: "NOT a new file — a change to a file the host already owns.",
    flat: true,
  },
  other: { id: "other", label: "Other", blurb: "Outside the three known tiers.", flat: false },
};

/** Tier order as the tree lists them: what you read, then what you must
 * remember to apply. */
export const TIER_ORDER: readonly Tier[] = ["server", "web", "tests", "host-edit", "other"];

export function classifyTier(file: Pick<GeneratedFile, "path" | "kind">): Tier {
  if (file.kind === "patch" || file.path.endsWith(".patch")) return "host-edit";
  if (file.path.startsWith("server/subapps/")) return "server";
  if (file.path.startsWith("web/src/subapps/")) return "web";
  if (file.path.startsWith("tests/")) return "tests";
  return "other";
}

/** Read-first order inside a tier. Lower sorts earlier. Anything unlisted
 * falls to `50` and then sorts alphabetically among its peers. */
const RANK: Partial<Record<GeneratedFileKind, number>> = {
  manifest: 0,
  "web-module": 1,
  "routes-index": 2,
  "routes-domain": 3,
  schema: 4,
  guard: 5,
  "host-test": 6,
  patch: 7,
};

export interface TreeFileNode {
  readonly type: "file";
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly tier: Tier;
  readonly fileKind: GeneratedFileKind;
}

export interface TreeDirNode {
  readonly type: "dir";
  /** The directory's own path, used as the collapse key. */
  readonly path: string;
  readonly name: string;
  readonly depth: number;
  readonly tier: Tier;
  /** Files at or below this directory. The row shows it, so a collapsed
   * directory still says how much it is hiding. */
  readonly fileCount: number;
}

export interface TreeTierNode {
  readonly type: "tier";
  readonly path: string;
  readonly depth: 0;
  readonly tier: Tier;
  readonly info: TierInfo;
  readonly fileCount: number;
}

export type TreeNode = TreeTierNode | TreeDirNode | TreeFileNode;

/** The directory prefix a tier's paths share, which the tree elides.
 *
 * Every path under `server/subapps/wc-clock/` starts with those three
 * segments, and repeating them on every row costs the width that the file
 * names need. The tier header already said where the tier lands, so the
 * rows below it show the part that differs. */
export function tierRoot(tier: Tier, paths: readonly string[]): string {
  if (paths.length === 0) return "";
  if (tier === "host-edit" || tier === "other") return "";
  const split = paths.map((path) => path.split("/"));
  const first = split[0];
  if (first === undefined) return "";
  let shared = first.length - 1; // never elide the file name itself
  for (const parts of split) {
    shared = Math.min(shared, parts.length - 1);
    for (let i = 0; i < shared; i += 1) {
      if (parts[i] !== first[i]) {
        shared = i;
        break;
      }
    }
  }
  return shared === 0 ? "" : first.slice(0, shared).join("/");
}

interface Grouped {
  readonly tier: Tier;
  readonly files: readonly GeneratedFile[];
  readonly root: string;
}

function group(files: readonly GeneratedFile[]): Grouped[] {
  const byTier = new Map<Tier, GeneratedFile[]>();
  for (const file of files) {
    const tier = classifyTier(file);
    const bucket = byTier.get(tier);
    if (bucket === undefined) byTier.set(tier, [file]);
    else bucket.push(file);
  }
  const out: Grouped[] = [];
  for (const tier of TIER_ORDER) {
    const bucket = byTier.get(tier);
    if (bucket === undefined || bucket.length === 0) continue;
    out.push({ tier, files: bucket, root: tierRoot(tier, bucket.map((f) => f.path)) });
  }
  return out;
}

function compareFiles(a: GeneratedFile, b: GeneratedFile): number {
  const rank = (RANK[a.kind] ?? 50) - (RANK[b.kind] ?? 50);
  if (rank !== 0) return rank;
  return a.path.localeCompare(b.path);
}

/** The tree, flattened to the rows that are actually visible.
 *
 * A flat list rather than a nested structure because the pane renders rows
 * and the rows are what keyboard navigation moves through. Nesting shows
 * up as `depth`, which is the only thing the renderer needs from it — and
 * a flat list means "move to the next visible row" is `index + 1` rather
 * than a tree walk that has to re-derive what is collapsed. */
export function buildTree(
  files: readonly GeneratedFile[],
  collapsed: ReadonlySet<string> = new Set(),
): TreeNode[] {
  const nodes: TreeNode[] = [];

  for (const { tier, files: tierFiles, root } of group(files)) {
    const info = TIERS[tier];
    nodes.push({ type: "tier", path: `tier:${tier}`, depth: 0, tier, info, fileCount: tierFiles.length });
    if (collapsed.has(`tier:${tier}`)) continue;

    // Relative path -> file, so directory structure is computed on the part
    // that varies rather than on the shared root.
    const relative = new Map<string, GeneratedFile>();
    for (const file of tierFiles) {
      const rel = root.length > 0 && file.path.startsWith(`${root}/`) ? file.path.slice(root.length + 1) : file.path;
      relative.set(rel, file);
    }

    // Directory file counts, computed before emission so a collapsed row
    // can state what it hides.
    const dirCounts = new Map<string, number>();
    for (const rel of relative.keys()) {
      const parts = rel.split("/");
      for (let i = 1; i < parts.length; i += 1) {
        const dir = parts.slice(0, i).join("/");
        dirCounts.set(dir, (dirCounts.get(dir) ?? 0) + 1);
      }
    }

    if (info.flat) {
      for (const file of [...tierFiles].sort(compareFiles)) {
        nodes.push({ type: "file", path: file.path, name: file.path, depth: 1, tier, fileKind: file.kind });
      }
      continue;
    }

    const sorted = [...relative.entries()].sort((a, b) => {
      // Group by directory first so a directory's files stay contiguous,
      // then apply read-first order inside it.
      const dirA = a[0].includes("/") ? a[0].slice(0, a[0].lastIndexOf("/")) : "";
      const dirB = b[0].includes("/") ? b[0].slice(0, b[0].lastIndexOf("/")) : "";
      if (dirA !== dirB) {
        // Files at the tier root come before files in subdirectories: the
        // manifest before `routes/`.
        if (dirA === "") return -1;
        if (dirB === "") return 1;
        return dirA.localeCompare(dirB);
      }
      return compareFiles(a[1], b[1]);
    });

    const openDirs = new Set<string>();
    for (const [rel, file] of sorted) {
      const parts = rel.split("/");
      const fileName = parts[parts.length - 1] ?? rel;

      let hidden = false;
      for (let i = 1; i < parts.length; i += 1) {
        const dirRel = parts.slice(0, i).join("/");
        const dirPath = root.length > 0 ? `${root}/${dirRel}` : dirRel;
        if (!openDirs.has(dirRel)) {
          openDirs.add(dirRel);
          nodes.push({
            type: "dir",
            path: dirPath,
            name: parts[i - 1] ?? dirRel,
            depth: i,
            tier,
            fileCount: dirCounts.get(dirRel) ?? 0,
          });
        }
        if (collapsed.has(dirPath)) {
          hidden = true;
          break;
        }
      }
      if (hidden) continue;

      nodes.push({
        type: "file",
        path: file.path,
        name: fileName,
        depth: parts.length,
        tier,
        fileKind: file.kind,
      });
    }
  }

  return nodes;
}

/** Visible file rows, in order — what up/down arrow keys move between.
 * Directory and tier rows are skipped: they toggle, they do not open. */
export function visibleFilePaths(nodes: readonly TreeNode[]): string[] {
  return nodes.filter((node): node is TreeFileNode => node.type === "file").map((node) => node.path);
}
