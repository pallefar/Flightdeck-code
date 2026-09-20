/** The human's half of the workbench: edits, saves, locks, and what
 * happens when the generator writes the file you are typing in.
 *
 * ── THE RULE THIS FILE EXISTS TO AVOID ───────────────────────────────
 * Last-write-wins. A person reads round 2's `routes/clocks.ts`, sees the
 * guard call is in the wrong place, fixes it, and asks for round 3. Round
 * 3 regenerates that file. Without a policy, one of two things happens
 * silently: the round clobbers the fix, or the fix clobbers the round.
 * Both are data loss the person finds out about later, from a diff that
 * no longer matches what they remember doing.
 *
 * So the policy is written down and is the same in every case:
 *
 *   • A draft with nothing of the person's in it is DROPPED when the file
 *     is regenerated. There is nothing to lose and nothing to ask about.
 *   • A draft whose text the round happens to reproduce exactly is also
 *     dropped — the generator agreed with you, so there is no edit left.
 *   • Anything else raises a CONFLICT: the round's text is what the panes
 *     show (it is what shipping would produce), the person's text is held
 *     verbatim, and neither is applied until they pick. Two buttons, both
 *     labelled with what they destroy.
 *
 * ── WHY A LOCK IS NOT A WRITE BARRIER HERE ───────────────────────────
 * bolt.diy's lock can be enforced: its editor and its agent write to the
 * same in-memory filesystem, so `files.ts` can refuse the agent's write.
 * This workbench is a renderer — the generator runs in another package,
 * on another machine in the deployed shape, and cannot be blocked from a
 * React component. Pretending otherwise would be the prettiest lie on the
 * screen (see `theme.ts` for the other one we refused to tell).
 *
 * A lock here is therefore two real things and no imaginary ones:
 *   1. It promises the person will be TOLD. A locked path conflicts on
 *      regeneration even when they never edited it, so a file they marked
 *      "I own this" can never change under them quietly.
 *   2. It is published as state (`lockedPaths`) for the driver to pass to
 *      the generator as a do-not-touch list. Enforcement belongs to the
 *      thing doing the writing; the UI's job is to make the intent exist
 *      and survive a round.
 *
 * Pure and DOM-free. `editing.test.ts` runs it in node. */
import type { GeneratedFile, GeneratedFileKind } from "./types";

// ───────────────────────────── drafts ────────────────────────────────────

export type ConflictKind = "regenerated" | "removed";

export interface Conflict {
  readonly kind: ConflictKind;
  /** What the new round produced for this path. `null` when the round no
   * longer contains the file at all. */
  readonly incoming: string | null;
  /** The person's text at the moment the conflict opened, held verbatim.
   * Kept here rather than recomputed because `buffer` keeps moving — they
   * can carry on typing while a conflict is open, and "keep mine" must
   * mean the text they can see, not the text they had when it opened. */
  readonly held: string;
  /** True when the conflict exists only because the path was locked. The
   * banner says so, because "you locked this and Studio changed it" and
   * "you edited this and Studio changed it" call for different reading. */
  readonly fromLock: boolean;
  readonly at: number;
}

export interface Draft {
  readonly path: string;
  /** The round this draft is anchored to. A draft never floats free: on
   * every new round it is either re-anchored, resolved or dropped. */
  readonly roundId: string;
  readonly kind: GeneratedFileKind;
  /** The generated text this draft forked from — the baseline the editor
   * diffs against and the text "restore generated" returns to. */
  readonly generated: string;
  /** What is in the editor right now, saved or not. */
  readonly buffer: string;
  /** The last text the person SAVED, or `null` if they never did. This is
   * the only field the other panes read: an unsaved buffer is theirs
   * alone, a saved one is part of the project. */
  readonly saved: string | null;
  readonly conflict: Conflict | null;
}

export type DraftState = "clean" | "dirty" | "saved" | "conflicted";

/** What the person's copy of this file effectively is. */
export function effectiveText(draft: Draft): string {
  return draft.saved ?? draft.generated;
}

export function isDirty(draft: Draft): boolean {
  return draft.buffer !== effectiveText(draft);
}

export function draftState(draft: Draft): DraftState {
  if (draft.conflict !== null) return "conflicted";
  if (isDirty(draft)) return "dirty";
  if (draft.saved !== null && draft.saved !== draft.generated) return "saved";
  return "clean";
}

/** A draft that holds nothing the person would miss. These are dropped
 * rather than reconciled — asking "keep your version or Studio's?" about
 * a file somebody merely opened is how a dialog becomes noise. */
export function isEmptyDraft(draft: Draft): boolean {
  return draft.conflict === null && draft.saved === null && draft.buffer === draft.generated;
}

export function openDraft(file: GeneratedFile, roundId: string): Draft {
  return {
    path: file.path,
    roundId,
    kind: file.kind,
    generated: file.contents,
    buffer: file.contents,
    saved: null,
    conflict: null,
  };
}

export function editDraft(draft: Draft, text: string): Draft {
  if (text === draft.buffer) return draft;
  return { ...draft, buffer: text };
}

/** Commit the buffer. Every other pane starts reading it on the next
 * render: the tree's delta, the diff against the previous round and the
 * preview are all derived from the same overlay, so a saved edit shows up
 * in all three or in none. */
export function saveDraft(draft: Draft): Draft {
  if (draft.buffer === draft.saved) return draft;
  return { ...draft, saved: draft.buffer };
}

/** Throw away unsaved typing, keep what was saved. */
export function revertDraft(draft: Draft): Draft {
  const target = effectiveText(draft);
  if (draft.buffer === target) return draft;
  return { ...draft, buffer: target };
}

/** Resolve a conflict.
 *
 * `"mine"` re-bases the person's held text onto the new round: the round's
 * text becomes the baseline (so the diff shows what they changed relative
 * to what Studio last produced) and their text becomes the saved overlay.
 * `"studio"` returns `null` — the draft ceases to exist and the round's
 * own text stands, with nothing left behind to overlay it later. */
export function resolveDraft(draft: Draft, choice: "mine" | "studio"): Draft | null {
  const conflict = draft.conflict;
  if (conflict === null) return draft;
  if (choice === "studio") return null;
  const generated = conflict.incoming ?? draft.generated;
  return {
    ...draft,
    generated,
    saved: conflict.held,
    buffer: conflict.held,
    conflict: null,
  };
}

// ───────────────────────────── the overlay ───────────────────────────────

/** The round's files with the person's SAVED edits applied.
 *
 * ⭐ Conflicted drafts are deliberately not applied. While a conflict is
 * open the panes show what shipping this round would actually produce —
 * the generator's text — and the person's copy stays visible in the editor
 * with the banner. Overlaying a held version would mean the diff, the
 * preview and the gate's line numbers all describe a file that nobody has
 * agreed to yet.
 *
 * Returns the SAME array when no draft applies, because `selectors.ts`
 * caches on identity and a fresh array per call is a render loop. */
export function applyDrafts(
  files: readonly GeneratedFile[],
  drafts: ReadonlyMap<string, Draft>,
  roundId: string,
): readonly GeneratedFile[] {
  if (drafts.size === 0) return files;

  let changed = false;
  const out = files.map((file) => {
    const draft = drafts.get(file.path);
    if (draft === undefined || draft.roundId !== roundId || draft.conflict !== null) return file;
    if (draft.saved === null || draft.saved === file.contents) return file;
    changed = true;
    return { ...file, contents: draft.saved };
  });

  // A draft whose path the round dropped, kept by "keep mine" on a
  // `removed` conflict. It is a file the person is holding against the
  // round, and hiding it would make "keep mine" a no-op with a message.
  const known = new Set(files.map((file) => file.path));
  for (const draft of drafts.values()) {
    if (draft.roundId !== roundId || draft.conflict !== null) continue;
    if (draft.saved === null || known.has(draft.path)) continue;
    out.push({ path: draft.path, contents: draft.saved, kind: draft.kind });
    changed = true;
  }

  return changed ? out : files;
}

// ───────────────────────────── reconciliation ────────────────────────────

export interface ReconcileInput {
  readonly drafts: ReadonlyMap<string, Draft>;
  readonly locks: ReadonlySet<string>;
  /** The files of the round the drafts are anchored to. `null` when there
   * was no previous round, in which case a lock cannot have been broken. */
  readonly previousFiles: readonly GeneratedFile[] | null;
  readonly nextFiles: readonly GeneratedFile[];
  readonly nextRoundId: string;
  readonly at: number;
}

/** Walk every draft and every lock into the new round.
 *
 * Called once, inside the same commit that appends the round — so a
 * subscriber never observes a state where the round has moved on and the
 * drafts still point at the last one.
 *
 * Returns the SAME map when nothing moved. */
export function reconcileDrafts(input: ReconcileInput): ReadonlyMap<string, Draft> {
  const { drafts, locks, previousFiles, nextFiles, nextRoundId, at } = input;
  const next = new Map<string, GeneratedFile>(nextFiles.map((file) => [file.path, file]));
  const previous = new Map<string, GeneratedFile>((previousFiles ?? []).map((file) => [file.path, file]));
  const out = new Map<string, Draft>();
  let changed = false;

  for (const [path, draft] of drafts) {
    const incoming = next.get(path);

    // Nothing of theirs is at stake. Follow the round.
    if (isEmptyDraft(draft)) {
      changed = true;
      continue;
    }

    // An unresolved conflict survives a further round rather than being
    // silently re-pointed: they were asked a question and have not
    // answered it. Only the incoming text is refreshed, so answering it
    // later applies against what the round actually contains now.
    if (draft.conflict !== null) {
      const refreshed: Draft = {
        ...draft,
        roundId: nextRoundId,
        conflict: {
          ...draft.conflict,
          kind: incoming === undefined ? "removed" : "regenerated",
          incoming: incoming?.contents ?? null,
          at,
        },
      };
      out.set(path, refreshed);
      changed = true;
      continue;
    }

    if (incoming === undefined) {
      out.set(path, {
        ...draft,
        roundId: nextRoundId,
        conflict: { kind: "removed", incoming: null, held: effectiveText(draft), fromLock: locks.has(path), at },
      });
      changed = true;
      continue;
    }

    // The generator produced exactly what they had. There is no edit left
    // to hold, so the draft goes and the file is simply the round's.
    if (incoming.contents === effectiveText(draft)) {
      changed = true;
      continue;
    }

    out.set(path, {
      ...draft,
      roundId: nextRoundId,
      kind: incoming.kind,
      conflict: {
        kind: "regenerated",
        incoming: incoming.contents,
        held: effectiveText(draft),
        fromLock: locks.has(path),
        at,
      },
    });
    changed = true;
  }

  // A locked path with no draft at all: the person never typed in it, they
  // marked it as theirs. The lock's whole promise is that they are told,
  // so a round that changed it opens a conflict holding the text they
  // locked.
  for (const path of locks) {
    if (out.has(path) || drafts.has(path)) continue;
    const before = previous.get(path);
    const incoming = next.get(path);
    if (before === undefined) continue;
    if (incoming !== undefined && incoming.contents === before.contents) continue;
    out.set(path, {
      path,
      roundId: nextRoundId,
      kind: before.kind,
      generated: before.contents,
      buffer: before.contents,
      saved: null,
      conflict: {
        kind: incoming === undefined ? "removed" : "regenerated",
        incoming: incoming?.contents ?? null,
        held: before.contents,
        fromLock: true,
        at,
      },
    });
    changed = true;
  }

  return changed ? out : drafts;
}

// ───────────────────────────── editability ───────────────────────────────

/** Past this, the `<textarea>` stops being an editor and starts being a
 * way to freeze the tab. Generated sub-app files are single-digit KB; a
 * file this size in a candidate is a bug worth seeing, not worth typing
 * into. */
export const EDITABLE_MAX_BYTES = 512 * 1024;

/** A generated file is a string, so "binary" here means "a string that is
 * not source": a NUL, or enough C0 control characters that a text editor
 * would be showing mojibake. Fixtures come off disk and a mis-decoded one
 * must render as "not text" rather than as garbage a person might edit
 * and save back. */
export function looksBinary(text: string): boolean {
  const sample = text.slice(0, 4096);
  if (sample.includes("\u0000")) return true;
  let control = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    // Tab, newline and carriage return are text.
    if (code === 9 || code === 10 || code === 13) continue;
    if (code < 32 || code === 127) control += 1;
  }
  return sample.length > 0 && control / sample.length > 0.02;
}

export interface Editability {
  readonly editable: boolean;
  /** Why not, in a sentence a person can act on. `null` when editable. */
  readonly reason: string | null;
}

export const EDITABLE: Editability = { editable: true, reason: null };

/** Why this file cannot be typed in right now.
 *
 * `beingWritten` comes from `run.pathsBeingWritten` — a step that declared
 * it writes this path is running. That is the one case where the answer is
 * "not yet" rather than "not ever", and the editor says so. */
export function editability(
  file: GeneratedFile | null,
  beingWritten: ReadonlySet<string> = new Set(),
): Editability {
  if (file === null) return { editable: false, reason: "No file selected." };
  if (beingWritten.has(file.path)) {
    return {
      editable: false,
      reason: "Studio is writing this file right now. It unlocks when the step finishes.",
    };
  }
  if (file.contents.length > EDITABLE_MAX_BYTES) {
    return {
      editable: false,
      reason: `${Math.round(file.contents.length / 1024)} KB — too large to edit here. A generated sub-app file this size is itself worth a look.`,
    };
  }
  if (looksBinary(file.contents)) {
    return { editable: false, reason: "Not text — this file did not decode as source." };
  }
  return EDITABLE;
}

// ───────────────────────────── aggregates ────────────────────────────────

export interface EditSummary {
  readonly dirty: number;
  readonly saved: number;
  readonly conflicted: number;
  readonly locked: number;
}

/** The one-glance answer to "is there anything of mine in here?", which is
 * the question a person asks before they ask for another round. */
export function editSummary(
  drafts: ReadonlyMap<string, Draft>,
  locks: ReadonlySet<string>,
): EditSummary {
  let dirty = 0;
  let saved = 0;
  let conflicted = 0;
  for (const draft of drafts.values()) {
    const state = draftState(draft);
    if (state === "conflicted") conflicted += 1;
    else if (state === "dirty") dirty += 1;
    else if (state === "saved") saved += 1;
  }
  return { dirty, saved, conflicted, locked: locks.size };
}
