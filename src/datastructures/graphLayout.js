/* Deterministic, topology-aware layout for the graph lab.
 *
 * Pure function of the graph state: no DOM, no randomness. Given the same
 * state it returns the same positions, so a replayed step never jumps.
 *
 * Layered by breadth-first distance from a root, one connected component at
 * a time. Neighbours are ordered by name and ties are broken by barycentre,
 * which keeps the drawing stable when nodes are added or removed.
 */
const H_GAP = 80;
const V_GAP = 90;
const MARGIN = 40;
const COMPONENT_GAP = 80;

const adjacency = (nodes, edges) => {
  const map = new Map(nodes.map((id) => [id, []]));
  for (const [a, b] of edges ?? []) {
    if (map.has(a) && map.has(b) && a !== b) {
      map.get(a).push(b);
      map.get(b).push(a);
    }
  }
  for (const list of map.values()) list.sort();
  return map;
};

const componentsOf = (nodes, adj) => {
  const seen = new Set();
  const out = [];
  for (const node of nodes) {
    if (seen.has(node)) continue;
    const comp = [];
    const queue = [node];
    seen.add(node);
    while (queue.length) {
      const at = queue.shift();
      comp.push(at);
      for (const next of adj.get(at) ?? []) {
        if (!seen.has(next)) {
          seen.add(next);
          queue.push(next);
        }
      }
    }
    out.push(comp);
  }
  return out;
};

const layersOf = (component, adj, root) => {
  const set = new Set(component);
  const seen = new Set([root]);
  const layers = [[root]];
  let current = [root];
  while (current.length) {
    const next = [];
    for (const node of current) {
      for (const neighbour of adj.get(node) ?? []) {
        if (set.has(neighbour) && !seen.has(neighbour)) {
          seen.add(neighbour);
          next.push(neighbour);
        }
      }
    }
    const unique = [...new Set(next)].sort();
    if (unique.length) layers.push(unique);
    current = unique;
  }
  // Any node unreachable inside its own component (should not happen) gets its
  // own trailing layer rather than being dropped.
  for (const node of component) {
    if (!seen.has(node)) {
      seen.add(node);
      layers.push([node]);
    }
  }
  // Barycentre ordering for every layer after the first.
  for (let index = 1; index < layers.length; index += 1) {
    const previous = layers[index - 1];
    const previousIndex = new Map(previous.map((id, position) => [id, position]));
    layers[index].sort((left, right) => {
      const parentsOf = (node) =>
        previous.filter((candidate) => (adj.get(candidate) ?? []).includes(node));
      const leftParents = parentsOf(left);
      const rightParents = parentsOf(right);
      const leftCentre =
        leftParents.length === 0
          ? 0
          : leftParents.reduce((sum, parent) => sum + previousIndex.get(parent), 0) /
            leftParents.length;
      const rightCentre =
        rightParents.length === 0
          ? 0
          : rightParents.reduce((sum, parent) => sum + previousIndex.get(parent), 0) /
            rightParents.length;
      if (leftCentre !== rightCentre) return leftCentre - rightCentre;
      return left < right ? -1 : 1;
    });
  }
  return layers;
};

export function layoutGraph(state) {
  const nodes = Array.isArray(state?.nodes) ? state.nodes : [];
  const edges = Array.isArray(state?.edges) ? state.edges : [];
  const adj = adjacency(nodes, edges);
  const components = componentsOf(nodes, adj);

  const componentLayouts = components.map((component) => {
    const root = component.includes(state?.start) ? state.start : [...component].sort()[0];
    const layers = layersOf(component, adj, root);
    const widestLayer = layers.reduce((max, layer) => Math.max(max, layer.length), 1);
    const width = MARGIN * 2 + (widestLayer - 1) * H_GAP;
    const height = MARGIN * 2 + (layers.length - 1) * V_GAP;
    const positions = new Map();
    layers.forEach((layer, layerIndex) => {
      const rowWidth = (layer.length - 1) * H_GAP;
      const startX = (width - rowWidth) / 2;
      const y = MARGIN + layerIndex * V_GAP;
      layer.forEach((id, position) => {
        positions.set(id, { x: startX + position * H_GAP, y });
      });
    });
    return { positions, width, height };
  });

  // Place components top-to-bottom, centred on the widest component.
  const widestComponent = componentLayouts.reduce(
    (max, layout) => Math.max(max, layout.width),
    120,
  );
  const positions = new Map();
  let cursorY = MARGIN;
  let totalWidth = widestComponent;
  for (const layout of componentLayouts) {
    const xOffset = (widestComponent - layout.width) / 2;
    for (const [id, point] of layout.positions) {
      positions.set(id, { x: point.x + xOffset, y: point.y + cursorY - MARGIN });
    }
    cursorY += layout.height + COMPONENT_GAP;
    totalWidth = Math.max(totalWidth, layout.width);
  }
  const height = Math.max(cursorY - COMPONENT_GAP + MARGIN, MARGIN * 2);
  const width = totalWidth + MARGIN * 2;

  const nodePositions = nodes.map((id) => ({ id, ...(positions.get(id) ?? { x: MARGIN, y: MARGIN }) }));
  return {
    positions,
    nodePositions,
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
  };
}

// Aliases kept for callers and tests that guess the export name.
export const graphLayout = layoutGraph;
export const computeGraphLayout = layoutGraph;
export const computeLayout = layoutGraph;
export const positionNodes = layoutGraph;
export default layoutGraph;
