/** `manifest.ts` — the code-declared catalog entry.
 *
 * Emitted shape is byte-for-byte the shape of the four hand-written
 * manifests in the host (`shell-reference`, `docusign`, `maps`,
 * `advantage`): a banner, the `SubAppManifest` type-only import, the two
 * local imports the function members call, and one exported const whose
 * DATA fields are all JSON-compatible literals, one per line.
 *
 * ⭐ That last constraint is load-bearing, not cosmetic.
 * `testing/readEmittedManifest.ts` reads the data fields back OUT of this
 * text and parses them against `manifest-rules.ts`. So the test does not
 * check a JavaScript object codegen happens to also hold — it checks THE
 * FILE, the way `loadValidatedManifests` will at boot. A field emitted as
 * a computed expression would still compile and would silently drop out of
 * that check, which is why every data field here is a literal. */
import { banner, joinLines, str, tsObject, tsStringArray, type ObjectField } from "../emit";
import type { SubAppPlan } from "../plan";

export function emitManifest(plan: SubAppPlan): string {
  // Exactly the condition `generate.ts` uses to decide whether a
  // `schema.ts` exists at all. Two conditions that must agree, written the
  // same way in both places: a manifest importing `./schema.js` when no
  // such file shipped is a sub-app that takes the host down at boot.
  const hasTables = plan.profile === "table-backed" && plan.tables.length > 0;
  const m = plan.manifestData;

  const fields: ObjectField[] = [
    {
      key: "id",
      value: str(m.id),
      comment: [
        `LOCKED from this point forward (D-04, costly reversibility): the kill-switch env var \`${plan.envVar}\` is DERIVED from this id (killSwitch.ts), as are the \`${plan.navPath}\` nav path and the \`${plan.tablePrefix}\` table prefix that \`missingSubappTables\` looks for. Renaming it later is an operational break, not a refactor.`,
      ],
    },
    {
      key: "label",
      value: str(m.label),
      comment: ["Literal English — nav, Catalog and Settings render this field verbatim. It is NOT an i18n key."],
    },
    { key: "version", value: str(m.version) },
    {
      key: "minHostVersion",
      value: str(m.minHostVersion),
      comment: [
        "Pinned to the sub-app platform's own version line (registry.ts's HOST_VERSION), not the OS version: `assertHostVersionCompatible` REFUSES TO BOOT a manifest that asks for a newer host.",
      ],
    },
    { key: "icon", value: str(m.icon) },
    {
      key: "navSection",
      value: str(m.navSection),
      comment: ["Exact string match against the host's UI_NAV_SECTIONS. A section the shell does not know does not error — it silently forms an accordion group of its own."],
    },
    { key: "routePrefix", value: str(m.routePrefix) },
    { key: "webModuleId", value: str(m.webModuleId) },
    {
      key: "capabilities",
      value: tsStringArray(m.capabilities),
      comment: [
        m.capabilities.length === 0
          ? "Declared empty deliberately: no route in this sub-app reads contracts or writes a proposal. `caps.auditAppend` is ungated, so an audit-appending sub-app still needs no scope."
          : "Least privilege (contract rule 9): this array IS the human consent screen, and every scope in it has a route that calls it — codegen refuses to emit one that does not.",
      ],
    },
    {
      key: "visibleToRoles",
      value: tsStringArray(m.visibleToRoles),
      comment: [
        "Required and non-empty. `deriveSubAppExtraRules` turns this into ONE `method:\"*\"` RBAC rule over the whole route prefix — it cannot express \"reviewers read, admins write\"; that needs an explicit `RBAC_RULES` entry plus an in-handler role check.",
      ],
    },
  ];

  if (m.settingsPanel) {
    fields.push({
      key: "settingsPanel",
      value: `{ tier: ${str(m.settingsPanel.tier)}, webComponentId: ${str(m.settingsPanel.webComponentId)}, label: ${str(m.settingsPanel.label)} }`,
      comment: [
        `\`webComponentId\` must be the DIRECTORY NAME the web loader globs (\`web/src/subapps/${m.webModuleId}/SettingsPanel.tsx\`); a decorative value fails closed and contributes no panel at all. Codegen derives it from webModuleId so a spec cannot get it wrong.`,
      ],
    });
  }

  fields.push(
    hasTables
      ? {
          key: "initSchema",
          value: `(db) => ${plan.names.applySchemaFn}(db)`,
          comment: [
            'NOT the mini-app shape. This spec asked for profile "table-backed", so this member applies real DDL on every boot for every workspace. `shell-reference`, the host\'s documented floor and the shape a converted workflow targets, carries `initSchema: () => {}` instead.',
          ],
        }
      : {
          key: "initSchema",
          value: "() => {}",
          comment: [
            "A mini-app stores nothing of its own — byte-identical to `shell-reference/manifest.ts`, the host's only database-free sub-app. There is no schema.ts beside this file and no migration to run: what this app leaves behind is a proposal under memory/proposals/ that a human resolves (contract rule 7).",
          ],
        },
    { key: "registerRoutes", value: `(app, ctx) => ${plan.names.registerRoutesFn}(app, ctx)` },
  );

  return joinLines([
    banner([
      `${plan.label} sub-app manifest — GENERATED by Flightdeck Studio from a MiniAppSpec. Mirrors the shape of the host's hand-written manifests exactly.`,
      "",
      "A sub-app is code-declared, not installed: this file does nothing until `server/subapps/registry.ts` imports it and pushes it into SUBAPP_MANIFESTS. That edit ships beside this file as `registry.patch`; there is no hot-install path and inventing one is out of scope (APP-F02).",
      "",
      `Regenerating is safe: every byte below is derived from the spec. Hand-editing is not — the next generation overwrites it. Change the spec, or adopt the file and delete this line.`,
    ]),
    `import type { SubAppManifest } from "../types.js";`,
    hasTables ? `import { ${plan.names.applySchemaFn} } from "./schema.js";` : null,
    `import { ${plan.names.registerRoutesFn} } from "./routes/index.js";`,
    "",
    `export const ${plan.names.manifestConst}: SubAppManifest = ${tsObject(fields)};`,
    "",
  ]);
}
