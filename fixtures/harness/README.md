# Harness recordings

Recorded model calls for Studio's planner, read and written by
`packages/harness` through `server/index.ts` (`HARNESS_FIXTURES_DIR`).

| `FLIGHTDECK_HARNESS_MODE` | What the server does |
|---|---|
| unset or empty (default) | Calls the Anthropic provider directly. Nothing is written here. |
| `live` (or `record`) | Calls the Anthropic provider and records each request and response here. Needs `ANTHROPIC_API_KEY` and costs money. |
| `playback` (or `replay`) | Answers from the recordings here only. It never calls the provider and needs no key. A request with no recording fails with `HarnessCacheMiss`. The planner reports the miss as an `invalid_draft` issue. |
| anything else | Boot refuses to start. |

Layout: `<model-slug>/<key>.json`, one file per distinct request. The key is a
content hash of the model, system prompt, messages and output settings, so it
does not depend on call order.

Before committing a recording:

- Recording redacts credentials. It also refuses to write a request or response
  that carries personal data (`FixtureNotCommittableError`). Read the file
  anyway. A live run writes the planner prompt, which is the operator's text.
- Record only prompts that are safe to keep in git. Do not record real
  employee, candidate or contract data.

No recordings are committed yet. Making them needs the owner's API key and budget.
