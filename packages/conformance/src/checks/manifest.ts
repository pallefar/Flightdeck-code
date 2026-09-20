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

/** Every field the host's schema reads. A member that is not one of these
 * and not a function member is additive and ignored, exactly as the host's
 * non-strict schema ignores it. */
const DATA_FIELDS = [
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

const FUNCTION_MEMBERS = ["initSchema", "registerRoutes"];

export const manifestCheck: Check = {
  name: "manifest",
  run({ app, hostVersion }) {
    const out: Finding[] = [];
    const file = app.manifestPath;
    const scan = app.fileAt(file)?.scan ?? null;
    const at = (offset: number) => (scan === null ? NO_POSITION : scan.positionAt(offset));
    const evidence = (offset: number) => scan?.lineTextAt(offset);

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

    if (out.length === 0 && scan === null) {
      out.push(finding("FD-M001", CANDIDATE_SCOPE, NO_POSITION, "the manifest file could not be read"));
    }
    return out;
  },
};

function shorten(text: string): string {
  const single = text.replace(/\s+/g, " ").trim();
  return single.length <= 48 ? single : `${single.slice(0, 45)}...`;
}
