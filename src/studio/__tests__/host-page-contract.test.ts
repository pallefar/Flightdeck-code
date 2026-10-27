import { expect, it } from "vitest";
import { projectPageSchema } from "../../../packages/spec/src/studio-create";
import { workflowResultSchema } from "../result";
import { workflow } from "./fixtures";

const page = {
  slug: "review-queue", title: "Review queue", purpose: "Review open cases",
  sourceSkillIds: ["review"], stepIds: ["human_review"], icon: "📄",
  navSection: "Contract pipeline", visibleToRoles: ["legal"],
};
const sections = ["Overview", "Contract pipeline", "Ops & insight", "Admin", "System apps"];
const response = {
  ...workflow,
  workflow: { ...workflow.workflow, steps: ["intake_received", "human_review", "complete"], statutorySteps: ["human_review"] },
  skillSources: [{ id: "review", version: "1", contentHash: "a".repeat(64) }],
};

it.each(sections)("accepts the actual host navigation section %s across planner and client", section => {
  const native = { ...page, navSection: section };
  expect(projectPageSchema.safeParse(native).success).toBe(true);
  expect(workflowResultSchema.safeParse({ ...response, pages: [native] }).success).toBe(true);
});

it("rejects an over-wide icon independently of its navigation section", () => {
  expect(projectPageSchema.shape.icon.safeParse("clipboard").success).toBe(false);
  expect(workflowResultSchema.innerType().shape.pages.element.shape.icon.safeParse("clipboard").success).toBe(false);
});

it.each([
  { ...page, navSection: "work" },
  { ...page, icon: "clipboard" },
  { ...page, icon: "" },
])("refuses host-incompatible page metadata %# on both boundaries", unsafe => {
  expect(projectPageSchema.safeParse(unsafe).success).toBe(false);
  expect(workflowResultSchema.safeParse({ ...response, pages: [unsafe] }).success).toBe(false);
});
