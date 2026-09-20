/** Check 7 — the parts of "it mounts" that are not about one file.
 *
 * The other six checks ask whether the code is safe. These ask whether it
 * is COMPLETE: a sub-app can satisfy every rule in the contract and still
 * do nothing, because a sub-app is code-declared and the code that
 * declares it lives in files the generator does not own.
 *
 *   • FD-X001 — `registry.ts` has to import the manifest and push it into
 *     SUBAPP_MANIFESTS. Without that edit the app is source in a
 *     repository and nothing more. It is a WARNING, not a refusal, because
 *     the edit legitimately travels as a patch a human applies, and the
 *     gate does not get to insist on how it is delivered.
 *   • FD-X002/X003 — the web loader globs `web/src/subapps/<id>/index.tsx`
 *     and lazy-mounts its default export's `.Page`. A nav entry whose page
 *     is missing is a dead link in someone's console.
 *   • FD-X004 — a schema file whose DDL is never wired into `initSchema`
 *     is the subtlest failure in this file: everything compiles, the app
 *     mounts, the routes answer, and every query fails at runtime against
 *     a table nothing created.
 *   • FD-X005 — i18n is the documented trap (contract §7, §8). The host's
 *     dictionary is a hand-written static import list, and
 *     `i18nSplit.test.ts` freezes EXACT key counts. Shipping one key
 *     silently falls back to English and turns a host test red. A warning,
 *     because it is a wrong-output bug rather than a crash. */
import type { Check } from "../check";
import { webDir } from "../derive";
import { CANDIDATE_SCOPE, NO_POSITION, finding, type Finding } from "../finding";
import { mountedServerFiles } from "../analyze";

function lastExportOffset(code: string, fallback: number): number {
  const at = code.lastIndexOf("export ");
  return at === -1 ? fallback : at;
}

export const mountCheck: Check = {
  name: "mount",
  run({ app }) {
    const out: Finding[] = [];
    const constName = app.manifest?.constName ?? null;

    // ── The registry edit. ──
    const declaresApp = app.files.some(
      (file) =>
        file.path !== app.manifestPath &&
        file.scan.text.includes("SUBAPP_MANIFESTS") &&
        (constName === null || file.scan.text.includes(constName)),
    );
    if (!declaresApp) {
      out.push(
        finding(
          "FD-X001",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `nothing in this candidate edits server/subapps/registry.ts — a sub-app is code-declared, so until ${constName ?? "the manifest"} is imported there and pushed into SUBAPP_MANIFESTS, none of these files are loaded by anything`,
        ),
      );
    }

    // ── The web module. ──
    const webIndex = app.files.find((file) => file.role === "web-module");
    if (webIndex === undefined) {
      out.push(
        finding(
          "FD-X002",
          CANDIDATE_SCOPE,
          NO_POSITION,
          `no ${webDir(app.webModuleId)}/index.tsx — the manifest's webModuleId names a directory the web loader globs, and a nav entry whose module is missing is a dead link in the console`,
        ),
      );
    } else {
      const code = webIndex.scan.skeleton;
      const defaultAt = code.indexOf("export default");
      // Anchor on the export the loader is looking for, or — when there is
      // none — on the last export there IS, which is what a reader has to
      // change.
      const at = defaultAt !== -1 ? defaultAt : lastExportOffset(code, webIndex.scan.firstMeaningfulOffset());
      const position = webIndex.scan.positionAt(at);
      const evidence = webIndex.scan.lineTextAt(at);
      if (defaultAt === -1) {
        out.push(
          finding(
            "FD-X003",
            webIndex.path,
            position,
            "the web module has no default export — the loader lazy-mounts the default export's `.Page`, so a named export alone renders nothing",
            evidence,
          ),
        );
      } else if (!/\bPage\b/.test(code)) {
        out.push(
          finding(
            "FD-X003",
            webIndex.path,
            position,
            "the web module's default export carries no `Page` — that is the member the host mounts",
            evidence,
          ),
        );
      }
    }

    // ── DDL that no one runs. ──
    const ddlFile = mountedServerFiles(app).find((file) =>
      file.scan.strings.some((literal) => /\bCREATE\s+TABLE\b/i.test(literal.value)),
    );
    const initSchema = app.manifest?.memberAt("initSchema") ?? null;
    if (ddlFile !== undefined && initSchema !== null && isNoOp(initSchema.valueText)) {
      const offset = initSchema.valueOffset;
      const scan = app.fileAt(app.manifestPath)?.scan ?? null;
      out.push(
        finding(
          "FD-X004",
          app.manifestPath,
          scan?.positionAt(offset) ?? NO_POSITION,
          `initSchema is \`${initSchema.valueText.replace(/\s+/g, " ")}\` while ${ddlFile.path} carries CREATE TABLE statements — nothing ever runs that DDL, so the app mounts, the routes answer, and every query fails against a table that was never created`,
          scan?.lineTextAt(offset),
        ),
      );
    }

    // ── i18n, the documented trap. ──
    for (const file of app.files) {
      if (!/\/i18n\.tsx?$/.test(file.path)) continue;
      const at = file.scan.firstMeaningfulOffset();
      out.push(
        finding(
          "FD-X005",
          file.path,
          file.scan.positionAt(at),
          "this sub-app ships a dictionary, which needs a hand-written static import plus a spread in web/src/i18n.ts AND an update to the EXACT frozen key counts in tests/subapps/i18nSplit.test.ts — without both, the dictionary silently falls back to English and a host test goes red",
          file.scan.lineTextAt(at),
        ),
      );
    }

    return out;
  },
};

function isNoOp(text: string): boolean {
  return /=>\s*(\{\s*\}|undefined|null|void 0)\s*$/.test(text.trim());
}
