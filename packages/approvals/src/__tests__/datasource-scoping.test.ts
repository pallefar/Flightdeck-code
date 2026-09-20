/**
 * A grant names what it grants — nothing near it, under it, or beside it.
 *
 * `boot.json` gives one connector, `microsoft-365`, whose scope array is
 * `["SharePoint","Teams","Outlook","Entra"]`. Those four are not four names for
 * one thing: a tool that may read a SharePoint document library has no business
 * in the CEO's mailbox. The same holds on disk — `contracts/` is the
 * person-bearing root the PII boundary exists for, and `obsidian-vault/` is not.
 */
import { describe, expect, it } from "vitest";
import { effectiveGrant } from "../decision";
import { datasourceKey, sameDatasource } from "../datasource";
import { CONTRACTS_INPUT, M365, OUTLOOK, PROJECT, SHAREPOINT, VAULT, ask, ceiling, ds, row, store } from "./support";

const granted = [ceiling([[SHAREPOINT, 4]]), row(PROJECT, [[SHAREPOINT, 4]])];

describe("a connector grant does not leak to a sibling sub-scope", () => {
  it("grants the scope it names", async () => {
    const decision = await effectiveGrant({ store: store(granted), ...ask({ datasource: SHAREPOINT, tier: 2 }) });
    expect(decision.allowed).toBe(true);
  });

  it("refuses the sibling sub-scope", async () => {
    const decision = await effectiveGrant({ store: store(granted), ...ask({ datasource: OUTLOOK, tier: 1 }) });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("refuses the bare connector — a sub-scope grant is not a connector grant", async () => {
    const decision = await effectiveGrant({ store: store(granted), ...ask({ datasource: M365, tier: 1 }) });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("refuses the sibling even when the PROJECT row boldly claims it", async () => {
    const decision = await effectiveGrant({
      store: store([
        ceiling([[SHAREPOINT, 4]]),
        row(PROJECT, [
          [SHAREPOINT, 4],
          [OUTLOOK, 4],
        ]),
      ]),
      ...ask({ datasource: OUTLOOK, tier: 1 }),
    });
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("granting the bare connector does not grant any of its sub-scopes", async () => {
    const bare = [ceiling([[M365, 4]]), row(PROJECT, [[M365, 4]])];
    expect((await effectiveGrant({ store: store(bare), ...ask({ datasource: M365, tier: 1 }) })).allowed).toBe(true);
    for (const scope of ["SharePoint", "Teams", "Outlook", "Entra"]) {
      const decision = await effectiveGrant({
        store: store(bare),
        ...ask({ datasource: ds("connector", "microsoft-365", scope), tier: 1 }),
      });
      expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
    }
  });
});

describe("a path grant does not leak to another root or into a sub-path", () => {
  const vault = [ceiling([[VAULT, 4]]), row(PROJECT, [[VAULT, 4]])];

  it("granting obsidian-vault does not grant contracts/", async () => {
    const decision = await effectiveGrant({
      store: store(vault),
      ...ask({ datasource: ds("repo-path", "contracts"), tier: 1 }),
    });
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("granting a root does not grant a path root beneath it", async () => {
    const decision = await effectiveGrant({
      store: store(vault),
      ...ask({ datasource: ds("repo-path", "obsidian-vault", "private"), tier: 1 }),
    });
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("granting contracts/input does not grant contracts/ itself", async () => {
    const decision = await effectiveGrant({
      store: store([ceiling([[CONTRACTS_INPUT, 4]]), row(PROJECT, [[CONTRACTS_INPUT, 4]])]),
      ...ask({ datasource: ds("repo-path", "contracts"), tier: 1 }),
    });
    expect(decision.reason).toBe("no_ceiling_grant_for_datasource");
  });

  it("the same id under a different kind is a different datasource", () => {
    expect(sameDatasource(ds("repo-path", "contracts"), ds("database", "contracts"))).toBe(false);
  });

  it("no id/scope pair can be re-parsed into another pair", () => {
    // The separator is \u0000, which neither the id nor the scope regex admits.
    expect(datasourceKey(ds("repo-path", "a", "b/c"))).not.toBe(datasourceKey(ds("repo-path", "a/b", "c")));
  });

  it("a traversal-shaped scope is refused rather than normalized", async () => {
    const decision = await effectiveGrant({
      store: store(vault),
      ...ask({ datasource: ds("repo-path", "obsidian-vault", "../contracts"), tier: 1 }),
    });
    expect(decision.reason).toBe("invalid_datasource");
  });
});
