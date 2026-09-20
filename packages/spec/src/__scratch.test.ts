import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { parseWorkflowMarkdown } from "./workflow";
import { planFromWorkflow } from "./workflowPlan";

const md = readFileSync(new URL("./__fixtures__/orchestrate-workflow.SKILL.md", import.meta.url), "utf8");
const qc = readFileSync(new URL("./__fixtures__/quality-check.SKILL.md", import.meta.url), "utf8");

const ANSWERS = { navSection: "Contract pipeline", visibleToRoles: "hr_preparer, hr_reviewer, legal", icon: "🧭" };

const AUTO = `---
name: close-works-council-clock
description: >
  Close the German works-council consultation clock once the statutory seven days have run,
  and move the contract on to the offer letter.
---

# close-works-council-clock

## Procedure
1. **Watch the clock** — read \`manifest.json\` and work out when the seven-day works-council window opened.
2. **Close the clock** — when the deadline expires, automatically mark the statutory works-council step approved and advance the contract to the offer letter.
3. **Tell the liaison** — post a Teams card to the works-council liaison saying it is done.
`;

const DISPLAY = `---
name: de-clause-checklist
description: >
  Walk a preparer through the four mandatory clauses a German employment contract must carry,
  in the order the pack lists them.
---

# de-clause-checklist

## Procedure
1. **Show the four mandatory clauses** — list them in the pack's order with the statute each one comes from.
2. **Explain the seven-day clock** — describe what the works-council window means for the preparer.
3. **Point at the template** — name the approved template each clause is drawn from.
`;

const VAGUE = `---
name: tidy-things
description: >
  Tidy things up a bit.
---

# tidy-things

## Procedure
1. Look at the list.
2. Sort it out.
`;

describe("scratch", () => {
  it("dumps", () => {
    const planned = planFromWorkflow({ workflow: md, answers: ANSWERS });
    if (planned.status === "planned") {
      console.log("CAPS:", planned.spec.capabilities, "TABLES:", planned.spec.tables.length);
      console.log("ROUTES:", planned.spec.routes.map((r) => `${r.method} ${r.path} [${r.capabilities}]`));
      for (const s of planned.spec.steps ?? []) console.log(`STEP ${s.ordinal} ${s.key} kind=${s.kind} gated=${s.gated} caps=${s.capabilities}`);
    } else console.log("NOT PLANNED", planned.status, JSON.stringify(planned).slice(0, 800));

    console.log("=== AUTO ===");
    console.log(JSON.stringify(planFromWorkflow({ workflow: AUTO, answers: ANSWERS }), null, 1).slice(0, 1600));

    console.log("=== DISPLAY ===");
    const d = planFromWorkflow({ workflow: DISPLAY, answers: ANSWERS });
    console.log(d.status, d.status === "planned" ? JSON.stringify({ caps: d.spec.capabilities, routes: d.spec.routes.map((r) => r.path), steps: (d.spec.steps ?? []).map((s) => [s.ordinal, s.kind, s.capabilities]) }) : JSON.stringify(d).slice(0, 900));

    console.log("=== VAGUE (no answers) ===");
    const v = planFromWorkflow({ workflow: VAGUE });
    console.log(v.status, v.status === "needs_input" ? JSON.stringify(v.questions.map((q) => [q.id, q.severity, q.question])) : "");

    console.log("=== QUALITY-CHECK ===");
    const p = parseWorkflowMarkdown(qc);
    console.log("ok?", p.ok, p.ok ? JSON.stringify({ cands: p.doc.stepSectionCandidates, section: p.doc.stepsSection, steps: p.doc.steps.map((s) => s.ordinal + ":" + s.title) }) : JSON.stringify(p.issues));
    const q = planFromWorkflow({ workflow: qc, answers: ANSWERS });
    console.log("plan:", q.status, q.status === "needs_input" ? JSON.stringify(q.questions.map((x) => x.id)) : q.status === "planned" ? JSON.stringify({ caps: q.spec.capabilities, warn: q.warnings.map((w) => w.code) }) : JSON.stringify(q).slice(0, 600));
  });
});
