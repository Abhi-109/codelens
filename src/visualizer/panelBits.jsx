/**
 * The small presentational pieces every inspector panel is built from.
 *
 * These are moved out of the orchestrator so the panels and the shell share
 * one definition of a heading, a variable row or a call entry - but they are
 * still dumb: they draw what they are handed and call back when clicked, and
 * none of them reads the trace itself.
 */

import { Component, useState } from "react";
import { slotEntries } from "../tracer/objects";
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

/** One variable. The type badge and the scope line are what a mode toggles. */
export function VariableRow({ entry, change, watched, onWatch, showTypes }) {
  // An argument is already explained by its "argument" tag; no NEW/after noise.
  // A slot change inside a list or object is shown on the object itself.
  const badged =
    change && change.kind !== "slot" && change.kind !== "new-slot" && !change.arg;
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
      {badged ? (
        <span className="var-after">
          after this line: {change.to}
        </span>
      ) : null}
      {watched && onWatch ? (
        <button type="button" className="var-jump" onClick={() => onWatch(entry.name)}>
          history
        </button>
      ) : null}
    </li>
  );
}

export function WatchHistory({ name, entries, index, onJump, onClose }) {
  return (
    <div className="watch">
      <div className="watch-head">
        <strong>{name}</strong> over time
        <button type="button" className="ghost" onClick={onClose}>
          ✕
        </button>
      </div>
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
            <span className="var-value">{entry.v}</span>
            <span className="watch-line">{entry.line ? `line ${entry.line}` : entry.function}</span>
          </li>
        ))}
      </ol>
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

export function CallList({ callStack, selectedId, onSelect }) {
  if (callStack.length === 0) return <p className="empty">Nothing is running yet.</p>;
  return (
    <ol className="calls">
      {callStack.map((frame, i) => (
        <li
          key={frame.frameId}
          className={`call${frame.frameId === selectedId ? " on" : ""}${i === 0 ? " top" : ""}`}
        >
          <button type="button" className="call-main" onClick={() => onSelect(frame.frameId)}>
            <span className="call-name">
              {frame.function === MODULE_NAME ? "top level (the whole program)" : frame.function}
              {frame.function === MODULE_NAME ? "" : ` call #${frame.callNumber}`}
            </span>
            {frame.args.length > 0 ? (
              <span className="call-args">
                {frame.args.map((arg) => `${arg.name} = ${arg.text}`).join(", ")}
              </span>
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
      ))}
    </ol>
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

/** The lists, dicts and objects the program remembers, with changed slots lit. */
export function HeapObjects({ heap, names, changes }) {
  const ids = Object.keys(heap ?? {});
  if (ids.length === 0) return null;
  return (
    <div className="objects">
      {ids.map((id) => {
        const object = heap[id];
        const changed = changes?.get(id);
        const labels = names.get(id) ?? [];
        const slots = slotEntries(object);
        const typeLabel = object.class ?? object.type;
        return (
          <div key={id} className={`object-card${changed ? " changed" : ""}`}>
            <div className="object-head">
              <span className="object-names">
                {labels.length > 0 ? labels.join(" and ") : `${typeLabel}`}
              </span>
              <span className="object-type">{typeLabel}</span>
            </div>
            <div className="slots">
              {slots.map((entry) => (
                <div
                  key={entry.key}
                  className={`slot${changed?.has(entry.key) ? " changed" : ""}`}
                >
                  <SlotLabel label={entry.label} heap={heap} />
                  <div className="slot-value">
                    <SlotValue value={entry.value} heap={heap} />
                  </div>
                </div>
              ))}
              {object.more ? <div className="slot slot-more">+{object.more} more</div> : null}
              {slots.length === 0 ? <div className="slot slot-empty">empty</div> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}
