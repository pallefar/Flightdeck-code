/** Genuine SDK → DTO parser → controller → Workbench composition.
 * Static rendering plus actual composed callbacks (not a mounted-browser test).
 * No model/provider, host state, generated-source execution or archive changes. */
import { createHash } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { buildSubAppFromSpec } from "../../../packages/pipeline/src/build-subapp-spec";
import { buildProcessPlan, PROCESS_TEMPLATES } from "../../process-studio/plan";
import { StudioController } from "../../studio/controller";
import { parseStudioResult, type ProposedSubapp } from "../../studio/result";
import { completeProcessDraft } from "../../studio/__tests__/process-template-fixture";
import { captureSubappSnapshot, snapshotDisabledReason } from "../../studio/subapp-snapshot";
import { currentCandidate } from "../selectors";
import { isDirty } from "../editing";
import type { RemovedSourceConflictsProps } from "../components/RemovedSourceConflicts";
import { Workbench } from "../Workbench";

// Observe the real composition seam without replacing the presentation or
// any SDK/controller/store behavior. Mounted reachability is a browser check.
type FileTreeProps = Parameters<typeof import("../components/FileTreePane").FileTreePane>[0];
const observed = vi.hoisted(() => ({ props: null as RemovedSourceConflictsProps | null, files: null as FileTreeProps | null }));
vi.mock("../components/RemovedSourceConflicts", async importOriginal => {
  const actual = await importOriginal<typeof import("../components/RemovedSourceConflicts")>();
  return { ...actual, RemovedSourceConflicts: (props: RemovedSourceConflictsProps) => {
    observed.props = props;
    return <actual.RemovedSourceConflicts {...props} />;
  } };
});

vi.mock("../components/FileTreePane", async importOriginal => {
  const actual = await importOriginal<typeof import("../components/FileTreePane")>();
  return { ...actual, FileTreePane: (props: FileTreeProps) => {
    observed.files = props;
    return <actual.FileTreePane {...props} />;
  } };
});

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type TemplateId = "operations-queue" | "analytical-report";
async function native(templateId: TemplateId) {
  const draft = completeProcessDraft(templateId), plan = buildProcessPlan(draft);
  if (plan.status !== "ready") throw new Error("Complete public DEVELOPMENT plan required");
  const template = PROCESS_TEMPLATES.find(item => item.id === templateId)!;
  const generated = await buildSubAppFromSpec({ prompt: plan.buildPrompt, spec: plan.spec, understanding: template.description, answers: { icon: draft.choices.icon, navSection: draft.choices.navSection!, visibleToRoles: draft.choices.visibleToRoles.join(","), ...Object.fromEntries(draft.choices.consentedScopes.map(scope => [`consent:${scope}`, "yes"])) } }, { ctx: { actor: "Development Operator" }, digest: sha, authorship: "first-party-operator" });
  const parsed = parseStudioResult(JSON.parse(JSON.stringify({ status: "subapp-result", target: "subapp", determination: { target: "subapp", reason: "Explicit registered template" }, outcome: generated })));
  if (parsed.status !== "subapp-result" || parsed.outcome.status !== "proposed") throw new Error("Real native SDK result required");
  return { outcome: parsed.outcome as ProposedSubapp, receipt: { projectId: "development-process", templateId, templateVersion: "1.0.0", artifactId: sha(JSON.stringify(parsed.outcome.generated.files)), prd: plan.prd } };
}
let operations: Awaited<ReturnType<typeof native>>, report: Awaited<ReturnType<typeof native>>;
beforeAll(async () => { operations = await native("operations-queue"); report = await native("analytical-report"); }, 60_000);
const removedFiles = () => operations.outcome.generated.files.filter(file => file.kind !== "standalone" && !report.outcome.generated.files.some(next => next.path === file.path));
function seed(hasSaved = true) {
  const fetcher = vi.fn<typeof fetch>(() => { throw new Error("No transport permitted"); });
  const controller = new StudioController(fetcher);
  expect(controller.acceptRegisteredTemplate(operations.outcome, operations.receipt)).toBe(true);
  const file = removedFiles().find(item => item.kind === "routes-domain")!;
  expect(file).toBeDefined();
  const saved = file.contents + "\r\n// DEVELOPMENT saved: 保留 café e\u0301 🧭\r\n\t";
  const pending = saved + '// DEVELOPMENT pending <script>throw "never evaluate"</script>\r\n';
  const store = controller.workbench;
  if (hasSaved) {
    expect(store.editFile(file.path, saved)).toBeNull();
    expect(store.saveFile(file.path)).toBe(true);
  }
  expect(store.editFile(file.path, pending)).toBeNull();
  store.selectFile(file.path);
  const original = JSON.stringify(store.getState().rounds[0]!.candidate);
  expect(controller.acceptRegisteredTemplate(report.outcome, report.receipt)).toBe(true);
  return { controller, store, file, saved, pending, original, fetcher };
}
const render = (store: StudioController["workbench"]) => renderToStaticMarkup(<Workbench store={store} onPrompt={() => { throw new Error("No prompt permitted"); }} hideChat />);

describe("removed source decisions in the real Workbench", () => {
  it("exposes both explicit decisions for a selected genuine removed source without inventing an effective file", () => {
    const { store, file, original, fetcher } = seed();
    expect(store.getState().rounds.map(round => round.candidate.manifest.id)).toEqual(["process-review", "process-review"]);
    expect(store.getState().drafts.get(file.path)?.conflict?.kind).toBe("removed");
    expect(currentCandidate(store.getState())!.files.some(item => item.path === file.path)).toBe(false);
    const out = render(store);
    expect(out).toContain("This round no longer contains this file.");
    expect(out).toContain("Keep mine");
    expect(out).toContain("Take Studio");
    expect(out).not.toContain(`data-source-path="${file.path}"`);
    expect(JSON.stringify(store.getState().rounds[0]!.candidate)).toBe(original);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("reviews the exact held project copy separately from pending typing as escaped inert text", () => {
    const { store, saved, pending } = seed();
    const out = render(store);
    const escape = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#x27;");
    expect(out).toContain("Held project copy (last saved or generated)");
    expect(out).toContain("Pending editor buffer (unsaved)");
    expect(out).toContain(`<pre>${escape(saved)}</pre>`);
    expect(out).toContain(`<pre>${escape(pending)}</pre>`);
    expect(out).not.toContain('<script>throw "never evaluate"</script>');
    expect(out).toContain("Neither copy is applied until you choose");
  });
  it("Keep mine from another view opens the retained dirty editor without publishing pending typing", () => {
    const { store, file, saved, pending, original } = seed();
    store.selectFile(report.outcome.generated.files[0]!.path);
    store.setView("preview");
    render(store);
    observed.props!.onResolve(file.path, "mine");
    expect(store.getState().view).toBe("files");
    expect(store.getState().selectedPath).toBe(file.path);
    const kept = store.getState().drafts.get(file.path)!;
    expect(kept.conflict).toBeNull();
    expect(kept.buffer).toBe(pending);
    expect(kept.saved).toBe(saved);
    expect(isDirty(kept)).toBe(true);
    expect(currentCandidate(store.getState())!.files.find(item => item.path === file.path)?.contents).toBe(saved);
    const out = render(store);
    expect(out).toContain(`aria-label="Edit ${file.path}"`);
    expect(out).toContain("● unsaved");
    expect(out).toContain("DEVELOPMENT pending &lt;script&gt;");
    expect(JSON.stringify(store.getState().rounds[0]!.candidate)).toBe(original);
    expect(store.getState().rounds[1]!.candidate.files.some(item => item.path === file.path)).toBe(false);
  });
  it("Take Studio explicitly drops both layers, navigates off the absent path and recovers a valid latest snapshot", () => {
    const { store, file, original } = seed();
    expect(snapshotDisabledReason(store.getState())).not.toBeNull();
    render(store);
    observed.props!.onResolve(file.path, "studio");
    expect(store.getState().selectedPath).not.toBe(file.path);
    expect(store.getState().selectedPath).not.toBeNull();
    expect(store.effectiveFiles().some(item => item.path === store.getState().selectedPath)).toBe(true);
    expect(store.getState().drafts.has(file.path)).toBe(false);
    expect(store.effectiveFiles().some(item => item.path === file.path)).toBe(false);
    expect(snapshotDisabledReason(store.getState())).toBeNull();
    const snapshot = captureSubappSnapshot(store.getState());
    expect(snapshot.baseline).toEqual(store.getState().rounds.at(-1)!.candidate);
    expect(snapshot.files.some(item => item.path === file.path)).toBe(false);
    expect(render(store)).not.toContain("DEVELOPMENT pending");
    expect(JSON.stringify(store.getState().rounds[0]!.candidate)).toBe(original);
  });
  it("labels kept extra paths in-session only before and after local Save, without relaxing the durable inventory", () => {
    const { store, file, pending } = seed();
    render(store);
    observed.props!.onResolve(file.path, "mine");
    expect(render(store)).toContain("Durable Save and source export cannot include paths absent from the latest generated baseline");
    expect(captureSubappSnapshot.bind(null, store.getState())).toThrow(/in-session Save/);
    expect(store.saveFile(file.path)).toBe(true);
    expect(store.effectiveFiles().find(item => item.path === file.path)?.contents).toBe(pending);
    expect(render(store)).toContain("Durable Save and source export cannot include paths absent from the latest generated baseline");
    expect(captureSubappSnapshot.bind(null, store.getState())).toThrow(/unsupported artifact inventory/);
    // The existing Restore generated escape must discard the whole kept
    // copy, not silently put pending bytes into a different archive shape.
    observed.props!.onRestore(file.path);
    expect(store.getState().drafts.has(file.path)).toBe(false);
    expect(store.getState().selectedPath).not.toBe(file.path);
    expect(store.effectiveFiles().some(item => item.path === file.path)).toBe(false);
    expect(captureSubappSnapshot(store.getState()).files.some(item => item.path === file.path)).toBe(false);
    expect(render(store)).not.toContain("Kept removed source");
  });
  it("offers every unvisited locked removal outside the source pane and leaves the other decision intact", () => {
    const { store, file, controller } = seed();
    const secondary = store.effectiveFiles().find(item => item.kind === "web-module")!;
    store.setLock(secondary.path, true);
    // Bounded public-store branch fixture, NOT a third SDK emission: the
    // genuine queue→report switch removes one path; this drops a second.
    const baseline = store.getState().rounds.at(-1)!.candidate;
    const baselineBytes = JSON.stringify(baseline);
    const turn = store.prompt("DEVELOPMENT multiple-removal source-only branch")!;
    store.settle(turn, { ...baseline, files: baseline.files.filter(item => item.path !== secondary.path) });
    const selected = store.effectiveFiles()[0]!.path;
    store.selectFile(selected);
    store.setView("gate");
    const out = render(controller.workbench);
    expect(out).toContain("Removed source conflicts (2)");
    expect(out).toContain(`aria-label="Removed source ${file.path}"`);
    expect(out).toContain(`aria-label="Removed source ${secondary.path}"`);
    expect(out).toContain("This path was locked");
    expect(out.indexOf('<details class="fd-removed-conflicts"')).toBeLessThan(out.indexOf('class="fd-body"'));
    expect(observed.props!.drafts.map(item => item.path)).toEqual(expect.arrayContaining([file.path, secondary.path]));
    observed.props!.onResolve(secondary.path, "studio");
    expect(store.getState().selectedPath).toBe(selected);
    expect(store.getState().drafts.get(file.path)?.conflict?.kind).toBe("removed");
    expect(store.getState().locks.has(secondary.path)).toBe(true);
    expect(store.effectiveFiles().some(item => item.path === file.path || item.path === secondary.path)).toBe(false);
    expect(render(store)).toContain("Removed source conflicts (1)");
    observed.props!.onResolve(file.path, "studio");
    expect(render(store)).not.toContain("Removed source conflicts (");
    expect(JSON.stringify(baseline)).toBe(baselineBytes);
  });
  it("never shows latest private retained text in historical or reset contexts and refuses stale decisions", () => {
    const { store, file } = seed();
    render(store);
    const stale = observed.props!;
    store.selectRound(store.getState().rounds[0]!.id);
    const before = store.getState();
    const historical = render(store);
    expect(historical).not.toContain("DEVELOPMENT saved");
    expect(historical).not.toContain("DEVELOPMENT pending");
    expect(historical).not.toContain("Removed source conflicts (");
    stale.onResolve(file.path, "studio");
    expect(store.getState()).toBe(before);
    store.selectRound(store.getState().rounds.at(-1)!.id);
    render(store);
    const resetStale = observed.props!;
    store.reset();
    const reset = store.getState();
    resetStale.onResolve(file.path, "mine");
    expect(store.getState()).toBe(reset);
    expect(render(store)).not.toContain("DEVELOPMENT pending");
  });
  it("does not act on a refreshed conflict through an older rendered callback", () => {
    const { store, controller, file } = seed();
    render(store);
    const stale = observed.props!;
    expect(controller.acceptRegisteredTemplate(report.outcome, report.receipt)).toBe(true);
    const fresh = store.getState();
    stale.onResolve(file.path, "studio");
    expect(store.getState()).toBe(fresh);
    expect(render(store)).toContain("Removed source conflicts (1)");
  });
  it("keeps unsaved-only removed typing dirty and separate from the held generated project copy", () => {
    const { store, file, pending } = seed(false);
    expect(store.getState().drafts.get(file.path)?.saved).toBeNull();
    render(store);
    observed.props!.onResolve(file.path, "mine");
    expect(store.getState().drafts.get(file.path)?.saved).toBe(file.contents);
    expect(store.getState().drafts.get(file.path)?.buffer).toBe(pending);
    expect(store.effectiveFiles().find(item => item.path === file.path)?.contents).toBe(file.contents);
    expect(render(store)).toContain("● unsaved");
    expect(captureSubappSnapshot.bind(null, store.getState())).toThrow(/in-session Save/);
  });
  it("exposes the locked but never edited removal without claiming there is pending typing", () => {
    const controller = new StudioController(() => { throw new Error("No transport permitted"); });
    const store = controller.workbench, file = removedFiles().find(item => item.kind === "routes-domain")!;
    controller.acceptRegisteredTemplate(operations.outcome, operations.receipt);
    store.setLock(file.path, true);
    controller.acceptRegisteredTemplate(report.outcome, report.receipt);
    const out = render(store);
    expect(out).toContain("This path was locked");
    expect(out).toContain("Editor buffer (no unsaved changes)");
    expect(out).not.toContain("Pending editor buffer (unsaved)");
    observed.props!.onResolve(file.path, "mine");
    expect(store.getState().drafts.get(file.path)?.buffer).toBe(file.contents);
    expect(isDirty(store.getState().drafts.get(file.path)!)).toBe(false);
    expect(store.getState().locks.has(file.path)).toBe(true);
    expect(store.effectiveFiles().find(item => item.path === file.path)?.contents).toBe(file.contents);
    expect(captureSubappSnapshot.bind(null, store.getState())).toThrow(/unsupported artifact inventory/);
  });
  it("collapses the kept-only warning so it does not consume the mobile editor workspace", () => {
    const { store, file } = seed();
    render(store);
    observed.props!.onResolve(file.path, "mine");
    const out = render(store);
    expect(out).toContain("Kept removed sources (1) — in-session only");
    expect(out).toContain('<details class="fd-removed-conflicts"><summary>Kept removed sources');
    expect(out).not.toContain('<details class="fd-removed-conflicts" open=""');
    expect(out).toContain(`aria-label="Edit ${file.path}"`);
    expect(out).toContain("● unsaved");
  });
  it("the retained editor's existing Restore generated action also navigates off the removed path", () => {
    const { store, file } = seed();
    render(store);
    observed.props!.onResolve(file.path, "mine");
    render(store);
    observed.files!.editorFor!(file.path).onRestore!(file.path);
    expect(store.getState().selectedPath).not.toBe(file.path);
    expect(store.effectiveFiles().some(item => item.path === store.getState().selectedPath)).toBe(true);
    expect(store.getState().drafts.has(file.path)).toBe(false);
    expect(captureSubappSnapshot(store.getState()).files.some(item => item.path === file.path)).toBe(false);
  });
});
