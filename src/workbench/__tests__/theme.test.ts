/** The theme contract: two Atlas palettes with the same names, every
 * colour in the chrome coming from them, and a frame that stays a plain,
 * light stand-in for the host rather than borrowing Studio's chrome.
 *
 * ── WHY THESE AND NOT A SNAPSHOT ────────────────────────────────────
 * The failure this guards is the one Studio had before the Atlas reskin:
 * a dark-only palette plus a dozen hand-typed dark hexes scattered through
 * the rules, each of which would have stayed dark in a light theme. A
 * snapshot would pin every value and catch none of that on purpose. */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_THEME,
  HOST_FRAME_CSS,
  THEME_STORAGE_KEY,
  TOKENS,
  WORKBENCH_CSS,
  isStudioTheme,
  tokenVar,
} from "../theme";
import { buildLedger } from "../preview/fidelity";

/** A custom-property declaration line: `  --name: value;`. */
const DECLARATION = /^\s*--[a-z0-9-]+:.*;\s*$/gm;

describe("theme", () => {
  it("defaults to light, as Atlas does, and knows exactly two themes", () => {
    expect(DEFAULT_THEME).toBe("light");
    expect(isStudioTheme("light")).toBe(true);
    expect(isStudioTheme("dark")).toBe(true);
    expect(isStudioTheme("system")).toBe(false);
    expect(isStudioTheme(null)).toBe(false);
    expect(THEME_STORAGE_KEY).toBe("flightdeck-studio-theme");
  });

  it("gives both palettes the same token names, so no rule goes unstyled in one theme", () => {
    expect(Object.keys(TOKENS.dark)).toEqual(Object.keys(TOKENS.light));
  });

  it("carries Atlas's own values for the anchors", () => {
    expect(TOKENS.light).toMatchObject({ bg: "#f3f6f7", ink: "#253d4b", line: "#d5dfe5", accent: "#e98300" });
    expect(TOKENS.dark).toMatchObject({ bg: "#0e1720", ink: "#eef2f7", line: "#304553", accent: "#e98300" });
    expect(WORKBENCH_CSS).toContain("--r-lg: 12px;");
    expect(WORKBENCH_CSS).toContain("--r-md: 7px;");
    expect(WORKBENCH_CSS).toContain('--sans: Arial, Helvetica, "Segoe UI", sans-serif;');
  });

  it("declares every variable the chrome uses", () => {
    const declared = new Set(
      [...WORKBENCH_CSS.matchAll(/^\s*(--[a-z0-9-]+):/gm)].map((m) => m[1]),
    );
    for (const name of Object.keys(TOKENS.light)) expect(declared).toContain(tokenVar(name));
    const used = new Set([...WORKBENCH_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]));
    const undeclared = [...used].filter((name) => !declared.has(name));
    expect(undeclared).toEqual([]);
  });

  it("takes every chrome colour from the palette — the frame's backdrop is the one literal", () => {
    const rules = WORKBENCH_CSS.replace(DECLARATION, "");
    const literals = [...new Set(rules.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [])];
    // The frame element's own background, matched to the frame document's
    // body so no seam shows while it loads. It is the host's colour, not Studio's.
    expect(literals).toEqual(["#f3f6f7"]);
    expect(HOST_FRAME_CSS).toContain("background: #f3f6f7");
    expect(rules).not.toMatch(/rgba?\(/);
  });

  it("keeps the frame a plain, light stand-in: none of Studio's tokens, no dark mode", () => {
    expect(HOST_FRAME_CSS).not.toMatch(/var\(--/);
    expect(HOST_FRAME_CSS).not.toMatch(/data-theme|prefers-color-scheme/);
    expect(HOST_FRAME_CSS).toContain("color-scheme: light");
    // And the ledger still says so: a resemblance is not the host's stylesheet.
    const shell = buildLedger({ scopesScanned: true, hasCapabilities: true, fabricatesRows: true }).find(
      (row) => row.aspect === "Host shell",
    );
    expect(shell?.fidelity).toBe("absent");
  });
});
