/** Does the emitted page actually RENDER?
 *
 * ⭐ WHY THIS IS A DIFFERENT QUESTION FROM EVERY OTHER TEST HERE.
 * `emitted-syntax.test.ts` asks the TypeScript parser whether the file is
 * well-formed; `mini-app.test.ts` asks whether the right strings are in it.
 * Neither can notice a component that throws on first render, a hook called
 * conditionally, a `.map` over something that is not an array, or a step
 * rail that renders nothing at all. This one transpiles the emitted TSX and
 * renders it with React, then reads the MARKUP — the same evidence a person
 * opening the page would have.
 *
 * It is a static render, so `useEffect` never runs and no request is made:
 * what it proves is the first paint, which is exactly the state a person
 * sees before the network answers, and the one a broken page fails in.
 *
 * The module is loaded through `createRequire` rather than imported: the
 * emitted file is TSX that has never been on disk as a module, and running
 * it through the same `require` that supplies React keeps one copy of React
 * in play (two would make `renderToStaticMarkup` reject the elements). */
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import ts from "typescript";
import { generateSubApp } from "../generate";
import { contractRunSpec, minimalSpec } from "../fixtures/specs";

const require_ = createRequire(import.meta.url);
const React = require_("react") as typeof import("react");
const { renderToStaticMarkup } = require_("react-dom/server") as typeof import("react-dom/server");

function renderEmittedPage(spec: unknown): string {
  const app = generateSubApp(spec);
  const web = app.files.find((f) => f.kind === "web-module");
  if (web === undefined) throw new Error("no web module was emitted");
  const js = ts.transpileModule(web.contents, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const module_ = { exports: {} as { default?: { Page?: unknown } } };
  new Function("require", "exports", "module", js)(require_, module_.exports, module_);
  const Page = module_.exports.default?.Page;
  if (typeof Page !== "function") throw new Error("the module's default export carries no Page component");
  return renderToStaticMarkup(React.createElement(Page as React.ComponentType));
}

describe("a converted workflow's page, rendered", () => {
  const html = renderEmittedPage(contractRunSpec);

  it("renders one row per Procedure step, in the Procedure's order", () => {
    const steps = [...html.matchAll(/data-step="(\d+)"/g)].map((m) => Number(m[1]));
    expect(steps).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("gives every step a state and a gate a person can see", () => {
    const states = [...html.matchAll(/data-step="\d+" data-state="([a-z]+)"/g)].map((m) => m[1]);
    expect(states).toEqual(["ready", "ready", "manual", "manual", "waiting", "manual"]);
    const gates = [...html.matchAll(/data-gate="([a-z]+)"/g)].map((m) => m[1]);
    expect(gates).toEqual(["auto", "human", "statutory", "human", "human", "human"]);
    expect(html).toContain('<span class="chip red">Statutory gate</span>');
    expect(html).toContain('<span class="chip">Outside this app</span>');
    expect(html).toContain('<span class="chip">Waiting on step 2</span>');
  });

  it("shows what each step needs and what it produces", () => {
    expect(html).toContain(">Needs</span>");
    expect(html).toContain(">Produces</span>");
    expect(html).toContain('<span class="chip">contracts/{ticket}_{person}/</span>');
    expect(html).toContain('<span class="chip">Hand-off proposal</span>');
  });

  it("puts the control that performs a step inside that step", () => {
    expect(html).toContain('<form data-form="post-/flag">');
    expect(html).toContain("<button type=\"submit\" aria-busy=\"false\">Flag a divergence for review</button>");
    // The read-only step gets a load button, not a form with no fields.
    expect(html).toContain('<button type="button" class="small" aria-busy="false">Load the contract folders this app may read</button>');
    // A step with no route says so rather than showing a dead control.
    expect(html).toContain("This step happens outside this app.");
  });

  it("does not show a step's control twice — once in the rail is once on the page", () => {
    expect([...html.matchAll(/data-form="post-\/flag"/g)]).toHaveLength(1);
    expect([...html.matchAll(/Load the contract folders this app may read/g)]).toHaveLength(1);
  });

  it("counts progress in the host's monospace, and starts honest at zero", () => {
    expect(html).toContain('<b class="mono">0</b> of <b class="mono">2</b> proposable steps filed');
    expect(html).toContain('<span class="fill" style="width:0%">');
  });

  it("wears the host's visual language rather than a stylesheet of its own", () => {
    expect(html).toContain('<div class="page">');
    expect(html).toContain('<div class="eyebrow">WORKFLOW</div>');
    expect(html).toContain("var(--surface, #11161f)");
    expect(html).toContain("var(--line, #1f2733)");
    expect(html).toContain("border-radius:16px");
    expect(html).not.toContain("<link");
    expect(html).not.toContain("<style");
  });

  it("names where the workflow came from", () => {
    expect(html).toContain('<span class="muted mono">skills/orchestrate-workflow/SKILL.md</span>');
  });
});

describe("a mini-app that came from no workflow", () => {
  const html = renderEmittedPage(minimalSpec);

  it("renders its panels and no empty rail", () => {
    expect(html).toContain('<div class="eyebrow">FLIGHTDECK MINI-APP</div>');
    expect(html).toContain('data-panel="contracts"');
    expect(html).not.toContain("data-step=");
    expect(html).not.toContain("Other actions");
  });
});
