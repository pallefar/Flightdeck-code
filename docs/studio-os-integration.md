# Studio / OS design and integration contract

## Owner requirements

- Follow **Flightdeck Studio and Flightdeck OS design**, including matching navigation.
- Use n8n as an interaction reference for the connected workflow canvas and block inspector, not as an independent brand or replacement shell.
- Provide working options for each block; changes must update the draft and affect supported execution, not just change labels on screen.
- Support actual drag-and-drop from categorized builtin/reusable palettes onto the canvas. Placement must account for zoom/scroll, and one undo retracts one drop. Keep existing canvas blocks draggable.
- Provide Expanded (current) and slimmer Compact block displays, retaining inspector access and connection ports. Switching display must not alter saved graph data or execution; edge anchors follow the block dimensions.
- The workflow creator/editor is destined for **Flightdeck Studio**. The current local demo is a development harness, not completed host integration.
- Keep a usable demo available while implementation develops.

## Source-grounded design

Source of truth in the host checkout is `flightdeck/web/src/theme.css`, `nav.ts`, `os/OsShell.tsx`, `admin/StudioHome.tsx` and `admin/adminRoutes.tsx`.

The inspected host uses Atlas light defaults, white surfaces, slate ink, orange `--te` and an Arial stack. Dark mode is expressed through the same tokens. OS mode has a separate scoped theme channel; never change the classic theme or repaint the document from an editor component.

The Studio and workflow components consume host `--bg`, `--surface`, `--surface2`, `--ink`, `--muted`, `--line`, `--te`, `--green`, `--amber`, `--red` and `--shadow` where appropriate. Standalone fallback values come from the actual host source. Component styles are scoped; standalone bootstrap resets must not travel into the OS shell.

Global navigation, workspace/project selection, authorized identity and leave guards remain host-owned. The editor provides subordinate authoring controls; it must not create a second OS dock/sidebar or guess console URLs.

## Current integration boundary

The inspected Admin route registry has a Build / Studio section. Its `StudioHome` launcher currently opens the configured Studio URL in a separate tab, under Studio's own sign-in, explicitly without framing or proxying it. That existing boundary must be preserved unless a deliberate architecture change is approved.

The checked-in Studio sub-app frontend in `packages/subapp/src/web/src/subapps/studio/index.tsx` is a guarded bundle admission/proposal surface. It is not the new authoring pipeline. It cannot install generated source or import the entire Studio backend into the host. Do not treat those two surfaces as interchangeable.

The local editor now lives in `src/workflow/` and its validated graph/runner in `packages/workflow/`. Studio routes creation through `src/studio/` and the protected server/pipeline APIs. Matching theme tokens alone does not prove that it is connected to the deployed Studio or host.

## Integration acceptance checklist

- [ ] Existing Studio entry and host launcher reach the upgraded authoring experience through the real configuration.
- [ ] Navigation matches Flightdeck and preserves URL/history behavior and unsaved work through its actual navigation contracts.
- [ ] Host workspace/project identity and authorization govern skill context, drafts and project-page suggestions; no browser-selected file paths establish authority.
- [ ] LLM determination selects distinct workflow/sub-app builders without keyword fallback.
- [ ] Each supported block has validated controls, visible saved/error states, effective custom defaults and undo/redo synchronization.
- [ ] Local set/condition/output execution and human-approval pauses are exercised through the UI.
- [ ] HTTP/LLM execution uses real server-side adapters and credential references, not inline secrets or fabricated responses.
- [ ] Graph edits preserve bound workflow steps and unavoidable human/statutory gates through import, persistence and publication.
- [ ] Graph persistence uses an actual host-validated contract; exported JSON is not described as a deployed workflow.
- [ ] Workflow project-page suggestions use the correct project's authorized skills and require host validation before saving/publishing.
- [ ] Light/dark theme inheritance and responsive editor layout are checked in the real Studio/OS launch context.
- [ ] Studio build/tests and host integration/conformance gates are run against a recorded baseline; existing failures are not hidden or weakened.

Only mark this integration complete after those paths have actually run in the target Studio/host. The demo currently provides local authoring/execution; live model configuration, production connector execution and host publication are not asserted.
