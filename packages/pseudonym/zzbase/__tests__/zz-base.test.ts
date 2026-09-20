import { describe, it } from "vitest";
import { tokenize } from "../tokenize";
function tryTok(t: string) {
  try { tokenize(t, {}); return "ok"; } catch (e: any) { return "THREW " + e?.name; }
}
describe("BASELINE pre-fix b38ed42", () => {
  it("cases that THROW after the fix", () => {
    const probes = [
      "Please ping @ops.team for help.",
      "Follow us @acme.io on the socials.",
      "Reviewed by\n@alice.dev\nthanks",
      "cc @team\n@release.notes updated",
      "Deploy tag v1.2 @ prod.eu cluster.",
      "Ask\n@\nsupport.de",
      "We were at the dot com peak.",
      "Nothing happened at the dot org level.",
      "It ran at every dot release.",
      "look at that dot com nonsense",
      "I looked at github.com and found nothing.",
    ];
    for (const p of probes) console.log("BASE", JSON.stringify(p), "=>", tryTok(p));
  });
});
