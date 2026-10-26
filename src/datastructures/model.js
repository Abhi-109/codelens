/* The data-structure lab's operation model.
 *
 * This is deliberately *not* the Python tracer. Each operation is authored
 * here, applied to a plain state, and recorded as a list of frames. A frame is
 * a complete snapshot of the structure plus one sentence and the marks that
 * belong to that snapshot — so Back, Next and seeking can draw any frame
 * directly and a highlight from a later frame cannot survive.
 *
 * Pure and deterministic: the same state and operation always produce the
 * same frames, which is what datastructures/model.test.mjs checks.
 */

/** A frame's marks are string keys into the structure being drawn:
 *  an array index, a list index, a BST value, or a graph node id. */
const noMarks = () => ({ active: [], compare: [], done: [], found: [] });

const clone = (value) => JSON.parse(JSON.stringify(value));

/** Record one frame. `marks` may name any of the four kinds. */
function frame(state, text, marks = {}) {
  return {
    state: clone(state),
    text,
    marks: { ...noMarks(), ...marks },
  };
}

const keys = (values) => values.map(String);

/* --- Arrays --------------------------------------------------------------- */

const ARRAY_START = { values: [4, 7, 1], capacity: 4 };

function arrayFrames(state, op, input) {
  const value = Number(input.value);
  const values = [...state.values];
  const frames = [];

  const grow = () => {
    if (values.length < state.capacity) return false;
    state = { ...state, capacity: state.capacity * 2 };
    frames.push(
      frame(state, `The array is full, so its capacity doubles from ${state.capacity / 2} to ${state.capacity}.`),
    );
    return true;
  };

  if (op === 'append') {
    grow();
    values.push(value);
    frames.push(frame({ ...state, values }, `Append ${value} at index ${values.length - 1}.`, { active: [String(values.length - 1)] }));
    return { state: { ...state, values }, frames };
  }

  if (op === 'insert') {
    const at = Number(input.index);
    if (!Number.isInteger(at) || at < 0 || at > values.length) {
      return { error: `Index ${input.index} is outside 0..${values.length}.` };
    }
    grow();
    values.splice(at, 0, value);
    frames.push(
      frame({ ...state, values }, `Insert ${value} at index ${at}; the values after it shift right.`, {
        active: [String(at)],
      }),
    );
    return { state: { ...state, values }, frames };
  }

  if (op === 'remove') {
    const at = Number(input.index);
    if (!Number.isInteger(at) || at < 0 || at >= values.length) {
      return { error: values.length === 0 ? 'The array is empty.' : `Index ${input.index} is outside 0..${values.length - 1}.` };
    }
    const [removed] = values.splice(at, 1);
    frames.push(
      frame({ ...state, values }, `Remove ${removed} from index ${at}; the values after it shift left.`, {
        active: [String(Math.min(at, values.length - 1))],
      }),
    );
    return { state: { ...state, values }, frames };
  }

  // search
  if (values.length === 0) return { error: 'The array is empty, so there is nothing to search.' };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === value) {
      frames.push(frame(state, `Found ${value} at index ${i}.`, { found: [String(i)] }));
      return { state, frames };
    }
    frames.push(frame(state, `Compare index ${i} (${values[i]}) with ${value}: not equal.`, { compare: [String(i)] }));
  }
  frames.push(frame(state, `${value} is not in the array.`, { done: keys(values.map((_, i) => i)) }));
  return { state, frames };
}

/* --- Linked lists --------------------------------------------------------- */

const LIST_START = { values: ['A', 'B', 'C'] };

function listFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const values = [...state.values];
  const frames = [];
  if (op !== 'traverse' && !value) return { error: 'Type a value first.' };

  if (op === 'prepend') {
    values.unshift(value);
    frames.push(frame({ ...state, values }, `Prepend ${value}; it becomes the new head.`, { active: ['0'] }));
    return { state: { ...state, values }, frames };
  }

  if (op === 'append') {
    values.push(value);
    frames.push(
      frame({ ...state, values }, `Append ${value}; it becomes the new tail.`, { active: [String(values.length - 1)] }),
    );
    return { state: { ...state, values }, frames };
  }

  if (op === 'traverse') {
    if (values.length === 0) return { error: 'The list is empty, so there is nothing to traverse.' };
    for (let i = 0; i < values.length; i += 1) {
      const next = i + 1 < values.length ? values[i + 1] : 'null';
      frames.push(
        frame(state, `Visit ${values[i]}; next is ${next}.`, {
          active: [String(i)],
          done: keys(values.slice(0, i).map((_, j) => j)),
        }),
      );
    }
    return { state, frames };
  }

  if (op === 'remove') {
    if (values.length === 0) return { error: 'The list is empty, so there is nothing to remove.' };
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] === value) {
        values.splice(i, 1);
        frames.push(
          frame({ ...state, values }, `Remove ${value}; the link before it now points past it.`, {
            active: [String(Math.min(i, values.length - 1))],
          }),
        );
        return { state: { ...state, values }, frames };
      }
      frames.push(frame(state, `Compare ${values[i]} with ${value}: not equal, follow the link.`, { compare: [String(i)] }));
    }
    frames.push(frame(state, `${value} is not in the list.`, { done: keys(values.map((_, i) => i)) }));
    return { state, frames };
  }

  // search
  if (values.length === 0) return { error: 'The list is empty, so there is nothing to search.' };
  for (let i = 0; i < values.length; i += 1) {
    if (values[i] === value) {
      frames.push(frame(state, `Found ${value} at position ${i}.`, { found: [String(i)] }));
      return { state, frames };
    }
    frames.push(frame(state, `Compare ${values[i]} with ${value}: not equal, follow the link.`, { compare: [String(i)] }));
  }
  frames.push(frame(state, `${value} is not in the list.`, { done: keys(values.map((_, i) => i)) }));
  return { state, frames };
}

/* --- Stack and queue ------------------------------------------------------ */

const STACK_START = { values: ['A', 'B'] };
const QUEUE_START = { values: ['A', 'B'] };

function stackFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const values = [...state.values];

  if (op === 'push') {
    if (!value) return { error: 'Type a value first.' };
    values.push(value);
    return {
      state: { ...state, values },
      frames: [frame({ ...state, values }, `Push ${value}; it becomes the top.`, { active: [String(values.length - 1)] })],
    };
  }

  if (values.length === 0) return { error: 'The stack is empty.' };

  if (op === 'pop') {
    const removed = values.pop();
    const top = values.length ? values[values.length - 1] : null;
    return {
      state: { ...state, values },
      frames: [
        frame({ ...state, values }, `Pop ${removed} from the top. ${top === null ? 'The stack is now empty.' : `The new top is ${top}.`}`, {
          active: values.length ? [String(values.length - 1)] : [],
        }),
      ],
    };
  }

  return {
    state,
    frames: [frame(state, `Peek: the top is ${values[values.length - 1]}.`, { active: [String(values.length - 1)] })],
  };
}

function queueFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const values = [...state.values];

  if (op === 'enqueue') {
    if (!value) return { error: 'Type a value first.' };
    values.push(value);
    return {
      state: { ...state, values },
      frames: [
        frame({ ...state, values }, `Enqueue ${value} at the back.`, { active: [String(values.length - 1)] }),
      ],
    };
  }

  if (values.length === 0) return { error: 'The queue is empty.' };

  if (op === 'dequeue') {
    const removed = values.shift();
    return {
      state: { ...state, values },
      frames: [
        frame({ ...state, values }, `Dequeue ${removed} from the front. ${values.length ? `The new front is ${values[0]}.` : 'The queue is now empty.'}`, {
          active: values.length ? ['0'] : [],
        }),
      ],
    };
  }

  return {
    state,
    frames: [frame(state, `Peek: the front is ${values[0]}.`, { active: ['0'] })],
  };
}

/* --- Binary search tree --------------------------------------------------- */

const node = (value) => ({ value, left: null, right: null });

function treeFrames(state, op, input) {
  const value = Number(input.value);
  if (op !== 'inorder' && !Number.isFinite(value)) return { error: 'Type a number first.' };
  const root = state.root ? clone(state.root) : null;
  const frames = [];

  if (op === 'insert') {
    if (!root) {
      const next = { root: node(value) };
      frames.push(frame(next, `Insert ${value} as the root.`, { active: [String(value)] }));
      return { state: next, frames };
    }
    let current = root;
    while (current) {
      if (value === current.value) {
        frames.push(
          frame({ root }, `${value} is already in the tree; a BST keeps one copy.`, { found: [String(value)] }),
        );
        return { state: { root }, frames };
      }
      frames.push(
        frame({ root }, `Compare ${value} with ${current.value}: go ${value < current.value ? 'left' : 'right'}.`, {
          compare: [String(current.value)],
        }),
      );
      if (value < current.value) {
        if (!current.left) {
          current.left = node(value);
          break;
        }
        current = current.left;
      } else {
        if (!current.right) {
          current.right = node(value);
          break;
        }
        current = current.right;
      }
    }
    frames.push(frame({ root }, `Insert ${value} as a new leaf.`, { active: [String(value)] }));
    return { state: { root }, frames };
  }

  if (!root) return { error: 'The tree is empty.' };

  if (op === 'search') {
    let current = root;
    while (current) {
      if (value === current.value) {
        frames.push(frame({ root }, `Found ${value}.`, { found: [String(value)] }));
        return { state: { root }, frames };
      }
      frames.push(
        frame({ root }, `Compare ${value} with ${current.value}: go ${value < current.value ? 'left' : 'right'}.`, {
          compare: [String(current.value)],
        }),
      );
      current = value < current.value ? current.left : current.right;
    }
    frames.push(frame({ root }, `${value} is not in the tree.`, {}));
    return { state: { root }, frames };
  }

  // in-order traversal
  const seen = [];
  const walk = (at) => {
    if (!at) return;
    walk(at.left);
    seen.push(at.value);
    frames.push(
      frame({ root }, `Visit ${at.value}. In-order so far: ${seen.join(', ')}.`, {
        active: [String(at.value)],
        done: keys(seen),
      }),
    );
    walk(at.right);
  };
  walk(root);
  frames.push(frame({ root }, `In-order traversal: ${seen.join(', ')}.`, { done: keys(seen) }));
  return { state: { root }, frames };
}

/* --- Graph ---------------------------------------------------------------- */

const GRAPH = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'D'],
    ['C', 'E'],
    ['D', 'F'],
    ['E', 'F'],
  ],
};

function graphFrames(state, op) {
  const order = [];
  const frames = [];
  const seen = new Set();

  if (op === 'bfs') {
    const queue = ['A'];
    const discovered = new Set(queue);
    while (queue.length) {
      const at = queue.shift();
      seen.add(at);
      order.push(at);
      const next = state.nodes.filter(
        (id) => !discovered.has(id) && state.edges.some(([a, b]) => (a === at && b === id) || (b === at && a === id)),
      );
      for (const id of next) {
        discovered.add(id);
        queue.push(id);
      }
      frames.push(
        frame(state, `Visit ${at}. ${queue.length ? `Queue: ${queue.join(', ')}.` : 'The queue is empty.'}`, {
          active: [at],
          done: keys(order),
        }),
      );
    }
    frames.push(frame(state, `Breadth-first order: ${order.join(' → ')}.`, { done: keys(order) }));
    return { state, frames };
  }

  // depth-first, recursive, following the edge order above
  const walk = (at) => {
    seen.add(at);
    order.push(at);
    const next = state.nodes.filter(
      (id) => !seen.has(id) && state.edges.some(([a, b]) => (a === at && b === id) || (b === at && a === id)),
    );
    frames.push(
      frame(state, `Visit ${at}.${next.length ? ` Next unvisited: ${next.join(', ')}.` : ' No unvisited neighbours.'}`, {
        active: [at],
        done: keys(order),
      }),
    );
    for (const id of next) if (!seen.has(id)) walk(id);
  };
  walk('A');
  frames.push(frame(state, `Depth-first order: ${order.join(' → ')}.`, { done: keys(order) }));
  return { state, frames };
}

/* --- The registry --------------------------------------------------------- */

export const STRUCTURES = [
  {
    type: 'array',
    name: 'Array',
    blurb: 'Append, insert, remove and search. The capacity doubles when the array fills.',
    limits: 'resizing the array by hand and deleting the whole array.',
    start: ARRAY_START,
    operations: [
      { id: 'append', label: 'Append', fields: [{ name: 'value', label: 'Value', default: 6 }] },
      {
        id: 'insert',
        label: 'Insert',
        fields: [
          { name: 'index', label: 'Index', default: 1 },
          { name: 'value', label: 'Value', default: 9 },
        ],
      },
      { id: 'remove', label: 'Remove', fields: [{ name: 'index', label: 'Index', default: 0 }] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 7 }] },
    ],
    run: arrayFrames,
  },
  {
    type: 'linked-list',
    name: 'Linked list',
    blurb: 'Prepend, append, remove, search and walk the links from head to tail.',
    limits: 'doubly linked lists and cycle detection.',
    start: LIST_START,
    operations: [
      { id: 'prepend', label: 'Prepend', fields: [{ name: 'value', label: 'Value', default: 'D', type: 'text' }] },
      { id: 'append', label: 'Append', fields: [{ name: 'value', label: 'Value', default: 'D', type: 'text' }] },
      { id: 'remove', label: 'Remove', fields: [{ name: 'value', label: 'Value', default: 'B', type: 'text' }] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 'B', type: 'text' }] },
      { id: 'traverse', label: 'Traverse', fields: [] },
    ],
    run: listFrames,
  },
  {
    type: 'stack',
    name: 'Stack',
    blurb: 'Push and pop at the top, or peek without changing anything.',
    limits: 'searching below the top; a stack only exposes its top.',
    start: STACK_START,
    operations: [
      { id: 'push', label: 'Push', fields: [{ name: 'value', label: 'Value', default: 'C', type: 'text' }] },
      { id: 'pop', label: 'Pop', fields: [] },
      { id: 'peek', label: 'Peek', fields: [] },
    ],
    run: stackFrames,
  },
  {
    type: 'queue',
    name: 'Queue',
    blurb: 'Enqueue at the back, dequeue from the front, or peek at the front.',
    limits: 'priority queues and circular buffers.',
    start: QUEUE_START,
    operations: [
      { id: 'enqueue', label: 'Enqueue', fields: [{ name: 'value', label: 'Value', default: 'C', type: 'text' }] },
      { id: 'dequeue', label: 'Dequeue', fields: [] },
      { id: 'peek', label: 'Peek', fields: [] },
    ],
    run: queueFrames,
  },
  {
    type: 'bst',
    name: 'Binary search tree',
    blurb: 'Insert, search and walk the tree in order. A duplicate value is kept once.',
    limits: 'deleting a node; the tree keeps one copy of a duplicate value.',
    start: { root: null },
    operations: [
      { id: 'insert', label: 'Insert', fields: [{ name: 'value', label: 'Value', default: 5 }] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 5 }] },
      { id: 'inorder', label: 'In-order', fields: [] },
    ],
    run: treeFrames,
  },
  {
    type: 'graph',
    name: 'Graph',
    blurb: 'Breadth-first and depth-first traversal of one fixed example graph.',
    limits: 'editing nodes, edges or the start node; the graph is fixed.',
    start: clone(GRAPH),
    operations: [
      { id: 'bfs', label: 'Breadth-first', fields: [] },
      { id: 'dfs', label: 'Depth-first', fields: [] },
    ],
    run: graphFrames,
  },
];

/** One structure by URL type, or null when the type names nothing. */
export function structureByType(type) {
  return STRUCTURES.find((entry) => entry.type === type) ?? null;
}

/** The starting state for a structure, cloned so callers cannot share it. */
export function initialState(type) {
  const structure = structureByType(type);
  return structure ? clone(structure.start) : null;
}

/**
 * Apply one operation to a state.
 *
 * Returns `{ state, frames }` on success, or `{ error }` when the operation
 * cannot run — in which case the caller keeps its current state. A success
 * always has at least one frame, and the last frame's state is the returned
 * state.
 */
export function applyOperation(type, state, op, input = {}) {
  const structure = structureByType(type);
  if (!structure) return { error: `Unknown structure: ${type}.` };
  if (!structure.operations.some((entry) => entry.id === op)) {
    return { error: `Unsupported operation: ${op}.` };
  }
  const result = structure.run(clone(state), op, input);
  if (result.error) return { error: result.error };
  return { state: result.state, frames: result.frames };
}
