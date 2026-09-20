/** Flightdeck Studio — the sub-app manifest.
 *
 * ⭐ STUDIO RUNS INSIDE FLIGHTDECK OS. It is not a standalone tool that happens
 * to target Flightdeck: it mounts at `/api/apps/studio` like any other sub-app,
 * under the same kill switch, the same install row and the same consent screen
 * as DocuSign or Maps. The CLI half of this product is the thing a human runs to
 * APPLY an approved proposal — never the thing that generates one.
 *
 * ⛔ WHAT THE CAPABILITY ARRAY MEANS HERE, AND WHY IT IS ONE ENTRY.
 * `capabilities` IS the human consent screen (contract §5.9), so it is declared
 * at exactly what Studio does and not one scope wider:
 *
 *   write:inbox-proposal  — Studio writes ONE file per approved conversion,
 *                           under `memory/proposals/`, and reads back the names
 *                           of the files it itself wrote so a second identical
 *                           conversion is a no-op. `listOwnInboxProposals` is
 *                           gated by this same scope, which is why the read
 *                           costs no second line on the consent screen.
 *
 * `read:contracts` is NOT declared. Studio converts a workflow that arrives in
 * a request body; it never opens a contract folder. A generated mini-app may
 * well declare that scope — the app Studio proposes is consented separately,
 * when a human installs it.
 *
 * ⛔ AND THERE IS NO FILESYSTEM WRITE ON THAT ADAPTER. That absence is the whole
 * design, not a limitation being worked around: Studio generates the sub-app's
 * source IN MEMORY and files it as one inbox proposal. A human applies it.
 * Contract rule 7 — propose, don't mutate — is the product, not an obstacle.
 *
 * `initSchema` is a no-op and this file has no `schema.ts` beside it. Studio is
 * a mini-app: the `shell-reference` floor, database-free, no DDL, no migration.
 * Every app Studio generates is the same shape. */
import type { SubAppManifest } from "../types.js";
import { registerStudioRoutes } from "./routes/index.js";

export const studioManifest: SubAppManifest = {
  id: "studio",
  label: "Studio",
  version: "0.1.0",
  // The host refuses to boot on a manifest that demands more than it is.
  minHostVersion: "5.0.0",
  icon: "🛠️",
  // One of the five EXACT literals matched against the host's UI_NAV_SECTIONS.
  // Studio builds the console's own apps, so it belongs with the system apps
  // rather than in the contract pipeline it generates apps for.
  navSection: "System apps",
  routePrefix: "/api/apps/studio",
  webModuleId: "studio",
  capabilities: ["write:inbox-proposal"],
  // Required, non-empty, and narrow on purpose: proposing a new sub-app is an
  // administrative act — the proposal names source files that a human will add
  // to the host repo. An hr_preparer has no use for it and should not see it.
  visibleToRoles: ["admin"],
  // No domain tables. A mini-app stores nothing; its only durable trace is the
  // proposals it writes, which the capability adapter owns.
  initSchema: () => {},
  registerRoutes: (app, ctx) => registerStudioRoutes(app, ctx),
};
