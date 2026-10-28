import { describe, expect, it } from "vitest";
import { buildEnvelope } from "../build";
import { AI_TASKS, FACT_KINDS, FACT_KEY_POLICY, HOST_AI_TASKS, HOST_FACT_KEY_POLICY } from "../allowlists";

const supportedTasks = ["map.suggest", "intake.fieldmap", "kb.question", "studio.workflow.summarise", "studio.spec.draft", "studio.widget.suggest"];
const labels = ["sourceLabels", "templateLabels"];
const secret = "private label salary 82000";

describe("host declaration metadata is not Studio wire admission", () => {
  it("records the current converter/labels declarations while retaining the exact supported task/kind surface", () => {
    expect(HOST_AI_TASKS).toEqual(["map.suggest", "intake.fieldmap", "kb.question", "converter.match"]);
    expect(AI_TASKS).toEqual(supportedTasks);
    expect(FACT_KINDS).toEqual(["enum", "count", "fieldName", "text"]);
    for (const key of labels) {
      expect(HOST_FACT_KEY_POLICY[key]).toEqual({ kind: "labels" });
      expect(Object.hasOwn(FACT_KEY_POLICY, key)).toBe(false);
    }
  });

  it("explicitly refuses the declared but unsupported task even without facts", () => {
    const result = buildEnvelope({ task: "converter.match", facts: {} });
    expect(result.ok).toBe(false);
    if (result.ok) throw Error("unsupported task reached wire");
    expect(result.failures).toContainEqual({ code: "unsupported-task", at: "task", expected: "a member of AI_TASKS" });
    expect(result).not.toHaveProperty("wire");
  });

  it.each(supportedTasks)("refuses every labels fact representation under supported task %s", task => {
    for (const key of labels) for (const fact of [{ kind: "labels", value: [secret] }, { kind: "text", value: secret }, { kind: "count", value: 1 }, secret]) {
      const result = buildEnvelope({ task, facts: { [key]: fact } });
      expect(result.ok).toBe(false);
      if (result.ok) throw Error("unsupported fact reached wire");
      expect(result.failures).toContainEqual({ code: "unsupported-fact-channel", at: "facts.#0" });
      expect(result).not.toHaveProperty("wire");
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it("does not reopen labels through the pseudonymised text channel or a top-level channel", () => {
    for (const key of labels) for (const input of [
      { task: "kb.question", text: [{ key, text: secret }] },
      { task: "kb.question", [key]: [secret] },
    ]) {
      const result = buildEnvelope(input);
      expect(result.ok).toBe(false);
      expect(result).not.toHaveProperty("wire");
      expect(JSON.stringify(result)).not.toContain(secret);
    }
  });

  it.each(supportedTasks)("still builds the same closed structured wire for %s", task => {
    const result = buildEnvelope({ task, facts: { docCount: { kind: "count", value: 4200 } } });
    expect(result.ok).toBe(true);
    if (!result.ok) throw Error("supported surface regressed");
    expect(JSON.parse(result.wire)).toEqual({ task, provider: result.provider, model: result.model, facts: { docCount: { kind: "count", value: 5000 } } });
    expect(result.disposition).toBe("ready");
  });
});
