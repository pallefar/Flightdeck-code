import { afterEach, expect, it, vi } from "vitest";
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {readFileSync} from 'node:fs';
import {StudioDesignerApp} from '../StudioDesignerApp';
import {hasClass,semanticBlockers,ssrTags} from './ordinary-ssr-contract';
const { render } = vi.hoisted(() => ({ render: vi.fn() }));
vi.mock("react-dom/client", () => ({ createRoot: () => ({ render }) }));
afterEach(() => vi.unstubAllGlobals());
it("mounts the actual StudioApp plus retained designer composition, not a fixture/demo driver", async () => {
  vi.stubGlobal("document", { getElementById: () => ({}) });
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await import("../../main");
  expect(render).toHaveBeenCalledTimes(1);
  const entry=render.mock.calls[0]?.[0]?.props.children;
  // Component identity, not a function-name alias that could conceal the old root.
  expect(entry.type).toBe(StudioDesignerApp);
  expect(entry.props.initialAppearance).toBe("night");
  const html=renderToStaticMarkup(createElement(entry.type,{...entry.props,fetcher}));
  const tags=ssrTags(html);
  expect(tags.filter(n=>n.attrs['aria-label']==='Flightdeck Studio workspace')).toHaveLength(1);
  expect(tags.filter(n=>hasClass(n,'fd-app-designer')&&hasClass(n,'fd-embedded'))).toHaveLength(1);
  const create=tags.find(n=>n.tag==='button'&&hasClass(n,'studio-home-create'));
  expect(create).toBeDefined();expect(create!.attrs).not.toHaveProperty('disabled');
  expect(semanticBlockers(create!)).toEqual([]);
  expect(html).not.toContain('Page designer is not connected');
  expect(html).not.toContain('Works Council Clock');
  expect(html).not.toContain('Builder workspace standby');
  for(const path of ['../../main.tsx','../StudioDesignerApp.tsx']){
    const source=readFileSync(new URL(path,import.meta.url),'utf8');
    expect(source).not.toMatch(/(?:from|import\s*)\s*['"][^'"]*(?:fixture|demo)[^'"]*['"]/i);
  }
  expect(fetcher).not.toHaveBeenCalled();
});
