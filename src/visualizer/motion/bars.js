// The numeric half of the motion view: project a list/tuple's recorded slot
// values onto bar geometry. Pure and DOM-free.
//
// The projection never invents a value or a comparison. It reads the same
// trace values the cell view holds and keeps the slot keys, so the renderer's
// existing move/FLIP animation can translate the bars without a second model.
//
// Fractions are 0..1 measured from the bottom of the plot. The domain always
// contains zero, so a positive bar grows up from the baseline, a negative bar
// hangs below it, and zero is a real position rather than a special case.
// One formula covers positives, negatives, equal values and mixed signs.

const NUMERIC = new Set(["int", "float"]);

/**
 * The bar model for a list or tuple, or `null` when the values are not all
 * finite numbers (mixed, boolean, reference, empty, or anything unsupported).
 *
 * @param {Array} slots view slots (`{ key, index, text, valueType, value, ... }`)
 * @returns {{min: number, max: number, zero: number, cells: Array}|null}
 */
export function numericBars(slots) {
  if (!Array.isArray(slots) || slots.length === 0) return null;

  const values = [];
  for (const slot of slots) {
    if (!NUMERIC.has(slot?.valueType)) return null;
    const value = slot.value?.value;
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    values.push(value);
  }

  const min = Math.min(0, ...values);
  const max = Math.max(0, ...values);
  // An all-zero collection has no span; one unit keeps the baseline at zero
  // and every bar empty instead of dividing by zero.
  const span = max - min || 1;
  const zero = (0 - min) / span;

  return {
    min,
    max,
    zero,
    cells: slots.map((slot, position) => {
      const value = values[position];
      const fraction = (value - min) / span;
      return {
        key: slot.key,
        index: slot.index,
        text: slot.text,
        value,
        negative: value < 0,
        changed: slot.changed === true,
        highlighted: slot.highlighted === true,
        entering: slot.entering === true,
        from: Math.min(fraction, zero),
        size: Math.abs(fraction - zero),
      };
    }),
  };
}
