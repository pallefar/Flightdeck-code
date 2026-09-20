/** Does the page actually RENDER, and does it say the one thing it must?
 *
 * ⭐ A DIFFERENT QUESTION FROM EVERY OTHER TEST HERE. `emit-manifest.test.ts`
 * asks whether the right strings are in the file. That cannot notice a
 * component that throws on first render, a hook called conditionally, or a
 * `.map` over something that is not an array. This one renders it with React
 * and reads the MARKUP — the same evidence a person opening the page has.
 *
 * It is a static render, so `useEffect` never runs and no request is made: what
 * it proves is the FIRST PAINT, which is exactly the state a person sees before
 * the network answers, and the one a broken page fails in.
 *
 * ⭐ AND IT CHECKS THE CLAIM. The single thing this page must never let
 * somebody misbelieve is that the button installs an app. That sentence has to
 * be on screen BEFORE anything is pasted — not in a toast after the fact, not
 * behind a disclosure — so it is asserted against the rendered markup. The one
 * assertion that cannot be (the control only exists once a conversion is ready)
 * reads the source instead and says so on itself, rather than being dressed up
 * as a render check. */
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import studioModule from "../web/src/subapps/studio/index.js";

const html = renderToStaticMarkup(createElement(studioModule.Page));
const PAGE_SOURCE = readFileSync(
  join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "web/src/subapps/studio/index.tsx"),
  "utf8",
);

describe("the Studio page, rendered", () => {
  it("default-exports a SubAppModule with a Page the web loader can lazy-mount", () => {
    expect(typeof studioModule.Page).toBe("function");
  });

  it("paints on first render, before any request has answered", () => {
    expect(html.length).toBeGreaterThan(500);
    expect(html).toContain("Convert a Cowork workflow into a mini-app");
  });

  it("says that filing a proposal installs nothing, before anything is pasted", () => {
    expect(html).toContain("Studio proposes. It does not install.");
    expect(html).toContain("memory/proposals/");
    expect(html).toMatch(/until a human adds those files/);
    expect(html).toMatch(/no path here that could install an app/);
  });

  it("repeats it on the control itself, for the person who scrolled past the notice", () => {
    // The file-the-proposal control only exists once a conversion is ready, so
    // this claim is read off the SOURCE rather than the first paint — and it is
    // marked as such rather than dressed up as a render assertion. The route
    // half of the same claim (`installs: false`, "installed nothing" in the
    // answer) is asserted against real HTTP in `propose.test.ts`.
    expect(PAGE_SOURCE).toContain("File the proposal (installs nothing)");
    expect(PAGE_SOURCE).toContain("A human applies it.");
  });

  it("explains why the workflow is pasted rather than picked off disk", () => {
    expect(html).toMatch(/never opens a file/);
  });

  it("uses the host's own class names and adds no stylesheet", () => {
    for (const cls of ["page", "pagehead", "eyebrow", "card", "muted", "mono"]) {
      expect(html, `expected the host class "${cls}"`).toContain(`class="${cls}"`);
    }
    expect(html).not.toContain("<style");
    expect(html).not.toContain("<link");
  });

  it("themes through host CSS variables, with the host's own values as fallbacks", () => {
    // The token so the page follows the console's theme toggle; the literal so
    // it still reads correctly anywhere the stylesheet has not loaded.
    expect(html).toMatch(/var\(--line, #1f2733\)/);
    expect(html).toMatch(/var\(--te, #ff8200\)/);
    expect(html).toMatch(/var\(--bg, #07090d\)/);
  });

  it("offers the workflow textarea and a disabled submit until something is pasted", () => {
    expect(html).toContain("Workflow markdown");
    expect(html).toContain("Read the workflow");
    // Nothing has been typed, so the action that starts the pipeline is off.
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Read the workflow<\/button>/);
  });

  it("shows no result, no refusal and no proposal before anything has been asked", () => {
    expect(html).not.toContain("Contract gate");
    expect(html).not.toContain('class="okbox"');
    expect(html).not.toContain('class="errorbox"');
  });
});
