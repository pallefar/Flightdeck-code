/** What the generator REFUSES. A generator is only as good as the specs it
 * turns away: every case below produces source that compiles and then
 * misbehaves — an INSERT that always throws, a route that 403s forever, a
 * consent screen asking for access nothing uses. */
import { describe, expect, it } from "vitest";
import { SpecRejectedError, planSubApp } from "../plan";
import { generateSubApp } from "../generate";
import { wcClockSpec } from "../fixtures/specs";

type Mutable = Record<string, unknown>;
const clone = (): Mutable => JSON.parse(JSON.stringify(wcClockSpec)) as Mutable;
const domains = (spec: Mutable) => spec.domains as Array<Record<string, unknown>>;
const routes = (spec: Mutable, i: number) => domains(spec)[i]?.routes as Array<Record<string, unknown>>;
const op = (spec: Mutable, d: number, r: number) => routes(spec, d)?.[r]?.operation as Mutable;

function refuse(spec: unknown): string {
  try {
    planSubApp(spec);
  } catch (err) {
    expect(err).toBeInstanceOf(SpecRejectedError);
    return (err as Error).message;
  }
  throw new Error("expected the spec to be refused");
}

describe("the door", () => {
  it("accepts the fixture", () => {
    expect(planSubApp(wcClockSpec).id).toBe("wc-clock");
  });

  it("refuses an unknown key rather than ignoring it", () => {
    expect(refuse({ ...clone(), hotInstall: true })).toMatch(/hotInstall|Unrecognized/);
  });

  it("refuses an id that would collide with a hand-written host sub-app", () => {
    const spec = clone();
    spec.id = "docusign";
    expect(refuse(spec)).toMatch(/already a hand-written sub-app/);
  });

  it("refuses knowledge-guardian — the host's fifth manifest, whose id is a constant in guard.ts", () => {
    // The host registers `knowledgeGuardianManifest` with
    // `id: KNOWLEDGE_GUARDIAN_SUBAPP_ID`; generating over it would push a
    // second entry beside it with the same nav path and route prefix.
    const spec = clone();
    spec.id = "knowledge-guardian";
    // The fixture's audit events are namespaced `wc-clock.`, so a renamed
    // spec is refused for THAT too — assert the reserved-id issue by name,
    // not merely that something threw.
    let thrown: unknown;
    try {
      generateSubApp(spec);
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(SpecRejectedError);
    expect((thrown as SpecRejectedError).issues).toContainEqual(
      expect.stringMatching(/^id "knowledge-guardian" is already a hand-written sub-app/),
    );
  });

  it("refuses an id the host's SUBAPP_ID_RE rejects", () => {
    const spec = clone();
    spec.id = "WC_Clock";
    expect(refuse(spec)).toMatch(/id must match/);
  });
});

describe("cross-field coherence Zod cannot express", () => {
  it("refuses an operation naming a table that does not exist", () => {
    const spec = clone();
    op(spec, 0, 0).table = "ghosts";
    expect(refuse(spec)).toMatch(/unknown table "ghosts"/);
  });

  it("refuses a NOT NULL column with no body field to fill it", () => {
    const spec = clone();
    const fields = op(spec, 0, 2).fields as Array<Record<string, unknown>>;
    op(spec, 0, 2).fields = fields.filter((f) => f.name !== "days");
    expect(refuse(spec)).toMatch(/column "days" is NOT NULL but no body field fills it/);
  });

  it("refuses a NOT NULL column whose only field is optional", () => {
    const spec = clone();
    const fields = op(spec, 0, 2).fields as Array<Record<string, unknown>>;
    (fields.find((f) => f.name === "days") as Mutable).optional = true;
    expect(refuse(spec)).toMatch(/NOT NULL but body field "days" is optional/);
  });

  it("refuses a body field whose type cannot live in its column", () => {
    const spec = clone();
    const fields = op(spec, 0, 2).fields as Array<Record<string, unknown>>;
    (fields.find((f) => f.name === "days") as Mutable).type = "string";
    expect(refuse(spec)).toMatch(/is a "string" but column "days" is INTEGER/);
  });

  it("refuses an enum field admitting values the column's CHECK rejects", () => {
    const spec = clone();
    const fields = op(spec, 0, 2).fields as Array<Record<string, unknown>>;
    (fields.find((f) => f.name === "state") as Mutable).values = ["running", "cancelled"];
    expect(refuse(spec)).toMatch(/admits value\(s\) "cancelled" that column "state"'s CHECK constraint rejects/);
  });

  it("refuses a client writing a managed column", () => {
    const spec = clone();
    const fields = op(spec, 0, 2).fields as Array<Record<string, unknown>>;
    fields.push({ name: "createdBy", type: "string" });
    expect(refuse(spec)).toMatch(/targets managed column "created_by"/);
  });

  it("refuses a table redeclaring a managed column", () => {
    const spec = clone();
    const tables = spec.tables as Array<Record<string, unknown>>;
    (tables[0]?.columns as unknown[]).push({ name: "created_at", type: "text" });
    expect(refuse(spec)).toMatch(/redeclares managed column "created_at"/);
  });

  it("refuses a path param no operation reads", () => {
    const spec = clone();
    routes(spec, 0)[0] = { ...(routes(spec, 0)[0] as Mutable), path: "/clocks/:stray" };
    expect(refuse(spec)).toMatch(/path declares param\(s\) ":stray" that no operation reads/);
  });

  it("refuses a get-row whose key column is not in the table", () => {
    const spec = clone();
    op(spec, 0, 1).keyColumn = "nope";
    expect(refuse(spec)).toMatch(/keyColumn "nope" is not a column/);
  });

  it("refuses two routes registering the same method and path", () => {
    const spec = clone();
    routes(spec, 1).push({ ...(routes(spec, 0)[0] as Mutable) });
    expect(refuse(spec)).toMatch(/is registered by both domain/);
  });

  it("refuses a writing operation on a GET and a reading operation on a POST", () => {
    const writeOnGet = clone();
    (routes(writeOnGet, 0)[2] as Mutable).method = "GET";
    expect(refuse(writeOnGet)).toMatch(/a writing operation \("insert-row"\) cannot be a GET/);

    const readOnPost = clone();
    (routes(readOnPost, 0)[0] as Mutable).method = "POST";
    expect(refuse(readOnPost)).toMatch(/a reading operation \("list-rows"\) must be a GET/);
  });

  it("refuses an audit event not namespaced under the sub-app id", () => {
    const spec = clone();
    op(spec, 0, 2).auditEvent = "clock.started";
    expect(refuse(spec)).toMatch(/must be namespaced under the sub-app id/);
  });

  it("refuses an orderBy on a column the table does not have", () => {
    const spec = clone();
    (op(spec, 0, 0).orderBy as Mutable).column = "whenever";
    expect(refuse(spec)).toMatch(/orderBy column "whenever" is not a column/);
  });

  it("refuses an index over an unknown column", () => {
    const spec = clone();
    const tables = spec.tables as Array<Record<string, unknown>>;
    tables[0]!.indexes = [{ on: ["nothing"] }];
    expect(refuse(spec)).toMatch(/indexes unknown column\(s\) "nothing"/);
  });
});

describe("least privilege, in both directions", () => {
  it("refuses a route needing a capability the spec does not declare", () => {
    const spec = clone();
    spec.capabilities = ["write:inbox-proposal"];
    expect(refuse(spec)).toMatch(/needs capability "read:contracts", which the spec does not declare/);
  });

  it("refuses a capability no route uses — the array is the consent screen", () => {
    const spec = clone();
    domains(spec).splice(1, 1); // drop the domain that reads contracts and proposes
    expect(refuse(spec)).toMatch(/is declared but no route uses it/);
  });
});

describe("refusals are collected, not reported one at a time", () => {
  it("names every problem in one message", () => {
    const spec = clone();
    spec.id = "docusign";
    op(spec, 0, 0).table = "ghosts";
    op(spec, 0, 2).auditEvent = "nope.started";
    const message = refuse(spec);
    expect(message).toMatch(/already a hand-written sub-app/);
    expect(message).toMatch(/unknown table "ghosts"/);
    expect(message).toMatch(/namespaced under the sub-app id/);
  });
});

describe("what the plan resolves", () => {
  it("prefixes tables and indexes, and keeps the bare name for the spec author", () => {
    const plan = planSubApp(wcClockSpec);
    expect(plan.tables[0]?.full).toBe("subapp_wc_clock_clocks");
    expect(plan.tables[0]?.bare).toBe("clocks");
    expect(plan.tables[0]?.indexes[0]?.name).toBe("idx_wc_clock_clocks_ticket");
  });

  it("adds id/created_at/created_by to every table, ahead of the domain columns", () => {
    const plan = planSubApp(wcClockSpec);
    expect(plan.tables[0]?.columns.slice(0, 3).map((c) => c.name)).toEqual(["id", "created_at", "created_by"]);
    expect(plan.tables[0]?.columns.slice(0, 3).every((c) => c.managed)).toBe(true);
  });

  it("maps camelCase body fields onto snake_case columns", () => {
    const plan = planSubApp(wcClockSpec);
    const insert = plan.domains[0]?.routes[2];
    expect(insert?.fields.map((f) => [f.name, f.targetColumn])).toContainEqual(["startedAt", "started_at"]);
  });

  it("warns about a table nothing reads or writes", () => {
    const spec = clone();
    (spec.tables as unknown[]).push({ name: "orphans", columns: [{ name: "why", type: "text" }] });
    expect(planSubApp(spec).warnings.join(" ")).toMatch(/table "orphans" is created by initSchema but no route/);
  });
});
