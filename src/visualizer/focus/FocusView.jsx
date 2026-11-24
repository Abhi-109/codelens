import { useEffect, useRef, useState } from "react";

import { EXAMPLES, exampleById } from "../../examples.js";
import MotionStage from "../motion/MotionStage.jsx";
import { SPEED_OPTIONS } from "../playback.js";
import CodeEditor from "./CodeEditor.jsx";
import {
  DEFAULT_FOCUS_LEFT,
  clampFocusLeft,
  loadFocusLeft,
  saveFocusLeft,
  splitLeft,
} from "./focusLayout.js";
import "./focus.css";

const WELCOME_EXAMPLES = ["variables", "for-loop", "recursion", "bubble-sort"]
  .map((id) => exampleById(id))
  .filter(Boolean);

function StatusChip({ runState }) {
  return (
    <span
      className={`focus-status is-${runState.id}`}
      title={runState.title ?? runState.label}
    >
      <span className="focus-status-dot" aria-hidden="true" />
      {runState.label}
    </span>
  );
}

function Welcome({ engine, running, onRun, onExample }) {
  return (
    <div className="focus-welcome">
      <div className="focus-welcome-copy">
        <span className="focus-kicker">A real recording, not a demo</span>
        <h1>Watch your code think.</h1>
        <p>
          Press Run. Every value, movement and printed line you see is recorded
          from the program as it really ran — in your browser.
        </p>
        <div className="focus-welcome-actions">
          <button
            type="button"
            className="focus-run focus-run-lg"
            onClick={onRun}
            disabled={running || engine === "failed"}
          >
            {engine === "loading" ? "Loading Python…" : running ? "Starting…" : "Run this program"}
          </button>
          <span className="focus-welcome-hint">
            or pick a starting point
          </span>
        </div>
      </div>
      <div className="focus-start-grid">
        {WELCOME_EXAMPLES.map((example) => (
          <button
            key={example.id}
            type="button"
            className="focus-start"
            onClick={() => onExample(example)}
          >
            <span className="focus-start-name">{example.name}</span>
            <span className="focus-start-code">
              {example.code
                .split("\n")
                .slice(0, 2)
                .map((lineText) => lineText.trim())
                .filter(Boolean)
                .join(" · ")}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function EmptyResult({ runState, result }) {
  const message =
    result?.error?.message ??
    result?.exception?.message ??
    "The program produced no recorded steps.";
  return (
    <div className="focus-error-card">
      <span className="focus-kicker">No animation</span>
      <strong>{runState.label}</strong>
      <p>{message}</p>
      <p className="focus-error-note">
        {result?.error?.line ? `Line ${result.error.line}. ` : ""}
        Nothing is drawn because nothing ran.
      </p>
    </div>
  );
}

function Transport({
  trace,
  index,
  playing,
  speed,
  runState,
  onJump,
  onTogglePlay,
  onSpeedChange,
}) {
  const last = Math.max(trace.length - 1, 0);
  const disabled = trace.length === 0;

  return (
    <div className="focus-transport" aria-label="Playback">
      <button
        type="button"
        className="focus-tbtn"
        onClick={() => onJump(Math.max(index - 1, 0))}
        disabled={disabled || index <= 0}
        aria-label="Previous step"
        title="Previous step (←)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M10.5 3.6 5 8l5.5 4.4V3.6Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="focus-tbtn focus-tbtn-play"
        onClick={onTogglePlay}
        disabled={disabled}
        aria-label={playing ? "Pause" : "Play"}
        title={playing ? "Pause (Space)" : "Play (Space)"}
      >
        {playing ? (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4 3.5h3v9H4zM9 3.5h3v9H9z" fill="currentColor" />
          </svg>
        ) : (
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
            <path d="M4.6 3.3 12.5 8l-7.9 4.7V3.3Z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        type="button"
        className="focus-tbtn"
        onClick={() => onJump(Math.min(index + 1, last))}
        disabled={disabled || index >= last}
        aria-label="Next step"
        title="Next step (→)"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path d="M5.5 3.6 11 8l-5.5 4.4V3.6Z" fill="currentColor" />
        </svg>
      </button>
      <button
        type="button"
        className="focus-tbtn"
        onClick={() => onJump(0)}
        disabled={disabled || index === 0}
        aria-label="Restart from the first step"
        title="Restart from the first step"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <path
            d="M12.7 6.3A5 5 0 1 0 13 9.2M12.7 3v3.6H9.1"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      <input
        className="focus-seek"
        type="range"
        min="0"
        max={last}
        step="1"
        value={index}
        disabled={disabled}
        onChange={(event) => onJump(Number(event.target.value))}
        aria-label="Step"
      />

      <span className="focus-count" aria-live="polite">
        {disabled ? "0 / 0" : `${index + 1} / ${trace.length}`}
      </span>
      <span className={`focus-transport-state is-${runState.id}`} title={runState.title ?? runState.label}>
        {runState.label}
      </span>

      <label className="focus-speed">
        <span className="focus-speed-label">Speed</span>
        <select
          value={speed}
          onChange={(event) => onSpeedChange(Number(event.target.value))}
          aria-label="Playback speed"
        >
          {SPEED_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}×
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

/**
 * The Focus surface: one editor, one stage, one transport.
 *
 * It reads the same session and the same `motionPlan` the Studio workspace
 * reads. There is no second cursor here; pressing Next in Focus moves the
 * Studio pages by exactly one step too.
 */
export default function FocusView({
  source,
  setSource,
  setEditing,
  editing,
  result,
  trace,
  index,
  playing,
  speed,
  running,
  runState,
  engine,
  motionPlan,
  errorLine,
  line,
  hint,
  justRanLine,
  usesInput,
  inputsText,
  setInputsText,
  fileName,
  onRun,
  onJump,
  onJumpLine,
  onTogglePlay,
  onSpeedChange,
  onStudio,
}) {
  const [left, setLeft] = useState(loadFocusLeft);
  const drag = useRef(null);
  const stepping = !editing && result !== null;

  useEffect(() => {
    saveFocusLeft(left);
  }, [left]);

  function grab(event) {
    const rect = event.currentTarget.parentElement?.getBoundingClientRect();
    if (!rect) return;
    drag.current = { startX: event.clientX, left, width: rect.width };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function move(event) {
    const state = drag.current;
    if (!state) return;
    setLeft(splitLeft(state.left, event.clientX, state.startX, state.width));
  }

  function release(event) {
    drag.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }

  function pickExample(example) {
    if (!example) return;
    setSource(example.code);
    setEditing(true);
  }

  return (
    <div className="focus" style={{ "--focus-left": `${clampFocusLeft(left)}%` }}>
      <header className="focus-top">
        <div className="focus-id">
          <span className="focus-lang" aria-hidden="true">
            PY
          </span>
          <span className="focus-file" title={fileName}>
            {fileName}
          </span>
          <StatusChip runState={runState} />
          {engine === "loading" || engine === "failed" ? (
            <span className={`focus-engine is-${engine}`}>
              {engine === "failed" ? "Python engine failed" : "Loading Python…"}
            </span>
          ) : null}
        </div>
        <div className="focus-top-actions">
          <button
            type="button"
            className="focus-ghost"
            onClick={onStudio}
            title="Open the full workspace, including every canvas and the inspector (Ctrl/Cmd + .)"
          >
            Studio
            <kbd>Ctrl/⌘.</kbd>
          </button>
          <button
            type="button"
            className="focus-tbtn"
            onClick={onRun}
            disabled={running || !result}
            title="Run the current source again"
            aria-label="Restart run"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M12.7 6.3A5 5 0 1 0 13 9.2M12.7 3v3.6H9.1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
          <button type="button" className="focus-run" onClick={onRun} disabled={running}>
            <svg viewBox="0 0 16 16" width="11" height="11" aria-hidden="true">
              <path d="M4.5 3.2 12 8l-7.5 4.8V3.2Z" fill="currentColor" />
            </svg>
            {running ? "Starting…" : "Run"}
          </button>
        </div>
      </header>

      <main className="focus-main">
        <section className="focus-editor-pane" aria-label="Code">
          <div className="focus-pane-head">
            <span className="focus-kicker">Code</span>
            <div className="focus-pane-tools">
              <select
                className="focus-examples"
                value=""
                aria-label="Load an example"
                onChange={(event) => pickExample(EXAMPLES.find((e) => e.id === event.target.value))}
              >
                <option value="">Examples…</option>
                {EXAMPLES.map((example) => (
                  <option key={example.id} value={example.id}>
                    {example.name}
                  </option>
                ))}
              </select>
              {stepping ? (
                <button type="button" className="focus-ghost" onClick={() => setEditing(true)}>
                  Edit
                </button>
              ) : (
                <span className="focus-note">editing</span>
              )}
            </div>
          </div>

          <div className="focus-editor-body">
            <CodeEditor
              value={source}
              onChange={setSource}
              readOnly={stepping}
              line={line}
              errorLine={errorLine}
              justRanLine={justRanLine}
              hint={hint}
              onJumpLine={onJumpLine}
            />
          </div>

          {usesInput ? (
            <label className="focus-inputs">
              <span>Values for input() · one per line</span>
              <textarea
                value={inputsText}
                onChange={(event) => setInputsText(event.target.value)}
                rows={2}
                spellCheck="false"
                aria-label="Values for input(), one per line"
              />
            </label>
          ) : null}

          <div className="focus-pane-foot">
            <span>{stepping ? "Click a line to jump to a step that ran it" : "Space plays · ← → step"}</span>
            <span className="focus-foot-right">{source.split("\n").length} lines</span>
          </div>
        </section>

        <div
          className="focus-split"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize the code panel"
          tabIndex={0}
          onPointerDown={grab}
          onPointerMove={move}
          onPointerUp={release}
          onPointerCancel={release}
          onDoubleClick={() => setLeft(DEFAULT_FOCUS_LEFT)}
          title="Drag to resize · double-click to reset"
        >
          <span aria-hidden="true" />
        </div>

        <section className="focus-stage" aria-label="Animation">
          <div className="focus-pane-head">
            <span className="focus-kicker">Animation</span>
            <span className="focus-stage-meta">
              {result
                ? `${trace.length} recorded ${trace.length === 1 ? "step" : "steps"}`
                : "press Run to begin"}
            </span>
          </div>

          <div className="focus-stage-body">
            {result ? (
              trace.length === 0 ? (
                <EmptyResult runState={runState} result={result} />
              ) : (
                <MotionStage plan={motionPlan} trace={trace} result={result} />
              )
            ) : (
              <Welcome
                engine={engine}
                running={running}
                onRun={onRun}
                onExample={pickExample}
              />
            )}
          </div>

          <Transport
            trace={trace}
            index={index}
            playing={playing}
            speed={speed}
            runState={runState}
            onJump={onJump}
            onTogglePlay={onTogglePlay}
            onSpeedChange={onSpeedChange}
          />
        </section>
      </main>
    </div>
  );
}
