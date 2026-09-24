# Approved prompts — owner-approval procedure

Prompt wording is human-owned (host D-033 decision 13; D-035 left it with a human).
This directory holds model-facing texts that Studio loads through
`packages/spec/src/approved-prompts.ts`. Code does not write these texts, and none
ships with the loader. Until a text is here and approved, the loader refuses it and
every caller must refuse too. There is no fallback text.

## Which prompts

Only these ids can be loaded (`APPROVED_PROMPT_IDS`). Adding an id is a code change
that needs review.

| id | intended for (nothing calls the loader yet) |
|---|---|
| `translation-repair` | the planner's repair round-trip after a refusal on substance, where `buildRepairPrompt`'s "did not fit the required JSON shape" would be false |
| `workflow-draft` | drafting a workflow |
| `workflow-repair` | the repair round-trip for a workflow draft |
| `revise` | revising an existing spec |

## Files

For each prompt `<id>`:

- `<id>.md`: the exact text sent to the model, in UTF-8. Every byte counts,
  including the trailing newline.
- `<id>.approval.json`: the approval record:

  ```json
  {
    "id": "<id>",
    "approvedBy": "<a named human, e.g. the owner>",
    "approvedAt": "YYYY-MM-DD",
    "sha256": "<output of shasum -a 256 <id>.md>"
  }
  ```

A `.md` without its `.approval.json` (or the other way round) fails the fence test
in `approved-prompts.test.ts`. So does any other file in this directory.

## Procedure

1. **Draft.** A named human writes or edits `<id>.md`. An agent may propose a
   draft in `memory/proposals/`, but only a human puts wording here. To hold a
   draft, set `"approvedBy": null` and `"approvedAt": null`. The loader treats
   that as `unapproved`.
2. **Review the exact bytes.** The approver reads the file as committed.
3. **Pin.** Run `shasum -a 256 packages/spec/prompts/<id>.md`. Put the hex digest
   in `sha256`, your name in `approvedBy` and today's date in `approvedAt`.
   `approvedBy` must be a named human. Values like "system", "agent" or "admin"
   are refused.
4. **Commit both files together** in a change that says who approved the text.
5. **Any later edit un-approves the text.** If `<id>.md` changes by even one byte,
   the loader returns `hash-mismatch` until steps 2–4 are repeated.

## What the loader returns

| outcome | when |
|---|---|
| `unknown-prompt` | the id is not in the table above |
| `missing` | there is no `<id>.md` |
| `unapproved` | there is no `<id>.approval.json`; it is not valid JSON or not the shape above; it names another id; `approvedBy` is null or not a named human; or `approvedAt` is not a real ISO date |
| `not-utf8` | the file's bytes are not valid UTF-8 |
| `hash-mismatch` | the sha256 of the file's bytes is not the recorded `sha256` |
| `{ ok: true, text, sha256 }` | all of the above hold |
