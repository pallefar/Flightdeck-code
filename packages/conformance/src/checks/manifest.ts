/** Check 1 — would `loadValidatedManifests` accept this manifest?
 *
 * ⛔ THE STAKES, RESTATED. Validation in the host is fail-LOUD: it throws
 * on the first violation and never filters. A single malformed generated
 * manifest does not get skipped — it takes the whole Flightdeck server
 * down at boot, taking every other sub-app with it. That is why this check
 * exists at all, and why it reports EVERY violation at once instead of
 * stopping at the first the way the host does: a generator that surfaced
 * one field per round trip would be unusable.
 *
 * The rules are checked against the FILE's fields, read back out of the
 * source by `manifest-read.ts`, not against any object Studio holds. */
import type { Check } from "../check";
import { ROUTE_PREFIX_RE, routePrefix } from "../derive";
import { CANDIDATE_SCOPE, NO_POSITION, finding, type Finding } from "../finding";
import { exceedsHostCeiling, validateManifestData } from "../manifest-schema";
import type { ManifestSource } from "../manifest-read";
import type { ScannedFile } from "../scan";

/** ── EVERY MEMBER THE HOST'S MANIFEST CARRIES IS JUDGED ONE OF THREE WAYS ──
 *
 * The host's `SubAppManifest` (`server/subapps/types.ts`) is the Zod data
 * `subAppManifestSchema` validates, plus members Zod never sees. This check
 * VALIDATES the first (`DATA_FIELDS`), REQUIRES the host-called functions
 * (`FUNCTION_MEMBERS`) and REFUSES the rest (`REFUSED_MEMBERS`).
 * `manifest-members-drift.test.ts` reads the host's interface and fails on a
 * member in none of the three, so a member the host starts ACTING on cannot
 * pass this gate unexamined again.
 *
 * ⚠ THIS COMMENT USED TO SAY THE OPPOSITE: that any other member "is
 * additive and ignored, exactly as the host's non-strict schema ignores it".
 * True of the Zod schema; false of the host since OS-04 (host 42b0f308),
 * which acts on `contributions` at boot and at runtime without the schema
 * ever seeing it. A generated manifest carrying one passed this gate clean.
 *
 * A member the host does not declare at all is still ignored — the host's
 * Zod strips it and nothing else reads it. */

/** Every field the host's schema reads. */
export const DATA_FIELDS: readonly string[] = [
  "id",
  "label",
  "version",
  "minHostVersion",
  "icon",
  "navSection",
  "routePrefix",
  "webModuleId",
  "capabilities",
  "visibleToRoles",
  "settingsPanel",
  "widgets",
];

/** The function members the host calls on every manifest. Required. */
export const FUNCTION_MEMBERS: readonly string[] = ["initSchema", "registerRoutes"];

/** Members the host's `SubAppManifest` declares that a GENERATED mini-app
 * may never carry. Refused wherever the manifest file names them.
 *
 * `contributions` (OS-04) is how a sub-app reaches a HOST surface without the
 * host importing it: `/api/state` flags, background work handed the raw `db`
 * and workspace `root`, fixed connector rows, and the signing state of a
 * contract (`ContractDetail.signing`, the inbox's signing rows). Every
 * contribution point replaces a docusign-specific import, and the host acts
 * on the bundle at BOOT — `app.ts` calls `assertContributionsUnambiguous`,
 * which throws when a second sub-app claims the single-valued
 * `ticketSigning`. None of that is a mini-app's to touch, and none of it can
 * be judged statically: every point is a function. */
export const REFUSED_MEMBERS: readonly string[] = ["contributions"];

const REFUSAL_REASON: Readonly<Record<string, string>> = {
  contributions:
    "`contributions` is the host's OS-04 contribution bundle — `/api/state` flags, background work handed the raw db and workspace root, fixed connector rows, and a contract's signing state — and the host acts on it at boot: app.ts calls assertContributionsUnambiguous, which throws when a second sub-app claims the single-valued `ticketSigning` (docusign already does). A generated mini-app declares no host-surface contributions",
};

export const manifestCheck: Check = {
  name: "manifest",
  run({ app, hostVersion }) {
    const out: Finding[] = [];
    const file = app.manifestPath;
    const scan = app.fileAt(file)?.scan;
    if (scan === undefined) {
      return [finding("FD-M001", CANDIDATE_SCOPE, NO_POSITION, `${file} could not be read back out of the candidate`)];
    }
    const at = (offset: number) => scan.positionAt(offset);
    const evidence = (offset: number) => scan.lineTextAt(offset);

    if (!app.manifestRead.ok) {
      return [
        finding("FD-M002", file, at(app.manifestRead.offset), app.manifestRead.reason, evidence(app.manifestRead.offset)),
      ];
    }

    const manifest = app.manifestRead.manifest;

    // ── The fields have to be readable before they can be judged. ──
    for (const member of manifest.members) {
      if (!DATA_FIELDS.includes(member.key) || member.literal !== null) continue;
      out.push(
        finding(
          "FD-M002",
          file,
          at(member.valueOffset),
          `\`${member.key}\` is written as \`${shorten(member.valueText)}\`, not a literal — a computed manifest field cannot be reviewed before boot, and the host will run whatever it evaluates to`,
          evidence(member.valueOffset),
        ),
      );
    }

    // ── The host's own schema. ──
    for (const issue of validateManifestData(manifest.data)) {
      const member = issue.field === null ? null : manifest.memberAt(issue.field);
      const offset = member?.valueOffset ?? manifest.declOffset;
      const missing = member === null && issue.field !== null;
      out.push(
        finding(
          "FD-M003",
          file,
          at(offset),
          missing
            ? `\`${issue.path}\` is absent from the manifest — subAppManifestSchema requires it, and loadValidatedManifests throws at boot rather than skipping the sub-app`
            : `\`${issue.path}\` ${issue.message} — subAppManifestSchema rejects it, and that refusal stops the host booting at all`,
          evidence(offset),
        ),
      );
    }

    // ── The host-version ceiling, which the Zod shape cannot express. ──
    const minHostVersion = manifest.data["minHostVersion"];
    if (exceedsHostCeiling(minHostVersion, hostVersion)) {
      const offset = manifest.memberAt("minHostVersion")?.valueOffset ?? manifest.declOffset;
      out.push(
        finding(
          "FD-M004",
          file,
          at(offset),
          `minHostVersion is "${String(minHostVersion)}" but the host is ${hostVersion} — assertHostVersionCompatible refuses to boot a manifest that asks for a newer host`,
          evidence(offset),
        ),
      );
    }

    // ── Fields the host DERIVES from the id must equal the derivation. ──
    const declaredPrefix = manifest.data["routePrefix"];
    if (typeof declaredPrefix === "string" && ROUTE_PREFIX_RE.test(declaredPrefix) && declaredPrefix !== routePrefix(app.id)) {
      const offset = manifest.memberAt("routePrefix")?.valueOffset ?? manifest.declOffset;
      out.push(
        finding(
          "FD-M005",
          file,
          at(offset),
          `routePrefix is "${declaredPrefix}" but id "${app.id}" derives "${routePrefix(app.id)}" — the RBAC rule the shell builds covers the DERIVED prefix, so these routes would mount outside their own role fence`,
          evidence(offset),
        ),
      );
    }

    const declaredModule = manifest.data["webModuleId"];
    if (typeof declaredModule === "string" && declaredModule !== app.id) {
      const offset = manifest.memberAt("webModuleId")?.valueOffset ?? manifest.declOffset;
      out.push(
        finding(
          "FD-M005",
          file,
          at(offset),
          `webModuleId is "${declaredModule}" but the host derives the web module directory from the id, which is "${app.id}"`,
          evidence(offset),
        ),
      );
    }

    // ── The two non-Zod members. ──
    for (const member of FUNCTION_MEMBERS) {
      if (manifest.memberAt(member) !== null) continue;
      out.push(
        finding(
          "FD-M006",
          file,
          at(manifest.declOffset),
          `the manifest has no \`${member}\` member — SubAppManifest requires it, so this file does not type-check in the host and the build fails before anything mounts`,
          evidence(manifest.declOffset),
        ),
      );
    }

    // ── The id is also a directory name. ──
    const claimed = manifest.data["id"];
    if (typeof claimed === "string" && claimed !== app.directoryId) {
      const offset = manifest.memberAt("id")?.valueOffset ?? manifest.declOffset;
      out.push(
        finding(
          "FD-M007",
          file,
          at(offset),
          `the manifest declares id "${claimed}" but sits in \`server/subapps/${app.directoryId}/\` — the id derives the table prefix and the kill switch while the directory derives the import path, so the two disagreeing is a sub-app that half-exists`,
          evidence(offset),
        ),
      );
    }

    out.push(...refusedMembers(app.manifestPath, scan, manifest));

    return out;
  },
};

/** FD-M008: every place the manifest FILE names a refused member — as a key
 * (bare or quoted), a method, a getter, a shorthand, a computed key, or a
 * write after the declaration — plus every member whose name cannot be read
 * at all, since a spread or a computed key could carry one unseen. Words in
 * comments and in string VALUES (a label reading "Pension contributions") are
 * not code and are not findings. What no reader of this file can see —
 * another module attaching the member — the mount probe asks the object
 * itself (`verify/mount.ts`). */
function refusedMembers(file: string, scan: ScannedFile, manifest: ManifestSource): Finding[] {
  const out: Finding[] = [];
  const reported = new Set<number>();
  const report = (offset: number, message: string): void => {
    if (reported.has(offset)) return;
    reported.add(offset);
    out.push(finding("FD-M008", file, scan.positionAt(offset), message, scan.lineTextAt(offset)));
  };
  const importOffsets = new Set(scan.imports.map((ref) => ref.offset));

  for (const name of REFUSED_MEMBERS) {
    const reason = REFUSAL_REASON[name] ?? `\`${name}\` is a SubAppManifest member a generated mini-app may not declare`;
    for (const member of manifest.members) {
      if (member.key === name) report(member.keyOffset, `the manifest declares \`${name}\` — ${reason}`);
    }
    for (const match of scan.skeleton.matchAll(new RegExp(`(?<![\\w$])${name}(?![\\w$])`, "g"))) {
      report(match.index ?? 0, `the manifest file names \`${name}\` as code — ${reason}, and attaching it any other way is still declaring it`);
    }
    for (const literal of scan.strings) {
      if (literal.value !== name || importOffsets.has(literal.offset)) continue;
      report(literal.offset, `the manifest file names \`${name}\` as a property key in a string — ${reason}, and a string-keyed write is still a declaration`);
    }
  }

  for (const member of manifest.unreadable) {
    report(
      member.offset,
      member.kind === "spread"
        ? `the manifest spreads \`${shorten(member.text)}\` into itself — a spread can carry \`contributions\` or any other member where no reader of this file can see it, so every member must be written out`
        : `the manifest has a computed key, \`${shorten(member.text)}\` — a computed key can name \`contributions\` or any other member without the name appearing in the source, so every key must be written out`,
    );
  }
  return out;
}

function shorten(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= 48 ? single : `${single.slice(0, 45)}...`;
}
