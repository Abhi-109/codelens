/* The drawing half of the data-structure lab.
 *
 * It only reads a snapshot, its marks and the step's structured detail: it
 * never applies an operation or invents a value. That is what lets Back, Next
 * and seeking show a past frame exactly, with no highlight left over from a
 * step the learner did not take.
 *
 * The drawing is decorative for assistive technology; each view carries a
 * spoken summary of the same state instead.
 */

import { strategyLabel } from './hashTable.js';

const MARK_CLASSES = [
  'active',
  'compare',
  'done',
  'found',
  'collision',
  'inserted',
  'deleted',
  'tombstone',
];

const marksFor = (marks, key) =>
  MARK_CLASSES.filter((kind) => marks[kind]?.includes(key)).map((kind) => `is-${kind}`).join(' ');

const cellClass = (marks, key, base) => `${base} ${marksFor(marks, key)}`.trim();

const emptyMarks = Object.fromEntries(MARK_CLASSES.map((kind) => [kind, []]));

function Empty({ children }) {
  return <p className="ds-empty">{children}</p>;
}

/* --- Arrays --------------------------------------------------------------- */

function ArrayView({ state, marks }) {
  return (
    <div className="ds-array">
      <ol className="ds-cells" aria-hidden="true">
        {Array.from({ length: state.capacity }).map((_, index) => {
          const filled = index < state.values.length;
          return (
            <li key={index} className={cellClass(marks, String(index), `ds-cell${filled ? '' : ' ds-cell-empty'}`)}>
              <span className="ds-value">{filled ? state.values[index] : ''}</span>
              <span className="ds-index">{index}</span>
            </li>
          );
        })}
      </ol>
      <p className="ds-note">
        length {state.values.length} · capacity {state.capacity}
      </p>
    </div>
  );
}

/* --- Linked list ---------------------------------------------------------- */

function ListView({ state, marks }) {
  const cycleTo = state.cycleTo ?? null;
  return (
    <div className="ds-linked">
      <span className="ds-end" aria-hidden="true">
        head
      </span>
      <ol className="ds-chain" aria-hidden="true">
        {state.values.map((value, index) => (
          <li key={index} className="ds-chain-item">
            <span className={cellClass(marks, String(index), 'ds-node')}>{value}</span>
            <span className="ds-link">{state.doubly ? '⇄' : '→'}</span>
          </li>
        ))}
        <li className="ds-chain-item">
          <span className="ds-null">
            {cycleTo === null ? 'null' : `node ${cycleTo} ↩`}
          </span>
        </li>
      </ol>
      <span className="ds-end" aria-hidden="true">
        tail
      </span>
      <p className="ds-note ds-note-wide">
        {state.doubly ? 'doubly linked · previous and next pointers' : 'singly linked · next pointers only'}
        {cycleTo !== null ? ` · cycle: tail → node ${cycleTo}` : ''}
      </p>
    </div>
  );
}

/* --- Stack and queue ------------------------------------------------------ */

function StackView({ state, marks }) {
  const top = state.values.length - 1;
  return (
    <div className="ds-stack" aria-hidden="true">
      <span className="ds-end">top</span>
      {state.values.length === 0 ? (
        <span className="ds-empty-cell">empty</span>
      ) : (
        [...state.values].reverse().map((value, at) => {
          const index = top - at;
          return (
            <span key={index} className={cellClass(marks, String(index), 'ds-plate')}>
              {value}
            </span>
          );
        })
      )}
      <span className="ds-end">bottom</span>
    </div>
  );
}

function QueueView({ state, marks }) {
  const mode = state.mode ?? 'simple';

  if (mode === 'circular') {
    const capacity = Number(state.capacity ?? 5);
    const front = Number(state.front ?? 0);
    return (
      <div className="ds-queue ds-queue-circular">
        <span className="ds-end">front slot {front}</span>
        <ol className="ds-slot-cells" aria-hidden="true">
          {Array.from({ length: capacity }).map((_, physical) => {
            const logical = (physical - front + capacity) % capacity;
            const filled = logical < state.values.length;
            const isFront = filled && logical === 0;
            const isRear = filled && logical === state.values.length - 1;
            return (
              <li
                key={physical}
                className={`${cellClass(marks, String(logical), `ds-plate ds-slot-cell${filled ? '' : ' ds-slot-cell-empty'}`)}${isFront ? ' is-front' : ''}${isRear ? ' is-rear' : ''}`}
              >
                <span className="ds-slot-address">{physical}</span>
                <span className="ds-slot-value">{filled ? state.values[logical] : ''}</span>
                {isFront ? <span className="ds-slot-tag">front</span> : isRear ? <span className="ds-slot-tag">rear</span> : null}
              </li>
            );
          })}
        </ol>
        <span className="ds-end">
          size {state.values.length}/{capacity}
        </span>
      </div>
    );
  }

  const priorities = state.priorities ?? [];
  return (
    <div className="ds-queue" aria-hidden="true">
      <span className="ds-end">front</span>
      {state.values.length === 0 ? (
        <span className="ds-empty-cell">empty</span>
      ) : (
        state.values.map((value, index) => (
          <span key={index} className={cellClass(marks, String(index), 'ds-plate')}>
            {value}
            {mode === 'priority' ? <span className="ds-priority">p{priorities[index] ?? 0}</span> : null}
          </span>
        ))
      )}
      <span className="ds-end">back</span>
    </div>
  );
}

/* --- Binary search tree --------------------------------------------------- */

function treeLayout(root) {
  const nodes = [];
  let next = 0;
  let depth = 0;
  const walk = (at, level) => {
    if (!at) return;
    depth = Math.max(depth, level);
    walk(at.left, level + 1);
    nodes.push({ value: at.value, x: next, y: level });
    next += 1;
    walk(at.right, level + 1);
  };
  walk(root, 0);
  return { nodes, depth };
}

function TreeView({ state, marks }) {
  if (!state.root) return <Empty>The tree is empty. Insert a value to start it.</Empty>;
  const { nodes, depth } = treeLayout(state.root);
  const width = Math.max(280, nodes.length * 64);
  const height = (depth + 1) * 76 + 24;
  const at = new Map(nodes.map((entry) => [entry.value, entry]));
  const xOf = (entry) =>
    nodes.length === 1 ? width / 2 : 40 + (entry.x * (width - 80)) / (nodes.length - 1);
  const yOf = (entry) => 38 + entry.y * 76;
  const edges = [];
  const link = (parent) => {
    if (!parent) return;
    const from = at.get(parent.value);
    for (const child of [parent.left, parent.right]) {
      if (!child) continue;
      const to = at.get(child.value);
      edges.push({ key: `${parent.value}-${child.value}`, x1: xOf(from), y1: yOf(from), x2: xOf(to), y2: yOf(to) });
      link(child);
    }
  };
  link(state.root);

  return (
    <svg
      className="ds-tree"
      viewBox={`0 0 ${width} ${height}`}
      role="presentation"
      aria-hidden="true"
      focusable="false"
    >
      {edges.map((edge) => (
        <line key={edge.key} className="ds-edge" x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2} />
      ))}
      {nodes.map((entry) => (
        <g key={entry.value} className={cellClass(marks, String(entry.value), 'ds-tree-node')}>
          <circle cx={xOf(entry)} cy={yOf(entry)} r="20" />
          <text x={xOf(entry)} y={yOf(entry)} dy="0.35em" textAnchor="middle">
            {entry.value}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* --- Graph ---------------------------------------------------------------- */

function GraphView({ state, marks }) {
  const width = 320;
  const height = 300;
  const cx = width / 2;
  const cy = height / 2;
  const count = Math.max(state.nodes.length, 1);
  const radius = state.nodes.length <= 1 ? 0 : Math.min(118, 42 + state.nodes.length * 8);
  const position = (id) => {
    const index = state.nodes.indexOf(id);
    const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
  };

  return (
    <svg className="ds-graph" viewBox={`0 0 ${width} ${height}`} role="presentation" aria-hidden="true" focusable="false">
      <defs>
        <marker id="ds-graph-arrow" markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto">
          <path d="M0,0 L8,4 L0,8 z" className="ds-arrow-head" />
        </marker>
      </defs>
      {state.edges.map(([a, b]) => {
        const [x1, y1] = position(a);
        const [x2, y2] = position(b);
        return (
          <line
            key={`${a}-${b}`}
            className="ds-edge"
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            markerEnd={state.directed ? 'url(#ds-graph-arrow)' : undefined}
          />
        );
      })}
      {state.nodes.map((id) => {
        const [x, y] = position(id);
        return (
          <g
            key={id}
            className={`${cellClass(marks, id, 'ds-graph-node')}${id === state.start ? ' is-start' : ''}`}
          >
            <title>{id === state.start ? `${id} (start)` : id}</title>
            <circle cx={x} cy={y} r="19" />
            <text x={x} y={y} dy="0.35em" textAnchor="middle" fontSize={id.length > 4 ? 10 : 13}>
              {id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --- Hash table ----------------------------------------------------------- */

function HashJourney({ detail }) {
  if (!detail || (detail.raw === undefined && detail.index === undefined)) return null;
  const stage = detail.kind;
  const bucketOn = ['hash', 'compare', 'collision', 'tombstone', 'missing', 'insert', 'found', 'delete'].includes(stage);
  return (
    <div className="ds-journey" aria-hidden="true">
      {detail.key !== undefined && detail.key !== null ? <span className="ds-journey-chip">{detail.key}</span> : null}
      {detail.raw !== undefined ? (
        <>
          <span className="ds-journey-arrow">→</span>
          <span className={`ds-journey-chip${stage === 'hash' ? ' is-on' : ''}`}>hash {detail.raw}</span>
        </>
      ) : null}
      {detail.index !== undefined ? (
        <>
          <span className="ds-journey-arrow">→</span>
          <span className={`ds-journey-chip${bucketOn ? ' is-on' : ''}`}>bucket {detail.index}</span>
        </>
      ) : null}
      {detail.probes ? (
        <>
          <span className="ds-journey-arrow">→</span>
          <span className={`ds-journey-chip${bucketOn && stage !== 'hash' ? ' is-on' : ''}`}>
            {detail.probes} {detail.probes === 1 ? 'probe' : 'probes'}
          </span>
        </>
      ) : null}
    </div>
  );
}

function OldTable({ previous }) {
  if (!previous) return null;
  const entries =
    previous.table?.flatMap?.((cell) => (Array.isArray(cell) ? cell : cell && !cell.tombstone ? [cell] : [])) ?? [];
  return (
    <div className="ds-old-table">
      <span className="ds-old-label">before · capacity {previous.capacity}</span>
      <span className="ds-old-entries">
        {entries.length ? entries.map((entry) => `${entry.key}=${entry.value}`).join(' · ') : 'empty'}
      </span>
    </div>
  );
}

function HashView({ state, marks, detail }) {
  const open = state.strategy !== 'chaining';
  const load = state.count / state.capacity;
  return (
    <div className="ds-hash">
      <HashJourney detail={detail} />
      <OldTable previous={state.previous} />
      {state.count === 0 && !state.previous ? (
        <p className="ds-empty">The table is empty. Insert a key, or load a dataset under Advanced.</p>
      ) : null}
      <ol className="ds-buckets" aria-hidden="true">
        {state.table.map((cell, index) => (
          <li key={index} className={`ds-bucket ${marksFor(marks, `b${index}`)}`.trim()}>
            <span className="ds-bucket-index">{index}</span>
            {open ? (
              <span
                className={
                  cell === null
                    ? 'ds-slot ds-slot-empty'
                    : cell.tombstone
                      ? 'ds-slot ds-slot-tombstone'
                      : cellClass(marks, `e:${cell.key}`, 'ds-slot ds-slot-filled')
                }
              >
                {cell === null ? 'empty' : cell.tombstone ? '† tombstone' : `${cell.key}=${cell.value}`}
              </span>
            ) : (
              <span className="ds-chain-inline">
                {cell.length === 0 ? (
                  <span className="ds-slot ds-slot-empty">empty</span>
                ) : (
                  cell.map((entry) => (
                    <span key={entry.key} className={cellClass(marks, `e:${entry.key}`, 'ds-chain-entry')}>
                      {entry.key}={entry.value}
                    </span>
                  ))
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
      <p className="ds-note">
        {strategyLabel(state.strategy)} · {state.count} {state.count === 1 ? 'key' : 'keys'} · capacity{' '}
        {state.capacity} · load {load.toFixed(2)} · {state.tombstones}{' '}
        {state.tombstones === 1 ? 'tombstone' : 'tombstones'}
      </p>
    </div>
  );
}

/* --- The spoken summary and the switch ------------------------------------ */

function summaryOf(type, state, marks) {
  const visited = marks.done.length ? ` Visited: ${marks.done.join(', ')}.` : '';
  if (type === 'array') {
    return `Array of ${state.values.length} values: ${state.values.join(', ') || 'empty'}. Capacity ${state.capacity}.`;
  }
  if (type === 'linked-list') {
    const cycle = state.cycleTo ?? null;
    return `Linked list from head: ${state.values.join(' → ') || 'empty'} → ${cycle === null ? 'null' : `node ${cycle} (cycle)`}.${state.doubly ? ' Doubly linked.' : ' Singly linked.'}`;
  }
  if (type === 'stack') {
    return `Stack from top: ${[...state.values].reverse().join(', ') || 'empty'}.`;
  }
  if (type === 'queue') {
    const mode = state.mode ?? 'simple';
    if (mode === 'circular') {
      return `Circular queue of ${state.capacity} slots, front at slot ${state.front}, holding ${state.values.join(', ') || 'nothing'}.`;
    }
    if (mode === 'priority') {
      return `Priority queue from front: ${state.values.map((value, index) => `${value} (priority ${state.priorities?.[index] ?? 0})`).join(', ') || 'empty'}.`;
    }
    return `Queue from front: ${state.values.join(', ') || 'empty'}.`;
  }
  if (type === 'bst') {
    const values = [];
    const walk = (at) => {
      if (!at) return;
      walk(at.left);
      values.push(at.value);
      walk(at.right);
    };
    walk(state.root);
    return `Binary search tree in order: ${values.join(', ') || 'empty'}.${visited}`;
  }
  if (type === 'hash-table') {
    const load = state.count / state.capacity;
    return `Hash table: ${state.count} keys in ${state.capacity} buckets using ${strategyLabel(state.strategy)}, load factor ${load.toFixed(2)}, ${state.tombstones} tombstones.${visited}`;
  }
  return `Graph nodes ${state.nodes.join(', ')}.${state.directed ? ' Directed.' : ' Undirected.'}${state.start ? ` Start ${state.start}.` : ''}${visited}`;
}

export default function StructureView({ type, state, marks = emptyMarks, detail = null }) {
  const view = {
    array: ArrayView,
    'linked-list': ListView,
    stack: StackView,
    queue: QueueView,
    bst: TreeView,
    graph: GraphView,
    'hash-table': HashView,
  }[type];
  if (!view) return null;
  const View = view;
  return (
    <div className={`ds-view ds-view-${type}`}>
      <p className="ds-sr">{summaryOf(type, state, marks)}</p>
      {type === 'linked-list' && state.values.length === 0 ? (
        <Empty>The list is empty. Prepend or append a value to start it.</Empty>
      ) : (
        <View state={state} marks={marks} detail={detail} />
      )}
    </div>
  );
}
