// The adaptive canvas: recognition, the supported view choices, and the
// validated scene for the selected step.
//
// Auto asks the registry for the adapter recognition chose. The alternatives
// are the adapters whose *own* availability checks pass at this step, so a
// merge sort can offer both Sorting and Recursion without pretending the
// recognizer picked both. Every build goes through the registry, which
// validates the scene and falls back to generic with a reason.

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

export default function AdaptiveView({
  adaptive,
  trace,
  result,
  adapter,
  onAdapterChange,
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

  return (
    <div className="adaptive-view">
      <div className="scene-chooser">
        <div
          className="scene-choice-strip"
          role="group"
          aria-label="Visualization view"
        >
          {options.choices.map((choice) => {
            const active = adapter === choice.id;
            const stateText =
              choice.state === "waiting"
                ? "Not enough evidence at this step"
                : choice.available
                  ? ""
                  : "Unavailable";
            const reason = stateText
              ? ` ${stateText}: ${choice.reason ?? "no reason was recorded"}`
              : "";
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
                className={`scene-choice${active ? " on" : ""}${stateClass}`}
                aria-pressed={active}
                aria-label={`${choice.label}${choice.recognized ? ", recognized" : ""}${reason}`}
                title={choice.reason ?? choice.description}
                onClick={() => onAdapterChange?.(choice.id)}
              >
                <span className="scene-choice-dot" aria-hidden="true" />
                {choice.label}
                {choice.recognized ? (
                  <span className="scene-choice-recognized" aria-hidden="true">
                    auto
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>

        <details className="scene-choice-why">
          <summary>Why these views?</summary>
          <p className="scene-recognition">
            <strong>{autoLead}</strong>
            <span>{recognitionText}</span>
          </p>
          {autoChoice?.reason ? <p className="scene-option-reason">{autoChoice.reason}</p> : null}
          <ul>
            {options.choices
              .filter((choice) => choice.id !== AUTO_ADAPTER)
              .map((choice) => (
                <li
                  key={choice.id}
                  className={choice.available ? "" : choice.state}
                >
                  <strong>{choice.label}</strong>
                  <span>{choiceNote(choice)}</span>
                </li>
              ))}
          </ul>
          <p className="scene-option-reason">
            {adapter === AUTO_ADAPTER
              ? `At this step Auto is using ${adapterLabel(effective)}.`
              : `Manual view: ${adapterLabel(adapter)}. At this step it is using ${adapterLabel(
                  effective,
                )}. Auto would use ${adapterLabel(options.recognitionId)}.`}
          </p>
        </details>
      </div>

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
