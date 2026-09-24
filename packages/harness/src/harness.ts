/** Two modes, and the wall between them.
 *
 *   live      call the real provider, record request and full response
 *   playback  replay the recording, make no network call, and on a miss FAIL
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE: playback never falls through to live.
 * A recorder that quietly calls the API when it cannot find a fixture is worse
 * than no recorder — the suite stays green, so nobody learns that the run cost
 * money, needed a key, and was not deterministic. The wall is built twice over:
 * a miss throws `HarnessCacheMiss`, and a playback harness has no provider to
 * fall through TO. `provider?: never` on the playback options means handing one
 * to a playback harness does not compile.
 *
 * Everything else about this package exists to make the two modes agree:
 * content-addressed keys so an inserted call does not shift the others,
 * canonical bytes so key order cannot re-record the world, redaction so a
 * recording is committable.
 */
import { keyFieldsFor, keyedView, requestKey } from "./keys";
import type { KeyingOptions } from "./keys";
import { differingFields } from "./keys";
import { redactWithSecrets, resolveSecrets } from "./redact";
import type { RedactionOptions } from "./redact";
import {
  FIXTURE_FORMAT,
  fixturePath,
  listFixtures,
  tryReadFixtureAt,
  writeFixtureAt,
} from "./fixture";
import type { FixtureRecord, StoredFixture } from "./fixture";
import type { HarnessCaller, ProviderCallShape, ProviderFn } from "./provider-contract";

export type HarnessMode = "live" | "playback";

export const HARNESS_MODE_ENV = "FLIGHTDECK_HARNESS_MODE";

/** ⭐ THE DEFAULT IS PLAYBACK. A suite that has to opt IN to spending money and
 * touching the network cannot do either by accident on somebody's laptop or in
 * CI. An unrecognised value is an error rather than a silent fallback to the
 * default, because `MODE=liv` must not quietly become "playback" and pass. */
export function resolveMode(env: Readonly<Record<string, string | undefined>> = process.env): HarnessMode {
  const raw = env[HARNESS_MODE_ENV];
  if (raw === undefined || raw.trim() === "") return "playback";
  const value = raw.trim().toLowerCase();
  if (value === "live" || value === "record") return "live";
  if (value === "playback" || value === "replay") return "playback";
  throw new Error(
    `${HARNESS_MODE_ENV}="${raw}" is not a mode. Use "live" (record against the real provider) or "playback" (replay fixtures).`,
  );
}

export interface HarnessEvent {
  readonly kind: "recorded" | "replayed" | "kept";
  readonly key: string;
  readonly model: string;
  readonly path: string;
  readonly durationMs: number | null;
}

interface CommonOptions<Res> extends KeyingOptions, RedactionOptions {
  /** Root of the recordings. Created on first write. */
  readonly fixturesDir: string;
  /** Rebuild a response from stored JSON — for a provider whose response is not
   * a plain object. Without it, playback hands back the parsed JSON as `Res`. */
  readonly reviveResponse?: ((stored: unknown) => Res) | undefined;
}

export interface LiveHarnessOptions<Req extends ProviderCallShape, Res> extends CommonOptions<Res> {
  readonly mode: "live";
  readonly provider: ProviderFn<Req, Res>;
  /** `keep` leaves an existing recording alone (still calls the provider, still
   * returns the live answer). Default `overwrite`: a live run refreshes. */
  readonly onExisting?: "overwrite" | "keep" | undefined;
  /** Turn a response into JSON. Default: the response itself. */
  readonly serializeResponse?: ((response: Res) => unknown) | undefined;
  /** Return the stored round-trip instead of the live object, so live behaves
   * exactly as playback will. Off by default — live should hand back what the
   * provider actually returned. */
  readonly roundTrip?: boolean | undefined;
  /** Injected clock for every recorded instant — `recordedAt` and the
   * `durationMs` of the call — so a recording is otherwise deterministic. */
  readonly now?: (() => Date) | undefined;
}

export interface PlaybackHarnessOptions<Res> extends CommonOptions<Res> {
  readonly mode: "playback";
  /** ⛔ There is no provider in playback. Passing one is a compile error, not a
   * runtime policy that a later edit can soften. */
  readonly provider?: never;
}

export type HarnessOptions<Req extends ProviderCallShape, Res> =
  | LiveHarnessOptions<Req, Res>
  | PlaybackHarnessOptions<Res>;

export interface Harness<Req extends ProviderCallShape, Res> extends HarnessCaller<Req, Res> {
  readonly mode: HarnessMode;
  readonly fixturesDir: string;
  /** Every call this harness made, in the order it made them. Recording order is
   * NOT part of any key — this is a report, not an index. */
  readonly events: readonly HarnessEvent[];
  keyFor(request: Req): string;
  pathFor(request: Req): string;
}

export interface CacheMissDetail {
  readonly key: string;
  readonly model: string;
  readonly path: string;
  readonly fixturesDir: string;
  /** Recordings that differ from this request in the fewest keyed fields. */
  readonly nearest: readonly { key: string; differingFields: readonly string[] }[];
}

export class HarnessCacheMiss extends Error {
  readonly key: string;
  readonly model: string;
  readonly path: string;
  readonly fixturesDir: string;
  readonly nearest: readonly { key: string; differingFields: readonly string[] }[];

  constructor(detail: CacheMissDetail) {
    super(formatMiss(detail));
    this.name = "HarnessCacheMiss";
    this.key = detail.key;
    this.model = detail.model;
    this.path = detail.path;
    this.fixturesDir = detail.fixturesDir;
    this.nearest = detail.nearest;
  }
}

function formatMiss(detail: CacheMissDetail): string {
  const lines = [
    "harness playback: no recording for this request, and playback never calls the provider.",
    `  model:      ${detail.model}`,
    `  key:        ${detail.key}`,
    `  looked for: ${detail.path}`,
  ];
  if (detail.nearest.length === 0) {
    lines.push(`  no recordings at all under ${detail.fixturesDir}`);
  } else {
    lines.push("  nearest recordings (and how this request differs from them):");
    for (const near of detail.nearest) {
      const fields = near.differingFields.length === 0 ? "nothing keyed" : near.differingFields.join(", ");
      lines.push(`    ${near.key}  differs in: ${fields}`);
    }
  }
  lines.push(
    `  Record it: re-run with ${HARNESS_MODE_ENV}=live (real provider, real cost), then commit the fixture.`,
  );
  return lines.join("\n");
}

const MAX_NEAREST = 3;

async function nearestFixtures(
  fixturesDir: string,
  model: string,
  wanted: Readonly<Record<string, unknown>>,
): Promise<{ key: string; differingFields: readonly string[] }[]> {
  let stored: StoredFixture[];
  try {
    stored = await listFixtures(fixturesDir);
  } catch {
    // Diagnostics must never replace the miss they are describing.
    return [];
  }
  return stored
    .map((entry) => ({
      key: entry.record.key,
      model: entry.record.model,
      differingFields: differingFields(wanted, entry.record.request),
    }))
    .sort((a, b) => {
      const sameModel = Number(b.model === model) - Number(a.model === model);
      if (sameModel !== 0) return sameModel;
      return a.differingFields.length - b.differingFields.length;
    })
    .slice(0, MAX_NEAREST)
    .map(({ key, differingFields: fields }) => ({ key, differingFields: fields }));
}

export function createHarness<Req extends ProviderCallShape, Res>(
  options: HarnessOptions<Req, Res>,
): Harness<Req, Res> {
  const { fixturesDir, mode } = options;
  const fields = keyFieldsFor(options);
  // The caller's environment is scanned by default: the commonest way a key
  // reaches a fixture is a provider echoing one it read from `process.env`.
  const secrets = resolveSecrets({ secrets: options.secrets, env: options.env ?? process.env });
  const events: HarnessEvent[] = [];

  const keyFor = (request: Req): string =>
    requestKey(request as unknown as Readonly<Record<string, unknown>>, options);
  const pathFor = (request: Req): string => fixturePath(fixturesDir, request.model, keyFor(request));

  const revive = (stored: unknown): Res =>
    options.reviveResponse === undefined ? (stored as Res) : options.reviveResponse(stored);

  async function playback(request: Req): Promise<Res> {
    const key = keyFor(request);
    const path = fixturePath(fixturesDir, request.model, key);
    const record = await tryReadFixtureAt(path);
    if (record === null) {
      const wanted = redactWithSecrets(
        keyedView(request as unknown as Readonly<Record<string, unknown>>, fields),
        secrets,
      ) as Readonly<Record<string, unknown>>;
      throw new HarnessCacheMiss({
        key,
        model: request.model,
        path,
        fixturesDir,
        nearest: await nearestFixtures(fixturesDir, request.model, wanted),
      });
    }
    events.push({ kind: "replayed", key, model: request.model, path, durationMs: record.durationMs });
    return revive(record.response);
  }

  async function recordLive(request: Req, config: LiveHarnessOptions<Req, Res>): Promise<Res> {
    const key = keyFor(request);
    const path = fixturePath(fixturesDir, request.model, key);

    // Every recorded instant comes from the one injected clock. Timing the call
    // on `Date.now()` behind an injected `now` left `durationMs` as the one
    // wall-clock byte in an otherwise reproducible recording.
    const clock = (): Date => (config.now === undefined ? new Date() : config.now());
    const startedAt = clock().getTime();
    const response = await config.provider(request);
    const finishedAt = clock();
    const elapsed = finishedAt.getTime() - startedAt;
    const durationMs = Number.isFinite(elapsed) ? elapsed : null;

    if (config.onExisting === "keep" && (await tryReadFixtureAt(path)) !== null) {
      events.push({ kind: "kept", key, model: request.model, path, durationMs });
      return response;
    }

    const serialized =
      config.serializeResponse === undefined ? (response as unknown) : config.serializeResponse(response);

    const record: FixtureRecord = {
      format: FIXTURE_FORMAT,
      key,
      model: request.model,
      keyedFields: fields,
      recordedAt: Number.isNaN(finishedAt.getTime()) ? null : finishedAt.toISOString(),
      durationMs,
      request: redactWithSecrets(
        keyedView(request as unknown as Readonly<Record<string, unknown>>, fields),
        secrets,
      ) as Readonly<Record<string, unknown>>,
      response: redactWithSecrets(serialized, secrets),
    };

    try {
      await writeFixtureAt(path, record);
    } catch (error) {
      // The provider answered and the call was paid for, but the answer is not
      // replayable — which is the one thing a live run is FOR. Saying so beats
      // handing back a response that a later playback will miss on.
      throw new Error(
        [
          "harness live: the provider answered, but the recording could not be written.",
          `  fixture: ${path}`,
          `  cause:   ${(error as Error).message}`,
        ].join("\n"),
        { cause: error },
      );
    }
    events.push({ kind: "recorded", key, model: request.model, path, durationMs });
    return config.roundTrip === true ? revive(record.response) : response;
  }

  return {
    mode,
    fixturesDir,
    events,
    keyFor,
    pathFor,
    call: (request: Req): Promise<Res> =>
      options.mode === "playback" ? playback(request) : recordLive(request, options),
  };
}
