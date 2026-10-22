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
 * the trace cannot support the action. Transport controls are icons with
 * accessible names, which keeps the bar to one calm row.
 */

import { SPEED_OPTIONS } from "./playback.js";

const icon = (path, extra = null) => (
  <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true" focusable="false">
    {path}
    {extra}
  </svg>
);

const ICONS = {
  first: (
    <>
      <path d="M4 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M12.5 3.6 6 8l6.5 4.4V3.6Z" fill="currentColor" />
    </>
  ),
  back: <path d="M10.5 3.2 5 8l5.5 4.8V3.2Z" fill="currentColor" />,
  play: <path d="M5 3.4 12.4 8 5 12.6V3.4Z" fill="currentColor" />,
  pause: (
    <>
      <rect x="4.6" y="3.4" width="2.6" height="9.2" rx="0.7" fill="currentColor" />
      <rect x="8.8" y="3.4" width="2.6" height="9.2" rx="0.7" fill="currentColor" />
    </>
  ),
  next: <path d="M5.5 3.2 11 8l-5.5 4.8V3.2Z" fill="currentColor" />,
  last: (
    <>
      <path d="M12 3v10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M3.5 3.6 10 8l-6.5 4.4V3.6Z" fill="currentColor" />
    </>
  ),
};

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
          className="transport"
          aria-label="First step"
          title="First step"
          onClick={() => onJump(0)}
          disabled={!hasTrace || atStart}
        >
          {icon(ICONS.first)}
        </button>
        <button
          type="button"
          className="transport"
          aria-label="Step back"
          title="Step back (←)"
          onClick={() => onJump(index - 1)}
          disabled={!hasTrace || atStart}
        >
          {icon(ICONS.back)}
        </button>
        <button
          type="button"
          className="transport play"
          onClick={onTogglePlay}
          disabled={!hasTrace}
          aria-pressed={playing}
          aria-label={playing ? "Pause" : "Play"}
          title={playing ? "Pause (Space)" : "Play (Space)"}
        >
          {icon(playing ? ICONS.pause : ICONS.play)}
        </button>
        <button
          type="button"
          className="transport"
          aria-label="Step forward"
          title="Step forward (→)"
          onClick={() => onJump(index + 1)}
          disabled={!hasTrace || atEnd}
        >
          {icon(ICONS.next)}
        </button>
        <button
          type="button"
          className="transport"
          aria-label="Last step"
          title="Last step"
          onClick={() => onJump(trace.length - 1)}
          disabled={!hasTrace || atEnd}
        >
          {icon(ICONS.last)}
        </button>

        <span className="step-readout" aria-hidden="true">
          {hasTrace ? `${index + 1} / ${trace.length}` : "— / —"}
        </span>

        <input
          className="timeline"
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
          className="speed"
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          aria-label="Playback speed"
          title="Playback speed"
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
          <summary aria-label="Developer options" title="Developer options">
            <span className="bar-wide">Developer</span>
            <span className="bar-narrow" aria-hidden="true">
              ⋯
            </span>
          </summary>
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
