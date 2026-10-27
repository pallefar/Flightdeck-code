# Private workflow and sub-app authoring — October 17, 2026

## Running delivery

Private Studio is updated at `http://127.0.0.1:8790/` to immutable image:

`sha256:e9a04ab64bd985fabe72c44a42b8194547affdfe0643d0dd562428bd087ee152`

This completes the **bounded private authoring setup for manual testing**, not real-provider end-to-end acceptance or public production. The selected engine/provider, user send, exact-context review, save, authorized run and deployment remain separate actions.

The latest direct user continuation was applied to the previously described Studio-only update. Earlier unanswered/timed-out confirmations remain unanswered historical events; this was not treated as permission for a host deployment, OS launcher change, database/identity access, provider request or credential copying.

Only private Studio was recreated. The existing companion and Flightdeck OS retain their exact IDs, image IDs and start times. There was no commit, push or public publication.

## What is now available

- Chat-first workflow/sub-app authoring with the existing registered workflow blocks and real sub-app generator/SDK.
- Optional bounded native Anthropic drafting enabled through `STUDIO_NATIVE_AUTHORING=1`. Startup does not select a connection, send a prompt or probe a provider. The current authenticated configuration reports `draftOnly:true`, `executed:false`, `deployed:false`, six model sends and sixteen tool calls per native request; this is not a financial/token budget guarantee.
- Durable workflow and sub-app draft controls with explicit save/readback/reopen. Working source stays separate from the immutable generated baseline and its original evidence.
- Explicit local module-Worker static checks of applied working source. These checks do not evaluate source, typecheck it, install a host app or approve deployment. Editing/context changes invalidate the in-session report; reopening does not automatically validate.
- Optional native-availability reads no longer block selected JSON drafting. Availability has non-destructive cancellation and a scheduled header/body deadline. Native requires fresh configuration and explicit selection; failures do not silently fall back.

## Actual private-update verification

### Preservation and isolation

The sole existing private-volume writer was stopped, then a never-starting-app, read-only/network-none inventory process checked the same volume. All four private files' complete bytes, paths, owners/groups and modes match the original aggregate inventory before and after the update. Both original drafts, both original runs, and their exact history read back through authenticated GETs unchanged. No saved run was replayed and no new record was written.

Normalized Compose differs only in the immutable image and the explicit native opt-in. The original volume, loopback publication, UID1000, read-only root, capability drop, no-new-privileges, resources, tmpfs and explicit read-only public-CA/TLS configuration are retained. The deny-only restore marker and disabled/unmounted host bridge are not promoted into a full restore or identity system.

The Studio safety helper now pins this new image and admits only the literal `STUDIO_NATIVE_AUTHORING=1`, not arbitrary values or similarly named keys. Original credential/clipboard/isolation logic and assertions remain unchanged. Real clipboard copying was not performed.

### Tests and review

- Two vertical RED→GREEN regressions cover the image pin/configuration agreement and literal native opt-in.
- Current default host-aware full suite: **3,986 Vitest assertions / 265 physical files plus 32 Node tests**, all passing. Every prior3,984 assertion multiplicity remains, with two new helper cases.
- **36 focused helper/entry assertions** pass; both JavaScript syntax checks, strict helper `checkJs`, project typecheck, unchanged production build and diff checks pass. The existing large-main-chunk warning remains advisory.
- Independent helper/configuration review accepted the three-file delta:467indexed artifacts verified;36focused assertions,22native Docker policy cases (two admitted/twenty refused),22synthetic gate cases and two sensitivity controls. All22owned never-started containers were removed; the parent independently checked their44exact IDs/names absent.
- Earlier independently accepted source/store/static/native/built-UI scopes remain separately recorded in `docs/evidence/authoring-integration/current-authoring-final-review-acceptance/`. The actual immutable built-main development review passed103unique checks; it is not re-labelled authenticated live-browser acceptance.
- All838accepted application-image build inputs still match. The new helper/configuration edits are outside that frozen image input set. All four deployed HTML/JS/CSS/Worker files match the reviewed image byte-for-byte, including main `index-DnRrUQAt.js` and the98,011-byte module Worker.
- Actual new-image `npm run studio:first-test -- --check` exits0: all four model destinations unavailable/not-probed, no selection, session setup unconfigured, authentication/workspace/assets/security checks pass, clipboard not accessed, model requests and record writes not performed.

These focused/repeated/native/browser counts are not added into a combined unique coverage total.

### Actual deployed browser

A fresh tab loaded the real new bundle. No operator credential or API key was supplied. The actual built-in Conditional routing workflow completed both `approved:true` and `approved:false` locally with the exact respective output and opposite branch skipped. Ordinary workflow/sub-app navigation retained the graph, local input and result. No API resource requests were observed in those local browser actions.

The real Saved sub-app modal opened and its save/refresh/check actions stayed disabled without authentication/source. A390×568entry observation showed no document horizontal overflow and the disabled Create button within the viewport. Desktop and mobile captures are retained. No window errors, unhandled rejections or CSP violations were collected; this is not an exhaustive console, accessibility or responsive-layout audit.

One browser IPC call timed out while awaiting animation frames before the tab was foregrounded. The existing state was read back after `Page.bringToFront`, without reloading or repeating local/API actions; the mobile observation passed. That timeout is preserved, not hidden or counted as a passing probe. Parent review discovery also corrected guessed report filenames/schema before verifying the exact delivered manifest.

## Start your manual authoring test

1. Open `http://127.0.0.1:8790/`. To check without AI, choose **Open workflow example** and use **Run locally** with synthetic true/false data.
2. Use the existing user-controlled Studio operator sign-in in **Connection settings** and choose a synthetic project. Do not enter an Anthropic key in the operator field. No separate Studio account was invented, and this is not OS identity/workspace authorization.
3. Open **Anthropic API key setup**, explicitly load metadata, and enter your real key only in the masked in-app field. Keys are server-memory-only and are lost on restart. No declined secure-login prompt is repeated or bypassed.
4. Explicitly check configuration and select Anthropic. For the bounded harness, open **Authoring engine**, explicitly check native availability and explicitly select Native when ready. Configured/not-probed is not a successful provider completion.
5. Send a small synthetic workflow request. Review any exact-context acknowledgment, inspect the received real graph, then explicitly validate/save and reopen the exact revision. Do not replay old saved runs.
6. Separately request a small synthetic sub-app, answer the human manifest/scope questions and inspect the generated SDK source. Distinguish in-session buffer Save, durable draft Save/readback/reopen, explicit static checking and any later host/typecheck/execution/deployment procedure.

Real key-save, billable model success and user-authenticated browser creation/review/save/run have **not** been performed by the agent. They remain the user-controlled live acceptance gate. Use synthetic examples only, not employee/candidate/customer or other personal data.

## Rollback and remaining boundaries

The previous5029image and exact pre-update Compose/helper snapshots are retained. Rollback is a Studio service/image operation only; never delete or restore the existing private volume as an image rollback. No rollback was needed.

Still separate: real provider acceptance, durable production key lifecycle, actual OS session/CSRF/project policy and independently bound reviewer, operational recovery/anti-rollback/effect reconciliation, full host installation, acoustic dictation, HTTPS/proxy/public release operations and framework-wide production adoption. Local static checks and private operator authentication do not establish these authorities.

## Evidence

`docs/evidence/authoring-integration/private-authoring-update-20261017/` contains the exact source diff/freeze, RED/GREEN/full results, normalized configuration comparison, independent-helper parent acceptance, stopped-volume witness, exact before/after/final record fingerprints, immutable served assets, safe helper output, deployed browser captures/local traces and final acceptance/manifest. Credentials and individual credential-file digests were not exported.

The independent helper report is `docs/evidence/authoring-integration/private-authoring-helper-review-20261017/review-summary.json`, bound by `manifest.json` SHA-256 `d2711020419e56230c7b73b9cc6ee3178d6f96f19e0eba076578f7dd9dd60d80`.
