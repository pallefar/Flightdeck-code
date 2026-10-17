import { afterEach, expect, it, vi } from "vitest";
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
afterEach(() => vi.unstubAllGlobals());
it("mounts StudioApp as the entry point instead of the fixture/demo driver", async () => {
  vi.stubGlobal("document", { getElementById: () => ({}) });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await import("../../main");
  expect(render.mock.calls[0]?.[0]?.props.children.type.name).toBe("StudioApp");
  expect(render.mock.calls[0]?.[0]?.props.children.props.initialAppearance).toBe("night");
  expect(fetcher).not.toHaveBeenCalled();
});
