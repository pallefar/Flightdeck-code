/**
 * Fixtures for the registry suite. Nothing here decides anything — every rule
 * under test lives in the package, so a fixture that "helped" would be a second
 * implementation of the thing being measured.
 */

import type { Artifact, ArtifactFile } from "../artifact";
import type { Actor } from "../actor";
import type { LedgerResult } from "../ledger";

/* ── actors ─────────────────────────────────────────────────────────────── */

/** The generator. Proposes; may never approve. */
export const AGENT: Actor = { kind: "agent", id: "studio-codegen", displayName: "Studio codegen" };
export const SYSTEM: Actor = { kind: "system", id: "flightdeck-server" };
/** A tool actor whose id IS the artifact's — the classic self-approval shape. */
export const TOOL_SELF: Actor = { kind: "tool", id: "wc-clock" };
/** A HUMAN account whose subject id is the artifact's: an identity minted to
 *  carry a tool's name past a "must be human" check. */
export const HUMAN_NAMED_AFTER_TOOL: Actor = {
  kind: "human",
  id: "wc-clock",
  displayName: "WC Clock Service Account",
};
export const ANON_HUMAN: Actor = { kind: "human", id: "u_81f3" };
export const APPROVER: Actor = { kind: "human", id: "k.haldan", displayName: "Karsten Haldan" };
export const SECOND_APPROVER: Actor = { kind: "human", id: "m.brandt", displayName: "Mia Brandt" };
export const ADMIN: Actor = { kind: "human", id: "uat-admin", displayName: "UAT Admin" };

/* ── timestamps (the package owns no clock) ─────────────────────────────── */

export const T = {
  proposed: "2026-09-20T08:00:00.000Z",
  approved: "2026-09-20T09:00:00.000Z",
  registered: "2026-09-20T09:05:00.000Z",
  enabled: "2026-09-20T09:10:00.000Z",
  project: "2026-09-20T09:15:00.000Z",
  later: "2026-09-20T10:00:00.000Z",
  latest: "2026-09-20T11:00:00.000Z",
} as const;

/* ── artifacts ──────────────────────────────────────────────────────────── */

const MANIFEST = `export const wcClockManifest = {
  id: "wc-clock",
  label: "WC Clock",
  version: "0.1.0",
  minHostVersion: "5.0.0",
  icon: "⏱",
  navSection: "Ops & insight",
  routePrefix: "/api/apps/wc-clock",
  webModuleId: "wc-clock",
  capabilities: ["read:contracts"],
  visibleToRoles: ["wc_liaison", "admin"],
};
`;

const ROUTES = `export async function registerRoutes(app, ctx) {
  app.get("/api/apps/wc-clock/state", async (req, reply) => {
    requireWcClockEnabled(req);
    return { ok: true };
  });
}
`;

export function miniAppFiles(): ArtifactFile[] {
  return [
    { path: "server/subapps/wc-clock/manifest.ts", text: MANIFEST },
    { path: "server/subapps/wc-clock/routes.ts", text: ROUTES },
    { path: "web/src/subapps/wc-clock/index.tsx", text: "export function Page() { return null; }\n" },
  ];
}

export function miniApp(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "wc-clock",
    kind: "mini-app",
    version: "0.1.0",
    capabilities: ["read:contracts"],
    files: miniAppFiles(),
    ...overrides,
  };
}

export function script(overrides: Partial<Artifact> = {}): Artifact {
  return {
    id: "parity-scaffold",
    kind: "script",
    version: "1.2.0",
    capabilities: [],
    files: [
      {
        path: "scripts/scaffold-parity.ts",
        text: "#!/usr/bin/env tsx\nconsole.log('scaffold parity');\n",
      },
    ],
    ...overrides,
  };
}

/** The same mini-app with one byte of one file changed. */
export function miniAppV2(): Artifact {
  const files = miniAppFiles();
  return miniApp({
    files: files.map((f) =>
      f.path.endsWith("routes.ts") ? { ...f, text: `${f.text}// v2: one extra line\n` } : f,
    ),
  });
}

/* ── result helpers ─────────────────────────────────────────────────────── */

type OkResult = Extract<LedgerResult, { ok: true }>;

/** Unwrap, or fail with the reason code rather than `undefined is not an object`. */
export function mustOk(result: LedgerResult): OkResult {
  if (!result.ok) throw new Error(`expected ok, got refusal: ${result.reason}`);
  return result;
}

export function reasonOf(result: LedgerResult): string {
  return result.reason;
}
