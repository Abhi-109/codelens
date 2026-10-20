/**
 * The small presentational pieces every inspector panel is built from.
 *
 * These are moved out of the orchestrator so the panels and the shell share
 * one definition of a heading, a variable row or a call entry - but they are
 * still dumb: they draw what they are handed and call back when clicked, and
 * none of them reads the trace itself.
 */

import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { chartGeometry, isNumericSeries } from "../tracer/history";
import { objectLabel, referenceEdges, slotEntries } from "../tracer/objects";
import { formatValue, showValue } from "../tracer/values";

const MODULE_NAME = "<module>";

/** A small "?" that opens a one-paragraph beginner explanation, and never takes space. */
export function SectionHelp({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="help">
      <button
        type="button"
        className="help-dot"
        aria-label={`What is ${title}?`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        ?
      </button>
      {open ? (
        <>
          <span className="help-backdrop" onClick={() => setOpen(false)} />
          <span className="help-pop" role="note">
            {children}
          </span>
        </>
      ) : null}
    </span>
  );
}

/** A panel heading in plain language, with a one-line purpose underneath. */
export function PanelHead({ title, hint, help }) {
  return (
    <div className="panel-head">
      <div className="panel-head-row">
        <h3>{title}</h3>
        {help ? <SectionHelp title={title}>{help}</SectionHelp> : null}
      </div>
      {hint ? <p className="panel-hint">{hint}</p> : null}
    </div>
  );
}

/**
 * One section of the inspector, isolated: if it cannot render, that section
 * says so honestly and the rest of the panels keep working, because a learner
 * must never lose the whole view to a single bad value.
 */
export class PanelError extends Component {
  state = { failed: false, message: "" };

  static getDerivedStateFromError(error) {
    return { failed: true, message: String(error?.message ?? error) };
  }

  render() {
    if (this.state.failed) {
      return (
        <p className="empty panel-failed">
          This section could not be shown ({this.state.message}). Everything
          else still works.
        </p>
      );
    }
    return this.props.children;
  }
}

const isBadged = (change) =>
  change && change.kind !== "slot" && change.kind !== "new-slot" && !change.arg;

/** One variable. The type badge and the scope line are what a mode toggles. */
export function VariableRow({ entry, change, watched, onWatch, showTypes }) {
  // An argument is already explained by its "argument" tag; no NEW/after noise.
  // A slot change inside a list or object is shown on the object itself.
  const badged = isBadged(change);
  return (
    <li className={`var-row${badged ? " changed" : ""}`}>
      <button type="button" className="var-name" onClick={onWatch} aria-pressed={watched}>
        {entry.name}
      </button>
      <span className="var-eq">=</span>
      <span className="var-value">{entry.text}</span>
      {showTypes && entry.type && entry.type !== "?" ? (
        <span className="tag tag-type">{entry.type}</span>
      ) : null}
      {entry.isArg ? <span className="tag">argument</span> : null}
      {badged ? (
        <span className={`tag tag-${change.kind}`}>{change.kind === "new" ? "NEW" : "CHANGED"}</span>
      ) : null}
      {badged && change.kind === "changed" ? (
        <span className="var-delta">
          was {change.from} (line {change.line})
        </span>
      ) : null}
      {badged ? <span className="var-after">after this line: {change.to}</span> : null}
      {watched && onWatch ? (
        <button type="button" className="var-jump" onClick={() => onWatch(entry.name)}>
          history
        </button>
      ) : null}
    </li>
  );
}

/** The same variables as a table: Name, Value, (Type,) Scope. */
export function VariableTable({
  rows,
  changeByName,
  watched,
  onWatch,
  showTypes,
  scope,
}) {
  return (
    <table className="vars-table">
      <thead>
        <tr>
          <th scope="col">Name</th>
          <th scope="col">Value</th>
          {showTypes ? <th scope="col">Type</th> : null}
          <th scope="col">Scope</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((entry) => {
          const change = changeByName.get(entry.name);
          const badged = isBadged(change);
          return (
            <tr key={entry.name} className={badged ? "changed" : ""}>
              <th scope="row">
                <button
                  type="button"
                  className="var-name"
                  onClick={() => onWatch(entry.name)}
                  aria-pressed={watched === entry.name}
                >
                  {entry.name}
                </button>
                {entry.isArg ? <span className="tag">argument</span> : null}
                {badged ? (
                  <span className={`tag tag-${change.kind}`}>
                    {change.kind === "new" ? "NEW" : "CHANGED"}
                  </span>
                ) : null}
              </th>
              <td>
                <span className="var-value">{entry.text}</span>
                {badged && change.kind === "changed" ? (
                  <span className="var-delta">was {change.from}</span>
                ) : null}
                {badged ? <span className="var-after">after: {change.to}</span> : null}
              </td>
              {showTypes ? <td className="vars-type">{entry.type ?? "?"}</td> : null}
              <td className="vars-scope">{scope}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function HistoryChart({ name, entries, index, total, onJump }) {
  const chart = useMemo(
    () => chartGeometry(entries, index, total),
    [entries, index, total],
  );
  const first = chart.points[0];
  const last = chart.points[chart.points.length - 1];

  return (
    <div className="history-chart">
      <svg
        viewBox={`0 0 ${chart.width} ${chart.height}`}
        role="img"
        aria-label={`${name} from step ${first.index + 1} to step ${last.index + 1}`}
      >
        {chart.zeroY !== null ? (
          <line className="hist-zero" x1={chart.pad} x2={chart.width - chart.pad} y1={chart.zeroY} y2={chart.zeroY} />
        ) : null}
        {chart.currentX !== null ? (
          <line className="hist-now" x1={chart.currentX} x2={chart.currentX} y1={chart.pad} y2={chart.height - chart.pad} />
        ) : null}
        <polyline
          className="hist-line"
          points={chart.points.map((point) => `${point.x},${point.y}`).join(" ")}
        />
        {chart.points.map((point) => (
          <g
            key={point.index}
            className={`hist-point${point.index === index ? " on" : ""}`}
            role="button"
            tabIndex={0}
            aria-label={`step ${point.index + 1}: ${name} = ${point.value}`}
            onClick={() => onJump(point.index)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onJump(point.index);
              }
            }}
          >
            <circle cx={point.x} cy={point.y} r={point.index === index ? 4 : 3} />
            <title>{`step ${point.index + 1}: ${name} = ${point.value}`}</title>
          </g>
        ))}
      </svg>
      <div className="history-axis">
        <span>step {first.index + 1}</span>
        <span>
          {first.value} → {last.value}
        </span>
        <span>step {last.index + 1}</span>
      </div>
    </div>
  );
}

export function WatchHistory({ name, entries, index, total, onJump, onClose }) {
  return (
    <div className="watch">
      <div className="watch-head">
        <strong>{name}</strong> over time
        <button type="button" className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
      {isNumericSeries(entries) ? (
        <HistoryChart name={name} entries={entries} index={index} total={total} onJump={onJump} />
      ) : (
        <ol className="watch-list">
          {entries.map((entry) => (
            <li key={entry.index}>
              <button
                type="button"
                className={`watch-step${entry.index === index ? " on" : ""}`}
                onClick={() => onJump(entry.index)}
              >
                step {entry.index + 1}
              </button>
              <span className="var-value">{entry.value}</span>
              <span className="watch-line">{entry.line ? `line ${entry.line}` : entry.function}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function ChangeList({ log, index, onJump }) {
  const shown = log.filter((entry) => entry.index <= index).slice(-40).reverse();
  if (shown.length === 0) return <p className="empty">Nothing has changed yet.</p>;
  return (
    <ol className="changes">
      {shown.map((entry, i) => (
        <li key={`${entry.index}-${entry.name}-${i}`}>
          <button type="button" className="change-jump" onClick={() => onJump(entry.index)}>
            step {entry.index + 1}
          </button>
          <span className="change-name">{entry.name}</span>
          <span className="change-values">
            {entry.from === null ? "" : `${entry.from} → `}
            <strong>{entry.to}</strong>
          </span>
          <span className="watch-line">{entry.line ? `line ${entry.line}` : ""}</span>
        </li>
      ))}
    </ol>
  );
}

const STATUS_WORD = {
  running: "running now",
  waiting: "waiting",
  returning: "returning",
  raising: "raising an error",
};

function frameName(frame) {
  return frame.function === MODULE_NAME
    ? "top level (the whole program)"
    : `${frame.function} call #${frame.callNumber}`;
}

function frameStatusText(frame) {
  if (frame.status !== "waiting") return STATUS_WORD[frame.status] ?? "running";
  const above = frame.waitingFor;
  return above && above.function !== MODULE_NAME
    ? `waiting for ${above.function} call #${above.callNumber} to finish`
    : "waiting for the call above it to finish";
}

export function CallList({ callStack, selectedId, onSelect }) {
  if (callStack.length === 0) return <p className="empty">Nothing is running yet.</p>;
  const onlyFrame = callStack.length === 1;
  return (
    <>
      <ol className="calls stack-frames">
        {callStack.map((frame) => {
          const status = frame.status ?? (frame.isTop ? "running" : "waiting");
          const active = status !== "waiting";
          return (
            <li
              key={frame.frameId}
              className={`call-frame call-frame-${status}${
                frame.frameId === selectedId ? " on" : ""
              }`}
            >
              <button type="button" className="call-main" onClick={() => onSelect(frame.frameId)}>
                <span className="call-frame-head">
                  <span className="call-name">{frameName(frame)}</span>
                  <span className={`call-status status-${status}`}>{frameStatusText(frame)}</span>
                </span>
                {frame.args.length > 0 ? (
                  <span className="call-args">
                    {frame.args.map((arg) => `${arg.name} = ${arg.text}`).join(", ")}
                  </span>
                ) : null}
                {frame.variables.some((entry) => !entry.isArg) ? (
                  <span className="call-locals">
                    <span className="call-locals-label">
                      {frame.function === MODULE_NAME ? "names:" : "locals:"}
                    </span>
                    {frame.variables
                      .filter((entry) => !entry.isArg)
                      .map((entry) => (
                        <span key={entry.name} className="call-local">
                          {entry.name} = {entry.text}
                        </span>
                      ))}
                  </span>
                ) : null}
                {active && frame.lineText ? (
                  <code className="call-line">
                    {frame.line ? `line ${frame.line}: ` : ""}
                    {frame.lineText}
                  </code>
                ) : null}
                <span className="call-where">
                  {frame.callLine
                    ? `called from line ${frame.callLine}`
                    : frame.line
                      ? `on line ${frame.line}`
                      : "the program starts here"}
                </span>
                {frame.returnValue !== null ? (
                  <span className="call-return">
                    returned {frame.returnValue}
                    {frame.callLine ? ` to line ${frame.callLine}` : ""}
                  </span>
                ) : null}
              </button>
            </li>
          );
        })}
      </ol>
      {onlyFrame ? (
        <p className="stack-note">
          This run never entered a function, so the whole program is one frame.
        </p>
      ) : null}
    </>
  );
}

function SlotLabel({ label, heap }) {
  if (label === null || label === undefined) return null;
  const text = typeof label === "object" ? formatValue(label, heap) : String(label);
  return <div className="slot-label">{text}</div>;
}

function SlotValue({ value, heap }) {
  return <span>{showValue(value, heap)}</span>;
}

function registerIn(map, key, node) {
  if (node) map.current.set(key, node);
  else map.current.delete(key);
}

/** One heap object, with the slots that can point at other objects. */
function ObjectCard({
  id,
  object,
  heap,
  labels,
  changed,
  showIds,
  registerCard,
  registerSlot,
}) {
  const slots = slotEntries(object);
  const typeLabel = object.class ?? object.type;
  return (
    <div className={`object-card${changed ? " changed" : ""}`} ref={registerCard} data-object-id={id}>
      <div className="object-head">
        <span className="object-names">
          {labels.length > 0 ? labels.join(" and ") : typeLabel}
        </span>
        <span className="object-type">{showIds ? objectLabel(id, object) : typeLabel}</span>
      </div>
      <div className="slots">
        {slots.map((entry) => {
          const slotRef = entry.value?.type === "ref";
          return (
            <div
              key={entry.key}
              className={`slot${changed?.has(entry.key) ? " changed" : ""}${slotRef ? " slot-ref" : ""}`}
              ref={slotRef ? (node) => registerSlot(`slot:${id}:${entry.key}`, node) : undefined}
            >
              <SlotLabel label={entry.label} heap={heap} />
              <div className="slot-value">
                <SlotValue value={entry.value} heap={heap} />
              </div>
            </div>
          );
        })}
        {object.more ? <div className="slot slot-more">+{object.more} more</div> : null}
        {slots.length === 0 ? <div className="slot slot-empty">empty</div> : null}
      </div>
    </div>
  );
}

/** The lists, dicts and objects the program remembers, with changed slots lit. */
export function HeapObjects({ heap, names, changes, showIds = false }) {
  const ids = Object.keys(heap ?? {});
  if (ids.length === 0) return null;
  return (
    <div className="objects">
      {ids.map((id) => (
        <ObjectCard
          key={id}
          id={id}
          object={heap[id]}
          heap={heap}
          labels={names?.get(id) ?? []}
          changed={changes?.get(id)}
          showIds={showIds}
          registerCard={() => {}}
          registerSlot={() => {}}
        />
      ))}
    </div>
  );
}

/**
 * Stack and heap in one picture, joined by real reference arrows.
 *
 * The arrows are measured from the rendered boxes with an SVG overlay, so a
 * name and the object it points at are connected even after the inspector is
 * resized; each edge comes from `referenceEdges`, which only ever follows refs
 * present in the trace. The arrow layer is decorative - every object card also
 * names the variables pointing at it - so nothing depends on seeing it.
 */
export function MemoryGraph({
  frames,
  stack,
  heap,
  names,
  changes,
  showIds = false,
  selectedId = null,
  onSelectFrame,
  shared = [],
}) {
  const heapIds = Object.keys(heap ?? {});
  const edges = useMemo(() => referenceEdges(frames, heap), [frames, heap]);
  const wrapRef = useRef(null);
  const varRefs = useRef(new Map());
  const slotRefs = useRef(new Map());
  const cardRefs = useRef(new Map());
  const [paths, setPaths] = useState([]);

  const measure = useCallback(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const base = wrap.getBoundingClientRect();
    // Edges into one object enter at different heights, so two names pointing
    // at the same list read as two arrows, not one thick line.
    const groups = new Map();
    for (const edge of edges) {
      const group = groups.get(edge.targetId) ?? [];
      group.push(edge);
      groups.set(edge.targetId, group);
    }
    const next = [];
    for (const edge of edges) {
      const from = (edge.kind === "variable" ? varRefs.current : slotRefs.current).get(edge.key);
      const to = cardRefs.current.get(edge.targetId);
      if (!from || !to) continue;
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const group = groups.get(edge.targetId) ?? [edge];
      const rank = group.indexOf(edge);
      const targetY = b.top + (b.height * (rank + 1)) / (group.length + 1) - base.top;
      let x1 = a.right - base.left;
      let y1 = a.top + a.height / 2 - base.top;
      const x2 = b.left - base.left;
      let d;
      if (x2 <= x1 + 6) {
        // One column: run down the right-hand gutter, clear of both regions'
        // text, and enter the object card on its right edge.
        const gutter = Math.max(x1 + 18, base.width - 4);
        const r = 7;
        const x2r = b.right - base.left;
        d = `M ${x1} ${y1} L ${gutter - r} ${y1} Q ${gutter} ${y1} ${gutter} ${y1 + r} L ${gutter} ${targetY - r} Q ${gutter} ${targetY} ${gutter - r} ${targetY} L ${x2r} ${targetY}`;
      } else {
        const bend = Math.max(22, (x2 - x1) / 2);
        d = `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${targetY}, ${x2} ${targetY}`;
      }
      next.push({ key: edge.key, d });
    }
    setPaths(next);
  }, [edges]);

  useLayoutEffect(() => {
    measure();
  }, [measure]);

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => measure());
    observer.observe(wrap);
    return () => observer.disconnect();
  }, [measure]);

  return (
    <div className="memory-wrap" ref={wrapRef}>
      <svg className="mem-arrows" aria-hidden="true">
        <defs>
          <marker
            id="mem-arrowhead"
            viewBox="0 0 6 6"
            refX="5"
            refY="3"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L6,3 L0,6 z" />
          </marker>
        </defs>
        {paths.map((path) => (
          <path key={path.key} d={path.d} markerEnd="url(#mem-arrowhead)" />
        ))}
      </svg>

      <div className="memory-grid">
        <section className="memory-region" aria-label="Stack memory">
          <h4>Stack memory</h4>
          <p className="memory-hint">Names and their values, newest call on top.</p>
          {stack.length === 0 ? (
            <p className="empty">Nothing is on the stack yet.</p>
          ) : (
            stack.map((frame) => (
              <div key={frame.frameId} className="memory-frame">
                <div className="memory-frame-head">
                  <span>{frame.function === MODULE_NAME ? "top level" : frame.function}</span>
                  {frame.function === MODULE_NAME ? null : (
                    <span className="memory-call">call #{frame.callNumber}</span>
                  )}
                </div>
                {frame.variables.length === 0 ? (
                  <p className="empty">No names yet.</p>
                ) : (
                  frame.variables.map((entry) => {
                    const key = `var:${frame.frameId}:${entry.name}`;
                    return (
                      <button
                        key={entry.name}
                        type="button"
                        className={`mem-var${
                          frame.frameId === selectedId ? " on" : ""
                        }${entry.refId ? " mem-var-ref" : ""}`}
                        ref={entry.refId ? (node) => registerIn(varRefs, key, node) : undefined}
                        onClick={() => onSelectFrame?.(frame.frameId)}
                        title={`Show ${frameName(frame)}'s variables`}
                      >
                        <span className="mem-var-name">{entry.name}</span>
                        <span className="mem-var-value">{entry.text}</span>
                        {entry.isArg ? <span className="tag">arg</span> : null}
                      </button>
                    );
                  })
                )}
              </div>
            ))
          )}
        </section>

        <section className="memory-region" aria-label="Heap memory">
          <h4>Heap memory</h4>
          <p className="memory-hint">
            Lists, dictionaries and objects. Names and arrows point at them.
          </p>
          {heapIds.length === 0 ? (
            <p className="empty">
              No lists, dictionaries or objects at this step. Small values stay in the stack
              boxes.
            </p>
          ) : (
            <div className="objects">
              {heapIds.map((id) => (
                <ObjectCard
                  key={id}
                  id={id}
                  object={heap[id]}
                  heap={heap}
                  labels={names?.get(id) ?? []}
                  changed={changes?.get(id)}
                  showIds={showIds}
                  registerCard={(node) => registerIn(cardRefs, id, node)}
                  registerSlot={(key, node) => registerIn(slotRefs, key, node)}
                />
              ))}
            </div>
          )}
        </section>
      </div>

      {shared.length > 0 ? (
        <ul className="shared-list">
          {shared.map((note) => (
            <li key={note.id} className="shared-note">
              {note.text}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
