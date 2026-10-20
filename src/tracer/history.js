// Pure geometry for the variable-history chart. The chart is drawn as SVG, so
// this module turns the real history entries into points and decides whether a
// series can honestly be plotted at all. No React, no DOM: node --test covers
// the scaling, the flat series and the "not a number" cases.

/**
 * True only when every entry holds a finite number. A variable that became a
 * string halfway through is not plotable: joining the numbers across the gap
 * would draw a change that never happened.
 */
export function isNumericSeries(entries) {
  return (
    Array.isArray(entries) &&
    entries.length > 0 &&
    entries.every((entry) => typeof entry.number === "number" && Number.isFinite(entry.number))
  );
}

const clamp = (value, lo, hi) => Math.min(Math.max(value, lo), hi);

/**
 * Plot points for a numeric history. X is the real trace step, so a change
 * after a long loop sits far to the right rather than evenly spaced.
 *
 * @param {Array<{index:number, number:number, value:string, line:number|null}>} entries
 * @param {number} currentIndex the selected step, for the marker line
 * @param {number} totalSteps length of the whole trace
 * @param {{width?:number, height?:number, pad?:number}} [options]
 */
export function chartGeometry(entries, currentIndex, totalSteps, options = {}) {
  const width = options.width ?? 260;
  const height = options.height ?? 112;
  const pad = options.pad ?? 10;
  const list = Array.isArray(entries) ? entries : [];
  if (!isNumericSeries(list)) {
    return { points: [], currentX: null, zeroY: null, width, height, pad, min: 0, max: 0 };
  }

  const lastStep = Math.max((Number(totalSteps) || 1) - 1, 1);
  const xFor = (index) => pad + (clamp(Number(index) || 0, 0, lastStep) / lastStep) * (width - pad * 2);

  const values = list.map((entry) => entry.number);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // One value (or one repeated value) still gets a readable line through the
  // middle instead of a division by zero at the edge.
  const min = rawMin === rawMax ? rawMin - 1 : rawMin;
  const max = rawMin === rawMax ? rawMax + 1 : rawMax;
  const yFor = (value) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2);

  return {
    points: list.map((entry) => ({ ...entry, x: xFor(entry.index), y: yFor(entry.number) })),
    currentX: Number.isFinite(currentIndex) ? xFor(currentIndex) : null,
    zeroY: min <= 0 && max >= 0 ? yFor(0) : null,
    min: rawMin,
    max: rawMax,
    width,
    height,
    pad,
  };
}
