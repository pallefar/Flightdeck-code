/** "Download candidate" — owner ruling 2026-09-22 (9).
 *
 * A browser-only way to take the edited files out of the workbench. Three
 * properties, each pinned here:
 *
 *   1. It is enabled ONLY when the conformance gate passes on the EDITED files
 *      — the saved overlay, not Studio's text — and only when there is nothing
 *      unsaved or unresolved that the download would silently leave out.
 *   2. It writes nothing on the server: the file is built in memory and handed
 *      to the browser's own save. No request of any kind.
 *   3. It never writes into the host repo. What it produces is a review copy
 *      that says so; `scripts/promote.sh` plus a compliance record stays the
 *      only way in. */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  CANDIDATE_DOWNLOAD_SCHEMA,
  candidateDownload,
  downloadReadiness,
  runFileGate,
  saveInBrowser,
  type FileGate,
  type FileGateVerdict,
} from "../download";
import { createStore } from "../store";
import { currentCandidate, edits, generatedCandidate } from "../selectors";
import type { GeneratedFile } from "../types";
import { candidate, finding } from "./fixtures";

const PASS: FileGateVerdict = { ok: true, findings: [], rulesRun: ["FD-M001", "FD-G001"] };

/** A gate that fails any file set containing the text "BROKEN" — so an edit
 * can make it fail, which is the case the ruling is about. */
const contentGate: FileGate = (files) => {
  const broken = files.find((f) => f.contents.includes("BROKEN"));
  return broken === undefined
    ? PASS
    : { ok: false, findings: [finding("FD-G001", broken.path, 1, "guard is not first")], rulesRun: PASS.rulesRun };
};

const MANIFEST = "server/subapps/wc-clock/manifest.ts";

function settled() {
  const store = createStore();
  store.settle(store.prompt("build it") ?? "", candidate());
  return store;
}

function readinessOf(store: ReturnType<typeof settled>, gate: FileGate = contentGate) {
  const state = store.getState();
  const current = currentCandidate(state);
  return downloadReadiness({ candidate: current, edits: edits(state), verdict: current === null ? null : runFileGate(gate, current.files) });
}

describe("when the button is enabled", () => {
  it("⭐ is ready when the gate passes on the round's files", () => {
    const ready = readinessOf(settled());
    expect(ready.ready).toBe(true);
  });

  it("⭐ runs the gate on the EDITED files, not on Studio's — a saved edit can fail it", () => {
    const store = settled();
    store.editFile(MANIFEST, "// BROKEN by hand\n");
    store.saveFile(MANIFEST);
    // Studio's own candidate is still clean: the verdict that matters is the
    // one over what would actually leave the browser.
    expect(generatedCandidate(store.getState())?.files.some((f) => f.contents.includes("BROKEN"))).toBe(false);
    const readiness = readinessOf(store);
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toMatch(/conformance gate fails on the edited files/i);
    expect(readiness.reason).toContain("1 error");
  });

  it("is ready again once the edit is fixed and saved", () => {
    const store = settled();
    store.editFile(MANIFEST, "// BROKEN\n");
    store.saveFile(MANIFEST);
    store.editFile(MANIFEST, "// fixed\n");
    store.saveFile(MANIFEST);
    expect(readinessOf(store).ready).toBe(true);
  });

  it("⛔ not while an edit is unsaved — the download would silently leave it out", () => {
    const store = settled();
    store.editFile(MANIFEST, "// typing\n");
    const readiness = readinessOf(store);
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toMatch(/1 unsaved edit/);
  });

  it("⛔ not while a conflict is open — the panes show Studio's text, not the person's", () => {
    const readiness = downloadReadiness({
      candidate: candidate(),
      edits: { dirty: 0, saved: 0, conflicted: 2, locked: 0 },
      verdict: PASS,
    });
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toMatch(/2 conflicts/);
  });

  it("⛔ not when the gate could not run — fail closed, never a pass by default", () => {
    const exploding: FileGate = () => {
      throw new Error("gate exploded");
    };
    expect(runFileGate(exploding, candidate().files)).toBeNull();
    const readiness = readinessOf(settled(), exploding);
    expect(readiness.ready).toBe(false);
    if (readiness.ready) return;
    expect(readiness.reason).toMatch(/could not run/);
  });

  it("⛔ not before there is a candidate", () => {
    expect(downloadReadiness({ candidate: null, edits: { dirty: 0, saved: 0, conflicted: 0, locked: 0 }, verdict: null }).ready).toBe(false);
  });

  it("a warning does not block it — the gate's own `ok` is the pass condition", () => {
    const warned: FileGateVerdict = { ok: true, findings: [finding("FD-X001", "(candidate)", 0, "no registry edit", "warning")], rulesRun: PASS.rulesRun };
    expect(downloadReadiness({ candidate: candidate(), edits: { dirty: 0, saved: 0, conflicted: 0, locked: 0 }, verdict: warned }).ready).toBe(true);
  });
});

describe("what it produces", () => {
  const edited: GeneratedFile[] = candidate().files.map((f) => (f.path === MANIFEST ? { ...f, contents: "// mine\n" } : f));

  it("⭐ is the edited files and the verdict over exactly those files, marked as a review copy", () => {
    const download = candidateDownload({
      candidate: candidate({ files: edited }),
      generated: candidate().files,
      verdict: PASS,
      round: 3,
    });
    expect(download.filename).toBe("wc-clock-candidate-round-3.json");
    expect(download.mime).toBe("application/json");
    const body = JSON.parse(download.text) as Record<string, unknown>;
    expect(body["schema"]).toBe(CANDIDATE_DOWNLOAD_SCHEMA);
    expect(body["id"]).toBe("wc-clock");
    expect(body["round"]).toBe(3);
    expect(body["edited"]).toEqual([MANIFEST]);
    expect((body["files"] as GeneratedFile[]).find((f) => f.path === MANIFEST)?.contents).toBe("// mine\n");
    expect(body["gate"]).toEqual({ ok: true, rulesRun: PASS.rulesRun, findings: [] });
    // It says what it is not, in the file itself, for whoever opens it later.
    expect(String(body["notice"])).toMatch(/not a compliance record/);
    expect(String(body["notice"])).toContain("scripts/promote.sh");
  });

  it("⛔ refuses to build a download from files the gate failed", () => {
    expect(() =>
      candidateDownload({
        candidate: candidate(),
        generated: candidate().files,
        verdict: { ok: false, findings: [finding("FD-G001", MANIFEST, 1, "x")], rulesRun: PASS.rulesRun },
        round: 1,
      }),
    ).toThrow(/gate/);
  });

  it("is not a studio-mini-app/1 bundle — it cannot be mistaken for something the host files", () => {
    expect(CANDIDATE_DOWNLOAD_SCHEMA).not.toBe("studio-mini-app/1");
    expect(CANDIDATE_DOWNLOAD_SCHEMA).not.toMatch(/compliance/);
  });
});

describe("how it leaves the browser", () => {
  it("⭐ hands the bytes to the browser's own save — an object URL and a download link, then revoked", () => {
    const click = vi.fn();
    const anchor = { href: "", download: "", rel: "", click, remove: vi.fn() };
    const doc = { createElement: vi.fn(() => anchor), body: { appendChild: vi.fn() } };
    const url = { createObjectURL: vi.fn(() => "blob:studio/1"), revokeObjectURL: vi.fn() };

    vi.useFakeTimers();
    try {
      saveInBrowser({ filename: "x.json", mime: "application/json", text: "{}" }, { document: doc, URL: url });

      expect(doc.createElement).toHaveBeenCalledWith("a");
      expect(anchor.download).toBe("x.json");
      expect(anchor.href).toBe("blob:studio/1");
      expect(click).toHaveBeenCalledOnce();
      expect(anchor.remove).toHaveBeenCalledOnce();
      // Revoked a task later, not before the browser has read the Blob.
      expect(url.revokeObjectURL).not.toHaveBeenCalled();
      vi.runAllTimers();
      expect(url.revokeObjectURL).toHaveBeenCalledWith("blob:studio/1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("⛔ contains no network call of any kind — it writes nothing on the server", () => {
    const source = readFileSync(fileURLToPath(new URL("../download.ts", import.meta.url)), "utf8")
      // Comments may name what the file does NOT do.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    for (const call of ["fetch(", "XMLHttpRequest", "sendBeacon", "WebSocket", "EventSource", "/api/"]) {
      expect(source, call).not.toContain(call);
    }
  });
});
