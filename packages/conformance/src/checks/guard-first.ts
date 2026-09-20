/** Check 4 — does every handler check enable-state BEFORE it does
 * anything?
 *
 * ⛔ WHY "FIRST" AND NOT "SOMEWHERE". The shell's manifest-derived RBAC
 * rule enforces ROLES ONLY. Nothing in the host checks enable-state for a
 * sub-app's own routes — so a handler that forgets `require<Id>Enabled` is
 * a handler that answers with the kill switch off, for a workspace that
 * never installed the app. And a handler that calls it on line four, after
 * parsing the body and reading a row, has already done the work by the
 * time it refuses.
 *
 * ⭐ POSITIONAL, SO IT IS CHECKED POSITIONALLY. The check finds the offset
 * of the guard call inside each handler body and the offset of the first
 * thing that parses, reads or writes, and compares them. That is why
 * `handlers.ts` goes to the trouble of finding body boundaries: "the file
 * mentions the guard" is a rule one handler out of four can satisfy on
 * behalf of the others.
 *
 * ⚠ AND WHEN IT CANNOT TELL, IT REFUSES (FD-G003). A registration the
 * extractor cannot read a body out of is not given the benefit of the
 * doubt. The gate's promise is that a passing app was PROVEN safe, and an
 * unread handler was not. */
import type { Check } from "../check";
import { guardFunctionName } from "../derive";
import { CANDIDATE_SCOPE, NO_POSITION, finding, type Finding } from "../finding";
import { extractRouteHandlers } from "../handlers";
import { mountedServerFiles } from "../analyze";

/** Everything a handler must not do before it knows it is allowed to run.
 * Each entry is CODE text — the scan blanked strings and comments, so an
 * error message mentioning `req.body` does not trip this. */
const WORK_BEFORE_GUARD: readonly (readonly [string, string])[] = [
  ["req.body", "reads the request body"],
  ["request.body", "reads the request body"],
  ["req.params", "reads the path parameters"],
  ["request.params", "reads the path parameters"],
  ["req.query", "reads the query string"],
  ["request.query", "reads the query string"],
  [".safeParse(", "parses input with Zod"],
  [".parse(", "parses input with Zod"],
  ["capabilitiesFor(", "resolves a capability adapter"],
  ["auditAppend(", "writes an audit event"],
  ["appendFlightdeckAudit(", "writes an audit event"],
  [".db", "touches the workspace database"],
  [".exec(", "executes SQL"],
  [".prepare(", "prepares a SQL statement"],
  ["fetch(", "makes a network call"],
];

export const guardFirstCheck: Check = {
  name: "guard-first",
  run({ app }) {
    const out: Finding[] = [];
    const guard = guardFunctionName(app.id);
    const serverFiles = mountedServerFiles(app);
    let handlerCount = 0;
    let routeModuleCount = 0;

    for (const file of serverFiles) {
      if (file.role === "route") routeModuleCount++;
      const { scan } = file;
      const { handlers, unverifiable } = extractRouteHandlers(scan);
      handlerCount += handlers.length;

      for (const registration of unverifiable) {
        out.push(
          finding("FD-G003", file.path, scan.positionAt(registration.offset), registration.reason, scan.lineTextAt(registration.offset)),
        );
      }

      if (handlers.length > 0) {
        const importsGuard = file.imports.some(
          ({ ref, target }) => target.kind === "internal" && !ref.typeOnly && importClause(scan.code, ref.offset).includes(guard),
        );
        const definesGuard = new RegExp(`function\\s+${guard}\\b`).test(scan.skeleton);
        if (!importsGuard && !definesGuard && scan.skeleton.includes(guard)) {
          out.push(
            finding(
              "FD-G004",
              file.path,
              scan.positionAt(scan.skeleton.indexOf(guard)),
              `calls ${guard} without importing it from this sub-app's own guard.ts — whatever it resolves to at runtime is not the three-layer enable check`,
              scan.lineTextAt(scan.skeleton.indexOf(guard)),
            ),
          );
        }
      }

      for (const handler of handlers) {
        const guardAt = handler.body.indexOf(guard);
        const label = `${handler.method} ${handler.routePath}`;

        if (guardAt === -1) {
          out.push(
            finding(
              "FD-G001",
              file.path,
              scan.positionAt(handler.registrationOffset),
              `handler ${label} never calls ${guard} — the shell enforces roles only, so this route answers even with ${app.id} disabled or never installed for the workspace`,
              scan.lineTextAt(handler.registrationOffset),
            ),
          );
          continue;
        }

        let earliest: { at: number; token: string; description: string } | null = null;
        for (const [token, description] of WORK_BEFORE_GUARD) {
          const at = handler.body.indexOf(token);
          if (at === -1 || at >= guardAt) continue;
          if (earliest === null || at < earliest.at) earliest = { at, token, description };
        }

        if (earliest !== null) {
          const offset = handler.bodyStart + 1 + earliest.at;
          out.push(
            finding(
              "FD-G002",
              file.path,
              scan.positionAt(offset),
              `handler ${label} ${earliest.description} (\`${earliest.token}\`) before calling ${guard} — the guard has to be the first statement, or the work happens for a workspace that never enabled this app`,
              scan.lineTextAt(offset),
            ),
          );
        }
      }
    }

    if (handlerCount === 0 && routeModuleCount > 0) {
      const routeFile = serverFiles.find((file) => file.role === "route");
      out.push(
        finding(
          "FD-G003",
          routeFile?.path ?? CANDIDATE_SCOPE,
          NO_POSITION,
          `no route handler could be identified anywhere in this sub-app, so the guard-first rule could not be proved for a single route — an unprovable app is refused rather than assumed safe`,
        ),
      );
    }

    return out;
  },
};

/** The `import { ... }` clause containing the specifier at `offset`, so a
 * guard call can be matched to the import that supplies it. */
function importClause(code: string, specifierOffset: number): string {
  const from = code.lastIndexOf("import", specifierOffset);
  return from === -1 ? "" : code.slice(from, specifierOffset);
}
