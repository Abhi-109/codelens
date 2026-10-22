// The adaptive canvas: recognition, the supported view choices, and the
// validated scene for the selected step.
//
// The canvas has one toolbar (rendered by VisualizationPane). The adapter
// choice and all of its reasoning live in `AdaptiveTools`, which is a single
// menu in that toolbar: the five view tabs stay the only navigation row, and
// the long explanation of *why* a view was recognised is one click away
// instead of permanently on screen.
//
// Auto asks the registry for the adapter recognition chose. The alternatives
// are the adapters whose *own* availability checks pass at this step, so a
// merge sort can offer both Sorting and Recursion without pretending the
// recognizer picked both. Every build goes through the registry, which
// validates the scene and falls back to generic with a reason.

import { useRef } from "react";

import { AUTO_ADAPTER, adapterLabel } from "./adaptive.js";
import SceneView from "./SceneView.jsx";

function EmptyState({ result }) {
  const error = result?.error ?? null;
  const ran = Boolean(result);
  return (
    <div className="scene-empty-state">
      <h4>{ran ? "No execution steps recorded" : "Run the program to visualize it"}</h4>
      <p>
        {ran
          ? error
            ? `${error.type ?? "Error"}: ${error.message ?? "the run did not produce a trace"}`
            : `The run ended with status "${result.status ?? "unknown"}" before a step was recorded.`
          : "The generic view works for every trace. Specialized views appear only when the profile and the recorded execution support them."}
      </p>
    </div>
  );
}

function fallbackTitle(built, options) {
  if (built?.validation?.valid === false) return "Scene validation failed";
  if (!built?.fallbackReason) return null;
  if (
    built.requestedAdapterId === options.recognitionId &&
    options.recognitionId !== "generic"
  ) {
    return "Not enough evidence at this step";
  }
  if (/could not check|could not build|not registered/i.test(built.fallbackReason)) {
    return "Adapter error";
  }
  return "Adapter unavailable at this step";
}

function choiceNote(choice) {
  if (choice.id === "generic") return "Always available for any recorded step.";
  if (choice.state === "waiting") {
    return `Recognized for this run, but this step does not have enough recorded state for it. ${choice.reason ?? ""}`.trim();
  }
  if (!choice.available) {
    return choice.state === "error"
      ? `Could not check this adapter: ${choice.reason}`
      : `Not available for this run at this step: ${choice.reason}`;
  }
  if (choice.recognized) return "Supported by this step and chosen by Auto.";
  return "Supported by this step; choose it to compare with Auto.";
}

/**
 * The canvas's second control: which adapter draws the scene, and why.
 *
 * It is one menu, not a second toolbar. Its summary is the honest current
 * choice ("Auto → Generic"), and opening it offers every supported adapter
 * with the registry's own reason for each. Choosing one closes the menu and
 * touches nothing but the presentation.
 */
export function AdaptiveTools({ adaptive, adapter, onAdapterChange }) {
  const options = adaptive?.options ?? null;
  const menu = useRef(null);
  if (!options) return null;

  const built = adaptive?.built ?? null;
  const effective = built?.adapterId ?? "generic";
  const autoChoice = options.choices.find((choice) => choice.id === AUTO_ADAPTER);
  const recognized = options.choices.find(
    (choice) => choice.id === options.recognitionId,
  );
  const recognitionText =
    options.recognitionId === "generic"
      ? options.recognition?.unavailableReason ??
        "No specialized pattern is supported by both the profile and this trace."
      : recognized?.available
        ? `${adapterLabel(options.recognitionId)} is recognized and this step has enough recorded state for it.`
        : `${adapterLabel(options.recognitionId)} is recognized for this run, but this step does not have enough recorded state for it yet.`;
  const autoLead =
    options.recognitionId === "generic"
      ? "Auto uses Generic"
      : recognized?.available
        ? `Auto chooses ${adapterLabel(options.recognitionId)}`
        : `Auto would use ${adapterLabel(options.recognitionId)}`;
  const title = fallbackTitle(built, options);

  const close = () => {
    if (menu.current) menu.current.open = false;
  };

  return (
    <details className="view-menu" ref={menu}>
      <summary
        className="view-menu-summary"
        title={title ?? recognitionText}
        aria-label={`View options. Currently ${
          adapter === AUTO_ADAPTER ? "Auto" : adapterLabel(adapter)
        }, drawing ${adapterLabel(effective)}.`}
      >
        <span className="view-menu-kicker">View</span>
        <span className="view-menu-value">
          {adapter === AUTO_ADAPTER ? "Auto" : adapterLabel(adapter)}
          <span className="view-menu-arrow" aria-hidden="true">
            →
          </span>
          {adapterLabel(effective)}
        </span>
        <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </summary>

      <div className="view-menu-pop">
        <div className="view-menu-group" role="group" aria-label="Visualization view">
          {options.choices.map((choice) => {
            const active = adapter === choice.id;
            const stateText =
              choice.state === "waiting"
                ? "Not enough evidence at this step"
                : choice.available
                  ? ""
                  : "Unavailable";
            const stateClass =
              choice.state === "waiting"
                ? " waiting"
                : choice.state === "error"
                  ? " error"
                  : choice.available
                    ? ""
                    : " unavailable";
            return (
              <button
                key={choice.id}
                type="button"
                className={`view-choice${active ? " on" : ""}${stateClass}`}
                aria-pressed={active}
                title={choice.reason ?? choice.description}
                onClick={() => {
                  onAdapterChange?.(choice.id);
                  close();
                }}
              >
                <span className="view-choice-name">
                  {choice.label}
                  {choice.recognized ? <span className="view-choice-tag">auto</span> : null}
                  {stateText ? <span className="view-choice-state">{stateText}</span> : null}
                </span>
                <span className="view-choice-note">{choiceNote(choice)}</span>
              </button>
            );
          })}
        </div>
        <p className="view-menu-note">
          <strong>{autoLead}.</strong> {recognitionText}
        </p>
        {autoChoice?.reason ? <p className="view-menu-note">{autoChoice.reason}</p> : null}
        <p className="view-menu-note view-menu-foot" title={title ?? undefined}>
          {adapter === AUTO_ADAPTER
            ? `At this step Auto is using ${adapterLabel(effective)}.`
            : `Manual view: ${adapterLabel(adapter)}. At this step it is using ${adapterLabel(
                effective,
              )}. Auto would use ${adapterLabel(options.recognitionId)}.`}
        </p>
      </div>
    </details>
  );
}

export default function AdaptiveView({
  adaptive,
  trace,
  result,
  onJumpLine,
  onJumpCall,
  onSelectFrame,
}) {
  const options = adaptive?.options ?? null;
  const built = adaptive?.built ?? null;

  if (!result || !Array.isArray(trace) || trace.length === 0) {
    return <EmptyState result={result} />;
  }
  if (!options) {
    return <p className="scene-empty">The selected step has no scene.</p>;
  }

  const effective = built?.adapterId ?? "generic";
  const requested = built?.requestedAdapterId ?? options.recognitionId;
  const title = fallbackTitle(built, options);

  return (
    <div className="adaptive-view">
      {/* A fallback is worth a line, never a second chooser. */}
      {built?.validation?.valid === false ? (
        <p className="scene-fallback">
          <strong className="scene-fallback-label">Scene validation failed</strong>
          The scene did not pass validation, so it was not drawn.{" "}
          {built.validation.errors?.slice(0, 2).join("; ")}
        </p>
      ) : title ? (
        <p className="scene-fallback">
          <strong className="scene-fallback-label">{title}</strong>
          {requested === effective
            ? built.fallbackReason
            : `${adapterLabel(effective)} shown instead of ${adapterLabel(
                requested,
              )}: ${built.fallbackReason}`}
        </p>
      ) : null}

      {built && built.validation?.valid !== false ? (
        <SceneView
          scene={built.scene}
          onJumpLine={onJumpLine}
          onJumpCall={onJumpCall}
          onSelectFrame={onSelectFrame}
        />
      ) : built ? (
        <p className="scene-empty">
          The scene did not pass validation, so it was not drawn.
        </p>
      ) : (
        <p className="scene-empty">The selected step has no scene.</p>
      )}
    </div>
  );
}
