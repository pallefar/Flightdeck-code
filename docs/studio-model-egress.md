# Studio OpenAI-compatible model egress

Scope: the server-owned `local` / OpenAI-compatible connection. This is not an Anthropic transport change, host gateway approval, vendor probe, deployment or production-readiness approval. Destination/send review is **not** an SSRF control.

## Trusted startup contract

Existing configuration remains server-only:

- `STUDIO_LOCAL_BASE_URL`: absolute canonical base URL, at most 2,048 characters; the adapter appends `/chat/completions`.
- `STUDIO_LOCAL_MODEL`: existing bounded model identifier.
- `STUDIO_LOCAL_API_KEY`: optional explicit bearer key. No ambient OpenAI key or credential-file lookup.
- `STUDIO_MODEL_CONNECTION=local`: optional explicit default selection. Without selection, requests remain blocked; there is no fallback.

New **nonsecret** trusted-server configuration:

```sh
STUDIO_MODEL_APPROVED_ORIGINS='["https://models.example.test","https://models.example.test:8443"]'
```

This is a JSON array, not CSV. The raw environment value is at most 4,096 UTF-8 bytes. There may be at most 16 unique origins, each at most 256 characters; the serialized validated array is also bounded to 4,096 characters. Every entry must equal its canonical `URL.origin` and use HTTPS. Lowercase ASCII DNS/punycode labels or canonical IPv4 host spellings are supported. No userinfo, paths, trailing slash, query, fragment, whitespace, wildcard, trailing hostname dot, default-port spelling, uppercase normalization or duplicate entry is accepted. Remote IPv6 origins are unsupported. Omission means an empty allowlist; `[]` is valid, but an empty string, `null`, object or malformed JSON is invalid. The server marks the local connection unavailable with a fixed reason on invalid configuration, without exposing supplied values.

A remote HTTPS base URL must match an approved origin **exactly**, including a nondefault port. Explicit destination/origin port zero is refused: it must not be converted into a protocol default by Node. Origin approval does not authorize an arbitrary browser endpoint. The base URL, headers, bearer key, transport, origin policy and model remain trusted server configuration; model routes reject browser overrides before model resolution/transport.

Canonical literal-loopback HTTP remains a deliberate development exception: `http://127.0.0.1[:port]` and `http://[::1][:port]`, optionally with a base path. No allowlist entry is required for that exception. `localhost`, alternate IPv4 spellings, expanded IPv6 spellings and explicit-zero/normalized/default/zero-padded destination ports are refused. This exception is permission to reach server-configured loopback development services, not an approval for production remote HTTP. This restriction concerns destination URLs, not a fixture's legitimate `server.listen(0)` ephemeral binding.

Configuration validation, construction, descriptor listing and connection resolution perform **no DNS or socket operation**. Configured connections remain `verification: "not-probed"`; this is not proof that the destination exists or will accept a completion.

### TypeScript API

`OpenAiCompatibleOptions.approvedOrigins?: readonly string[]` is the equivalent trusted startup policy. `validateModelApprovedOrigins` validates, copies, sorts and freezes it. The adapter validates this policy even when an injected `fetchImpl` is supplied. Model, explicit key and trusted transport references are also captured once at construction; later mutation of the caller's options cannot replace validated request values or the selected transport. Reconstruct the adapter/registry deliberately when startup configuration changes.

`fetchImpl` and registry `localFetch` are **trusted deterministic test seams only**. They replace the socket implementation, so do not provide production DNS/socket confinement. They must never be wired from a browser/model or used as a general production fetch/proxy override. Leaving them absent selects the pinned Node transport, not global `fetch`.

## Connection-time confinement

Each real remote invocation performs one `dns.lookup(hostname, {all:true, verbatim:true})`. Every returned record must be a valid supported public IPv4 address with matching family `4`. Empty answers, more than 64 results, unsupported families, all IPv6 (including mapped addresses) and any mixed safe/unsafe answer fail before a socket is opened.

The address policy conservatively denies the complete IANA IPv4 Special-Purpose ranges, including their globally reachable special-purpose exceptions, plus multicast and Azure's platform virtual IP `168.63.129.16`. It therefore also excludes private, loopback, shared/CGNAT, metadata/link-local, documentation, benchmarking, reserved and broadcast destinations. There is no attempt to classify remote IPv6 as safe. The resources transport was inspected but not reused: its private address helper is not exported and its REST/MCP payload/status/timeout contracts differ. No shared resources policy was modified.

The selected checked address is copied, placed directly in the Node request's numeric `hostname`, and also supplied by a constant lookup callback. No second resolver, alternate address, automatic family selection, retry, redirect, reused/global agent or ambient proxy is used. The HTTP `Host` and TLS SNI retain the approved origin's hostname; certificate verification is explicitly enabled and the Node TLS identity checker is bound to that original hostname, not the pinned numeric address. Literal HTTPS IPv4 uses IP identity checking without DNS-name SNI. The HTTP loopback exception bypasses DNS and uses its exact literal address.

Requests use a fresh direct `agent:false` connection, `Connection: close`, a fixed POST and adapter-owned headers. There is no SDK, OAuth/credential-file resolution, implicit API-key environment fallback, custom credential resolver, remote redirect or proxy configuration in this transport. Normal Node trust roots remain applicable; this is not certificate/SPKI pinning or a claim that every runtime trust-root configuration is audited.

Sources for the fixed address policy:

- IANA IPv4 Special-Purpose Address Space registry, reported last update `2025-10-09`: `https://www.iana.org/assignments/iana-ipv4-special-registry/` (retrieved during this tranche).
- Azure platform virtual IP documentation: `https://learn.microsoft.com/en-us/azure/virtual-network/what-is-ip-address-168-63-129-16`.
- Node direct request/TLS interfaces: `https://nodejs.org/api/https.html`, `https://nodejs.org/api/tls.html`, `https://nodejs.org/api/dns.html`.

The range snapshot is deliberately conservative, not a dynamic IANA update service or an all-cloud metadata discovery mechanism. Exact trusted origin review, current address-policy maintenance and host/container/network egress controls remain necessary defense in depth.

## Binding and cancellation/accounting

The private local connection binding includes the canonical base URL, model, sorted complete approved-origin set and `MODEL_TRANSPORT_POLICY_ID`. Policy-only changes therefore change the binding and invalidate exact-context send reviews, even when the selected endpoint/model stay the same. Reordering equivalent allowlist entries does not change it. The current transport policy is `studio-model-pinned-v2-iana-ipv4-2025-10-09`; the zero-port correction changes bindings from the earlier v1 policy. The policy version must change when address/transport semantics change. Environment changes require reconstruction/restart; they are not a browser configuration channel. Keys remain absent from this nonsecret binding, preserving the existing local secret-rotation contract.

The adapter no longer races abort against a still-running fetch. Its returned promise remains pending until the original fetch and any response-body cancellation settle. The default transport settles after its actual owned socket closes, not just when an abort signal fires. A caller abort/deadline destroys that socket and returns a fixed safe failure. A late successful fetch/body after abort cannot become a successful model response.

`dns.lookup` is not cancellable here: if resolution ignores the deadline, the adapter retains work/admission capacity until that lookup settles, then refuses to connect. Likewise a broken trusted injected fetch or body cancellation can remain pending forever. This is intentional truthful admission accounting, **not** a hard wall-clock settlement guarantee or proof that abort cancelled a remote effect. Admission shutdown can report an incomplete drain rather than silently freeing capacity or retrying.

Limits are retained: serialized request at most 256,000 bytes; default response at most 256,000 bytes (configurable 1–1,000,000); default timeout 30 seconds (configurable integer 1–120,000 ms). The native transport additionally caps response headers at 16,384 bytes. Body bytes are checked before buffering beyond the configured cap; JSON and UTF-8 validation, one-choice/non-tool completion rules, truncation behavior and fixed sanitized errors remain in place. The exported low-level request boundary now also replaces URL/DNS/native-construction exceptions with the fixed failure without input/cause details, after awaiting the original operation; it introduces no early abort race or new public settlement API.

## Verification and remaining scope

Executable evidence covers actual literal IPv4 and IPv6 loopback HTTP completion, caller abort, stalled headers/body, oversized headers/body, invalid UTF-8, early disconnect and empty HTTP 204/205. The two-server redirect fixture observes one source request/socket and **zero target sockets**. An isolated child supplies proxy variables, `NODE_USE_ENV_PROXY` and an unauthorized ambient API-key sentinel: only the intended loopback destination is called, no authorization header is inherited, and the proxy sees zero requests. The child accepts only the exact native Node experimental proxy-warning lines, not arbitrary stderr or credential/transport details.

Remote DNS/address and TLS-option tests use mocked DNS and a deliberately translated trusted local socket fixture. They check every mixed answer, IPv6/mapped and unsupported-family rejection, immutable pinning, no re-resolution, original `Host`/SNI/identity verification, rejection of a subsequently rebound answer, and retained work through delayed DNS settlement. **They are not live remote HTTPS/vendor or real remote TLS-handshake evidence.** All real test sockets are loopback fixtures; no model/vendor requests are made.

Authenticated composition-root tests demonstrate rejection of browser policy/header/key/destination overrides, actual stale-send-review refusal after a policy-only change, preserved no-selection/not-probed behavior and retained admission capacity through original ignored-abort fetch settlement. No existing auth, privacy, fixture or admission limits were relaxed. No deployment, active services, active credentials, host database or persistent runtime state were changed.

See `docs/evidence/studio-model-egress-tdd-2026-10-15.json` for observed vertical RED/GREEN checkpoints and the generated focused/integration reports for final test results. Whole-worktree build/typecheck results are scoped to the shared uncommitted checkout, not an independently reviewed release.

## Parent source and execution check — October 15, 2026

Parent reread all production changes and the socket/DNS/accounting tests, verified all **7 delivered source hashes**, then independently reran the exact focused-plus-related test set: **216 unique test identities across 11 files passed, zero failures or pending/skipped tests**. The generated parent report is `docs/evidence/next-ui/model-egress-parent-tests.json`; `model-egress-parent-check.json` records hashes, test recount and scope.

The parent also fetched the current official IANA XML over verified HTTPS. Its reported update remains **2025-10-09**; all **25 rows / 26 expanded CIDR networks** are contained by the implementation's conservative denied supernets. Official Node 22 HTTPS/TLS and Azure platform-IP references were fetched successfully and their hashes retained. This checks the stated reference snapshot, not future registry changes, every cloud-specific service address, or an executed remote TLS handshake.

The original independent read-only critique is now complete and found the port-zero defect below. No actual model/vendor request, active-state mutation or deployment occurred in parent verification. Final merged/candidate-image acceptance is still separate; the running private demo has not been upgraded with this transport.

## Independent critique and v2 remediation

Original report, exact reviewed hashes, executable guarded probes and generated **134-case** independent focused report are archived under `docs/evidence/next-ui/model-egress-independent/`. Before editing, parent verified all seven worker source hashes and all seven reported artifact hashes; the original snapshot and evidence remain unchanged. This is a pre-fix review, not approval of the later v2 code.

The critic demonstrated **R1/P2**: `https://approved.test:0` was approved/bound, but Node's effective native destination used **443**, and loopback HTTP zero used **80**. It required trusted startup misconfiguration, not arbitrary browser SSRF, but violated the exact-origin port contract. Parent reproduced these effective ports in a child whose `Socket.connect` records options and throws **before OS connect**, with deterministic DNS and zero actual connections. A valid **8443** control remains exactly 8443.

Strict RED/GREEN corrections now reject zero in both public validators and independently at the exported transport before DNS. The native child checks five canonical/normalized zero URL forms, no DNS or socket attempts for them, and real-registry unavailability, while retaining numeric address/family and port 8443 in the native control. A separate RED/GREEN test proves the v2 binding differs from v1 for the same valid URL/model/origins.

The two nonblocking direct-API observations were also reproduced and repaired: later mutation of model/key/transport options cannot change a constructed adapter, and URL/DNS/native-request failures from the low-level export are sanitized without a cause or input field. The original audit did not demonstrate either as a current HTTP composition-root bypass.

Parent's post-fix focused run passed **144 unique tests / 4 files**. The broader root/admission/readiness/setup/client/signal run passed **301 unique tests / 14 files**, including those 144, with zero failures/pending tests. Do not add overlapping test totals. Typecheck, build and whitespace checks passed; the existing Vite chunk-size warning remains. Generated reports are `parent-remediation-focused.json` and `parent-remediation-related.json`.

Parent also reran the separately guarded six real-loopback scenarios into `parent-remediation-sockets.json`: six loopback connections, zero forbidden DNS/external attempts. Success and abort both retained one admission slot while actual owned-client close notification was held, then released it after notification. Native destruction was not delayed; this is not proof that a live OS handle was kept open. These six scenarios are separate from the Vitest test count.

The fresh independent scoped R1/O1/O2 re-audit has completed: **R1 closed; O1/O2 repaired; no additional reachable egress or premature-settlement defect found within that scope**. Parent independently matched all seven reviewed source hashes plus two unchanged admission/planner-bridge dependency hashes, recounted **144 unique passing focused cases**, and verified the separately enumerated **24 independent probe rows** and **six real-loopback rows** with zero external/vendor/OS-remote-connect attempts. These sets are separate, not an expanded unique Vitest total.

The re-audit includes nine zero-port spellings before DNS/native connect, six pre-OS-connect effective-port controls, independent exact v2-binding reconstruction, three calls after replacing caller-owned option properties with throwing getters, fixed low-level error boundaries and original DNS/fetch/body-cancellation/close-notification accounting. Its close fixture holds only notification delivery, not native destruction. Reviewer-only harness corrections and failed-attempt notes remain disclosed.

The report and measured results are durably copied under `docs/evidence/next-ui/model-egress-independent/reaudit/`; `review-deliveries-parent-check.json` and the bridge remediation verification record contain parent hash/count checks. Native remote HTTPS/TLS handshakes, final new-candidate/runtime/release acceptance and production certification remain unverified. No code was changed by the re-auditor and no deployment was made. Docker availability has since been restored by the user and the existing accepted services verified in `runtime-restored-readback.json`; those healthy retained images do not contain or accept this newer egress tranche.
