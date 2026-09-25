/**
 * ⭐ THE PIN ON GET /api/studio/health (adm-56).
 *
 * The health endpoint is the ONE Studio route that answers without the
 * operator token, and FlightDeck Admin › Build › Studio (adm-55) probes it
 * from the OS through an allowlist. That makes its body a public contract:
 * whatever a key says, anyone who can reach the port can read it. So the
 * body is pinned to an exact key allowlist — a new key is a deliberate,
 * reviewed change to this file, never a side effect of a refactor.
 *
 * `version` is NOT on the allowlist. Plan 2026-09-25 (admin, D-039) lists
 * "adding a 'version' field to Studio /api/studio/health" as an owner ruling;
 * until it is made, Admin shows "version unavailable". When the owner rules,
 * the change is: add the key to ALLOWED_KEYS here, in the same commit as the
 * server change, and cite the ruling.
 */
import { describe, expect, it } from "vitest";

import { createServer } from "../index";

const TOKEN = "a-sufficiently-long-operator-token";
const OPERATOR = { actor: "Karsten Haldan", token: TOKEN };
const NO_DIST = "/nonexistent/studio-dist-for-health-pin";
const serve = () => createServer({ operator: OPERATOR, distDir: NO_DIST, llm: async () => ({ text: "{}" }) });

/** The complete, ordered-insensitive set of keys the body may carry. */
const ALLOWED_KEYS = ["harnessMode", "model", "modelKeyConfigured", "ok"] as const;

/** The security headers every Studio response carries, verbatim. */
const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "content-security-policy": "default-src 'self'; frame-ancestors 'none'; object-src 'none'",
} as const;

describe("GET /api/studio/health is pinned", () => {
  it("⭐ answers 200 with NO token, and the same with a wrong one — it never consults auth", async () => {
    const app = serve();
    const bare = await app.inject({ method: "GET", url: "/api/studio/health" });
    expect(bare.statusCode).toBe(200);
    const wrong = await app.inject({
      method: "GET",
      url: "/api/studio/health",
      headers: { authorization: "Bearer not-the-token" },
    });
    expect(wrong.statusCode).toBe(200);
    expect(wrong.body).toBe(bare.body);
  });

  it("⭐ the body carries EXACTLY the allowlisted keys — an extra key fails, a missing one fails", async () => {
    const res = await serve().inject({ method: "GET", url: "/api/studio/health" });
    const body = res.json() as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...ALLOWED_KEYS].sort());
    // `version` needs an owner ruling (plan 2026-09-25 admin, adm-56) —
    // named separately so the failure says so if it is added unreviewed.
    expect(body).not.toHaveProperty("version");
  });

  it("each allowlisted key has its pinned type, and none is nested", async () => {
    const body = (await serve().inject({ method: "GET", url: "/api/studio/health" })).json() as Record<string, unknown>;
    expect(body["ok"]).toBe(true);
    expect(typeof body["model"]).toBe("string");
    expect(typeof body["modelKeyConfigured"]).toBe("boolean");
    expect(body["harnessMode"] === null || typeof body["harnessMode"] === "string").toBe(true);
  });

  it("⭐ security headers are unchanged, and nothing invites a cross-origin read or sets state", async () => {
    const res = await serve().inject({ method: "GET", url: "/api/studio/health" });
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      expect(res.headers[name], name).toBe(value);
    }
    expect(res.headers["content-type"]).toMatch(/^application\/json/);
    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
    expect(res.headers["access-control-allow-credentials"]).toBeUndefined();
    expect(res.headers["set-cookie"]).toBeUndefined();
  });

  it("only GET is answered — health is not a write surface", async () => {
    const app = serve();
    for (const method of ["POST", "PUT", "DELETE", "PATCH"] as const) {
      const res = await app.inject({ method, url: "/api/studio/health", payload: {} });
      expect(res.statusCode, method).toBe(404);
    }
  });
});
