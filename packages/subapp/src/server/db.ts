/** HOST STAND-IN — not emitted. See `src/emit.ts`.
 *
 * ⭐ WHY A STAND-IN AND NOT THE HOST. Studio's sub-app source lives in this
 * package, outside the Flightdeck checkout, so `../types.js` and
 * `../installRow.js` resolve to nothing here. Typechecking the emitted files
 * alone would report nine unresolved modules and nothing else. So the seam is
 * declared here, from `docs/FLIGHTDECK-SUBAPP-CONTRACT.md`, and the sub-app is
 * compiled against it — the same discipline `@conformance`'s
 * `FLIGHTDECK_HOST_SURFACE` uses for the candidates it judges.
 *
 * ⛔ IT IS A MODEL, NOT THE HOST. Every stand-in in this tree is deliberately
 * NARROWER than the host's own module: it declares only what the emitted code
 * actually uses. That direction is the safe one — source that compiles against
 * a narrower type also compiles against the wider real one, because it can only
 * have used members both of them have. A stand-in that invented a member the
 * host lacks would be the dangerous direction, so none of them do.
 *
 * The host's `Db` is a live database handle. A database-free mini-app never
 * touches one: the only thing Studio's guard does with `rt.db` is hand it to
 * `effectiveSubAppEnabled`, so the shape needed here is "an object, opaque". */
export interface Db {
  /** Never read. Present so `Db` is a distinct nominal-ish type rather than
   * `{}`, which would accept a string. */
  readonly __flightdeckDb?: unique symbol;
}
