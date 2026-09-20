/** Reading the generated page's shape out of its own source text.
 *
 * ── THE CONSTRAINT THAT SHAPES THIS WHOLE FILE ──────────────────────
 * The obvious way to preview a generated React page is to transpile it and
 * run it. Two things forbid that here. The boring one: Studio ships no
 * in-browser transpiler, and adding Babel to preview a file that will be
 * compiled by the HOST's toolchain anyway would be previewing a different
 * compilation than the one that ships. The one that actually matters:
 * `index.tsx` is text a language model wrote. `eval`, `new Function` and a
 * `<script>` in a same-origin frame all hand that text the Studio origin —
 * its cookies, its session, its DOM. A builder whose preview button
 * executes model output inside its own origin has no security story at
 * all. So: **nothing in the generated file is ever evaluated.** Not once,
 * not behind a flag.
 *
 * ── WHAT MAKES THAT AFFORDABLE ──────────────────────────────────────
 * `codegen/emitters/web.ts` emits a DATA-DRIVEN page on purpose: a
 * `PANELS` array that is the spec as data, plus a runtime that is fixed
 * text, byte-identical in every generated sub-app. So the page's entire
 * variable part is a literal, and a literal can be PARSED rather than run.
 * `preview/mirror.tsx` then re-implements the fixed part in Studio's own
 * code, and the preview renders the real descriptor through a faithful
 * copy of the real renderer.
 *
 * ── AND WHAT KEEPS IT HONEST ────────────────────────────────────────
 * That trade has one failure mode: the emitter changes its fixed runtime
 * and the mirror silently goes on showing the old behaviour. So the
 * runtime is fingerprinted. `RUNTIME_MARKERS` lists the behaviours the
 * mirror reproduces, each one tied to the source text it depends on; if
 * any is missing from the emitted file, `readWebModule` reports
 * `renderer-drift` naming exactly which, and the preview pane refuses
 * rather than lying. A preview that cannot tell it has gone stale is worse
 * than no preview.
 *
 * The parser below accepts the literal grammar the emitter produces —
 * JSON plus bare identifier keys and trailing commas — and REFUSES
 * anything else. It is not a JavaScript parser and does not try to be:
 * an expression where a literal was expected means the file did not come
 * from this emitter, which is exactly the `renderer-drift` answer. */

export interface FieldDescriptor {
  readonly name: string;
  readonly label: string;
  readonly control: "text" | "number" | "checkbox" | "select";
  readonly options: readonly string[] | null;
  readonly optional: boolean;
}

export interface FormDescriptor {
  readonly id: string;
  readonly method: string;
  readonly path: string;
  readonly label: string;
  readonly fields: readonly FieldDescriptor[];
}

export interface PanelDescriptor {
  readonly id: string;
  readonly title: string;
  readonly list: { readonly path: string; readonly label: string } | null;
  readonly forms: readonly FormDescriptor[];
}

export interface WebModule {
  readonly routePrefix: string;
  readonly title: string;
  readonly blurb: string;
  readonly panels: readonly PanelDescriptor[];
}

export type ReadResult =
  | { readonly ok: true; readonly module: WebModule }
  | { readonly ok: false; readonly reason: "unparsable"; readonly detail: string }
  | { readonly ok: false; readonly reason: "renderer-drift"; readonly missing: readonly string[] };

// ───────────────────────── the literal parser ────────────────────────────

type Literal = string | number | boolean | null | Literal[] | { [key: string]: Literal };

class LiteralParseError extends Error {}

/** Recursive descent over the emitter's literal grammar. Deliberately
 * small: every construct it does not accept is a signal that the file was
 * not produced by the emitter this preview mirrors. */
class LiteralParser {
  #at = 0;
  constructor(private readonly src: string, start: number) {
    this.#at = start;
  }

  get position(): number {
    return this.#at;
  }

  #skip(): void {
    while (this.#at < this.src.length) {
      const ch = this.src[this.#at];
      if (ch === " " || ch === "\n" || ch === "\t" || ch === "\r") {
        this.#at += 1;
        continue;
      }
      // Comments are legal in the source and the emitter writes them.
      if (ch === "/" && this.src[this.#at + 1] === "/") {
        const end = this.src.indexOf("\n", this.#at);
        this.#at = end === -1 ? this.src.length : end + 1;
        continue;
      }
      if (ch === "/" && this.src[this.#at + 1] === "*") {
        const end = this.src.indexOf("*/", this.#at + 2);
        this.#at = end === -1 ? this.src.length : end + 2;
        continue;
      }
      return;
    }
  }

  #fail(what: string): never {
    const line = this.src.slice(0, this.#at).split("\n").length;
    throw new LiteralParseError(`${what} at line ${line}`);
  }

  value(): Literal {
    this.#skip();
    const ch = this.src[this.#at];
    if (ch === undefined) this.#fail("unexpected end of file");
    if (ch === "{") return this.#object();
    if (ch === "[") return this.#array();
    if (ch === '"' || ch === "'") return this.#string();
    if (this.src.startsWith("true", this.#at)) {
      this.#at += 4;
      return true;
    }
    if (this.src.startsWith("false", this.#at)) {
      this.#at += 5;
      return false;
    }
    if (this.src.startsWith("null", this.#at)) {
      this.#at += 4;
      return null;
    }
    if (ch === "-" || (ch >= "0" && ch <= "9")) return this.#number();
    this.#fail(`expected a literal, found ${JSON.stringify(ch)}`);
  }

  #object(): { [key: string]: Literal } {
    this.#at += 1; // '{'
    const out: { [key: string]: Literal } = {};
    for (;;) {
      this.#skip();
      if (this.src[this.#at] === "}") {
        this.#at += 1;
        return out;
      }
      const key = this.src[this.#at] === '"' || this.src[this.#at] === "'" ? this.#string() : this.#identifier();
      this.#skip();
      if (this.src[this.#at] !== ":") this.#fail(`expected ':' after key ${JSON.stringify(key)}`);
      this.#at += 1;
      out[key] = this.value();
      this.#skip();
      if (this.src[this.#at] === ",") {
        this.#at += 1;
        continue;
      }
      if (this.src[this.#at] === "}") {
        this.#at += 1;
        return out;
      }
      this.#fail("expected ',' or '}'");
    }
  }

  #array(): Literal[] {
    this.#at += 1; // '['
    const out: Literal[] = [];
    for (;;) {
      this.#skip();
      if (this.src[this.#at] === "]") {
        this.#at += 1;
        return out;
      }
      out.push(this.value());
      this.#skip();
      if (this.src[this.#at] === ",") {
        this.#at += 1;
        continue;
      }
      if (this.src[this.#at] === "]") {
        this.#at += 1;
        return out;
      }
      this.#fail("expected ',' or ']'");
    }
  }

  #identifier(): string {
    const start = this.#at;
    while (this.#at < this.src.length && /[A-Za-z0-9_$]/.test(this.src[this.#at] ?? "")) this.#at += 1;
    if (this.#at === start) this.#fail("expected an object key");
    return this.src.slice(start, this.#at);
  }

  #string(): string {
    const quote = this.src[this.#at];
    this.#at += 1;
    let out = "";
    while (this.#at < this.src.length) {
      const ch = this.src[this.#at];
      if (ch === "\\") {
        const escape = this.src[this.#at + 1];
        this.#at += 2;
        switch (escape) {
          case "n": out += "\n"; break;
          case "t": out += "\t"; break;
          case "r": out += "\r"; break;
          case "b": out += "\b"; break;
          case "f": out += "\f"; break;
          case "u": {
            const hex = this.src.slice(this.#at, this.#at + 4);
            if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.#fail("bad \\u escape");
            out += String.fromCharCode(Number.parseInt(hex, 16));
            this.#at += 4;
            break;
          }
          default: out += escape ?? ""; break;
        }
        continue;
      }
      if (ch === quote) {
        this.#at += 1;
        return out;
      }
      if (ch === undefined) break;
      out += ch;
      this.#at += 1;
    }
    this.#fail("unterminated string");
  }

  #number(): number {
    const match = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(this.src.slice(this.#at));
    if (match === null) this.#fail("bad number");
    this.#at += match[0].length;
    return Number(match[0]);
  }
}

/** Parse the literal that follows `marker` in `source`. Exported for the
 * tests, which exercise the grammar directly rather than through a whole
 * generated file. */
export function parseLiteralAfter(source: string, marker: string): Literal {
  const at = source.indexOf(marker);
  if (at === -1) throw new LiteralParseError(`no \`${marker}\` in this file`);
  return new LiteralParser(source, at + marker.length).value();
}

// ─────────────────────── the runtime fingerprint ─────────────────────────

export interface RuntimeMarker {
  readonly id: string;
  /** Source text that must be present in the emitted file. */
  readonly needle: string;
  /** What `mirror.tsx` does BECAUSE this is in the generated file. If the
   * needle goes, this claim stops being true and the mirror is a lie. */
  readonly mirrors: string;
}

/** The behaviours `mirror.tsx` claims to reproduce, each tied to the text
 * it is reproducing. This is the mirror's contract with the emitter,
 * written where it can be checked instead of in a comment nobody reruns. */
export const RUNTIME_MARKERS: readonly RuntimeMarker[] = [
  {
    id: "fetch-prefix",
    needle: "fetch(ROUTE_PREFIX + path",
    mirrors: "every request goes to ROUTE_PREFIX + the descriptor's sub-path",
  },
  {
    id: "same-origin",
    needle: 'credentials: "same-origin"',
    mirrors: "the page authenticates as the signed-in user, not anonymously",
  },
  {
    id: "refusal-class",
    needle: "class ApiRefusal",
    mirrors: "a non-2xx answer becomes a refusal object, never a thrown string",
  },
  {
    id: "refusal-disabled",
    needle: 'r.status === 403 && r.code === "subapp_disabled"',
    mirrors: "a disabled sub-app says so, routed on the body's code and not on prose",
  },
  {
    id: "refusal-capability",
    needle: 'r.status === 403 && r.code === "capability_denied"',
    mirrors: "a denied capability names the scope it wanted",
  },
  {
    id: "refusal-400",
    needle: "r.status === 400",
    mirrors: "a Zod refusal renders the server's issues, not a generic message",
  },
  {
    id: "rows-shape",
    needle: "const rows = (payload as { rows?: unknown } | null)?.rows",
    mirrors: "a list answer is read as `{ rows }` or as a bare array",
  },
  {
    id: "page-export",
    needle: "const subAppModule: SubAppModule = { Page: GeneratedPage };",
    mirrors: "the host lazy-mounts `.Page` from the module's default export",
  },
];

// ────────────────────────────── the read ─────────────────────────────────

function asString(value: Literal | undefined, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function asFields(value: Literal | undefined): FieldDescriptor[] {
  if (!Array.isArray(value)) return [];
  const out: FieldDescriptor[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const control = asString(entry.control, "text");
    const options = Array.isArray(entry.options)
      ? entry.options.filter((o): o is string => typeof o === "string")
      : null;
    out.push({
      name: asString(entry.name, ""),
      label: asString(entry.label, ""),
      control:
        control === "number" || control === "checkbox" || control === "select" ? control : "text",
      options,
      optional: entry.optional === true,
    });
  }
  return out;
}

function asPanels(value: Literal): PanelDescriptor[] {
  if (!Array.isArray(value)) return [];
  const out: PanelDescriptor[] = [];
  for (const entry of value) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) continue;
    const listValue = entry.list;
    const list =
      listValue !== null && typeof listValue === "object" && !Array.isArray(listValue)
        ? { path: asString(listValue.path, ""), label: asString(listValue.label, "Load") }
        : null;
    const formsValue = entry.forms;
    const forms: FormDescriptor[] = [];
    if (Array.isArray(formsValue)) {
      for (const form of formsValue) {
        if (form === null || typeof form !== "object" || Array.isArray(form)) continue;
        forms.push({
          id: asString(form.id, ""),
          method: asString(form.method, "POST").toUpperCase(),
          path: asString(form.path, ""),
          label: asString(form.label, ""),
          fields: asFields(form.fields),
        });
      }
    }
    out.push({
      id: asString(entry.id, ""),
      title: asString(entry.title, ""),
      list,
      forms,
    });
  }
  return out;
}

/** Read a generated `web/src/subapps/<id>/index.tsx`.
 *
 * Order matters: drift is checked BEFORE parsing. A file whose runtime has
 * changed may still contain a perfectly parsable `PANELS`, and reporting
 * "parsed fine" about a page the mirror no longer resembles is the exact
 * failure this is built to prevent. */
export function readWebModule(source: string): ReadResult {
  const missing = RUNTIME_MARKERS.filter((marker) => !source.includes(marker.needle)).map((m) => m.id);
  if (missing.length > 0) return { ok: false, reason: "renderer-drift", missing };

  try {
    const panels = asPanels(parseLiteralAfter(source, "const PANELS: PanelDescriptor[] ="));
    const routePrefix = parseLiteralAfter(source, "const ROUTE_PREFIX =");
    const title = parseLiteralAfter(source, "const APP_TITLE =");
    const blurb = parseLiteralAfter(source, "const APP_BLURB =");
    if (typeof routePrefix !== "string") {
      return { ok: false, reason: "unparsable", detail: "ROUTE_PREFIX is not a string literal" };
    }
    return {
      ok: true,
      module: {
        routePrefix,
        title: asString(title, "Generated sub-app"),
        blurb: asString(blurb, ""),
        panels,
      },
    };
  } catch (error) {
    return {
      ok: false,
      reason: "unparsable",
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}
