# Private sub-app GET/HEAD framing remediation (F2)

This source checkpoint supersedes only the F2-pending note in the earlier frozen `studio-subapp-workspace.md` remediation checkpoint. The separate F1/F3/N1 review's five-file freeze is unchanged.

## Behavior

After the existing operator authentication succeeds, the sub-app routes reject GET/HEAD with positive Content-Length or **any** Transfer-Encoding, before any private-store method/property access. The response is fixed `400` / `Cache-Control: no-store` (HEAD has no response body). Absent/invalid credentials still receive `401` / no-store first. Empty/no-length and native-parser-admitted zero-length requests still perform the exact real store read. POST/PUT body parsing and limits are unchanged.

The guard uses wire framing because pinned Fastify skips its ordinary body parser for GET/HEAD. Rejecting all body framing is not a resource/concurrent-connection limit, not a host authentication policy, and not authentication precedence over malformed HTTP rejected by Node before route handling.

## Verification

- Exact two delivered source/test hashes match implementer delivery and archived snapshots.
- Implementer RED evidence: four Content-Length failures, then four chunked failures in the next vertical slice. Its final scoped route suite passed 73 records across two physical files (68 new + five existing), with no failures/skips; original logs/reports are preserved.
- Parent combined related suite: **122 passing physical assertion records across 9 files**, including the same 68 new read-body tests, current store/schema fixes and static-source core/UI tests. These totals overlap; they are not added together.
- Parent current unchanged package-scoped TypeScript check and diff-whitespace check exit 0. No `subapp-read-bodies-*` fixture roots remained at the parent metadata check: 0.
- Parent replay of the original independent 23-case native schema/filesystem/HTTP probe now passes with one explicit contract adaptation: oversized GET also returns **400**, because all GET/HEAD bodies are rejected before parsing, rather than the historical probe's expected 413 body-size-parser status. The original mismatch is preserved; only that expected status changes in the second replay, and its zero-store-access assertion remains. No test/validator was silently weakened.

Evidence: `docs/evidence/authoring-integration/workspace-f2-remediation/` (32 exact archived implementer artifacts plus parent hash manifest), `workspace-all-fixes-parent-tests.json`, `workspace-f2-parent-receipt.json`, `workspace-http-native-replay/`. Executable copied probes/config are inert `.snapshot` files. Owned replay roots were removed after real app/socket cleanup.

This is parent source verification, not a fresh independent review, whole-suite/runtime/browser acceptance, live-provider proof or deployment. The live private app was not updated.
