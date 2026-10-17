import { candidate } from "../../workbench/__tests__/fixtures";
export function subapp() {
  const c = candidate();
  const { icon, navSection, capabilities, visibleToRoles, ...plan } = c.manifest;
  return { status: "subapp-result", target: "subapp", determination: { target: "subapp", reason: "An isolated application" }, outcome: { status: "proposed", understanding: "A clock", generated: { plan: { ...plan, manifestData: { icon, navSection, capabilities, visibleToRoles } }, files: c.files, warnings: ["not mounted"] }, conformance: { ok: false, id: "wc-clock", findings: [{ rule: "FD-X001", severity: "warning", file: "(candidate)", line: 0, column: 0, message: "registry patch needed", evidence: null }], errors: [], warnings: [], rules: ["FD-X001"], checks: ["registration"], filesChecked: c.files.length }, artifacts: { verdict: "ready" } } };
}

export const workflow = {
  status: "workflow-proposed", target: "workflow", determination: { target: "workflow", reason: "A governed process, not an application." },
  workflow: { name: "Consultation", slug: "consultation", country: "DE", intakeFields: [{ name: "Start", type: "date", required: true }], steps: ["prepare", "human-review"], statutorySteps: ["human-review"] },
  pages: [{ slug: "consultation-review", title: "Consultation review", purpose: "Review open cases", sourceSkillIds: ["consultation-skill"], stepIds: ["human-review"], icon: "📋", navSection: "Contract pipeline", visibleToRoles: ["admin"] }],
  projectId: "project-a", skillSources: [{ id: "consultation-skill", version: "1", contentHash: "abc" }], warnings: [],
};
