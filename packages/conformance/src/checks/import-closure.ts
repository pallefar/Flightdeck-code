/** Check 2 — what does mounting this app drag into the host?
 *
 * ⛔ THE FAILURE THIS PREVENTS. `server/subapps/registry.ts` imports every
 * manifest, so a sub-app that imports the registry back — or reaches a
 * sibling's guard "just to reuse it" — closes a loop in which loading ANY
 * sub-app loads ALL of them. The host has a test for exactly this
 * (`tests/subapps/subappImportClosure.test.ts`); a generated app that
 * breaks it turns someone else's suite red in a file the generator never
 * touched. The contract's instruction is to import from the LEAVES
 * (`../installRow.js`, `../killSwitch.js`) and never from `../registry.js`
 * or `../installRoutes.js`.
 *
 * ⭐ A CLOSURE, NOT A FILE SCAN. The rule is about what the app REACHES,
 * so the walk starts at the two doors the host opens — `manifest.ts` and
 * the web module — and follows internal imports. A forbidden import three
 * files deep is the same violation as one in the manifest, and a file
 * nothing imports cannot violate anything (it gets its own finding for
 * being dead weight instead).
 *
 * ⚠ `import type` is reported the same as a value import. It is erased at
 * runtime, so it cannot by itself pull a sibling in — but the contract
 * speaks about the STATIC closure, which is what the host's own test
 * reads, and a type edge is a coupling that becomes a value edge the first
 * time somebody deletes the word `type`. */
import type { Check } from "../check";
import { finding, type Finding } from "../finding";

export const importClosureCheck: Check = {
  name: "import-closure",
  run({ app }) {
    const out: Finding[] = [];

    for (const file of app.files) {
      if (!file.reachable) continue;
      const { scan } = file;

      for (const { ref, target } of file.imports) {
        const at = scan.positionAt(ref.offset);
        const evidence = scan.lineTextAt(ref.offset);
        const kindWord = ref.typeOnly ? "type-imports" : "imports";

        switch (target.kind) {
          case "sibling":
            out.push(
              finding(
                "FD-I001",
                file.path,
                at,
                `${kindWord} "${ref.specifier}", which resolves into the sibling sub-app "${target.siblingId}" — a sub-app's import closure must never reach another sub-app, and the host's subappImportClosure test fails on this`,
                evidence,
              ),
            );
            break;
          case "registry":
            out.push(
              finding(
                "FD-I002",
                file.path,
                at,
                `${kindWord} "${ref.specifier}" (${target.path}), which imports every manifest in SUBAPP_MANIFESTS — reaching it pulls every sibling sub-app into this file's closure; import the leaves (../installRow.js, ../killSwitch.js) instead`,
                evidence,
              ),
            );
            break;
          case "missing-internal":
            out.push(
              finding(
                "FD-I003",
                file.path,
                at,
                `${kindWord} "${ref.specifier}", which resolves to ${target.path} — a file this candidate does not contain, so the host would not compile once this is written`,
                evidence,
              ),
            );
            break;
          case "cross-tier":
            out.push(
              finding(
                "FD-I004",
                file.path,
                at,
                `${kindWord} "${ref.specifier}", crossing the server/web tier line — the two halves of a sub-app are built separately and only meet over HTTP at the route prefix`,
                evidence,
              ),
            );
            break;
          case "unresolvable":
            out.push(
              finding(
                "FD-I003",
                file.path,
                at,
                `${kindWord} "${ref.specifier}", which climbs above the repository root and resolves to nothing`,
                evidence,
              ),
            );
            break;
          default:
            break;
        }
      }
    }

    for (const file of app.files) {
      if (file.reachable || file.role === "test" || file.role === "patch") continue;
      out.push(
        finding(
          "FD-I005",
          file.path,
          { line: 1, column: 1 },
          `nothing in this sub-app imports ${file.path} — it would be written into the host repo and never loaded, since the host reaches a sub-app only through ${app.roots.join(" and ")}`,
        ),
      );
    }

    return out;
  },
};
