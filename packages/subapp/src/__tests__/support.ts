/** The test rig: a REAL Fastify, a FAKE capability adapter, and the host
 * stand-ins wired the way the host wires the real ones.
 *
 * ⭐ WHY REAL FASTIFY. The claim under test is "the guard is the first
 * statement in every handler". A hand-rolled `app.post` recorder would prove
 * that about the recorder. `fastify().inject()` runs the actual routing, the
 * actual body parsing and the actual reply lifecycle, so a handler that
 * answered 403 by accident — because a body parser rejected first, say — would
 * be visible instead of hidden.
 *
 * ⭐ WHY A FAKE ADAPTER. The capability adapter is the ONLY surface a sub-app
 * route may use, so a fake that RECORDS every call is a complete transcript of
 * everything the routes did to the outside world. "A blocked gate writes
 * nothing" is then a statement about that transcript, not about a mock's
 * expectations. */
import fastify, { type FastifyInstance } from "fastify";
import type { Db } from "../server/db.js";
import { CapabilityDeniedError } from "../server/subapps/capabilities.js";
import { standInResetAudit } from "../server/lib/flightdeckAudit.js";
import { standInClearInstallRows, standInSetInstallRow } from "../server/subapps/installRow.js";
import type { CapabilityScope, ContractFolder, RegisterRoutesCtx, SubAppCapabilities } from "../server/subapps/types.js";
import type { WorkspaceRuntime } from "../server/workspace/types.js";
import { registerStudioRoutes } from "../server/subapps/studio/routes/index.js";
import type { StudioBundle } from "../server/subapps/studio/service/bundle.js";
import { bundleFrom, convertWorkflow, type StudioConversion } from "../studio/conversion.js";

export const STUDIO_ENV = "SUBAPP_STUDIO_ENABLED";

export interface CapabilityCall {
  readonly method: keyof SubAppCapabilities;
  readonly args: readonly unknown[];
}

export interface FakeCapabilities extends SubAppCapabilities {
  /** Every call made through the adapter, in order. The whole transcript of
   * what the routes touched. */
  readonly calls: CapabilityCall[];
  /** Filenames under `memory/proposals/` this sub-app has "written". */
  readonly written: Map<string, unknown>;
  /** Scopes to refuse, so a `capability_denied` can be exercised. */
  readonly denied: Set<string>;
}

export function fakeCapabilities(seed: readonly string[] = []): FakeCapabilities {
  const calls: CapabilityCall[] = [];
  const written = new Map<string, unknown>();
  const denied = new Set<string>();
  for (const name of seed) written.set(name, { seeded: true });

  const require_ = (scope: CapabilityScope): void => {
    if (denied.has(scope)) {
      // The host's own adapter throws `CapabilityDeniedError` WITH the scope
      // attached — that is how a route can answer `{ code, scope }` instead of
      // splicing server prose into a sentence. Dropping it here would let a
      // route that lost the scope keep passing.
      throw new CapabilityDeniedError(`sub-app "studio" attempted "${scope}" without a granted scope`, scope);
    }
  };

  return {
    calls,
    written,
    denied,
    readContracts(): ContractFolder[] {
      calls.push({ method: "readContracts", args: [] });
      require_("read:contracts");
      return [];
    },
    writeInboxProposal(fileName: string, content: unknown): string {
      calls.push({ method: "writeInboxProposal", args: [fileName, content] });
      require_("write:inbox-proposal");
      written.set(fileName, content);
      return `memory/proposals/${fileName}`;
    },
    listOwnInboxProposals(): string[] {
      calls.push({ method: "listOwnInboxProposals", args: [] });
      require_("write:inbox-proposal");
      return [...written.keys()];
    },
    auditAppend(event: Record<string, unknown> & { event: string }): { hash: string } {
      calls.push({ method: "auditAppend", args: [event] });
      return { hash: "fake-hash" };
    },
  };
}

export interface HarnessOptions {
  /** Layer 1. Default on, so a test that is not ABOUT the kill switch does not
   * have to know it exists. */
  readonly killSwitch?: boolean;
  /** Layers 2 and 3. Default on. */
  readonly installed?: boolean;
  /** `req.workspace`. Null models a request the workspace resolver could not
   * place, which the guard must refuse without auditing anything. */
  readonly workspace?: boolean;
  readonly principal?: { username: string; displayName: string } | null;
  readonly caps?: FakeCapabilities;
}

export interface Harness {
  readonly app: FastifyInstance;
  readonly caps: FakeCapabilities;
  readonly rt: WorkspaceRuntime;
  /** How many times the routes asked for an adapter at all. */
  readonly adapterRequests: string[];
  close(): Promise<void>;
}

export async function buildHarness(options: HarnessOptions = {}): Promise<Harness> {
  standInResetAudit();

  const db: Db = {};
  const rt: WorkspaceRuntime = { id: "te-ops", root: "/tmp/te-ops-standin", db };
  standInClearInstallRows(db);
  if (options.installed ?? true) {
    standInSetInstallRow(db, "general", "studio", {
      ceilingEnabled: true,
      projectConsented: true,
      grantedScopes: ["write:inbox-proposal"],
      version: "0.1.0",
    });
  }

  if ((options.killSwitch ?? true) === true) process.env[STUDIO_ENV] = "true";
  else delete process.env[STUDIO_ENV];

  const caps = options.caps ?? fakeCapabilities();
  const adapterRequests: string[] = [];
  const ctx: RegisterRoutesCtx = {
    capabilitiesFor: async (workspaceId: string) => {
      adapterRequests.push(workspaceId);
      return caps;
    },
  };

  const app = fastify();
  app.decorateRequest("workspace", null);
  app.decorateRequest("project", null);
  app.decorateRequest("principal", null);
  app.addHook("onRequest", async (req) => {
    req.workspace = (options.workspace ?? true) ? rt : null;
    req.project = { id: "general" };
    req.principal = options.principal === undefined ? { username: "ada", displayName: "Ada L" } : options.principal;
  });
  registerStudioRoutes(app, ctx);
  await app.ready();

  return {
    app,
    caps,
    rt,
    adapterRequests,
    close: async () => {
      await app.close();
      delete process.env[STUDIO_ENV];
      standInClearInstallRows(db);
    },
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Workflow fixtures
 *
 * Written out here rather than read from `packages/spec/src/__fixtures__`:
 * these tests are about Studio's behaviour, and a fixture that moves under
 * them would make a red run ambiguous between "Studio broke" and "the fixture
 * changed". Both are faithful to the shape `skills/orchestrate-workflow/SKILL.md`
 * uses — YAML frontmatter with `name` and `description`, then a `## Procedure`
 * of numbered steps with a bolded lead-in.
 * ═══════════════════════════════════════════════════════════════════════ */

/** A procedure whose steps read, hand off and record — the ordinary case.
 * Step 4 asks to write host state, which must be NARROWED to a proposal and
 * reported, never performed. */
export const CONVERTIBLE_WORKFLOW = `---
name: works-council-clock
description: >
  Track the German works-council consultation clock for one contract folder: read the folder's
  manifest, show where the clock stands, and hand off to the liaison when a person is needed.
---

# works-council-clock

## Why
The folder is the on-disk projection of the consultation state, which is what makes hand-offs clean.

## Procedure
1. **Read state** — load the contract folder's \`manifest.json\` and see which artifacts exist.
2. **Check the clock** — compare the consultation start date against the statutory window; flag divergence.
3. **Notify the liaison** — at every hand-off that needs a human, draft the ping for the wc_liaison to review.
4. **Record the outcome** — write the consultation result to the folder's audit entries.

## Guardrails
- Memory is canonical; the folder is the operational interface.
`;

/** The same document with one sentence added that asks the mini-app to close a
 * gate by itself. Contract rule 7 refuses this outright — not narrowed, not
 * asked about. */
export const AUTO_ADVANCING_WORKFLOW = `---
name: works-council-autopilot
description: >
  Track the German works-council consultation clock and close it out without waiting for anybody.
---

# works-council-autopilot

## Procedure
1. **Read state** — load the contract folder's \`manifest.json\` and see which artifacts exist.
2. **Close the works council step** — automatically approve the statutory works-council step without human review once the window elapses.
`;

/** Answers to the questions `@spec` always asks: no workflow carries an icon,
 * a nav section or a role list, and none of the three is guessable. */
export const ANSWERS: Record<string, string> = {
  icon: "⏱️",
  navSection: "Contract pipeline",
  visibleToRoles: "wc_liaison, admin",
};

/* ══════════════════════════════════════════════════════════════════════════
 * Bundles
 *
 * ⭐ BUILT BY RUNNING THE REAL ENGINE, not typed out by hand. The routes under
 * test accept a bundle; the thing that produces one in production is
 * `studio/conversion.ts`. A hand-written fixture would let the two drift —
 * Studio could start emitting a bundle the host refuses and every test here
 * would stay green. Running the conversion means the wire contract is
 * exercised end to end on every run, in the one place both halves are
 * importable at once.
 *
 * `at` is injected so a bundle is byte-identical between runs.
 * ═══════════════════════════════════════════════════════════════════════ */

export function readyConversion(
  workflow: string = CONVERTIBLE_WORKFLOW,
  answers: Record<string, string> = ANSWERS,
): Extract<StudioConversion, { status: "ready" }> {
  const conversion = convertWorkflow({ workflow, answers });
  if (conversion.status !== "ready") {
    throw new Error(`fixture workflow did not convert: ${conversion.status} ${JSON.stringify(conversion)}`);
  }
  return conversion;
}

export const BUNDLE_AT = "2026-09-20T09:00:00.000Z";

export function studioBundle(options: { workflow?: string; source?: string } = {}): StudioBundle {
  const ready = readyConversion(options.workflow ?? CONVERTIBLE_WORKFLOW);
  return bundleFrom(ready, { at: BUNDLE_AT, ...(options.source === undefined ? {} : { source: options.source }) });
}
