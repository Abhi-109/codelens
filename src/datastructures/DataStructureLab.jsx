/* One data-structure page's interactive lab.
 *
 * The model (model.js + hashTable.js) owns the operations and the frames.
 * This component owns only the cursor: which frame of the current operation is
 * showing, whether it is playing, and the values typed into the operation
 * fields. Applying a new operation always starts from the structure's final
 * recorded state, so a half-seeked run cannot fork into a state that never
 * happened.
 *
 * These steps are authored for teaching. They are not a Python trace, and the
 * badge on the page says so.
 */

import { useEffect, useMemo, useState } from 'react';
import { Link } from '../router.jsx';
import { PageHeader } from '../shell/AppShell.jsx';
import { NotFoundState } from '../shell/states.jsx';
import { STRUCTURES, applyOperation, initialState, structureByType } from './model.js';
import StructureView from './StructureView.jsx';
import HashTableExtras from './HashTableExtras.jsx';
import './datastructures.css';

const STEP_MS = 750;

const clamp = (index, length) => Math.max(0, Math.min(index, length - 1));

function startingInputs(structure) {
  return Object.fromEntries(
    structure.operations.map((operation) => [
      operation.id,
      Object.fromEntries(operation.fields.map((field) => [field.name, field.default])),
    ]),
  );
}

/** A lesson may deep-link to a prepared dataset: ?preset=colliders. The model
 *  owns the dataset, so the page cannot invent one that the engine rejects. */
function seededRun(type) {
  if (type !== 'hash-table') return null;
  const preset = new URLSearchParams(window.location.search).get('preset');
  if (!preset) return null;
  const result = applyOperation(type, initialState(type), 'load', { preset });
  return result.error ? null : result;
}

function Transport({ run, playing, onBack, onPlay, onNext, onReset, onSeek }) {
  const hasSteps = Boolean(run && run.frames.length);
  const atStart = !hasSteps || run.index === 0;
  const atEnd = !hasSteps || run.index >= run.frames.length - 1;
  return (
    <div className="ds-transport" role="group" aria-label="Lab playback">
      <button type="button" className="ds-btn" onClick={onReset} aria-label="Reset lab">
        Reset
      </button>
      <button type="button" className="ds-btn" onClick={onBack} disabled={atStart} aria-label="Previous lab step">
        Back
      </button>
      <button
        type="button"
        className="ds-btn ds-btn-play"
        onClick={onPlay}
        disabled={!hasSteps}
        aria-label={playing ? 'Pause lab' : 'Play lab'}
        aria-pressed={playing}
      >
        {playing ? 'Pause' : 'Play'}
      </button>
      <button type="button" className="ds-btn" onClick={onNext} disabled={atEnd} aria-label="Next lab step">
        Next
      </button>
      <span className="ds-readout" aria-hidden="true">
        {hasSteps ? `${run.index + 1} / ${run.frames.length}` : '0 / 0'}
      </span>
      <input
        className="ds-slider"
        type="range"
        min={0}
        max={Math.max((run?.frames.length ?? 0) - 1, 0)}
        value={run?.index ?? 0}
        onChange={(event) => onSeek(Number(event.target.value))}
        disabled={!hasSteps}
        aria-label="Lab step"
        aria-valuetext={hasSteps ? `Step ${run.index + 1} of ${run.frames.length}` : 'No steps recorded'}
      />
    </div>
  );
}

function StepDetail({ detail }) {
  if (!detail) return null;
  const rows = [
    detail.raw !== undefined ? ['Raw hash', detail.raw] : null,
    detail.index !== undefined ? ['Bucket', detail.index] : null,
    detail.probes ? ['Probes', detail.probes] : null,
    detail.count !== undefined ? ['Keys', `${detail.count} / ${detail.capacity}`] : null,
    detail.load !== undefined ? ['Load factor', detail.load.toFixed(2)] : null,
    detail.tombstone ? ['Deleted as', 'tombstone'] : null,
  ].filter(Boolean);
  if (!rows.length) return null;
  return (
    <dl className="ds-detail">
      {rows.map(([term, value]) => (
        <div key={term} className="ds-detail-pair">
          <dt>{term}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function OperationRow({ operation, inputs, onChange, onApply, selected }) {
  return (
    <div className={`ds-op${selected ? ' is-selected' : ''}`}>
      <div className="ds-fields">
        {operation.fields.map((field) => (
          <label key={field.name} className="ds-field">
            <span>{field.label}</span>
            {field.type === 'select' ? (
              <select
                value={inputs[field.name]}
                onChange={(event) => onChange(operation, field, event.target.value)}
                aria-label={`${operation.label} ${field.label}`}
              >
                {field.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={field.type ?? 'number'}
                value={inputs[field.name]}
                onChange={(event) => onChange(operation, field, event.target.value)}
                aria-label={`${operation.label} ${field.label}`}
              />
            )}
          </label>
        ))}
      </div>
      <button type="button" className="ds-btn" onClick={() => onApply(operation)}>
        {operation.label}
      </button>
    </div>
  );
}

export default function DataStructureLab({ type }) {
  const structure = structureByType(type);
  if (!structure) return <NotFoundState />;
  return <Lab key={type} structure={structure} />;
}

function Lab({ structure }) {
  const seeded = useMemo(() => seededRun(structure.type), [structure.type]);
  const [state, setState] = useState(() => seeded?.state ?? initialState(structure.type));
  const [run, setRun] = useState(() =>
    seeded ? { frames: seeded.frames, index: 0, label: 'Load dataset', operationId: 'load' } : null,
  );
  const [error, setError] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [inputs, setInputs] = useState(() => startingInputs(structure));

  const frame = run?.frames[run.index] ?? null;
  const viewState = frame?.state ?? state;
  const marks = useMemo(
    () => frame?.marks ?? { active: [], compare: [], done: [], found: [], collision: [], inserted: [], deleted: [], tombstone: [] },
    [frame],
  );

  useEffect(() => {
    if (!playing || !run || run.index >= run.frames.length - 1) return undefined;
    const next = run.index + 1;
    const id = setTimeout(() => {
      setRun((current) => (current ? { ...current, index: next } : current));
      if (next >= run.frames.length - 1) setPlaying(false);
    }, STEP_MS);
    return () => clearTimeout(id);
  }, [playing, run]);

  function changeInput(operation, field, value) {
    setInputs((current) => ({
      ...current,
      [operation.id]: { ...current[operation.id], [field.name]: value },
    }));
  }

  function apply(operation) {
    setPlaying(false);
    const result = applyOperation(structure.type, state, operation.id, inputs[operation.id]);
    if (result.error) {
      setError(result.error);
      return;
    }
    setError(null);
    setState(result.state);
    setRun({ frames: result.frames, index: 0, label: operation.label, operationId: operation.id });
    if (structure.type === 'hash-table' && ['configure', 'resize', 'load'].includes(operation.id)) {
      // Keep the settings fields showing what the table actually uses now.
      setInputs((current) => ({
        ...current,
        configure: {
          ...current.configure,
          strategy: result.state.strategy,
          hashFn: result.state.hashFn,
          seed: result.state.universal.seed,
          threshold: result.state.threshold,
        },
        resize: { ...current.resize, capacity: result.state.capacity * 2 <= 97 ? result.state.capacity * 2 : result.state.capacity },
      }));
    }
  }

  function reset() {
    setPlaying(false);
    setError(null);
    setRun(null);
    setState(initialState(structure.type));
    setInputs(startingInputs(structure));
  }

  function seek(index) {
    setPlaying(false);
    setRun((current) => (current ? { ...current, index: clamp(index, current.frames.length) } : current));
  }

  const hasSteps = Boolean(run && run.frames.length);
  const atEnd = !hasSteps || run.index >= run.frames.length - 1;
  const primary = structure.operations.filter((operation) => !operation.advanced);
  const advanced = structure.operations.filter((operation) => operation.advanced);
  const row = (operation) => (
    <OperationRow
      key={operation.id}
      operation={operation}
      inputs={inputs[operation.id]}
      onChange={changeInput}
      onApply={apply}
      selected={run?.operationId === operation.id}
    />
  );

  return (
    <div>
      <PageHeader
        crumbs={[
          { label: 'Visualize', to: '/get-started' },
          { label: 'Data Structures', to: '/visualizer/data-structures' },
          { label: structure.name },
        ]}
        title={`${structure.name} visualizer`}
        subtitle={structure.blurb}
      />

      <p className="ds-badge">Authored operation model · not a Python trace</p>

      <nav className="ds-switch" aria-label="Structures">
        {STRUCTURES.map((entry) => (
          <Link
            key={entry.type}
            to={`/visualizer/data-structures/${entry.type}`}
            className={`ds-switch-link${entry.type === structure.type ? ' is-current' : ''}`}
            aria-current={entry.type === structure.type ? 'page' : undefined}
          >
            {entry.name}
          </Link>
        ))}
      </nav>

      <div className="ds-lab">
        <section className="ds-controls" aria-labelledby="ds-operations">
          <h2 id="ds-operations">Operations</h2>
          {primary.map(row)}
          {advanced.length ? (
            <details className="ds-advanced">
              <summary>Advanced settings</summary>
              <div className="ds-advanced-body">{advanced.map(row)}</div>
            </details>
          ) : null}
          {error ? (
            <p className="ds-error" role="alert">
              {error}
            </p>
          ) : null}
          <p className="ds-limits">
            <strong>Not offered:</strong> {structure.limits}
          </p>
        </section>

        <section className="ds-stage" aria-labelledby="ds-stage-title">
          <h2 id="ds-stage-title" className="ds-sr">
            {structure.name} state
          </h2>
          <StructureView type={structure.type} state={viewState} marks={marks} detail={frame?.detail ?? null} />
          <p className="ds-text" aria-live="polite">
            {frame
              ? frame.text
              : 'Apply an operation to record the first step. The structure below is the starting state.'}
          </p>
          <StepDetail detail={frame?.detail ?? null} />
          <Transport
            run={run}
            playing={playing}
            onReset={reset}
            onBack={() => seek((run?.index ?? 0) - 1)}
            onPlay={() => {
              if (atEnd) {
                setRun((current) => (current ? { ...current, index: 0 } : current));
                setPlaying(true);
              } else {
                setPlaying((value) => !value);
              }
            }}
            onNext={() => seek((run?.index ?? 0) + 1)}
            onSeek={seek}
          />
          {run ? (
            <p className="ds-step-source">
              Showing {run.label.toLowerCase()} · step {run.index + 1} of {run.frames.length}. The
              structure keeps its final state when you move back.
            </p>
          ) : null}
        </section>
      </div>

      {structure.type === 'hash-table' ? <HashTableExtras state={state} /> : null}
    </div>
  );
}
