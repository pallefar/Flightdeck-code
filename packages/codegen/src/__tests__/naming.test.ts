/** The id derivations. Every one of these is a name the HOST computes too —
 * the env var in `killSwitch.ts`, the nav path in `installRoutes.ts`, the
 * table prefix `missingSubappTables` looks for — so a drift here is a
 * generated sub-app whose kill switch has a different name from the one
 * anyone would type. */
import { describe, expect, it } from "vitest";
import * as names from "../naming";

describe("id derivations", () => {
  it("derives the kill-switch env var exactly as killSwitch.ts does", () => {
    // `SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`
    for (const id of ["wc-clock", "docusign", "shell-reference", "a1-b2"]) {
      expect(names.killSwitchEnvVar(id)).toBe(`SUBAPP_${id.toUpperCase().replace(/-/g, "_")}_ENABLED`);
    }
  });

  it("derives the table prefix, index names and nav path from the id", () => {
    expect(names.tablePrefix("wc-clock")).toBe("subapp_wc_clock_");
    expect(names.tableName("wc-clock", "clocks")).toBe("subapp_wc_clock_clocks");
    expect(names.indexName("wc-clock", "clocks", ["ticket", "state"])).toBe("idx_wc_clock_clocks_ticket_state");
    expect(names.navPath("wc-clock")).toBe("/console/apps/wc-clock");
  });

  it("emits a routePrefix the host's ROUTE_PREFIX_RE accepts", () => {
    const ROUTE_PREFIX_RE = /^\/api\/apps\/[a-z0-9-]+$/;
    for (const id of ["wc-clock", "x", "a-b-c-d", "9lives"]) {
      expect(ROUTE_PREFIX_RE.test(names.routePrefix(id))).toBe(true);
    }
  });

  it("prefixes an identifier derived from a digit-leading id", () => {
    // `/^[a-z0-9][a-z0-9-]*$/` admits "3d-maps"; "3dMaps" is not an
    // identifier, and dropping the digit would collide with "d-maps".
    expect(names.pascalCase("3d-maps")).toBe("App3dMaps");
    expect(names.camelCase("3d-maps")).toBe("app3dMaps");
    expect(names.pascalCase("3d-maps")).not.toBe(names.pascalCase("d-maps"));
    expect(names.guardFunctionName("3d-maps")).toBe("requireApp3dMapsEnabled");
  });

  it("maps camelCase body keys onto snake_case columns", () => {
    expect(names.snakeCase("startedAt")).toBe("started_at");
    expect(names.snakeCase("ticket")).toBe("ticket");
    expect(names.snakeCase("reminderCadenceDays")).toBe("reminder_cadence_days");
  });
});
