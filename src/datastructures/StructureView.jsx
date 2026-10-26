/* The drawing half of the data-structure lab.
 *
 * It only reads a snapshot and its marks: it never applies an operation or
 * invents a value. That is what lets Back, Next and seeking show a past frame
 * exactly, with no highlight left over from a step the learner did not take.
 *
 * The drawing is decorative for assistive technology; each view carries a
 * spoken summary of the same state instead.
 */

const MARK_CLASSES = ['active', 'compare', 'done', 'found'];

const marksFor = (marks, key) =>
  MARK_CLASSES.filter((kind) => marks[kind].includes(key)).map((kind) => `is-${kind}`).join(' ');

const cellClass = (marks, key, base) => `${base} ${marksFor(marks, key)}`.trim();

const emptyMarks = { active: [], compare: [], done: [], found: [] };

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
  return (
    <div className="ds-linked">
      <span className="ds-end" aria-hidden="true">
        head
      </span>
      <ol className="ds-chain" aria-hidden="true">
        {state.values.map((value, index) => (
          <li key={index} className="ds-chain-item">
            <span className={cellClass(marks, String(index), 'ds-node')}>{value}</span>
            <span className="ds-link" aria-hidden="true">
              →
            </span>
          </li>
        ))}
        <li className="ds-chain-item">
          <span className="ds-null">null</span>
        </li>
      </ol>
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
  return (
    <div className="ds-queue" aria-hidden="true">
      <span className="ds-end">front</span>
      {state.values.length === 0 ? (
        <span className="ds-empty-cell">empty</span>
      ) : (
        state.values.map((value, index) => (
          <span key={index} className={cellClass(marks, String(index), 'ds-plate')}>
            {value}
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

const GRAPH_POSITIONS = {
  A: [100, 32],
  B: [38, 102],
  C: [162, 102],
  D: [38, 176],
  E: [162, 176],
  F: [100, 246],
};

function GraphView({ state, marks }) {
  return (
    <svg className="ds-graph" viewBox="0 0 200 280" role="presentation" aria-hidden="true" focusable="false">
      {state.edges.map(([a, b]) => (
        <line
          key={`${a}-${b}`}
          className="ds-edge"
          x1={GRAPH_POSITIONS[a][0]}
          y1={GRAPH_POSITIONS[a][1]}
          x2={GRAPH_POSITIONS[b][0]}
          y2={GRAPH_POSITIONS[b][1]}
        />
      ))}
      {state.nodes.map((id) => (
        <g key={id} className={cellClass(marks, id, 'ds-graph-node')}>
          <circle cx={GRAPH_POSITIONS[id][0]} cy={GRAPH_POSITIONS[id][1]} r="17" />
          <text x={GRAPH_POSITIONS[id][0]} y={GRAPH_POSITIONS[id][1]} dy="0.35em" textAnchor="middle">
            {id}
          </text>
        </g>
      ))}
    </svg>
  );
}

/* --- The spoken summary and the switch ------------------------------------ */

function summaryOf(type, state, marks) {
  const visited = marks.done.length ? ` Visited: ${marks.done.join(', ')}.` : '';
  if (type === 'array') {
    return `Array of ${state.values.length} values: ${state.values.join(', ') || 'empty'}. Capacity ${state.capacity}.`;
  }
  if (type === 'linked-list') {
    return `Linked list from head: ${state.values.join(' → ') || 'empty'} → null.`;
  }
  if (type === 'stack') {
    return `Stack from top: ${[...state.values].reverse().join(', ') || 'empty'}.`;
  }
  if (type === 'queue') {
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
  return `Graph nodes ${state.nodes.join(', ')}.${visited}`;
}

export default function StructureView({ type, state, marks = emptyMarks }) {
  const view = {
    array: ArrayView,
    'linked-list': ListView,
    stack: StackView,
    queue: QueueView,
    bst: TreeView,
    graph: GraphView,
  }[type];
  if (!view) return null;
  const View = view;
  return (
    <div className={`ds-view ds-view-${type}`}>
      <p className="ds-sr">{summaryOf(type, state, marks)}</p>
      {type === 'linked-list' && state.values.length === 0 ? (
        <Empty>The list is empty. Prepend or append a value to start it.</Empty>
      ) : (
        <View state={state} marks={marks} />
      )}
    </div>
  );
}
