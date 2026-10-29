/* The data-structure lab's operation model.
 *
 * This is deliberately *not* the Python tracer. Each operation is authored
 * here, applied to a plain state, and recorded as a list of frames. A frame is
 * a complete snapshot of the structure plus one sentence and the marks that
 * belong to that snapshot — so Back, Next and seeking can draw any frame
 * directly and a highlight from a later frame cannot survive.
 *
 * Pure and deterministic: the same state and operation always produce the
 * same frames, which is what the tests in this folder check.
 */

import { clone, frame } from './frames.js';
import { HASH_START, HASH_FUNCTIONS, HASH_PRESETS, HASH_STRATEGIES, hashTableFrames } from './hashTable.js';

const keys = (values) => values.map(String);

/* --- Arrays --------------------------------------------------------------- */

const ARRAY_START = { values: [4, 7, 1], capacity: 4 };

function arrayFrames(state, op, input) {
  const value = Number(input.value);
  const values = [...state.values];
  const frames = [];

  const grow = () => {
    if (values.length < state.capacity) return;
    state = { ...state, capacity: state.capacity * 2 };
    frames.push(
      frame(state, `The array is full, so its capacity doubles from ${state.capacity / 2} to ${state.capacity}.`),
    );
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

  if (op === 'resize') {
    const capacity = Number(input.capacity);
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) {
      return { error: `Capacity ${input.capacity} must be a whole number from 1 to 256.` };
    }
    if (capacity < values.length) {
      return {
        error: `Cannot shrink to ${capacity}: the array holds ${values.length} values. Remove some first, or clear the array.`,
      };
    }
    if (capacity === state.capacity) return { error: `The array already has capacity ${capacity}.` };
    const previous = state.capacity;
    state = { ...state, capacity };
    frames.push(
      frame(
        state,
        `Resize the capacity from ${previous} to ${capacity}. ${capacity < previous ? 'The released slots were empty; no value is lost.' : 'The new slots are empty.'}`,
        {},
      ),
    );
    return { state: { ...state, values }, frames };
  }

  if (op === 'clear') {
    const removed = values.length;
    frames.push(
      frame({ ...state, values: [] }, `Clear the array: all ${removed} ${removed === 1 ? 'value is' : 'values are'} removed. The capacity stays ${state.capacity}.`, {
        done: [],
      }),
    );
    return { state: { ...state, values: [] }, frames };
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

const LIST_START = { values: ['A', 'B', 'C'], doubly: false, cycleTo: null };

function listFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const values = [...state.values];
  const doubly = Boolean(state.doubly);
  const cycleTo = state.cycleTo ?? null;
  const frames = [];
  if (op !== 'traverse' && op !== 'traverse-backward' && op !== 'detect-cycle' && op !== 'mode' && op !== 'break-cycle' && op !== 'cycle' && !value) {
    return { error: 'Type a value first.' };
  }

  const nextOf = (at) => {
    if (at === null || at === undefined) return null;
    if (at < values.length - 1) return at + 1;
    return cycleTo ?? null;
  };

  const cycleGuard = () => {
    if (cycleTo !== null) {
      return { error: 'The list has a cycle; break it before changing the links.' };
    }
    return null;
  };

  if (op === 'mode') {
    const mode = input.mode === 'doubly' ? 'doubly' : 'singly';
    if ((mode === 'doubly') === doubly) {
      frames.push(frame(state, `The list already stores ${mode === 'doubly' ? 'previous and next' : 'next'} pointers.`, {}, ));
      return { state, frames };
    }
    state = { ...state, doubly: mode === 'doubly' };
    frames.push(
      frame(
        state,
        mode === 'doubly'
          ? 'Make the list doubly linked: every node now stores a previous pointer as well as a next pointer.'
          : 'Make the list singly linked: the previous pointers are dropped.',
        {},
      ),
    );
    return { state, frames };
  }

  if (op === 'prepend') {
    const blocked = cycleGuard();
    if (blocked) return blocked;
    values.unshift(value);
    frames.push(frame({ ...state, values }, `Prepend ${value}; it becomes the new head.`, { active: ['0'] }));
    return { state: { ...state, values }, frames };
  }

  if (op === 'append') {
    const blocked = cycleGuard();
    if (blocked) return blocked;
    values.push(value);
    frames.push(
      frame({ ...state, values }, `Append ${value}; it becomes the new tail.`, { active: [String(values.length - 1)] }),
    );
    return { state: { ...state, values }, frames };
  }

  if (op === 'traverse') {
    if (values.length === 0) return { error: 'The list is empty, so there is nothing to traverse.' };
    for (let i = 0; i < values.length; i += 1) {
      const next = i + 1 < values.length ? values[i + 1] : cycleTo !== null ? `node ${cycleTo} (${values[cycleTo]})` : 'null';
      const back = doubly ? ` It also points back to ${i === 0 ? (cycleTo !== null ? `node ${values.length - 1}` : 'null') : values[i - 1]}.` : '';
      const note = i === values.length - 1 && cycleTo !== null ? ' The next pointer loops back into the list.' : '';
      frames.push(
        frame(state, `Visit ${values[i]}; next is ${next}.${back}${note}`, {
          active: [String(i)],
          done: keys(values.slice(0, i).map((_, j) => j)),
        }),
      );
    }
    return { state, frames };
  }

  if (op === 'traverse-backward') {
    if (!doubly) return { error: 'This is a singly linked list: it has no previous pointers. Switch the mode to doubly linked first.' };
    if (values.length === 0) return { error: 'The list is empty, so there is nothing to traverse.' };
    for (let i = values.length - 1; i >= 0; i -= 1) {
      const prev = i > 0 ? values[i - 1] : cycleTo !== null ? `node ${values.length - 1} (${values[values.length - 1]})` : 'null';
      frames.push(
        frame(state, `Visit ${values[i]} from the tail; previous is ${prev}.`, {
          active: [String(i)],
          done: keys(values.slice(i + 1).map((_, j) => i + 1 + j)),
        }),
      );
    }
    return { state, frames };
  }

  if (op === 'cycle') {
    if (values.length < 2) return { error: 'A cycle needs at least two nodes.' };
    if (cycleTo !== null) return { error: 'The list already has a cycle. Break it first.' };
    const to = Number(input.to);
    if (!Number.isInteger(to) || to < 0 || to > values.length - 2) {
      return { error: `Choose a node from 0 to ${values.length - 2}; the tail cannot point at itself.` };
    }
    state = { ...state, cycleTo: to };
    const length = values.length - to;
    frames.push(
      frame(
        state,
        `Point the tail's next pointer at node ${to} (${values[to]}). The list now has a cycle of length ${length}.`,
        { active: [String(values.length - 1)], compare: [String(to)] },
      ),
    );
    return { state, frames };
  }

  if (op === 'break-cycle') {
    if (cycleTo === null) return { error: 'The list has no cycle to break.' };
    state = { ...state, cycleTo: null };
    frames.push(frame(state, `Set the tail's next pointer back to null. The list is acyclic again.`, { active: [String(values.length - 1)] }));
    return { state, frames };
  }

  if (op === 'detect-cycle') {
    if (values.length === 0) return { error: 'The list is empty, so there is no cycle to detect.' };
    let slow = 0;
    let fast = 0;
    let met = -1;
    frames.push(frame(state, 'Start the slow and fast pointers at the head.', { active: ['0'] }));
    while (fast !== null) {
      const one = nextOf(fast);
      if (one === null) {
        fast = null;
        break;
      }
      const two = nextOf(one);
      slow = nextOf(slow);
      fast = two;
      if (slow === null || fast === null) break;
      frames.push(
        frame(
          state,
          `Slow is at node ${slow} (${values[slow]}); fast is at node ${fast} (${values[fast]}).`,
          { active: [String(slow)], compare: [String(fast)] },
        ),
      );
      if (slow === fast) {
        met = slow;
        break;
      }
    }

    if (met < 0) {
      frames.push(frame(state, 'Fast reached null before meeting slow, so the list has no cycle.', { done: keys(values.map((_, i) => i)) }));
      return { state, frames };
    }

    frames.push(frame(state, `The pointers met at node ${met} (${values[met]}), so a cycle exists. Walk from the head and from the meeting point to find its entry.`, { found: [String(met)] }));
    slow = 0;
    fast = met;
    while (slow !== fast) {
      slow = nextOf(slow);
      fast = nextOf(fast);
      frames.push(
        frame(state, `Walk one step from the head (node ${slow}) and one from the meeting point (node ${fast}).`, {
          active: [String(slow)],
          compare: [String(fast)],
        }),
      );
    }
    let length = 1;
    let at = nextOf(slow);
    while (at !== slow && at !== null) {
      at = nextOf(at);
      length += 1;
    }
    frames.push(
      frame(
        state,
        `Cycle entry at node ${slow} (${values[slow]}); cycle length ${length}. Break the cycle before inserting or removing.`,
        { found: [String(slow)] },
      ),
    );
    return { state, frames };
  }

  if (op === 'remove') {
    const blocked = cycleGuard();
    if (blocked) return blocked;
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
const QUEUE_START = { values: ['A', 'B'], mode: 'simple', capacity: 5, front: 0, priorities: [] };

function stackFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const values = [...state.values];
  const frames = [];

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

  if (op === 'search') {
    if (!value) return { error: 'Type a value to search for.' };
    for (let i = values.length - 1; i >= 0; i -= 1) {
      if (values[i] === value) {
        frames.push(
          frame(state, `Found ${value} at position ${i} below the top. The stack itself is unchanged: searching is observational.`, {
            found: [String(i)],
          }),
        );
        return { state, frames };
      }
      frames.push(
        frame(state, `Inspect ${values[i]} at position ${i} below the top: not equal, look one lower.`, {
          compare: [String(i)],
        }),
      );
    }
    frames.push(
      frame(state, `${value} is not in the stack. Peeking and popping only touch the top, so searching every plate is a demonstration, not a normal stack operation.`, {
        done: keys(values.map((_, i) => i)),
      }),
    );
    return { state, frames };
  }

  return {
    state,
    frames: [frame(state, `Peek: the top is ${values[values.length - 1]}.`, { active: [String(values.length - 1)] })],
  };
}

function queueFrames(state, op, input) {
  const value = String(input.value ?? '').trim();
  const mode = state.mode ?? 'simple';
  const capacity = Number(state.capacity ?? 5);
  const front = Number(state.front ?? 0);
  const values = [...state.values];
  const priorities = [...(state.priorities ?? values.map(() => 0))];

  if (op === 'mode') {
    const next = input.mode === 'circular' || input.mode === 'priority' ? input.mode : 'simple';
    const nextCapacity = Number(input.capacity ?? capacity);
    if (next === 'circular' && (!Number.isInteger(nextCapacity) || nextCapacity < Math.max(2, values.length) || nextCapacity > 12)) {
      return { error: `A circular queue needs a whole capacity from ${Math.max(2, values.length)} to 12.` };
    }
    state = {
      ...state,
      mode: next,
      capacity: next === 'circular' ? nextCapacity : capacity,
      front: next === 'circular' ? 0 : front,
      priorities: next === 'priority' ? values.map((_, i) => priorities[i] ?? 0) : [],
    };
    const text =
      next === 'circular'
        ? `Use a circular buffer with ${nextCapacity} slots. Enqueue writes at the rear and dequeue advances the front; both wrap around the end.`
        : next === 'priority'
          ? 'Use a priority queue: lower priority numbers leave first, and equal priorities keep arrival order (stable). This teaching model keeps a sorted array, not a heap.'
          : 'Use a simple FIFO queue: enqueue at the back, dequeue from the front.';
    return { state, frames: [frame(state, text, {})] };
  }

  if (op === 'enqueue') {
    if (!value) return { error: 'Type a value first.' };
    if (mode === 'circular' && values.length >= capacity) {
      return { error: `The circular queue is full (${values.length} of ${capacity} slots). Dequeue before enqueueing.` };
    }
    if (mode === 'priority') {
      const priority = Number(input.priority ?? 0);
      if (!Number.isFinite(priority)) return { error: 'Priority must be a number.' };
      let at = values.length;
      for (let i = 0; i < priorities.length; i += 1) {
        if (priorities[i] > priority) {
          at = i;
          break;
        }
      }
      values.splice(at, 0, value);
      priorities.splice(at, 0, priority);
      return {
        state: { ...state, values, priorities },
        frames: [
          frame(
            { ...state, values, priorities },
            `Enqueue ${value} with priority ${priority} at position ${at}; lower numbers leave first and equal priorities keep arrival order.`,
            { active: [String(at)], inserted: [String(at)] },
          ),
        ],
      };
    }
    values.push(value);
    if (mode === 'circular') {
      const rear = (front + values.length - 1) % capacity;
      const wrapped = rear < front;
      return {
        state: { ...state, values, front },
        frames: [
          frame(
            { ...state, values, front },
            `Enqueue ${value} at physical slot ${rear}${wrapped ? ' (the rear wrapped past the end)' : ''}. front is ${front}, size ${values.length} of ${capacity}.`,
            { active: [String(values.length - 1)], inserted: [String(values.length - 1)] },
          ),
        ],
      };
    }
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
    const removedPriority = priorities.shift();
    const nextFront = mode === 'circular' ? (front + 1) % capacity : front;
    const priorityNote = mode === 'priority' ? ` It had priority ${removedPriority}.` : '';
    const circularNote = mode === 'circular' ? ` The front moves from slot ${front} to slot ${nextFront}.` : '';
    return {
      state: { ...state, values, priorities, front: nextFront },
      frames: [
        frame(
          { ...state, values, priorities, front: nextFront },
          `Dequeue ${removed} from the front.${priorityNote}${circularNote} ${values.length ? `The new front is ${values[0]}.` : 'The queue is now empty.'}`,
          { active: values.length ? ['0'] : [], deleted: ['0'] },
        ),
      ],
    };
  }

  const priorityNote = mode === 'priority' ? ` Its priority is ${priorities[0]}.` : '';
  return {
    state,
    frames: [frame(state, `Peek: the front is ${values[0]}.${priorityNote}`, { active: ['0'] })],
  };
}

/* --- Binary search tree --------------------------------------------------- */

const node = (value) => ({ value, left: null, right: null });

function treeFrames(state, op, input) {
  const value = Number(input.value);
  if (!['inorder', 'delete'].includes(op) && !Number.isFinite(value)) return { error: 'Type a number first.' };
  if (op === 'delete' && !Number.isFinite(value)) return { error: 'Type a number first.' };
  let root = state.root ? clone(state.root) : null;
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

  if (op === 'delete') {
    let parent = null;
    let current = root;
    while (current && current.value !== value) {
      frames.push(
        frame({ root }, `Compare ${value} with ${current.value}: go ${value < current.value ? 'left' : 'right'}.`, {
          compare: [String(current.value)],
        }),
      );
      parent = current;
      current = value < current.value ? current.left : current.right;
    }
    if (!current) {
      frames.push(frame({ root }, `${value} is not in the tree, so nothing is deleted.`, {}));
      return { state: { root }, frames };
    }

    const detach = (target, targetParent, replacement) => {
      if (!targetParent) root = replacement;
      else if (targetParent.left === target) targetParent.left = replacement;
      else targetParent.right = replacement;
    };

    if (!current.left && !current.right) {
      detach(current, parent, null);
      frames.push(frame({ root }, `Delete the leaf ${value}: it has no children, so its parent's pointer becomes null.`, { deleted: [String(value)] }));
      return { state: { root }, frames };
    }

    if (!current.left || !current.right) {
      const child = current.left ?? current.right;
      detach(current, parent, child);
      frames.push(
        frame({ root }, `Delete ${value}: it has one child, so that child (${child.value}) takes its place.`, {
          deleted: [String(value)],
          active: [String(child.value)],
        }),
      );
      return { state: { root }, frames };
    }

    frames.push(frame({ root }, `${value} has two children: find its in-order successor, the smallest value on the right.`, { active: [String(value)] }));
    let successorParent = current;
    let successor = current.right;
    while (successor.left) {
      frames.push(frame({ root }, `Successor search: ${successor.left.value} is smaller than ${successor.value}, keep going left.`, { compare: [String(successor.value)] }));
      successorParent = successor;
      successor = successor.left;
    }
    frames.push(frame({ root }, `The successor is ${successor.value}; copy it into the node being deleted.`, { found: [String(successor.value)] }));
    const successorValue = successor.value;
    current.value = successorValue;
    detach(successor, successorParent, successor.right);
    frames.push(
      frame({ root }, `Replace ${value} with ${successorValue}, then remove the successor node. The tree keeps its search order.`, {
        active: [String(successorValue)],
      }),
    );
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

const GRAPH_START = {
  nodes: ['A', 'B', 'C', 'D', 'E', 'F'],
  edges: [
    ['A', 'B'],
    ['A', 'C'],
    ['B', 'D'],
    ['C', 'E'],
    ['D', 'F'],
    ['E', 'F'],
  ],
  start: 'A',
  directed: false,
};

function graphFrames(state, op, input) {
  const frames = [];
  const nodeId = (raw) => String(raw ?? '').trim();

  if (op === 'add-node') {
    const id = nodeId(input.id);
    if (!id) return { error: 'Type a node name first.' };
    if (id.length > 12) return { error: 'Node names are limited to 12 characters in this lab.' };
    if (state.nodes.includes(id)) return { error: `Node ${id} already exists.` };
    if (state.nodes.length >= 12) return { error: 'This lab draws at most 12 nodes.' };
    state = { ...state, nodes: [...state.nodes, id] };
    frames.push(frame(state, `Add node ${id}. It has no edges yet.`, { active: [id] }));
    return { state, frames };
  }

  if (op === 'remove-node') {
    const id = nodeId(input.id);
    if (!state.nodes.includes(id)) return { error: `Node ${id} is not in the graph.` };
    const nodes = state.nodes.filter((entry) => entry !== id);
    const edges = state.edges.filter(([a, b]) => a !== id && b !== id);
    const removedEdges = state.edges.length - edges.length;
    const start = state.start === id ? (nodes[0] ?? null) : state.start;
    state = { ...state, nodes, edges, start };
    frames.push(
      frame(
        state,
        `Remove node ${id}${removedEdges ? ` and ${removedEdges} ${removedEdges === 1 ? 'edge' : 'edges'} that touched it` : '; it had no edges'}. ${start ? `The start node is now ${start}.` : 'The graph is empty.'}`,
        { deleted: [id] },
      ),
    );
    return { state, frames };
  }

  if (op === 'add-edge') {
    const from = nodeId(input.from);
    const to = nodeId(input.to);
    if (!state.nodes.includes(from) || !state.nodes.includes(to)) {
      return { error: `Both endpoints must exist: ${from} → ${to}.` };
    }
    if (from === to) return { error: 'A self-loop is not part of this lab.' };
    const exists = state.edges.some(([a, b]) =>
      state.directed ? a === from && b === to : (a === from && b === to) || (a === to && b === from),
    );
    if (exists) return { error: `The edge ${from} — ${to} already exists.` };
    state = { ...state, edges: [...state.edges, [from, to]] };
    frames.push(frame(state, `Add the ${state.directed ? 'directed' : 'undirected'} edge ${from} ${state.directed ? '→' : '—'} ${to}.`, { active: [from, to] }));
    return { state, frames };
  }

  if (op === 'remove-edge') {
    const from = nodeId(input.from);
    const to = nodeId(input.to);
    const at = state.edges.findIndex(([a, b]) =>
      state.directed ? a === from && b === to : (a === from && b === to) || (a === to && b === from),
    );
    if (at < 0) return { error: `There is no edge between ${from} and ${to}.` };
    const edges = state.edges.filter((_, index) => index !== at);
    state = { ...state, edges };
    frames.push(frame(state, `Remove the edge ${from} ${state.directed ? '→' : '—'} ${to}.`, { deleted: [from, to] }));
    return { state, frames };
  }

  if (op === 'start') {
    const id = nodeId(input.node);
    if (!state.nodes.includes(id)) return { error: `Node ${id} is not in the graph.` };
    state = { ...state, start: id };
    frames.push(frame(state, `Start traversal from ${id}.`, { active: [id] }));
    return { state, frames };
  }

  if (op === 'direction') {
    const directed = input.direction === 'directed';
    if (directed === state.directed) {
      frames.push(frame(state, `The graph is already ${directed ? 'directed' : 'undirected'}.`, {}));
      return { state, frames };
    }
    state = { ...state, directed };
    frames.push(
      frame(
        state,
        directed
          ? 'Make the graph directed: an edge now has a direction and traversal follows it one way only.'
          : 'Make the graph undirected: every edge can be followed in both directions.',
        {},
      ),
    );
    return { state, frames };
  }

  if (!state.nodes.length) return { error: 'The graph has no nodes.' };
  const start = state.start ?? state.nodes[0];
  if (!state.nodes.includes(start)) return { error: `The start node ${start} is not in the graph.` };
  const neighbours = (at) =>
    state.nodes.filter(
      (id) =>
        id !== at &&
        state.edges.some(([a, b]) => (a === at && b === id) || (!state.directed && b === at && a === id)),
    );

  if (op === 'bfs') {
    const order = [];
    const queue = [start];
    const discovered = new Set(queue);
    while (queue.length) {
      const at = queue.shift();
      order.push(at);
      const next = neighbours(at).filter((id) => !discovered.has(id));
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
    const unreachable = state.nodes.filter((id) => !discovered.has(id));
    frames.push(
      frame(
        state,
        `Breadth-first order: ${order.join(' → ')}.${unreachable.length ? ` Unreachable from ${start}: ${unreachable.join(', ')}.` : ''}`,
        { done: keys(order) },
      ),
    );
    return { state, frames };
  }

  // depth-first, recursive, following the edge order above
  const order = [];
  const seen = new Set();
  const walk = (at) => {
    seen.add(at);
    order.push(at);
    const next = neighbours(at).filter((id) => !seen.has(id));
    frames.push(
      frame(state, `Visit ${at}.${next.length ? ` Next unvisited: ${next.join(', ')}.` : ' No unvisited neighbours.'}`, {
        active: [at],
        done: keys(order),
      }),
    );
    for (const id of next) if (!seen.has(id)) walk(id);
  };
  walk(start);
  const unreachable = state.nodes.filter((id) => !seen.has(id));
  frames.push(
    frame(
      state,
      `Depth-first order: ${order.join(' → ')}.${unreachable.length ? ` Unreachable from ${start}: ${unreachable.join(', ')}.` : ''}`,
      { done: keys(order) },
    ),
  );
  return { state, frames };
}

/* --- The registry --------------------------------------------------------- */

const hashField = (name, label, defaultValue) => ({ name, label, default: defaultValue, type: 'text' });
const select = (name, label, defaultValue, options) => ({
  name,
  label,
  default: defaultValue,
  type: 'select',
  options,
});

export const STRUCTURES = [
  {
    type: 'array',
    name: 'Array',
    blurb: 'Append, insert, remove and search. Grow or shrink the capacity and clear the whole array.',
    limits: 'multi-dimensional arrays and sorting.',
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
      { id: 'resize', label: 'Resize', fields: [{ name: 'capacity', label: 'Capacity', default: 8 }], advanced: true },
      { id: 'clear', label: 'Clear array', fields: [], advanced: true },
    ],
    run: arrayFrames,
  },
  {
    type: 'linked-list',
    name: 'Linked list',
    blurb: 'Walk the links, switch between singly and doubly linked, and detect a cycle with slow and fast pointers.',
    limits: 'sorting a list and joining two lists.',
    start: LIST_START,
    operations: [
      { id: 'prepend', label: 'Prepend', fields: [{ name: 'value', label: 'Value', default: 'D', type: 'text' }] },
      { id: 'append', label: 'Append', fields: [{ name: 'value', label: 'Value', default: 'D', type: 'text' }] },
      { id: 'remove', label: 'Remove', fields: [{ name: 'value', label: 'Value', default: 'B', type: 'text' }] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 'B', type: 'text' }] },
      { id: 'traverse', label: 'Traverse', fields: [] },
      { id: 'traverse-backward', label: 'Traverse backward', fields: [] },
      {
        id: 'mode',
        label: 'Link mode',
        fields: [select('mode', 'Mode', 'singly', [{ value: 'singly', label: 'Singly linked' }, { value: 'doubly', label: 'Doubly linked' }])],
        advanced: true,
      },
      { id: 'cycle', label: 'Make cycle', fields: [{ name: 'to', label: 'Tail points to', default: 1 }], advanced: true },
      { id: 'break-cycle', label: 'Break cycle', fields: [], advanced: true },
      { id: 'detect-cycle', label: 'Detect cycle', fields: [], advanced: true },
    ],
    run: listFrames,
  },
  {
    type: 'stack',
    name: 'Stack',
    blurb: 'Push, pop, peek and search downward from the top without changing the stack.',
    limits: 'indexed access; a stack only exposes its top.',
    start: STACK_START,
    operations: [
      { id: 'push', label: 'Push', fields: [{ name: 'value', label: 'Value', default: 'C', type: 'text' }] },
      { id: 'pop', label: 'Pop', fields: [] },
      { id: 'peek', label: 'Peek', fields: [] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 'A', type: 'text' }] },
    ],
    run: stackFrames,
  },
  {
    type: 'queue',
    name: 'Queue',
    blurb: 'FIFO, circular-buffer and priority modes, each with its own front and back behaviour.',
    limits: 'deques and double-ended operations.',
    start: QUEUE_START,
    operations: [
      {
        id: 'enqueue',
        label: 'Enqueue',
        fields: [
          { name: 'value', label: 'Value', default: 'C', type: 'text' },
          { name: 'priority', label: 'Priority', default: 0 },
        ],
      },
      { id: 'dequeue', label: 'Dequeue', fields: [] },
      { id: 'peek', label: 'Peek', fields: [] },
      {
        id: 'mode',
        label: 'Queue mode',
        fields: [
          select('mode', 'Mode', 'simple', [
            { value: 'simple', label: 'Simple FIFO' },
            { value: 'circular', label: 'Circular buffer' },
            { value: 'priority', label: 'Priority queue' },
          ]),
          { name: 'capacity', label: 'Slots', default: 5 },
        ],
        advanced: true,
      },
    ],
    run: queueFrames,
  },
  {
    type: 'bst',
    name: 'Binary search tree',
    blurb: 'Insert, search, delete and walk the tree in order. A duplicate value is kept once.',
    limits: 'self-balancing; the tree keeps one copy of a duplicate value.',
    start: { root: null },
    operations: [
      { id: 'insert', label: 'Insert', fields: [{ name: 'value', label: 'Value', default: 5 }] },
      { id: 'search', label: 'Search', fields: [{ name: 'value', label: 'Value', default: 5 }] },
      { id: 'delete', label: 'Delete', fields: [{ name: 'value', label: 'Value', default: 5 }] },
      { id: 'inorder', label: 'In-order', fields: [] },
    ],
    run: treeFrames,
  },
  {
    type: 'graph',
    name: 'Graph',
    blurb: 'Edit nodes and edges, choose the start node, switch direction and run BFS or DFS.',
    limits: 'weighted edges and shortest-path algorithms.',
    start: clone(GRAPH_START),
    operations: [
      { id: 'bfs', label: 'Breadth-first', fields: [] },
      { id: 'dfs', label: 'Depth-first', fields: [] },
      { id: 'add-node', label: 'Add node', fields: [hashField('id', 'Node', 'G')], advanced: true },
      { id: 'remove-node', label: 'Remove node', fields: [hashField('id', 'Node', 'F')], advanced: true },
      { id: 'add-edge', label: 'Add edge', fields: [hashField('from', 'From', 'A'), hashField('to', 'To', 'F')], advanced: true },
      { id: 'remove-edge', label: 'Remove edge', fields: [hashField('from', 'From', 'A'), hashField('to', 'To', 'B')], advanced: true },
      { id: 'start', label: 'Start node', fields: [hashField('node', 'Node', 'A')], advanced: true },
      {
        id: 'direction',
        label: 'Direction',
        fields: [select('direction', 'Direction', 'undirected', [{ value: 'undirected', label: 'Undirected' }, { value: 'directed', label: 'Directed' }])],
        advanced: true,
      },
    ],
    run: graphFrames,
  },
  {
    type: 'hash-table',
    name: 'Hash table',
    blurb:
      'Hash a key to a bucket, resolve collisions with chaining or probing, delete with tombstones, and watch a resize rehash every key.',
    limits:
      'Robin Hood hashing, cuckoo hashing, incremental rehashing and universal hashing; those advanced variants are a recorded follow-up, not part of this table.',
    start: clone(HASH_START),
    operations: [
      { id: 'insert', label: 'Insert / update', fields: [hashField('key', 'Key', 'apple'), hashField('value', 'Value', '4')] },
      { id: 'search', label: 'Search', fields: [hashField('key', 'Key', 'apple')] },
      { id: 'delete', label: 'Delete', fields: [hashField('key', 'Key', 'apple')] },
      { id: 'contains', label: 'Contains', fields: [hashField('key', 'Key', 'apple')] },
      { id: 'update', label: 'Update value', fields: [hashField('key', 'Key', 'apple'), hashField('value', 'Value', '5')] },
      { id: 'clear', label: 'Clear table', fields: [] },
      {
        id: 'load',
        label: 'Load dataset',
        fields: [
          select(
            'preset',
            'Dataset',
            'sparse',
            Object.entries(HASH_PRESETS).map(([value, preset]) => ({ value, label: preset.label })),
          ),
        ],
        advanced: true,
      },
      {
        id: 'configure',
        label: 'Apply settings',
        fields: [
          select(
            'strategy',
            'Collision strategy',
            'chaining',
            HASH_STRATEGIES.map(({ id, label }) => ({ value: id, label })),
          ),
          select(
            'hashFn',
            'Hash function',
            'division',
            HASH_FUNCTIONS.map(({ id, label }) => ({ value: id, label })),
          ),
          { name: 'threshold', label: 'Load threshold', default: 0.75 },
        ],
        advanced: true,
      },
      { id: 'resize', label: 'Resize table', fields: [{ name: 'capacity', label: 'Capacity', default: 11 }], advanced: true },
      { id: 'rehash', label: 'Force rehash', fields: [], advanced: true },
    ],
    run: hashTableFrames,
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
