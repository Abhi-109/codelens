/* Frames shared by every authored data-structure model.
 *
 * A frame is a complete snapshot plus the marks and the short explanation that
 * belong to it. Snapshotting here, rather than replaying reversible diffs,
 * is what lets Back and seeking draw an old step exactly: a mark from a later
 * step cannot survive, because it was never part of this snapshot.
 */

export const MARK_KINDS = [
  'active',
  'compare',
  'done',
  'found',
  'collision',
  'inserted',
  'deleted',
  'tombstone',
];

export const noMarks = () =>
  Object.fromEntries(MARK_KINDS.map((kind) => [kind, []]));

export const clone = (value) => JSON.parse(JSON.stringify(value));

/** Record one frame. `marks` may name any of MARK_KINDS; `detail` is the
 *  structured data the hash-table readout shows, never a second narrative. */
export function frame(state, text, marks = {}, detail = null) {
  return {
    state: clone(state),
    text,
    marks: { ...noMarks(), ...marks },
    detail,
  };
}
