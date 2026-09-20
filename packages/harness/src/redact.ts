/** Keeping credentials out of the fixtures directory.
 *
 * ⛔ THE RULE THIS FILE EXISTS TO ENFORCE: a fixture is a file somebody commits.
 * It gets code-reviewed, pushed, forked and pasted into an issue. So the write
 * path is the last place a key can still be caught, and redaction happens there
 * — on the way to disk, never on the way to the hash.
 *
 * That split matters. The key is computed from the RAW request, so two requests
 * that differ only inside a redacted span still get different fixtures; if the
 * hash were taken after redaction they would collide on one recording. The copy
 * on disk is redacted, which is why a fixture carries its `key` as a field
 * rather than inviting anyone to recompute it from the stored request.
 *
 * Three layers, applied in order, because the specific ones must win:
 *   1. literal secrets the caller hands us,
 *   2. values of credential-shaped environment variables,
 *   3. shapes — object keys that name a credential, and strings that look like one.
 */

export const REDACTED = "[redacted]";

/** An object key whose VALUE is a credential regardless of what it looks like. */
const SECRET_KEY_PATTERN =
  /^(?:x-)?(?:api[-_]?key|apikey|auth|authorization|access[-_]?token|refresh[-_]?token|id[-_]?token|bearer|client[-_]?secret|secret|secret[-_]?key|password|passwd|pwd|credentials?|session[-_]?token|set-cookie|cookie|private[-_]?key|anthropic[-_]?api[-_]?key|openai[-_]?api[-_]?key)$/i;

/** An environment variable whose value is worth scrubbing out of any text. */
const SECRET_ENV_PATTERN = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|CREDENTIALS|COOKIE|SESSION|AUTH)S?$/i;

/** Below this a value is a flag or a word ("true", "debug"), not a credential,
 * and blanket-replacing it would gut unrelated prose. */
const MIN_ENV_SECRET_LENGTH = 12;

interface ShapeRule {
  readonly pattern: RegExp;
  readonly replace: (match: string, ...groups: string[]) => string;
}

const SHAPE_RULES: readonly ShapeRule[] = [
  // Anthropic / OpenAI / Stripe-style prefixed keys, incl. sk-ant-api03-…
  { pattern: /\b[sr]k-(?:[A-Za-z0-9]+-)*[A-Za-z0-9_-]{16,}/g, replace: () => REDACTED },
  // Authorization: Bearer <anything long>
  { pattern: /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, replace: () => `Bearer ${REDACTED}` },
  // AWS access key id, Google API key, GitHub tokens, Slack tokens
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replace: () => REDACTED },
  { pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/g, replace: () => REDACTED },
  { pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, replace: () => REDACTED },
  { pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, replace: () => REDACTED },
  { pattern: /\bxox[baprse]-[A-Za-z0-9-]{10,}\b/g, replace: () => REDACTED },
  // A JWT, which is a credential often enough to be worth the false positive.
  { pattern: /\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{4,}\b/g, replace: () => REDACTED },
  // `api_key=…`, `"token": "…"`, `x-api-key: …` inline in a larger string.
  {
    pattern:
      /((?:api[-_]?key|apikey|access[-_]?token|refresh[-_]?token|auth[-_]?token|token|secret|password)["']?\s*[:=]\s*["']?)([^\s"',;&)}\]]{8,})/gi,
    replace: (_match: string, prefix: string) => `${prefix}${REDACTED}`,
  },
];

export interface RedactionOptions {
  /** Exact strings to scrub wherever they appear. The caller's own key belongs here. */
  readonly secrets?: readonly string[] | undefined;
  /** Environment to harvest credential-shaped values from. Pass `{}` to opt out;
   * defaults to `process.env` at the call site, never read from here implicitly. */
  readonly env?: Readonly<Record<string, string | undefined>> | undefined;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Values of credential-shaped env vars, longest first so a key that contains
 * another key's value is replaced before its substring is. */
export function collectEnvSecrets(env: Readonly<Record<string, string | undefined>>): string[] {
  const found: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    if (typeof value !== "string") continue;
    if (value.length < MIN_ENV_SECRET_LENGTH) continue;
    if (!SECRET_ENV_PATTERN.test(name)) continue;
    found.push(value);
  }
  return [...new Set(found)].sort((a, b) => b.length - a.length);
}

/** All literal strings this redactor will scrub, longest first. */
export function resolveSecrets(options: RedactionOptions = {}): string[] {
  const literals = (options.secrets ?? []).filter((secret) => secret.length > 0);
  const fromEnv = options.env === undefined ? [] : collectEnvSecrets(options.env);
  return [...new Set([...literals, ...fromEnv])].sort((a, b) => b.length - a.length);
}

/** Scrub one string: literals first, then shapes. */
export function redactString(value: string, secrets: readonly string[] = []): string {
  let out = value;
  for (const secret of secrets) {
    out = out.replace(new RegExp(escapeRegExp(secret), "g"), REDACTED);
  }
  for (const rule of SHAPE_RULES) {
    out = out.replace(rule.pattern, rule.replace as (substring: string, ...args: unknown[]) => string);
  }
  return out;
}

/** Deep copy with every credential removed.
 *
 * Returns plain JSON-ish values only — this runs on the way to `JSON`, so a
 * `Date` becomes its ISO string and a class instance becomes its enumerable
 * fields. Cycles are cut with a marker instead of throwing: this is the write
 * path, and a fixture that says `[circular]` beats a recording lost to an
 * exception after the API call was already paid for. */
export function redactValue(value: unknown, options: RedactionOptions = {}): unknown {
  return redactDeep(value, resolveSecrets(options), new Set<object>(), 0);
}

/** Same, when the secret list is already resolved (the harness resolves once per call). */
export function redactWithSecrets(value: unknown, secrets: readonly string[]): unknown {
  return redactDeep(value, secrets, new Set<object>(), 0);
}

function redactDeep(value: unknown, secrets: readonly string[], seen: Set<object>, depth: number): unknown {
  if (depth > 64) return "[too deep]";
  if (typeof value === "string") return redactString(value, secrets);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (typeof value === "undefined" || typeof value === "function" || typeof value === "symbol") return undefined;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();

  const object = value as object;
  if (seen.has(object)) return "[circular]";
  seen.add(object);
  try {
    if (Array.isArray(value)) {
      return value.map((element) => redactDeep(element, secrets, seen, depth + 1) ?? null);
    }
    if (value instanceof Map) {
      return redactDeep(Object.fromEntries(value.entries()), secrets, seen, depth + 1);
    }
    if (value instanceof Set) {
      return redactDeep([...value.values()], secrets, seen, depth + 1);
    }
    const out: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(key)) {
        // Whatever it holds and whatever shape it has: the name says credential.
        out[key] = REDACTED;
        continue;
      }
      const redacted = redactDeep(member, secrets, seen, depth + 1);
      if (redacted !== undefined) out[key] = redacted;
    }
    return out;
  } finally {
    seen.delete(object);
  }
}
