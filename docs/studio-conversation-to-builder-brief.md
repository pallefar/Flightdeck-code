# Conversation → builder experience brief

## Direction

The primary surface is **Command / Inspect**: the operator starts with an idea in a real conversational composer and moves into a technical workspace once a validated server result establishes its destination. Lovable supplies a general conversation/workspace interaction reference, not a copied brand or a claim of feature parity. Flightdeck keeps its own identity, theme tokens, authorization and host boundaries.

The user explicitly requests a more futuristic, animated chat experience with a clear transition into separate sub-app and workflow builders. This is an implementation in the existing React application, not a standalone visual mockup.

## Flow

1. **Describe.** A bounded in-memory conversation, usable prompt suggestions that prefill only, accessible send/cancel, and disclosed real connection/project setup. With no configured model, typing/local examples remain available but model submission stays blocked.
2. **Clarify/review.** Actual server questions, refusals and exact-context skill-send reviews appear in the conversation. They are not replaced with generic assistant prose. No destination is guessed from user keywords.
3. **Route.** Only a valid `workflow-proposed` or `subapp-result/proposed` response selects the builder. The existing protected classifier/planner/graph pipeline is authoritative. Waiting is indeterminate; it does not establish which stage a non-streaming API has reached.
4. **Workflow IDE.** Keep the conversation alongside the real editable DAG, typed modal settings, input mapping, block palette, registry manifest and saved-workspace/history controls. Prefer builtins; show actual declarative wrapper proposals and require the existing human-review action before manual addition. No graph reference grants connector authority.
5. **Sub-app IDE.** Keep the conversation alongside the real generated source tree, editable file drafts, changes, checks and existing scriptless preview. Source edits do not install or execute generated code in the host.
6. **Continue safely.** Existing edited graphs and unapplied settings require the editor's real replacement confirmation. Preserve saved document identity on ordinary navigation. Cancellation, stale scope and invalid/refused results never overwrite or route into a new accepted workspace.

The current create API returns a complete response rather than live per-tool progress. Node/file arrival animation may reveal **received** artifacts; it must not pretend to stream model work, install files or execute a workflow after that work has already arrived. A new draft request is not an unrestricted in-place autonomous edit tool.

## Visual and motion posture

- Precise technical chrome, intentional spacing, readable source and strong composer hierarchy.
- Flightdeck orange focal accents, steel/ink neutrals and inherited host light/dark values. No global theme replacement or default purple brand clone.
- Short conversation, workspace, tab and artifact-entry transitions; capped topology reveal regardless of graph size.
- No delayed click actions, flashing paths, fake percentage counters, invented token/tool totals, simulated terminal output or automatically completed build tasks.
- `prefers-reduced-motion` disables nonessential movement without hiding state or blocking actions.
- All visible action controls must work. No fake microphone, attachment, publish, terminal or connected-provider buttons.
- No extra browser package/CDN/font requests merely for appearance. Existing script CSP and scriptless preview isolation remain intact.

## Functional acceptance

- Initial chat, real requesting, questions, skill-review, refused, cancelled, error and received-draft states are legible.
- Both real typed response paths open their corresponding builder; no keyword fallback or provider fallback.
- Existing local edits and modal drafts survive navigation; dirty replacement cancellation retains the original graph and saved identity.
- Repeated send/review clicks issue at most one active request. Context changes invalidate reviews, abort stale responses and mask old private transcript/source before reset effects.
- Workflow manifests/counts are derived from the actual graph/registry, not guessed operations. New wrappers remain declarative and review-required.
- Sub-app source editing, apply/revert, diff, gate findings and preview fidelity remain truthful.
- Desktop, short-screen and mobile layouts have no document-wide horizontal overflow; hidden retained panels are not keyboard-focusable.
- Native modal/focus behavior, drag/drop coordinates, fit-to-graph, mapping, undo and resource insertion remain tested.
- Reduced-motion and production CSP are exercised in the browser; no accessibility certification is implied by scoped checks.
- Development route fixtures are explicitly labeled. Their predetermined model answers are test doubles, not real vendor completions; fixture credentials never become production identities.

## Provenance and baseline

The stable pre-redesign Docker root was captured at `http://127.0.0.1:8790/`, screenshot `/Users/te451223/.hermes/cache/scratch/studio-ai-before.png`. It showed the form-first composer and no conversation log. Staging stays unchanged while source implementation is in progress.

Official indexed Lovable documentation supplied general interaction evidence:

- `https://docs.lovable.dev/features/projects/editor` — project chat/workspace and editor tools.
- `https://docs.lovable.dev/features/projects/chat` — conversation context, modes and explicit transitions.
- `https://docs.lovable.dev/features/chat-mode` — discussion vs planning/building distinctions.
- `https://docs.lovable.dev/features/code-mode.md` — source inspection/editing and file references.

Direct browser access to the Lovable documentation was enterprise Zscaler-blocked. No Continue action, bypass, upload, authenticated product inspection or private runtime inference occurred. Indexed official excerpts are not current authenticated UI screenshots.

Starting source verification: **2,867 Vitest tests and 16 Docker tests**, no failures/skips; typecheck/build passed. Release verification now uses `FLIGHTDECK_HOST_ROOT=/Users/te451223/project-contract npm test -- --maxWorkers=4`; Vitest 4 does not accept the former `--minWorkers` option.

Real production reviewer identity, live model credentials, HTTPS and operational recovery remain separate gates. Visual changes do not grant deployment or tool execution authority.
