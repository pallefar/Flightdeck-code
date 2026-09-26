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

Since OS-04 (host 42b0f308) the host's `SubAppManifest` also declares an optional
`contributions` bundle — `/api/state` flags, background work handed the raw `db` and
`root`, fixed connector rows, a contract's signing state — which the host acts on at
boot (`assertContributionsUnambiguous`) and at runtime. **A generated mini-app declares
none.** The gate refuses it in any spelling (FD-M008), the typecheck stub types it
`never`, and the mount probe refuses a manifest object that carries it at runtime.

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

---

# Corrections — verified against the checkout, 2026-09-20

The sections above understated the mount. Everything below was measured in
`pallefar/project-contract`, not inferred. Where it contradicts anything above,
**this section wins**.

## 7. Mounting is a THREE-file host edit, not "import + push"

`registry.ts` is necessary and not sufficient. A sub-app that ships any
user-facing string also requires:

| File | Edit |
|---|---|
| `flightdeck/server/subapps/registry.ts` | import + push into `SUBAPP_MANIFESTS` |
| `flightdeck/web/src/i18n.ts` | a static `import { <id>Dict } from "./subapps/<id>/i18n.js"` **and** a spread into `DICT` |
| `flightdeck/tests/subapps/i18nSplit.test.ts` | update the frozen key counts |

`import.meta.glob` covers the web *module* but **not** i18n — that is a hand-written
static import list. Missing it means the dictionary silently falls back to English
(decision D-07), which is a wrong-output bug, not a crash.

## 8. The i18n fence is exact equality, and it will bite

`flightdeck/tests/subapps/i18nSplit.test.ts` freezes the total dictionary size
and each sub-app's key count as integer constants, and asserts them with `toBe`.

Measured at host `9d25a078` (on `integration/unified-2026-09-22`; the commit the
live Mac checkout ran on 2026-09-24):

| Line | Host source |
|---|---|
| 978 | `const TOTAL_KEYS = 4582;` |
| 1113 | `const ADVANTAGE_KEYS = 600;` |
| 1158 | `const DOCUSIGN_KEYS = 429;` |
| 1213 | `const MAPS_AND_ASSISTANT_KEYS = 760;` |
| 1222 | `const KNOWLEDGE_GUARDIAN_KEYS = 8;` |
| 1223 | `const POA_KEYS = 50;` |
| 1224 | `const DOCPREVIEW_KEYS = 4;` |
| 1230 | `expect(Object.keys(DICT).length).toBe(TOTAL_KEYS);` |

**These numbers move** with every key any sub-app or host page adds. The tip of
`integration/unified-2026-09-22` had already moved `TOTAL_KEYS` again by the time
this table was written. Re-read the host file before you rely on a number. The
host file's own notes say each count is **re-counted from the live dictionary in
a separate process, never derived by addition**. `packages/conformance/src/contract-doc-drift.test.ts`
checks this table against `git show 9d25a078:…`. It also checks that the live
host still freezes each named count as an integer constant and asserts the
total with `toBe`. Since host D-044 (deck-i18n-seam) `TOTAL_KEYS` pins every
key except `presentation-studio.*`, which is counted through its import, so
the live total reads `toBe(TOTAL_KEYS + PRESENTATION_STUDIO_KEYS)`.

The counts are **exact**, not `toBeGreaterThan`. So a generated sub-app that
ships even one i18n key turns a host test red until the counts are updated in
the same change. The generator must emit that count delta, or emit no i18n at
all.

The floor is legitimately i18n-free: `shell-reference` is **three files**
(`server/subapps/shell-reference/{manifest.ts,routes.ts}` and
`web/src/subapps/shell-reference/index.tsx`) and ships no dictionary.

## 9. CSS goes in the shared theme.css, never a new stylesheet

Measured: `find web/src/subapps -name '*.css'` returns **zero**. Every sub-app's CSS
lives in the shared `web/src/theme.css` inside a banner-delimited region — e.g.
`/* ═══ End Phase 28 Plan 04 DocuSign block ═══ */` at line 1373,
`/* ═══ End APP-F01 stage C Flightdeck Maps block ═══ */` at 3818.

So "the generated app ships its own stylesheet" is wrong for this codebase, and a
conformance rule written against a generated stylesheet is checking a file that will
never exist. `tests/keyboardOperability.test.tsx:290` reads **only** `theme.css` and
cannot see a generated file at all.

## 10. Tests live in the sub-app's own folder

`tests/subapps/subappManifest.test.ts` carries a **G3 layout fence**: a sub-app's tests
belong in `tests/subapps/<id>/`, never the flat `tests/` root. The vitest glob is
already recursive, so nothing needs wiring — only placing. For scale: `tests/subapps/advantage/`
holds 38 files.

## 11. Prior art — read it before writing a generator

`flightdeck/scripts/scaffold-parity.ts` and `scaffold-course.ts` (`npm run scaffold:parity`,
`scaffold:course`) are **existing deterministic manifest-to-file generators** in this
codebase. They already encode the house doctrine. Study them before inventing a
generation strategy.

### The host's own sub-app SDK (Phase H, host `981efc19`)

Since 2026-09-20 the host publishes an authoring kit for sub-apps. It is the
nearest prior art to Studio, and it overlaps with Studio's own conformance gate:

| Piece | Host path | What it does |
|---|---|---|
| Contract | `docs/SUBAPP-SDK.md` | the authoring contract, measured against the five shipped sub-apps |
| Generator | `flightdeck/scripts/scaffold-subapp.ts` (`npm run scaffold:subapp -- --id <slug>`) | writes the six files a sub-app owns, prints the host edits it will not make (registry, `web/src/i18n.ts`, `i18nSplit.test.ts`), then runs the kit on what it wrote |
| Conformance kit | `flightdeck/server/subapps/conformance.ts` | `runSubAppConformance`: 19 checks over a manifest and its files on disk, pure, no vitest import |
| Behavioural harness | `flightdeck/tests/subapps/conformanceHarness.ts` | boots a real server with the principals a role fence needs |
| Platform test | `flightdeck/tests/subapps/sdkConformance.test.ts` | runs the kit over every shipped sub-app, with controls proving each check can fail |

What that means for Studio, stated as fact and not as a plan:

- The host kit and Studio's gate (`packages/conformance`) are **separate
  implementations of overlapping rules**. Studio does not call the host kit, and
  nothing checks that the two agree. A generated sub-app mounted into the host
  meets the host kit through `sdkConformance.test.ts` in the host suite, which
  `npm run mount` and the host gate run.
- `scaffold:subapp` deliberately does not edit `registry.ts`. On Studio's side
  the equivalent is codegen's registry patch
  (`packages/codegen/src/registry-patch.ts`). `mount-in-host.sh` and
  `promote.sh` apply it only inside their sandbox. Codegen never writes it into
  the host.

## 12. The contamination lesson, already learned here

`docs/advantage/gauntlet/` holds a previously built blind-round rig
(`blind-round.mjs`, `piece-round.mjs`, `fix-round.mjs`, `render.mjs`) and a postmortem,
`CONTAMINATED-ROUND-1-WHY.md`:

> An opposition that argues your case tests nothing.

Round 1 was voided because the agent building the *opposition* was handed the same
brief as our own builder, so the "rival" reproduced our slogans and our product name.
The fix was a separate `barBrief` + `barScope` carrying none of our constraints, with
the script throwing rather than falling back to the builder's brief.

Any judging harness built here inherits that rule.

---

## Addendum — the standalone half

Every generated sub-app also runs outside Flightdeck OS. Full detail in
[`STANDALONE.md`](./STANDALONE.md); what belongs in the *contract* document is
the part that constrains the host:

- **The harness is never written to a host checkout.** Two of its shims sit at
  host paths (`server/subapps/registry.ts`, `server/subapps/types.ts`).
  `planWrites` defaults to the host target and drops them; `target: "both"` is
  refused by name.
- **The mount is unchanged.** `registry.ts` is still the only host edit codegen
  asks for, and a Flightdeck checkout still receives exactly the documented
  file set — the host-half assertions in `generate.test.ts` and
  `mini-app.test.ts` pin that, and the mount script measures it.
- **`ADM-020` stays as it is.** The host's admission rule already refuses a
  bundle carrying the harness, which is correct; the Studio bundle therefore
  carries the host half only.

The coupling the harness has to supply is the honest inventory of what an
emitted sub-app reaches for, and it is longer than reading the code suggests:
`../registry` (web), `../../types.js`, `../../capabilities.js`,
`../../lib/flightdeckAudit.js`, `../installRow.js`, `../killSwitch.js`,
`../../project/types.js`, `../../workspace/types.js`, `./registry.js` (server)
and `../../db.js`. A test derives that list from the emitted imports rather
than restating it, so this paragraph cannot go stale without failing.
