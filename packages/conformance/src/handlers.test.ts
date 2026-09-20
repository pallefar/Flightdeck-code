/** Finding handlers — and admitting when it cannot. */
import { describe, expect, it } from "vitest";
import { extractRouteHandlers } from "./handlers";
import { scanFile } from "./scan";

const handlersIn = (source: string) => extractRouteHandlers(scanFile("server/subapps/x/routes/a.ts", source));

describe("extractRouteHandlers", () => {
  it("reads the method, the path and the body", () => {
    const { handlers } = handlersIn(`
export function register(app) {
  app.get("/api/apps/x/rows", async (req, reply) => {
    const rt = await requireXEnabled(req);
    return reply.send({ rt });
  });
}
`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.method).toBe("GET");
    expect(handlers[0]?.routePath).toBe("/api/apps/x/rows");
    expect(handlers[0]?.body).toContain("requireXEnabled");
    expect(handlers[0]?.body).not.toContain("app.get");
  });

  it("reads past a route-options object argument", () => {
    const { handlers } = handlersIn(`
app.post("/api/apps/x/rows", { config: { rawBody: true } }, async (req, reply) => {
  const rt = await requireXEnabled(req);
});
`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.body).toContain("requireXEnabled");
  });

  it("takes the handler, not a nested arrow inside it", () => {
    const { handlers } = handlersIn(`
app.get("/api/apps/x/rows", async (req, reply) => {
  const rt = await requireXEnabled(req);
  const mapped = rows.map((row) => { return row.id; });
  return reply.send(mapped);
});
`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.body).toContain("requireXEnabled");
    expect(handlers[0]?.body).toContain("row.id");
  });

  it("is not fooled by a method call that is not a route", () => {
    const { handlers, unverifiable } = handlersIn(`
const cached = store.get("wc-clock");
const rows = await rt.db.all("SELECT id FROM subapp_x_rows");
headers.delete("authorization");
`);
    expect(handlers).toEqual([]);
    expect(unverifiable).toEqual([]);
  });

  it("reports app.route({...}) as unverifiable rather than passing it", () => {
    const { handlers, unverifiable } = handlersIn(`app.route({ method: "GET", url: "/api/apps/x/rows", handler: listRows });\n`);
    expect(handlers).toEqual([]);
    expect(unverifiable[0]?.reason).toContain("route(");
  });

  it("reports a handler passed by reference as unverifiable", () => {
    const { handlers, unverifiable } = handlersIn(`app.get("/api/apps/x/rows", listRows);\n`);
    expect(handlers).toEqual([]);
    expect(unverifiable[0]?.reason).toContain("no inline handler");
  });

  it("finds every handler in a file, not just the first", () => {
    const { handlers } = handlersIn(`
app.get("/api/apps/x/rows", async (req, reply) => { await requireXEnabled(req); });
app.post("/api/apps/x/rows", async (req, reply) => { await requireXEnabled(req); });
app.delete("/api/apps/x/rows/:id", async (req, reply) => { await requireXEnabled(req); });
`);
    expect(handlers.map((handler) => handler.method)).toEqual(["GET", "POST", "DELETE"]);
  });

  it("still reads a registration whose path is concatenated", () => {
    const { handlers } = handlersIn(`
app.get(PREFIX + "rows", async (req, reply) => {
  const rt = await requireXEnabled(req);
});
`);
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.routePath).toBe("(computed path)");
    expect(handlers[0]?.body).toContain("requireXEnabled");
  });

  it("reports a concatenated path with a by-reference handler as unverifiable", () => {
    const { handlers, unverifiable } = handlersIn(`app.get(PREFIX + "rows", listRows);\n`);
    expect(handlers).toEqual([]);
    expect(unverifiable[0]?.reason).toContain("(computed path)");
  });

  it("gives a body with strings blanked, so a quoted token is not read as code", () => {
    const { handlers } = handlersIn(`
app.get("/api/apps/x/rows", async (req, reply) => {
  const hint = "req.body is not read here";
  const rt = await requireXEnabled(req);
});
`);
    expect(handlers[0]?.body).not.toContain("req.body");
  });
});
