/** Finding the route handlers in a file, so the guard-first rule can be
 * checked against the handler BODY rather than against the file.
 *
 * ⭐ WHY THE BODY MATTERS. "Does this file mention the guard" is a rule a
 * generated sub-app passes with one handler out of four calling it. The
 * question worth asking is per handler and it is positional: does the
 * guard call come before anything that parses, reads or writes? So the
 * extractor has to find where each handler's body starts and ends, which
 * means matching braces, which means knowing which braces are inside
 * strings and comments. That is what `scan.ts` is for.
 *
 * ⛔ WHAT IT CANNOT READ, IT SAYS SO. A registration this extractor cannot
 * turn into a body — `app.route({ ... })`, a handler built by a helper, a
 * call whose braces do not balance — comes back in `unverifiable`, and the
 * check turns that into a FINDING. "The gate could not prove this handler
 * checks enable-state" has to fail closed, because the alternative is an
 * app that ships on the strength of the gate not understanding it. */
import { matchBrace, matchParen, type ScannedFile } from "./scan";

export interface RouteHandler {
  /** `GET`, `POST`, … as written on the Fastify call. */
  readonly method: string;
  /** The path literal, e.g. `/api/apps/wc-clock/entries`. */
  readonly routePath: string;
  readonly registrationOffset: number;
  /** Offset of the `{` that opens the handler body. */
  readonly bodyStart: number;
  /** Offset of the matching `}`. */
  readonly bodyEnd: number;
  /** The body as CODE: strings, comments and regex bodies blanked, so a
   * token found in here is a token the runtime will execute. */
  readonly body: string;
}

export interface UnverifiableRegistration {
  readonly offset: number;
  readonly reason: string;
}

export interface HandlerScan {
  readonly handlers: readonly RouteHandler[];
  readonly unverifiable: readonly UnverifiableRegistration[];
}

const METHOD_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*(get|post|put|patch|delete|options|head|all)\s*\(/g;
const ROUTE_OBJECT_CALL = /\b([A-Za-z_$][\w$]*)\s*\.\s*route\s*\(/g;

export function extractRouteHandlers(scan: ScannedFile): HandlerScan {
  const handlers: RouteHandler[] = [];
  const unverifiable: UnverifiableRegistration[] = [];
  const { skeleton } = scan;

  for (const match of skeleton.matchAll(ROUTE_OBJECT_CALL)) {
    unverifiable.push({
      offset: match.index ?? 0,
      reason:
        "registers a route through `" +
        (match[1] ?? "app") +
        ".route({ ... })`, a form this gate cannot read a handler body out of — generated routes use `app.<method>(path, handler)` so the guard-first rule is checkable",
    });
  }

  for (const match of skeleton.matchAll(METHOD_CALL)) {
    const start = match.index ?? 0;
    const openParen = start + (match[0] ?? "").length - 1;
    const closeParen = matchParen(skeleton, openParen);
    if (closeParen === -1) continue;

    // A route registration's first argument is a path literal. Anything
    // else with a `.get(` in it — a Map, a headers bag — is not a route.
    const first = scan.strings.find((s) => s.offset > openParen && s.offset < closeParen);
    if (first === undefined || !first.value.startsWith("/")) continue;

    const bodyStart = findHandlerBody(scan, openParen, closeParen);
    if (bodyStart === null) {
      unverifiable.push({
        offset: start,
        reason:
          "registers `" +
          (match[2] ?? "").toUpperCase() +
          " " +
          first.value +
          "` with no inline handler function — the gate cannot follow a handler passed by reference, and an unreadable handler is an unproven one",
      });
      continue;
    }

    const bodyEnd = matchBrace(skeleton, bodyStart);
    if (bodyEnd === -1) {
      unverifiable.push({ offset: start, reason: "the handler body's braces do not balance" });
      continue;
    }

    handlers.push({
      method: (match[2] ?? "").toUpperCase(),
      routePath: first.value,
      registrationOffset: start,
      bodyStart,
      bodyEnd,
      body: skeleton.slice(bodyStart + 1, bodyEnd),
    });
  }

  return { handlers, unverifiable };
}

/** The `{` opening the handler function's body.
 *
 * Function bodies are recognised by the depth the scanner already
 * computed: a brace that increases function depth opens one, an object
 * literal (`app.get(path, { schema }, handler)`) does not. Of the
 * candidates inside the call, the handler is the SHALLOWEST — a nested
 * arrow inside it sits one level deeper — and, among those, the last, so
 * that `app.get(p, preHandler, handler)` reads the handler and not the
 * hook. */
function findHandlerBody(scan: ScannedFile, openParen: number, closeParen: number): number | null {
  const candidates: number[] = [];
  for (let i = openParen; i < closeParen; i++) {
    if (scan.skeleton[i] !== "{") continue;
    if (scan.functionDepthAt(i + 1) === scan.functionDepthAt(i) + 1) candidates.push(i);
  }
  if (candidates.length === 0) return null;

  let best = candidates[0] as number;
  for (const candidate of candidates) {
    if (scan.functionDepthAt(candidate) < scan.functionDepthAt(best)) best = candidate;
    else if (scan.functionDepthAt(candidate) === scan.functionDepthAt(best)) best = candidate;
  }
  return best;
}
