# Single chat-first Studio entry

## Current interaction

Both `/` and `/demo` now start on **one AI conversation page**. The initial workspace standby panel has been removed rather than merely hidden, and neither URL automatically selects a workflow or sub-app builder.

The empty entry uses one centered request composer, two working suggestion pills and disclosed connection/project setup. Suggestions only prefill. The explicit **Open workflow example** action remains available as a local template, clearly distinguished from an AI request.

The existing protected model determination stays authoritative:

- `workflow-proposed` → the real workflow editor, subject to the existing dirty-document/unapplied-settings replacement guard;
- `subapp-result` with a `proposed` outcome → the retained real sub-app IDE;
- `needs_input` → clarification in the same single chat page;
- refused/invalid/stale/cancelled results → no automatic builder handoff or replacement.

Typing the words “workflow” or “sub-app” does not create a client-side keyword fallback. The requested deliverable is still interpreted by the selected model through the server's strict determination schema. Examples and manual navigation are explicit actions, not automatic model calls.

After an accepted handoff, desktop builders use the retained conversation beside their technical workspace. Mobile switches to the workspace with **Discuss draft** returning to the same conversation. Navigation retains graph/forms/source state; a new accepted graph still requires the existing one-shot replacement guard.

## Verified source behavior

- Two entry tests observed RED on the old standby/special `/demo` entry, then GREEN for both URLs.
- Actual Chromium layout initially reproduced a reserved second column; after the CSS repair, four distinct cases passed: root at 1440×900, 1280×577 and 390×844, plus `/demo` at 1440×900.
- All cases had one chat column, no standby node, no visible technical builder, no document-wide horizontal overflow, and the composer within the first viewport.
- The existing real-Fastify development harness passed **47 browser assertions / 45 unique checks**, with 9 explicit create requests and 14 tracked Studio transport requests. It exercised clarification, both typed builder paths, exact skill review, real saved-draft readback, dirty-cancel retention, duplicate-submit suppression and scope/stale/cancellation guards. Predetermined model replies are development test doubles, not vendor completions.
- An additional real-route short-screen check confirmed an ambiguous request stays on one chat page with its actual question and no visible technical workspace.
- **18 native mobile Tab steps** avoided hidden/inert controls.
- **49 focused tests across 9 files**, TypeScript, production build and `git diff --check` passed. This is not a new full-release-suite claim while parallel voice/tour integration is incomplete. The build still reports the >500 kB chunk advisory (this source snapshot: 659.03 kB minified JavaScript).

Evidence under `/Users/te451223/.hermes/cache/scratch`:

- `chat-first-layout.json`
- `chat-first-route-regression.json`
- `chat-first-keyboard.json`
- `chat-first-clarification-1280.png`
- `chat-first-mobile.png`

The owned development fixture was stopped after verification. The live development entry is `http://127.0.0.1:5180/`; this change has not replaced the frozen Docker staging image. Voice/tour integration and the complete combined staging release remain separate pending work. No provider credentials, host source, resource authority, approval policy or deployment permission were changed.
