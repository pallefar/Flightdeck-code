# The Flightdeck OS sub-app contract

Ground truth for everything Studio generates. Sourced from `pallefar/project-contract`
at `flightdeck/server/subapps/` (host version 5.0.0). If this document and that repo
disagree, **that repo wins** — re-derive, do not patch this by hand.

## 1. What a sub-app is

A sub-app is **code-declared, not installed**. `server/subapps/registry.ts` holds a
hand-maintained `SUBAPP_MANIFESTS` array:

> "Adding a sub-app is exactly as heavy as adding a route file: import + push — never a
> directory scan or hot-install path (explicitly out of scope, APP-F02)."

So Studio's output is **source files plus an edit to `registry.ts`**. There is no
hot-install path to target, and inventing one is out of scope.

## 2. The manifest (`subAppManifestSchema`)

| Field | Rule |
|---|---|
| `id` | `/^[a-z0-9][a-z0-9-]*$/`. **Locked once shipped** — derives the env var, nav path and table prefix. |
| `label` | non-empty, literal English, rendered verbatim. Not an i18n key. |
| `version` | string |
| `minHostVersion` | must be `<= 5.0.0` or the server refuses to boot |
| `icon` | non-empty string; an emoji in practice |
| `navSection` | exactly one of `Overview` \| `Contract pipeline` \| `Ops & insight` \| `Admin` \| `System apps` — exact string match against the host's `UI_NAV_SECTIONS` |
| `routePrefix` | `/^\/api\/apps\/[a-z0-9-]+$/` — one segment, no sub-path |
| `webModuleId` | directory name under `web/src/subapps/` |
| `capabilities` | subset of `["read:contracts", "write:inbox-proposal"]`. `[]` is valid and common. |
| `visibleToRoles` | **required, non-empty**, from `hr_preparer, hr_reviewer, wc_liaison, legal, admin` |
| `settingsPanel` | optional, exactly one tier |
| `widgets` | optional; must NOT feed RBAC derivation |

Plus two non-Zod function members: `initSchema(db)` and `registerRoutes(app, ctx)`.

Validation is **fail-loud**: `loadValidatedManifests` throws on the first violation. One
malformed generated manifest takes the whole server down at boot, by design. This is why
the conformance gate exists.

## 3. Everything derived from `id`

```
SUBAPP_<ID_UPPER_UNDERSCORED>_ENABLED   // kill switch, must equal the string "true"
/console/apps/<id>                       // nav path
subapp_<id_with_underscores>_*           // every table this sub-app creates
web/src/subapps/<webModuleId>/index.tsx  // default-exports { Page }
```

## 4. Enablement is a three-layer AND

```
enabled = SUBAPP_<ID>_ENABLED === "true"
       && ceiling row ('*') enabled
       && this project's row enabled
```

Fail-closed, default OFF. `grantedScopes` come **only** from the ceiling row — a project
can turn a sub-app off, never widen consent. Consent is all-or-nothing; there is no
partial-grant UI.

## 5. Rules a generated sub-app must never break

1. **Guard first.** The shell enforces roles only — it never enforces enable-state for a
   sub-app's own routes. Every handler calls `require<Id>Enabled(req)` before parsing a
   body or touching anything, and maps the refusal to 403.
2. **Never cache a boolean.** Kill switch, install row and granted scopes are re-read on
   every call. No module-level `process.env` capture.
3. **No capability escape.** A route may not import `node:fs`, a DB driver, or a host
   reader module to reach contracts/proposals/audit. Only `ctx.capabilitiesFor(id)`.
4. **No sibling imports.** A sub-app's static import closure must never reach another
   sub-app. Import from the leaves (`../installRow.js`, `../killSwitch.js`), never
   `../registry.js` or `../installRoutes.js`.
5. **Never construct an audit hash.** Only `appendFlightdeckAudit()` / `caps.auditAppend()`.
6. **Zod at every HTTP boundary**, `.strict()` where an unknown key would be a silent
   widening. Semantic refusals belong in the service layer, not the schema.
7. **Propose, don't mutate.** No mini-app may auto-advance or resolve a gated or statutory
   step. Proposals are confined to `memory/proposals/`.
8. **Audit names fields, never PII values.** No address, DOB or salary value in an event.
9. **Least privilege.** Declare the narrowest `capabilities` — the array *is* the human
   consent screen.

## 6. The minimum viable sub-app

`shell-reference` is two files: `manifest.ts` and `routes.ts`. That is the floor Studio
generates to. `docusign` (~40 files, `routes/` + `service/` split) is the ceiling it
should grow toward for anything with real domain logic.
