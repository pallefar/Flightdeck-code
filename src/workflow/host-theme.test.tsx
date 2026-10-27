import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { StudioApp } from "../studio/StudioApp";
import { WORKFLOW_CSS } from "./styles";

it("inherits the real Flightdeck light/dark token channel", () => {
  for (const token of ["--bg", "--surface", "--surface2", "--ink", "--muted", "--line", "--te", "--green", "--amber", "--red"]) {
    expect(WORKFLOW_CSS, token).toContain(`var(${token},`);
  }
  expect(WORKFLOW_CSS).toContain("var(--te,#e98300)");
  expect(WORKFLOW_CSS).toContain("accent-color:var(--wf-accent)");
  expect(WORKFLOW_CSS).not.toMatch(/\.wf-editor\{[^}]*font-family:Inter/);
});

it("keeps Studio styles scoped instead of repainting the OS body", () => {
  const html = renderToStaticMarkup(<StudioApp />);
  const css = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)].map(match => match[1]).join("\n");
  expect(css).not.toMatch(/(?:^|})\s*(?:body|:root|html)\s*\{/);
  expect(css).toContain("var(--te,#e98300)");
  expect(html).toContain('aria-label="Studio areas"');
});
