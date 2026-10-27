# Connected enterprise authoring — implementation contract

Status: **in progress, not a deployed enterprise system**. This milestone extends the existing Flightdeck Studio authoring pipeline; it does not replace Flightdeck OS identity, the registered workflow engine, the sub-app SDK, or independent approval. Existing provider, host integration, live reviewer and production deployment gates remain applicable.

## Product direction

A Flightdeck-native **Process Discovery** app turns an observed process into a reviewed, reusable build:

`Process facts → opportunities and assumptions → guided questions → V1 PRD → reuse/design/agent blueprint → explicit build review → Studio draft → checks → save/readback → separate run/release gates → grade and V2`

The primary surface is Configure / Command–Inspect. Keep the current chat-first Studio entry; Process Discovery is an explicit internal app/area, not a replacement landing page or an unrelated branded prototype.

The standalone shell is based on the user's **Flightdeck Atlas** source layout/theme at commit `0b5897bad64bea3ad9ee5c9df1bc3c275ae4d4e9`: its sidebar, breadcrumbs, typography and scoped Day/Night tokens, not a copied dashboard full of invented metrics.[7] Inherited host tokens remain authoritative when embedded; Studio navigation and audience choices do not create OS identity or membership.

### Reference principles, not copied products

OutSystems describes Mentor around enterprise context, model-driven visual blueprints, reuse, review and lifecycle governance. Adapt that approach into Flightdeck's own contracts and UI; these vendor descriptions do not certify Flightdeck security.[1]

Base44 is a user-specified reference for approachable design editing and templates. Its public search metadata was available, but direct design-document inspection was intercepted by an organization security warning. No warning was bypassed, upload performed, or exact UI behavior independently verified. Implement the user's visual-choice requirement using original Flightdeck components rather than claiming a clone or measured parity.[2]

OpenWork's repository documents reusable skills/MCP connections and a directory-split core/enterprise license. It is a reference only, not installed by this work and not the selected Cowork runtime.[3] The selected external target is **OpenCoworkAI/open-cowork**, identified from the user's Flightdeck repository; its repository identity has been verified, but runtime compatibility and confinement remain separate acceptance gates.[5]

MLX LM documents Apple-silicon inference, quantization and low-rank/full tuning. Runtime support is a prerequisite, not proof that a particular device/model/context/training workload fits or performs well.[4]

## 1. Enterprise ownership and backend connection

- Flightdeck OS remains the owner of canonical actor identity, membership, workspace/project scope and grants. Never create a competing Studio user directory or copy OS database/service credentials.
- Distinguish organizational roles, workspace membership, project organizing dimensions and individual action permissions. A builder, reviewer, publisher or operator label selected in a form is a requirements proposal, not an entitlement.
- Bind each effect to server-resolved actor/workspace/project, action, exact document revision and policy/authority epoch. Validate session and CSRF at the actual host boundary; recheck after waits and immediately before effects.
- Preserve independent author/reviewer separation. Generating, validating, saving, reviewing, running, installing and releasing are separate transitions.
- Keep existing source-only/disabled host adapters closed until the actual host interfaces are verified and deliberately mounted. A development context is not a production principal.
- Authenticated endpoints must use strict bounded DTOs, existing no-store/private transport policy, exact CAS/readback and sanitized audit metadata. Unknown scope or policy refuses rather than silently choosing an account/project.
- Do not change running Studio/OS/companion services, launcher, grants, database credentials or host registration merely to demonstrate this milestone.

## 2. Harness, Studio and Cowork

Use the existing bounded draft harness and registered tools for catalog/schema reads, clarification, candidate-scoped draft proposals/patches, validation and safe preview. One shared run/context/budget and exact-context send review covers all agents and model turns.

The Cowork boundary is an adapter to this broker, not a second privileged executor. Do not adopt arbitrary filesystem, shell, plugin installation, network, model fallback, raw tracing or deployment defaults. External skill/tool content remains third-party input.

The external Cowork product is **OpenCoworkAI/open-cowork**, identified from the user's existing Flightdeck repository.[5] The pinned source/API/default-permission audit is complete; the connector remains explicitly **not connected / confined adapter pending**. Source discovery is not runtime permission or compatibility acceptance. Do not install its unrestricted tool defaults, migrate credentials, launch it against host data or advertise a working connection.

OpenHarness is the **Open-Harness/open-harness** project named in `docs/HARNESS-NOTES.md`, also called Open Scaffold.[6] Its actual consolidated package is `@open-harness/sdk`; the source audit pin is `4645c5dca3598c5da5ea83cbd543674153ffced0`, and published-core verification is recorded separately from Studio runtime adoption. The initial bounded proof used the actual SDK with Flightdeck's existing read-only draft broker, no model sends, explicit nonpersistent stores and OS-denied probe networking. Its default HOME-directory creation, incomplete replay binding and abort-before-original-work-settlement behavior preclude treating an SDK handle as Flightdeck authority or completed admission drain. The optional project command `npm run verify:openharness -- --scratch-parent <owned-directory>` is implemented and has passed 43 actual checks: native confinement controls, SDK runtime behavior, the existing read-only Flightdeck broker and held-original-promise drain. Acquisition is locked and probes run with networking denied and writes confined to owned scratch. Independent source review found no blocking issue in this optional-verifier scope; parent verification matched every reviewed source hash and reran all 10 helper tests successfully under native network/write confinement. Those helper tests are separate from, not additive to, the 43-check SDK proof. Acquisition/process-log streaming byte ceilings remain a nonblocking hardening item; current timeouts and broker-output limits are not a general output-byte sandbox. This is a verification harness, not Studio production orchestration or live Cowork connectivity.

## 3. Reuse before generation

Build one scoped context index over actual registered components, widget/report schemas, workflow fragments, generated artifacts, approved templates, skills and tools. Each entry needs:

- stable identity, kind, version/content digest and owner scope;
- source/provenance, license and review state;
- input/output/schema contract, dependencies and compatibility;
- metadata summary separated from lazily fetched full content;
- authorized operations and current availability, not inferred authority.

Prefer an exact compatible reviewed artifact; otherwise compose approved pieces; generate only the missing delta. Resolve dependency impact before changing a shared component. Do not modify a reviewed shared artifact in place without a new version and review.

Search authorized metadata first and expand only relevant, approved details. Scope caches by actor/workspace/project, policy epoch, artifact digest and model/context binding. Invalidate on revocation. Measure actual token usage/cache reuse; do not invent a percentage saving or claim that fewer prompt bytes guarantee a financial cap.

## 4. Deterministic model gateway

Route by explicit server-owned rules, not an LLM deciding which LLM should run. Order checks before ranking:

1. authoritative allowed profile IDs and current connection binding;
2. data locality/egress and actor/project action policy;
3. configured status, evaluated task quality and required capabilities;
4. context plus bounded output allowance;
5. known exact price estimate and request budget;
6. deterministic cost/quality/profile-ID tie-break.

Device-only means the device, not an arbitrary private server. Unknown pricing is not zero. A profile must pass an evaluation appropriate to the task; hardware fit does not establish quality. No eligible model means a clear refusal.

Return a route **proposal** with reasons and policy version. Explicit review binds exact destination/model/context/policy before send; recompute and refuse drift. No silent provider switch, repair loop, automatic fallback or credential discovery. Estimates are not a hard monetary guarantee, and zero inference price excludes operational cost unless explicitly modeled.

The pure server policy module is implemented and has passed its focused tests and independent source review. Endpoint mounting, scoped catalog provenance, exact-review binding and provider dispatch remain separate; the policy-core tests do not establish live gateway integration.

## 5. Process Discovery and ROI

Ask for process purpose, owner/users, steps, evidence, volumes, active effort versus waiting time, errors/rework, current systems, constraints, data sensitivity and desired outcomes. Tag facts as observed, user-estimated or inferred; suggestions must explain the evidence and missing information.

Offer distinct outcomes: reuse an existing capability, configure a workflow, build a sub-app/report, improve the process without software, or do not build yet. A positive model opinion is not business approval.

ROI must expose editable assumptions and units. Separate released staff capacity from realizable cash benefit. Include adoption, implementation/migration/training effort, ongoing operations/model cost and a stated horizon. Show uncertainty/scenarios; leave unknown quantities unknown rather than fabricating a baseline.

### Initial deterministic calculation core

`src/process-studio/roi.ts` calculates a simple first-year, steady-state estimate from explicit assumptions:

- annual cases, baseline and target active seconds/case;
- adoption and cash-realization basis points;
- loaded hourly cost, annual recurring cost and initial investment in integer minor currency units.

It separates capacity seconds/value, cash benefit, recurring operating cashflow, first-year net cash, first-year ROI basis points and payback in thousandths of a month. Signed BigInt rational intermediates remain exact through every downstream calculation: reported seconds/cents/basis points truncate toward zero only when each output is produced, and positive payback rounds upward. A displayed truncated value is never fed into the next formula. Zero initial investment gives an undefined ROI ratio, not infinity. Missing inputs remain incomplete, negative outcomes remain negative and unsafe/unrepresentable values refuse. All monetary inputs must use the same currency; there is no implicit conversion, discounting, tax, inflation, ramp or causal-proof model.

This is an explicit-assumptions calculation foundation, not a measured opportunity score or guaranteed financial forecast. The app must display its assumptions and limitations and add scenario/ramp handling explicitly rather than implying the initial core covers them.

### Maps / TEOA / OS source boundary

Read-only contract discovery found useful existing Advantage/TEOA process-KPI and opportunity shapes, Maps graph/timing provenance and OS workflow/session information. They are not a uniform labor baseline. Manual stopwatch elapsed time, authored estimates, improvement-card cycle time, queue counts and self-reported time saved remain distinct evidence classes; none automatically supplies annual active effort or realizable cash.

Do not connect Studio directly to these existing GETs merely because they are called reads: some Maps CI paths can persist defaults and host resolution/recovery paths can initialize state. The initial seam is an aggregate-only proposed export, with explicit exact workspace/project/source action policy, coverage, units, revision/window and minimum-cohort controls. No such authenticated export is mounted by this milestone; connector availability remains false. Statutory and human-only process gates stay unchanged. Unknown baseline/rates/adoption stay questions, not zero or fabricated savings.

## 6. Guided PRD and one-click V1

Use stable question IDs and a versioned decision log. Ask only the unanswered high-impact questions; let users say “unknown.” Cover target users, the smallest useful outcome, data/source ownership, required roles, integrations, primary screens/reports, acceptance criteria, success measures and explicit out-of-scope items.

Generate an editable PRD with requirement-to-artifact/test traceability, known assumptions, unresolved questions, reuse choices, data/permission boundaries and V1 acceptance criteria. Keep V2 wishes out of the first build unless explicitly promoted.

A visual blueprint shows the proposed pages/workflows/widgets, reused components, suggested agent responsibilities, data contracts, model route and estimated work/cost. Review must be tied to its exact revision; changes invalidate prior approval.

**Build V1** initiates the real existing Studio workflow/sub-app generator through the existing protected determination/review path or an explicitly typed deterministic SDK path. It must produce an actual accepted draft/source artifact, not a scripted success animation. Checks, durable save/readback, authorized execution, installation and deployment retain their separate gates. A one-click button does not authorize arbitrary code or real external side effects.

## 7. Templates and visual choices

Ship versioned original Flightdeck-native templates for an operations queue, a case/record workspace and an analytical report/dashboard. Derive actual usable schemas/components from current registries, not mock component names.

Use accessible visual chooser dialogs at decision points: template, layout/density, information hierarchy, fields/data source, role intent, reuse options, agent proposal and review. Persist the selection in the blueprint. Avoid repeated popups during every generation token; support Back/Cancel and retained pending edits.

Respect host Day/Night tokens, scoped styling, native focus/Escape/return behavior and short-screen containment. Design choices must not change security grants or silently rewrite reviewed shared components.

## 8. Hardware-aware local model advisor and optional tuning

Inspect only nonsecret capabilities on explicit opt-in: platform/architecture, RAM, supported GPU/runtime and available storage. Do not collect serial numbers, hostname, credential files or arbitrary filesystem inventories. Browser clients cannot claim to have measured GPU memory they cannot observe.

Recommend model/quantization/distillation variants from a source/version/license-pinned catalog with separate estimates for weights, KV/context, runtime buffers, OS/app headroom and concurrency. Distillation and quantization are different properties. Label every recommendation **estimate / benchmark required** until actually measured. Do not download a model, alter wired-memory limits, enable remote code trust or select a model automatically.

Offer optional adapter-tuning plans only where runtime/model/hardware support, private dataset consent, license, held-out evaluations, safety regressions, storage and export controls fit. Training and replacing a production model require separate explicit approval. Ratings alone do not authorize fine-tuning or dataset upload.

## 9. Suggested agents, generation state and widget editing

Show suggested roles such as process analysis, reuse/design, builder and validator as **proposed** until their scoped tasks actually begin. Available tools must be a subset of the parent broker's grants. Never imply that animated badges represent autonomous agents that were not dispatched.

Use a cancellable indeterminate **Generating** placeholder only while a real request is pending. Show sanitized actual phases/events when available; no fake percentage, countdown or fabricated completion. On accepted artifacts, animate decorative assembly/agent attachments while preserving fixed editing hitboxes. Support reduced motion, Pause/Skip and real failed/cancelled states.

For widgets/reports, right-click opens a scoped contextual editor; a colorful pen button and keyboard equivalent provide the same action. Edit only schema-supported layout/content/data bindings. Show live safe preview and exact diff, preserve pending drafts and provide Apply/Undo. Changing a widget cannot widen data access, execute generated JavaScript or activate a connector.

## 10. Grades and V2+

Let users grade correctness, usefulness, visual quality and reuse, with optional bounded comments. Bind feedback to the exact artifact/PRD/blueprint/model/policy/template versions and trusted actor context. Treat it as feedback, not approval or training consent.

Plan V2 from reviewed feedback, measured outcomes and unresolved V1 requirements. Produce an impact/dependency/data-migration/test/release plan against the accepted V1 baseline; preserve working components and generate a minimal reviewed delta. Keep rollout and rollback of effects separate from source reversal.

## Current implementation boundaries

The source audit is complete for the mapped interfaces, not for runtime identity. Both host checkouts have matching bytes for the inspected contract files despite different Git HEADs. Studio still starts under its separate operator boundary, its host identity bridge is unmounted, and the host AI gateway's allowed tasks do not cover PRD/Studio generation. Do not substitute an unrelated allowed task or infer authority from matching source.

`src/process-studio/contracts.ts` declares the new retained process brief and explicit template, audience and capability-ceiling choices. `src/process-studio/roi.ts` handles deterministic explicit-assumption arithmetic. The new bounded browser build client validates exact project/review/template version and draft manifest ceilings, requires conformance and output-policy allowance, and independently hashes every ordered emitted file before admission. It does not authorize an OS operation, activate an agent, invoke a model, or prove cancellation stopped the server.

The server-only `server/deterministic-model-router.ts` now implements `chooseModelRoute(request, catalog, policy)` as a strict, zero-effect proposal core. Its focused tests and scoped strict TypeScript check have been rerun by the parent. It is not HTTP-mounted or connected to provider dispatch. Catalog configuration, evaluations, locality and permitted IDs are trusted server inputs, not facts measured by the router. Prices and the estimate ceiling must share one server-defined currency unit. A future gateway must derive nonlowerable task-quality/capability/privacy requirements from trusted operation/project policy, restrict catalog disclosure to that scope, and bind any actual send review to current pricing/evaluation/model/policy revisions; caller-declared requirements or approved IDs cannot establish authority.

The template compiler and retained five-step Process Discovery UI now exist against those shared contracts. The real composition root mounts authenticated `POST /api/studio/process/build`, sharing the existing request-admission owner; authenticated no-store health advertises the registered-template feature without resolving a model. All three closed templates have passed native loopback HTTP → strict browser DTO client → existing Workbench → private saved-source create/exact GET → reconstructed store/server GET → restored source comparison in isolated DEVELOPMENT fixtures, with zero model resolutions. This is genuine backend/client/source-persistence composition, not real-user browser sign-in, live OS authority, provider acceptance, deployment or generated-code execution.

The retained UI handoff has passed a fresh 125-assertion composed browser lifecycle against an isolated DEVELOPMENT root: exact reviewed build, genuine pending state, explicit source opening, cancellation/hide/edit/revert, selected saved/unsaved source guards plus confirmed identical-rebuild and Keep mine retention, late-response suppression and token/project/model scope cleanup. This fixture uses new private stores, an empty deny-execution resource registry, disabled credential setup/native model authoring and Vite environment-file loading disabled. It is not real-user sign-in or provider acceptance. The full host-source-aware repository gate now passes 4,803 Vitest assertions across 287 physical test files, all 41 Node test cases, typecheck, build and diff check, with no skipped tests. The isolated HOME must contain its own Hermes scratch directory, and ABI tests use the explicit reference source checkout rather than silently skipping when HOME changes. Exact authenticated-health expectations include the registered-template capability; public health remains unchanged. A pre-existing exact-byte harness test also freezes the duration clock, retaining its whole-file equality assertion and restoring the real clock afterwards. Original failed gate receipts remain retained. Fresh independent packaging-source review has passed within the explicitly bounded scope below; the UI and test-only delta also have a separate passing scoped verdict. The manifest-metadata repair has independently passed scoped acceptance: every consumed Candidate manifest field and applicable identity/dependency mirror is bound to local deterministic generation or exact reviewed choices. This is consistency acceptance, not host authority or privacy approval. The aggregate-evidence admission width-bound repair requires primitive JSON at or below 32,768 UTF-8 bytes before parsing; its current frozen source has passed fresh independent scoped acceptance. This local parser boundary does not authorize a live export. The original finding concerned an in-process native-parser gap, not a demonstrated live API attack.

The original independent review reproduced a blocking reconciliation defect missed by the earlier 95-check matrix: identical regeneration could discard an unsaved-only buffer, and Keep mine could replace current typing with older saved text. The shared reconciliation/resolution repair retains saved and pending layers independently; fresh independent review confirms both original data-loss cases are fixed. The held effective snapshot is deliberately distinct from the pending buffer; the original stronger probe remains red and unchanged, not relabelled green. A separate genuine Operations queue → Record-list report removal exposed unreachable conflict controls. The repaired Workbench presents every retained removed path outside effective-file-only editors, source search and hidden explorer/view panels, with escaped saved/pending inspection and explicit Keep mine / Take Studio decisions. Keep mine preserves independently unsaved typing and labels extra paths **in-session only**; Take Studio or explicit Restore generated can recover valid inventory-bound snapshot capture. Neither choice weakens baseline or durable inventory policy. Twelve composed regressions cover this UI. A separate 91-assertion mounted scenario exercises actual template HTTP/SDK builds, native Enter activation of both decisions, desktop source-focus mode, mobile closed explorer, locked pending source, explicit local Save, strict extra-path refusal and Restore generated. Its initial-build checks overlap the separate 125-assertion lifecycle; the counts are not added. Native geometry found that the expanded kept-only warning could hide the mobile editor despite correct DOM values. A retained RED→GREEN regression now collapses that resolved warning while leaving its in-session-only summary visible; the final locked mobile replay exposes at least 64 vertical CSS pixels of the editor after ancestor clipping. Zero model resolutions, browser errors and horizontal viewport overflow were observed. Rebuild confirmations remain controlled fixtures, not native-confirm accessibility proof; post-resolution native focus lands on the body, so these checks do not claim complete accessibility certification. The owned fixture was stopped and its exact remaining owned root explicitly removed after process exit. Fresh independent review accepts the final UI/test, evidence-bound and scoped packaging-source changes. Runtime promotion remains separately gated.

Aggregate evidence admission and assessment are local planning helpers, not mounted exports. They accept primitive serialized JSON only, with an inclusive 32,768 UTF-8 byte ceiling checked before JSON.parse or key enumeration; native objects, boxed strings and proxies are refused without inspecting their properties. Assessment still treats null/undefined as unavailable. The internal schema/semantic checks and frozen declared-unverified output remain conservative. This intentionally narrows the earlier native-object helper API; existing application panels use inert metadata only. Future adapters still require their own bounded transport and actual host-owned scope/action/privacy authorization, and this local bound does not cover caller-side string construction or hostile-JavaScript process isolation.

The ROI panel also discloses the actual Maps/TEOA/OS source boundaries through reusable inert metadata; all live connectors remain unavailable. Durable process-plan/feedback storage remains open. Existing saved-source snapshots must not acquire arbitrary process-plan fields: keep process briefs in session memory until an explicitly scoped durable contract exists. Saving generated source is not the same as saving the whole process plan.

Explicitly reviewed registered-template generation is a separate model-free path: compile the human's exact supported template choices to the existing `buildSubAppFromSpec` contract. It is not keyword-based workflow/sub-app classification, an excuse to bypass unstructured-request routing, or a general arbitrary-code generation endpoint. Its proposed output still passes the real native pipeline's privacy, consent and conformance gates and then the existing separate source review/save/readback/release controls.

### Runtime source packaging — source verification only

The final UI review passed its UI/test scope but failed overall on `PROCESS-RUNTIME-COPY-01`: the server composition root imported the deterministic compiler from `src`, while both Docker runtime source inventories omitted it. The original failed verdict and missing-module witnesses remain unchanged. Both recipes now explicitly copy only `src/process-studio/{plan,roi,contracts}.ts`. The API build context admits exactly those three `src` files and exact nonsecret ignore metadata required by its unchanged default-RUN tests; existing sensitive exclusions remain. The separate production build context retains complete TypeScript/frontend sources, while its runtime copies only the three compiler files from that tree. Bootstrap, operator authentication, recovery, image pins, dependency installation and live Compose configuration are unchanged.

Maintained context/COPY projections import the actual Node/tsx composition root, initialize Fastify, verify authenticated no-store health and unauthenticated refusal, and build all three templates with zero model/network/listen calls. The complete recipe/context-derived minimal API RUN passes all 41 Node cases without a Git checkout, Studio/browser source or development helper fallback. Missing compiler and ignore-metadata counterfactuals remain red. The initial 36/37 missing-`.gitignore` RUN and excluded-existing-input failures are preserved separately; a successful source-only COPY projection was not relabelled as a successful context proof.

These checks use a documented fail-closed grammar for the current ignore policies and the installed checkout dependencies by read-only convention. Inherited parent-directory exceptions admit ordinary scripts/deploy descendants; narrow actual COPY selectors do not make the entire build context leaf-only. Tightening that inherited policy is separate work, not part of this repair. These checks do not certify arbitrary Docker syntax, generated `dist` bytes inside a new image, the physical omit-dev dependency graph, an actual image build/start or deployment. The full merged checkout gate and fresh independent scoped packaging-source review pass; no runtime promotion is implied.

## Acceptance gates

- Actual source inventories and tests identify usable versus missing OS/Studio interfaces.
- Negative auth/scope/CSRF/reviewer cases refuse with no downstream effect.
- Routing is deterministic under catalog permutations and refuses privacy/capability/quality/price/binding drift.
- ROI distinguishes capacity/cash, unknowns, negative outcomes, precision and currency/horizon limits.
- A real guided PRD/blueprint produces an actual registered Studio artifact through the real pipeline.
- Reuse dependencies, provenance and saved readback survive navigation and revision changes.
- Template/choice/context editors work with pointer and keyboard on short mobile and desktop screens; draft state survives modal transitions.
- Generation events/animations/agent badges reflect real state, honor cancellation/reduced motion and do not move interactive hitboxes.
- Grades are version-bound and cannot train/change routes/grants without approval.
- Hardware suggestions do not install, upload, train or claim an unmeasured benchmark.
- Full host-aware tests/typecheck/build and independent source review precede publication. Runtime promotion and host mounting remain separate explicit operations.

## Sources

[1] https://www.outsystems.com/platform/mentor-ai-app-generation
[2] https://docs.base44.com/Building-your-app/Design
[3] https://github.com/different-ai/openwork
[4] https://github.com/ml-explore/mlx-lm
[5] https://github.com/OpenCoworkAI/open-cowork — OpenCoworkAI/open-cowork — selected integration target
[6] https://github.com/Open-Harness/open-harness — Open-Harness/open-harness — pinned source and published-core audit target
[7] https://github.com/pallefar/flightdeck-atlas — Flightdeck Atlas — source layout and theme reference
