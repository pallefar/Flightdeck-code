# Workflow block controls and application menus

These are workflow editor source/development-preview changes. Source publication and promotion into the private Studio image are separate actions. This document does not establish a live provider connection, host identity, independent reviewer, resource grant or deployment.

## Blocks have different jobs

The editor configures registered, schema-bound engine operations. It does not turn every block into a generic script or execute arbitrary configuration JSON as code.

| Block | Actual job | Quick controls | Extended controls and boundary |
| --- | --- | --- | --- |
| Manual trigger | Starts with the original execution input | Execution-input entry point; no meaningless parameter Apply | Inputs explains trigger-seed semantics. Legacy trigger mappings can be cleared; transformations belong downstream. |
| Set fields | Merges typed fields into incoming data | Field names, types and values | Structured configuration inspection; no JavaScript or expressions. |
| Condition | Selects the true or false output using a field comparison | Field, operator, comparison value | Input mappings, configuration JSON, and observed local results. Both drawn branches are alternatives, not evidence both executed. |
| Output | Returns incoming data | Return-data explanation; no meaningless parameter Apply | Inputs can project incoming data using validated mappings. |
| HTTP | Invokes the trusted HTTP adapter | URL and method | Service, credential **reference**, body and diagnostics. No raw secret entry; absent adapters fail closed. |
| Language model | Invokes the trusted model adapter | Instruction | Model selection/configuration and diagnostics. No implicit provider fallback, tools or arbitrary-code execution. |
| Resource | Refers to a reviewed resource function | Resource and function IDs | Exact revision, literal/ancestor input mappings and diagnostics. A reference does not activate a resource or grant access. |
| Human approval | Stops for independent human review | Reviewer/queue reference | Reason and review diagnostics. Configuration is not an approval; the editor cannot approve or resume the gate. |
| Unconfigured | Preserves an unresolved intent and blocks execution | Description | Explicit reviewed fragment composition where eligible, or configuration inspection. It is not executable placeholder code. |

Reusable wrappers inherit the actual registered base operation and reviewed defaults; their declaration does not create a new authority-bearing execution primitive.

## Two control levels

- **Single-click a block:** open its quick drawer, focused on its own function and main fields.
- **Double-click the block:** open the native extended-controls dialog with Inputs, Parameters and Results, plus identity/position and connection controls.
- **Extended controls…** in the drawer is the keyboard/touch alternative to double-click. The Edit menu provides the same entry point for the selected block.
- Ports remain connection controls, not settings shortcuts.
- Close/Escape returns focus to the actual opener. Closing either level does not apply or discard pending form edits.

The same keyed parameter and mapping forms remain mounted across control-level, selection and view changes. Parameters and Inputs have independent Apply operations. View operations never apply either draft.

The quick drawer overlays the editor without resizing the graph. Its placement follows the visible editor/viewport and leaves the clicked block uncovered for the second click. Short screens use the available space above or below that block, with internal scrolling and no forced minimum height. If no usable region exists, extended controls remain available through double-click or Edit. Returning from extended controls reveals the actual drawer opener by scrolling only the drawer, not the graph. The manual-trigger input action closes block controls, opens and focuses the existing execution input, and does not run the workflow.

### Hidden advanced edits

Quick Apply must not save invisible advanced changes. Pending HTTP service/credential/body, model, resource-revision or approval-reason edits require the extended view. A pending configuration-JSON edit also disables quick typed editing rather than replacing that source implicitly. Reopen extended controls and apply or resolve the intended draft there.

Configuration JSON is schema-validated data, not a general-purpose code block.

## Application menus

- **File:** New workflow, Import JSON, Export JSON, Download applied JSON.
- **Edit:** Undo, Redo, extended selected-block controls, delete eligible selected block.
- **View:** Canvas/Stacked, Expanded/Compact, zoom/reset/Fit, palette and inspector visibility.
- **Insert:** block palette and explicit reusable-block review.
- **Run:** the existing local run, execution input/trace, validation warnings.
- **Help:** graph-grounded explanation and block registry.

The canvas toolbar shows current view/display/zoom status instead of duplicating the View commands. Registry remains editor-relative and internally scrollable rather than escaping into host UI.

File export/download contains the **applied local graph**, not pending forms. It is not a server save. Durable workspace save/open remains in Studio's existing separately authenticated controls; this menu does not invent a second persistence path.

Menu navigation supports arrows, Home/End, Enter/Space, Escape and ordinary Tab exit. Choosing a command closes its dropdown and captures a persistent menu opener before opening a dialog or transfer panel. View changes and menu navigation do not alter graph history or revive an invalidated local result.

## Verification boundary

Keep original failing tests and browser observations alongside corrected runs. Verification must cover real local engine contrasts, hidden-draft refusal, retained form identity, quick/full interaction, native pointer/keyboard behavior, responsive containment, and the default host-aware test/build entry. DEVELOPMENT adapter fixtures are not real provider acceptance. Do not infer a live runtime update from source or preview success.
