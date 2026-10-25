// The pure half of the motion choreography: where an element is now and where
// its layout slot is go in, the transform keyframes that carry it there come
// out. No DOM, no timer, no algorithm name - the component measures, this
// decides the path.
//
// Every keyframe is a transform, so a move never touches layout, and the first
// frame is always the *measured* offset. That is what lets an interrupted
// animation continue from where the eye last saw the element instead of
// snapping back to its slot.

/** One curve per role, so the same kind of change always travels the same way. */
export const MOTION_EASING = Object.freeze({
  // Movement decelerates into place: it starts fast, because a cell is already
  // moving when a step interrupts another one, and settles at the end with no
  // overshoot - a list cell that bounces past its slot reads as a bug.
  move: "cubic-bezier(0.2, 0.7, 0.3, 1)",
  // Opacity and scale only. The even curve keeps a fade from looking like a
  // slide, and an exit is over before the next step lands.
  fade: "cubic-bezier(0.4, 0, 0.2, 1)",
  // An element entering the canvas grows into place.
  enter: "cubic-bezier(0.2, 0.8, 0.2, 1)",
});

/** How far a moving cell bows off the straight line, in px. Deliberately small. */
export const MOTION_ARC = Object.freeze({ swap: 10 });

/** Below this distance a move is sub-pixel layout noise, not a movement. */
const MIN_MOVE_PX = 0.5;

const px = (value) => `${Math.round(value * 100) / 100}px`;

/** Current offset relative to the layout slot, for an element measured at `rect`. */
export function offsetOf(fromRect, toRect) {
  if (!fromRect || !toRect) return null;
  return { dx: fromRect.left - toRect.left, dy: fromRect.top - toRect.top };
}

/**
 * The keyframes that carry an element from `(dx, dy)` - where it is now,
 * relative to its layout slot - to that slot.
 *
 * `arc` bows the path perpendicular to travel, capped at half the distance so a
 * short move curves less and a long one never loops. The side follows the
 * direction of travel, so the two cells of a swap - which travel opposite ways -
 * bow to opposite sides and pass each other instead of overlapping. Because the
 * caller animates both with the same duration and easing, they arrive together.
 *
 * @param {number} dx horizontal offset from the slot, in px
 * @param {number} dy vertical offset from the slot, in px
 * @param {{arc?: number}} [options]
 * @returns {Array<Object>|null} keyframes, or null when nothing should animate
 */
export function moveKeyframes(dx, dy, { arc = 0 } = {}) {
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const distance = Math.hypot(dx, dy);
  if (distance < MIN_MOVE_PX) return null;

  const start = { transform: `translate(${px(dx)}, ${px(dy)})` };
  const end = { transform: "translate(0, 0)" };
  const bow = Math.min(Math.abs(arc), distance / 2) * Math.sign(arc);
  if (bow === 0) return [start, end];

  // Screen y points down, so this perpendicular is the one where a move to the
  // right bows up and a move to the left bows down.
  const mid = {
    transform: `translate(${px(dx / 2 - (dy / distance) * bow)}, ${px(dy / 2 + (dx / distance) * bow)})`,
  };
  return [start, mid, end];
}
