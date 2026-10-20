/**
 * The one playback bar: stepping, the timeline, the speed, and the two
 * disclosure menus that are about the run rather than the lesson.
 *
 * It knows nothing about how a step is described. It is given the step it is
 * on, the length of the trace and three callbacks, so the same bar can drive
 * any surface and can never disagree about which step is current.
 *
 * Every control is a real `<button>`, `<input>` or `<select>`, so it is
 * reachable by keyboard, announced with its purpose, and disabled the moment
 * the trace cannot support the action.
 */

import { SPEED_OPTIONS } from "./playback.js";

export default function PlaybackBar({
  trace,
  index,
  playing,
  speed,
  onJump,
  onTogglePlay,
  onSpeedChange,
  onOpenGlossary,
  showJson,
  onShowJsonChange,
  result,
  traceFacts,
  showTraceDetails,
  onShowTraceDetailsChange,
}) {
  const hasTrace = trace.length > 0;
  const atStart = index <= 0;
  const atEnd = index >= trace.length - 1;

  return (
    <footer className="controls-bar">
      <div className="controls">
        <button
          type="button"
          aria-label="First step"
          title="First step"
          onClick={() => onJump(0)}
          disabled={!hasTrace || atStart}
        >
          ⏮
        </button>
        <button
          type="button"
          aria-label="Step back"
          onClick={() => onJump(index - 1)}
          disabled={!hasTrace || atStart}
        >
          ◀ Back
        </button>
        <button
          type="button"
          className="play"
          onClick={onTogglePlay}
          disabled={!hasTrace}
          aria-pressed={playing}
        >
          {playing ? "⏸ Pause" : "▶ Play"}
        </button>
        <button
          type="button"
          aria-label="Step forward"
          onClick={() => onJump(index + 1)}
          disabled={!hasTrace || atEnd}
        >
          Next ▶
        </button>
        <button
          type="button"
          aria-label="Last step"
          title="Last step"
          onClick={() => onJump(trace.length - 1)}
          disabled={!hasTrace || atEnd}
        >
          ⏭
        </button>
        <input
          type="range"
          min={0}
          max={Math.max(trace.length - 1, 0)}
          value={index}
          onChange={(event) => onJump(Number(event.target.value))}
          disabled={!hasTrace}
          aria-label="Step"
          aria-valuetext={hasTrace ? `Step ${index + 1} of ${trace.length}` : "No steps recorded"}
        />
        <select
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}×
            </option>
          ))}
        </select>
      </div>

      <div className="bar-actions">
        <button type="button" className="ghost" onClick={onOpenGlossary}>
          Glossary
        </button>
        <details className="dev-menu">
          <summary>Developer</summary>
          <div className="dev-pop">
            <label className="dev-check">
              <input
                type="checkbox"
                checked={showTraceDetails}
                onChange={(event) => onShowTraceDetailsChange(event.target.checked)}
              />
              Show trace details
            </label>
            {showTraceDetails ? (
              <dl className="trace-facts">
                {traceFacts.map((fact) => (
                  <div key={fact.label}>
                    <dt>{fact.label}</dt>
                    <dd>{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            <label className="dev-check">
              <input
                type="checkbox"
                checked={showJson}
                onChange={(event) => onShowJsonChange(event.target.checked)}
              />
              Show raw trace JSON
            </label>
            {showJson && <pre className="json">{JSON.stringify(result, null, 2)}</pre>}
          </div>
        </details>
      </div>
    </footer>
  );
}
