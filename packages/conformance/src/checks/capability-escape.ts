/** Check 3 — can this code reach anything it was not granted?
 *
 * ⛔ THE RULE. A mounted sub-app module may not import `node:fs`, a
 * database driver, or a host module that reads contracts, proposals or the
 * audit log. Everything it is allowed to touch arrives through
 * `ctx.capabilitiesFor(id)`, whose scopes are exactly the array in the
 * manifest — and that array IS the consent screen a human approved. An
 * import that goes around it makes the consent screen a lie, which is a
 * worse failure than a crash because nothing about it is visible at
 * runtime.
 *
 * ⭐ ALLOWLIST, NOT BLOCKLIST, WHERE IT COUNTS. `node:fs` and
 * `better-sqlite3` are named so the message can say WHY they are refused,
 * but the rule that actually holds the line is FD-C003: a host module
 * that is not one of the nine leaves in `resolve.ts` is refused whether or
 * not anyone anticipated it. A blocklist is a list of the escapes somebody
 * already thought of; the next one is never on it.
 *
 * FD-C005 is the same discipline pointed at npm: a generated sub-app
 * compiles inside the HOST's `node_modules`, so importing a package the
 * host does not carry is not a style question, it is an app that does not
 * build. */
import type { Check } from "../check";
import { finding, type Finding } from "../finding";

/** Bare specifiers a mounted sub-app module may use, because the host
 * already depends on all of them. */
const ALLOWED_PACKAGES = new Set(["fastify", "zod", "react", "react-dom", "react/jsx-runtime", "react-dom/client", "vitest"]);

const NODE_BUILTINS = new Set([
  "assert", "async_hooks", "buffer", "child_process", "cluster", "console", "constants", "crypto",
  "dgram", "diagnostics_channel", "dns", "domain", "events", "fs", "http", "http2", "https",
  "inspector", "module", "net", "os", "path", "perf_hooks", "process", "punycode", "querystring",
  "readline", "repl", "stream", "string_decoder", "sys", "timers", "tls", "trace_events", "tty",
  "url", "util", "v8", "vm", "wasi", "worker_threads", "zlib",
]);

const DB_DRIVERS = new Set([
  "better-sqlite3", "sqlite3", "sqlite", "node:sqlite", "@libsql/client", "libsql",
  "pg", "pg-promise", "postgres", "mysql", "mysql2", "mariadb",
  "knex", "drizzle-orm", "kysely", "sequelize", "typeorm", "prisma", "@prisma/client",
  "mongodb", "mongoose", "redis", "ioredis",
]);

const AUDIT_MODULE = "server/lib/flightdeckAudit";
const AUDIT_FUNCTION = "appendFlightdeckAudit";

function packageRoot(specifier: string): string {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
}

export const capabilityEscapeCheck: Check = {
  name: "capability-escape",
  run({ app }) {
    const out: Finding[] = [];

    for (const file of app.files) {
      if (!file.reachable) continue;
      const { scan } = file;

      for (const { ref, target } of file.imports) {
        const at = scan.positionAt(ref.offset);
        const evidence = scan.lineTextAt(ref.offset);

        if (target.kind === "package") {
          const bare = target.name.startsWith("node:") ? target.name.slice(5) : target.name;
          if (DB_DRIVERS.has(target.name) || DB_DRIVERS.has(packageRoot(target.name))) {
            out.push(
              finding(
                "FD-C002",
                file.path,
                at,
                `imports the database driver "${target.name}" — a sub-app never opens its own connection; its tables are reached through the workspace handle the host passes in, and a second connection sees a different database`,
                evidence,
              ),
            );
            continue;
          }
          if (NODE_BUILTINS.has(bare)) {
            out.push(
              finding(
                "FD-C001",
                file.path,
                at,
                `imports the node builtin "${target.name}" — a mounted sub-app module has the host process's full filesystem and network access, and "${bare}" is how it escapes the capabilities its manifest declares`,
                evidence,
              ),
            );
            continue;
          }
          if (!ALLOWED_PACKAGES.has(target.name) && !ALLOWED_PACKAGES.has(packageRoot(target.name))) {
            out.push(
              finding(
                "FD-C005",
                file.path,
                at,
                `imports "${target.name}", a package the host does not carry — a sub-app compiles inside the host's node_modules and cannot add a dependency, so this does not build once it is written`,
                evidence,
              ),
            );
          }
          continue;
        }

        if (target.kind === "host-leaf" && target.path === AUDIT_MODULE && file.role === "route") {
          out.push(
            finding(
              "FD-C004",
              file.path,
              at,
              `a route module imports ${AUDIT_FUNCTION} directly — routes append audit only through ctx.capabilitiesFor(...).auditAppend, which is the call that records WHICH sub-app acted; the raw appender belongs to guard.ts alone`,
              evidence,
            ),
          );
          continue;
        }

        if (target.kind === "host-other") {
          out.push(
            finding(
              "FD-C003",
              file.path,
              at,
              `imports the host module ${target.path}, which is not one of the leaf modules a sub-app may reach — contracts, proposals and the audit log are reached through ctx.capabilitiesFor(id) and nothing else, because that call is what the declared capabilities gate`,
              evidence,
            ),
          );
        }
      }

      // Reaching the raw audit appender without importing it — re-exported
      // through a local helper, or pulled off a namespace import.
      if (file.role === "route") {
        const importedAudit = file.imports.some(({ target }) => target.kind === "host-leaf" && target.path === AUDIT_MODULE);
        if (!importedAudit) {
          const at = scan.skeleton.indexOf(`${AUDIT_FUNCTION}(`);
          if (at !== -1) {
            out.push(
              finding(
                "FD-C004",
                file.path,
                scan.positionAt(at),
                `a route module calls ${AUDIT_FUNCTION} — routes append audit only through ctx.capabilitiesFor(...).auditAppend, and an event written any other way is not attributed to this sub-app`,
                scan.lineTextAt(at),
              ),
            );
          }
        }
      }
    }

    return out;
  },
};
