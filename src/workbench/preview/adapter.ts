/** The mocked capability adapter the preview runs against.
 *
 * ── WHAT THIS IS STANDING IN FOR ────────────────────────────────────
 * A generated sub-app's routes reach the world through exactly one door:
 * `ctx.capabilitiesFor(id)` (contract §5.3). No `node:fs`, no DB driver,
 * no host reader module. That is a strict enough door that it can be
 * MOCKED FAITHFULLY, which is the entire reason this preview can be
 * honest where a general-purpose one could not. There is no arbitrary
 * Node program to emulate here; there is one adapter with two capabilities
 * and a handful of refusal conditions.
 *
 * ── WHY IT IS BUILT AROUND THE REFUSALS, NOT THE HAPPY PATH ─────────
 * The interesting question about a generated sub-app is never "does the
 * list render". It is: what does a person see when the kill switch is off,
 * when the ceiling row withdrew a scope, when the body fails Zod. Those
 * are the paths the contract legislates (§4, §5.1, §5.6, §5.9) and the
 * ones a reviewer cannot otherwise exercise without booting a host and
 * editing a database. So the adapter models them exactly, and the preview
 * pane puts toggles on them.
 *
 * ── WHAT IT DOES NOT PRETEND TO BE ──────────────────────────────────
 * Stated here and again in `fidelity.ts`, where a person reads it: the
 * SUCCESS bodies are fabricated. `{ rows }` is shaped correctly and seeded
 * deterministically from the sub-app id, but the rows are invented; the
 * real ones come from SQLite. A green preview is evidence the page renders
 * and refuses correctly. It is not evidence the SQL is right. Nothing in
 * this file will ever tell you the SQL is right.
 *
 * Pure and DOM-free. `adapter.test.ts` runs the whole thing in node. */
import { z } from "zod";
import { type EnableLayers, isEnabled, refusingLayer } from "../types";
import type { FieldDescriptor, FormDescriptor, PanelDescriptor } from "./descriptor";

export const CAPABILITY_SCOPES = ["read:contracts", "write:inbox-proposal"] as const;
export type CapabilityScope = (typeof CAPABILITY_SCOPES)[number];

export interface MockRequest {
  readonly method: string;
  /** Sub-path, exactly as the descriptor carries it — the prefix is the
   * adapter's business, not the page's. */
  readonly path: string;
  readonly body?: unknown;
}

export interface MockResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface AuditEvent {
  readonly seq: number;
  readonly action: string;
  /** Contract §8: field NAMES, never values. */
  readonly fields: readonly string[];
  /** Set when a submitted VALUE was found inside the event payload — the
   * §8 violation, caught live rather than argued about. Normally `null`. */
  readonly leak: string | null;
}

export interface Proposal {
  readonly seq: number;
  /** Contract §7: proposals are confined to `memory/proposals/`. */
  readonly path: string;
  readonly fields: readonly string[];
}

export interface LogEntry {
  readonly seq: number;
  readonly method: string;
  readonly path: string;
  readonly status: number;
  readonly code: string | null;
  /** One clause saying WHY, in the contract's language. */
  readonly why: string;
}

export interface HostSnapshot {
  readonly log: readonly LogEntry[];
  readonly audit: readonly AuditEvent[];
  readonly proposals: readonly Proposal[];
}

/** Which capability a route needs. `null` = a plain table route, which
 * reaches nothing outside the sub-app's own tables and so needs none. */
export type ScopeMap = ReadonlyMap<string, CapabilityScope | null>;

export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Recover each route's required capability from the emitted server source.
 *
 * ⭐ WHY SCAN THE SERVER AND NOT INFER FROM THE HTTP METHOD. The page's
 * descriptor does not carry scopes — it has no reason to, the server
 * enforces them. The lazy fill-in is "GET needs read, POST needs write",
 * and it is wrong in both directions for this generator: `requiredScopeOf`
 * keys off the OPERATION, so a POST that inserts into the sub-app's own
 * table needs NO capability, while a GET that lists contracts needs
 * `read:contracts`. A preview built on the lazy inference would show a
 * capability refusal on a route that has none and miss the route that
 * does — precisely inverting the §9 least-privilege question a reviewer is
 * here to answer.
 *
 * So this reads the emitted routes: find each `app.<method>("<path>"`,
 * take the span up to the next one, and see which `caps.*` call it makes.
 * That is the same evidence a human reviewer would use. When the scan
 * finds no registrations at all — a hand-edited file, a shape this does
 * not know — it returns an empty map and the caller degrades honestly
 * rather than guessing. */
export function scanScopes(sources: readonly string[], routePrefix: string): ScopeMap {
  const out = new Map<string, CapabilityScope | null>();
  const registration = /app\.(get|post|put|patch|delete)\(\s*"((?:[^"\\]|\\.)*)"/g;

  for (const source of sources) {
    const hits: Array<{ method: string; path: string; at: number }> = [];
    registration.lastIndex = 0;
    for (;;) {
      const match = registration.exec(source);
      if (match === null) break;
      const method = (match[1] ?? "").toUpperCase();
      const full = match[2] ?? "";
      hits.push({ method, path: full, at: match.index + match[0].length });
    }
    for (let i = 0; i < hits.length; i += 1) {
      const hit = hits[i];
      if (hit === undefined) continue;
      const end = hits[i + 1]?.at ?? source.length;
      const body = source.slice(hit.at, end);
      const scope: CapabilityScope | null = body.includes("caps.writeInboxProposal")
        ? "write:inbox-proposal"
        : body.includes("caps.readContracts")
          ? "read:contracts"
          : null;
      const sub = hit.path.startsWith(routePrefix) ? hit.path.slice(routePrefix.length) : hit.path;
      out.set(routeKey(hit.method, sub === "" ? "/" : sub), scope);
    }
  }
  return out;
}

export interface HostConfig {
  readonly subAppId: string;
  /** Declared in the manifest — contract §9 calls this array the human
   * consent screen, so the adapter treats it as the whole grant. */
  readonly capabilities: readonly string[];
  readonly panels: readonly PanelDescriptor[];
  readonly scopes: ScopeMap;
  /** A FUNCTION, not a value. Contract §5.2: kill switch, install row and
   * granted scopes are re-read on every call, never cached. The mock obeys
   * the rule it is here to demonstrate — and it means the preview's
   * toggles take effect on the next request rather than on a remount. */
  readonly layers: () => EnableLayers;
}

/** Small deterministic PRNG. The preview must show the same fabricated
 * rows every time it opens, or a reviewer comparing two rounds cannot tell
 * a real change from noise in the mock. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** A Zod object built from the page's field descriptors.
 *
 * Contract §5.6 puts Zod at every HTTP boundary and `.strict()` where an
 * unknown key would be a silent widening, and the generated routes do
 * exactly that. Rebuilding the schema from the descriptors means the
 * preview's 400s are REAL Zod refusals with real issue paths — the one
 * part of the mocked server that is not an approximation at all. */
export function bodySchema(fields: readonly FieldDescriptor[]): z.ZodTypeAny {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    let base: z.ZodTypeAny;
    switch (field.control) {
      case "checkbox":
        base = z.boolean();
        break;
      case "number":
        base = z.number();
        break;
      case "select": {
        const options = field.options ?? [];
        const head = options[0];
        base =
          head === undefined
            ? z.string()
            : z.enum([head, ...options.slice(1)] as [string, ...string[]]);
        break;
      }
      default:
        // The generated page posts "" for an empty required text field, so
        // `.min(1)` is what turns a blank form into the server's real 400
        // rather than a silently accepted empty string.
        base = field.optional ? z.string() : z.string().min(1, "expected a value");
        break;
    }
    shape[field.name] = field.optional ? base.optional() : base;
  }
  return z.object(shape).strict();
}

interface IssueShape {
  readonly path: readonly (string | number)[];
  readonly message: string;
}

export class MockCapabilityHost {
  #seq = 0;
  #log: LogEntry[] = [];
  #audit: AuditEvent[] = [];
  #proposals: Proposal[] = [];
  #inserted = new Map<string, Array<Record<string, unknown>>>();
  readonly #config: HostConfig;

  constructor(config: HostConfig) {
    this.#config = config;
  }

  snapshot(): HostSnapshot {
    return { log: [...this.#log], audit: [...this.#audit], proposals: [...this.#proposals] };
  }

  reset(): void {
    this.#seq = 0;
    this.#log = [];
    this.#audit = [];
    this.#proposals = [];
    this.#inserted.clear();
  }

  /** Granted scopes come ONLY from the ceiling row (contract §4). A
   * project row can turn a sub-app off; it can never widen consent. That
   * is why this reads `ceiling` and not `isEnabled(...)`. */
  #granted(): readonly string[] {
    return this.#config.layers().ceiling ? this.#config.capabilities : [];
  }

  #respond(method: string, path: string, status: number, body: unknown, why: string): MockResponse {
    this.#seq += 1;
    const code =
      body !== null && typeof body === "object" && "code" in body && typeof body.code === "string"
        ? body.code
        : null;
    this.#log.push({ seq: this.#seq, method, path, status, code, why });
    return { status, body };
  }

  handle(request: MockRequest): MockResponse {
    const method = request.method.toUpperCase();
    const path = request.path;
    const layers = this.#config.layers();

    // 1. GUARD FIRST (contract §5.1). Before the route table, before the
    //    body is looked at. The order here is the order the generated
    //    handler must use, and a preview that checked the route first
    //    would leak the existence of routes a disabled app should not
    //    admit to having.
    if (!isEnabled(layers)) {
      const layer = refusingLayer(layers);
      return this.#respond(method, path, 403, {
        error: `${this.#config.subAppId} is not enabled here`,
        code: "subapp_disabled",
      }, LAYER_WHY[layer ?? "killSwitch"]);
    }

    const target = this.#route(method, path);
    if (target === null) {
      return this.#respond(method, path, 404, { error: "no such route", code: "unknown_route" },
        "no route in the page's descriptor matches this path");
    }

    // 2. CAPABILITY (contract §5.3, §5.9).
    const required = this.#config.scopes.get(routeKey(method, path)) ?? null;
    if (required !== null && !this.#granted().includes(required)) {
      return this.#respond(method, path, 403, {
        error: `capability ${required} is not granted here`,
        code: "capability_denied",
        scope: required,
      }, layers.ceiling
        ? `the manifest does not declare ${required} — §9, the capabilities array is the consent screen`
        : "the ceiling row is off, and granted scopes come only from the ceiling row (§4)");
    }

    // 3. ZOD AT THE BOUNDARY (contract §5.6).
    if (target.kind === "form") {
      const parsed = bodySchema(target.form.fields).safeParse(request.body ?? {});
      if (!parsed.success) {
        const issues: IssueShape[] = parsed.error.issues.map((issue) => ({
          path: issue.path,
          message: issue.message,
        }));
        return this.#respond(method, path, 400, { error: "invalid body", issues },
          "the body failed the route's Zod schema before any work was done");
      }
      return this.#perform(method, path, target.form, parsed.data as Record<string, unknown>, required);
    }

    return this.#respond(method, path, 200, { rows: this.#rows(path) },
      required === null
        ? "read from the sub-app's own tables"
        : `read through caps.${required === "read:contracts" ? "readContracts()" : "writeInboxProposal()"}`);
  }

  #perform(
    method: string,
    path: string,
    form: FormDescriptor,
    body: Record<string, unknown>,
    scope: CapabilityScope | null,
  ): MockResponse {
    const fields = form.fields.map((f) => f.name);

    // Contract §7: propose, don't mutate. A write capability produces a
    // PROPOSAL in `memory/proposals/`, never a resolved step.
    if (scope === "write:inbox-proposal") {
      this.#seq += 1;
      const proposalPath = `memory/proposals/${this.#config.subAppId}-${this.#seq}.json`;
      this.#proposals.push({ seq: this.#seq, path: proposalPath, fields });
      this.#appendAudit(`${this.#config.subAppId}.propose`, fields, body);
      return this.#respond(method, path, 200, { proposed: proposalPath },
        "a proposal was written to memory/proposals/ — nothing was advanced or resolved (§7)");
    }

    const rows = this.#inserted.get(path) ?? [];
    rows.unshift({ id: `row-${rows.length + 1}`, ...body });
    this.#inserted.set(path, rows);
    this.#appendAudit(`${this.#config.subAppId}.insert`, fields, body);
    return this.#respond(method, path, 200, { ok: true },
      "inserted into the sub-app's own table — no capability needed (§3 table prefix)");
  }

  /** Contract §5.5 and §8: the sub-app never constructs an audit hash, and
   * an event names FIELDS, never PII values. The second is checked rather
   * than asserted — every submitted value is looked for in the recorded
   * event, and a hit is surfaced in the preview's inspector. A rule that is
   * only ever stated in a doc is a rule nobody can see being kept. */
  #appendAudit(action: string, fields: readonly string[], body: Record<string, unknown>): void {
    const recorded = JSON.stringify({ action, fields });
    let leak: string | null = null;
    for (const [key, value] of Object.entries(body)) {
      if (typeof value !== "string" || value.length < 3) continue;
      if (recorded.includes(value)) {
        leak = key;
        break;
      }
    }
    this.#seq += 1;
    this.#audit.push({ seq: this.#seq, action, fields, leak });
  }

  #route(
    method: string,
    path: string,
  ): { kind: "list" } | { kind: "form"; form: FormDescriptor } | null {
    for (const panel of this.#config.panels) {
      if (method === "GET" && panel.list !== null && panel.list.path === path) return { kind: "list" };
      for (const form of panel.forms) {
        if (form.method.toUpperCase() === method && form.path === path) return { kind: "form", form };
      }
    }
    return null;
  }

  /** Fabricated rows, deterministic per (sub-app, path). Columns are taken
   * from the forms that write to the same panel, so the shape of the table
   * matches the shape of the thing being written — which is what makes the
   * preview's table headers real even though its cells are not. */
  #rows(path: string): Array<Record<string, unknown>> {
    const live = this.#inserted.get(path) ?? [];
    const panel = this.#config.panels.find((p) => p.list?.path === path);
    const columns = panel === undefined ? [] : [...new Set(panel.forms.flatMap((f) => f.fields.map((x) => x.name)))];
    if (columns.length === 0) return live;

    const random = mulberry32(seedOf(`${this.#config.subAppId}:${path}`));
    const fabricated: Array<Record<string, unknown>> = [];
    const fieldByName = new Map(
      (panel?.forms ?? []).flatMap((f) => f.fields.map((field) => [field.name, field] as const)),
    );
    for (let i = 0; i < 3; i += 1) {
      const row: Record<string, unknown> = { id: `sample-${i + 1}` };
      for (const column of columns) {
        const field = fieldByName.get(column);
        if (field?.control === "checkbox") row[column] = random() > 0.5;
        else if (field?.control === "number") row[column] = Math.floor(random() * 90) + 10;
        else if (field?.control === "select") {
          const options = field.options ?? [];
          row[column] = options[Math.floor(random() * options.length)] ?? "";
        } else row[column] = `sample ${column} ${i + 1}`;
      }
      fabricated.push(row);
    }
    return [...live, ...fabricated];
  }
}

const LAYER_WHY: Record<keyof EnableLayers, string> = {
  killSwitch: "SUBAPP_<ID>_ENABLED is not the string \"true\" — layer 1 of §4's AND",
  ceiling: "the ceiling row ('*') is off — layer 2 of §4's AND",
  project: "this project's install row is off — layer 3 of §4's AND",
};
