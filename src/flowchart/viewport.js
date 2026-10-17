// Pure viewport maths for the execution graph: fit-to-view, zoom, and pan.
// No React and no DOM, so `node --test` covers it directly.
//
// A transform is { scale, x, y }. A point p in graph space is drawn at
//   screen = p * scale + (x, y)
// so the visible graph rectangle — the SVG viewBox — is
//   left = -x / scale      top = -y / scale
//   width = paneW / scale  height = paneH / scale

/** Below this the 13px labels stop being readable, so we stop zooming out. */
export const MIN_LEGIBLE_SCALE = 0.85;
export const MIN_SCALE = 0.2;
export const MAX_SCALE = 3;
/** Breathing room left between the drawing and the edge of the pane. */
export const FIT_PADDING = 14;

const positive = (value) => (Number.isFinite(value) && value > 0 ? value : 1);

export function clampScale(scale, min = MIN_SCALE, max = MAX_SCALE) {
  return Math.min(Math.max(scale, min), max);
}

/** Moves the transform so `point` (graph space) sits at the centre of the pane. */
export function centreOn(transform, point, viewport) {
  const width = Number.isFinite(viewport?.width) ? viewport.width : 0;
  const height = Number.isFinite(viewport?.height) ? viewport.height : 0;
  return {
    scale: transform.scale,
    x: width / 2 - point.x * transform.scale,
    y: height / 2 - point.y * transform.scale,
  };
}

/**
 * The transform that shows the whole chart in the pane.
 *
 * The whole chart is shown when that keeps labels legible. When the chart is
 * too large for that, the width is fitted and the learner pans vertically —
 * and if even the width would need unreadable labels, the legibility floor
 * wins instead.
 */
export function computeFit(bounds, viewport, minScale = MIN_LEGIBLE_SCALE) {
  const bw = positive(bounds?.width);
  const bh = positive(bounds?.height);
  const paneW = Number.isFinite(viewport?.width) ? viewport.width : 0;
  const paneH = Number.isFinite(viewport?.height) ? viewport.height : 0;
  const innerW = Math.max(paneW - FIT_PADDING * 2, 1);
  const innerH = Math.max(paneH - FIT_PADDING * 2, 1);

  const whole = Math.min(innerW / bw, innerH / bh);
  const widthOnly = innerW / bw;
  const fitted = whole >= minScale ? whole : Math.max(widthOnly, minScale);
  // Never magnify on load: a two-node chart should not balloon to fill the pane.
  const scale = clampScale(Math.min(fitted, 1));
  return centreOn({ scale, x: 0, y: 0 }, { x: bw / 2, y: bh / 2 }, viewport);
}

/** Zooms by `factor` while keeping the graph point under `point` (pane space) fixed. */
export function zoomAt(transform, point, factor, limits = {}) {
  const scale = clampScale(
    transform.scale * factor,
    limits.min ?? MIN_SCALE,
    limits.max ?? MAX_SCALE,
  );
  if (scale === transform.scale) return transform;
  const graphX = (point.x - transform.x) / transform.scale;
  const graphY = (point.y - transform.y) / transform.scale;
  return {
    scale,
    x: point.x - graphX * scale,
    y: point.y - graphY * scale,
  };
}

export function panBy(transform, dx, dy) {
  return { ...transform, x: transform.x + dx, y: transform.y + dy };
}

/** Stops a pan from pushing the whole drawing out of sight. */
export function clampPan(transform, bounds, viewport, margin = 48) {
  const drawnW = positive(bounds?.width) * transform.scale;
  const drawnH = positive(bounds?.height) * transform.scale;
  const paneW = Number.isFinite(viewport?.width) ? viewport.width : 0;
  const paneH = Number.isFinite(viewport?.height) ? viewport.height : 0;
  const keepX = Math.min(margin, paneW / 2);
  const keepY = Math.min(margin, paneH / 2);
  const minX = keepX - drawnW;
  const maxX = paneW - keepX;
  const minY = keepY - drawnH;
  const maxY = paneH - keepY;
  return {
    scale: transform.scale,
    x: Math.min(Math.max(transform.x, minX), Math.max(minX, maxX)),
    y: Math.min(Math.max(transform.y, minY), Math.max(minY, maxY)),
  };
}

/** The SVG `viewBox` string for a transform and pane size. */
export function viewBoxOf(transform, viewport) {
  const paneW = positive(viewport?.width);
  const paneH = positive(viewport?.height);
  const width = paneW / transform.scale;
  const height = paneH / transform.scale;
  return `${-transform.x / transform.scale} ${-transform.y / transform.scale} ${width} ${height}`;
}

/** Where a graph point lands on screen, for positioning tooltips. */
export function toScreen(transform, point) {
  return {
    x: point.x * transform.scale + transform.x,
    y: point.y * transform.scale + transform.y,
  };
}
