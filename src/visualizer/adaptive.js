// Presentation-side adapter choice. The tracer registry owns the scenes and
// their validation; this module only answers which of its adapters to offer,
// what each one costs in availability at the selected step, and which adapter
// an automatic choice resolves to. It stays React-free so the same answers can
// be tested without a browser.

import { DEFAULT_REGISTRY } from "../tracer/adapters.js";

export const AUTO_ADAPTER = "auto";

export const ADAPTER_CHOICES = Object.freeze([
  {
    id: AUTO_ADAPTER,
    label: "Auto",
    description: "Use the adapter the recognizer chose from this program's profile and trace.",
  },
  {
    id: "generic",
    label: "Generic",
    description: "Show the selected step, variables, stack and heap without an algorithm claim.",
  },
  {
    id: "recursion",
    label: "Recursion",
    description: "Show the recursive calls the trace actually made.",
  },
  {
    id: "searching",
    label: "Searching",
    description: "Show a traced linear or binary search over its real sequence.",
  },
  {
    id: "sorting",
    label: "Sorting",
    description: "Show the real list state and the comparisons and writes the trace recorded.",
  },
]);

export const ADAPTER_IDS = Object.freeze(ADAPTER_CHOICES.map((entry) => entry.id));

/** Why a view can or cannot be drawn at the selected step. */
export const ADAPTER_STATE = Object.freeze({
  ready: "ready",
  waiting: "waiting",
  unsupported: "unsupported",
  unavailable: "unavailable",
  error: "error",
});

const LABELS = Object.freeze(
  Object.fromEntries(ADAPTER_CHOICES.map((entry) => [entry.id, entry.label])),
);

/** Recognition never depends on a variable or function name alone. */
const RECURSION_AVAILABILITY = new WeakMap();

export function isAdapterChoice(value) {
  return ADAPTER_IDS.includes(value);
}

export function adapterLabel(id) {
  return LABELS[id] ?? LABELS.generic;
}

/** The id Auto asks the registry for. Unknown or absent recognition is generic. */
export function autoAdapterId(recognition) {
  const id = recognition?.adapterId;
  return id === "generic" || DEFAULT_REGISTRY.has(id) ? id : "generic";
}

/** The adapter a click will request, whether the click was Auto or manual. */
export function requestedAdapterId(choice, recognition) {
  if (choice !== AUTO_ADAPTER && DEFAULT_REGISTRY.has(choice)) return choice;
  return autoAdapterId(recognition);
}

function availabilityOf(id, context) {
  if (id === "generic") return { available: true, reason: null };
  const adapter = DEFAULT_REGISTRY.get(id);
  if (!adapter) return { available: false, reason: `adapter "${id}" is not registered` };
  try {
    const answer = adapter.availability(context);
    const available = answer === true || answer?.available === true;
    return {
      available,
      error: false,
      reason:
        available
          ? null
          : typeof answer?.reason === "string" && answer.reason.length > 0
            ? answer.reason
            : `adapter "${id}" is not available for this step`,
    };
  } catch (error) {
    return {
      available: false,
      error: true,
      reason: `adapter "${id}" could not check availability: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
}

function recursionAvailability(context) {
  // The recursion adapter's availability only depends on the run, not on the
  // selected step. Cache it per trace and profile so playback does not rebuild
  // the call tree once per tick just to redraw the view chooser.
  const trace = context?.trace;
  if (!Array.isArray(trace) || trace.length === 0) return availabilityOf("recursion", context);
  const cached = RECURSION_AVAILABILITY.get(trace);
  if (cached && cached.profile === context.profile) return cached.value;
  const value = availabilityOf("recursion", context);
  RECURSION_AVAILABILITY.set(trace, { profile: context.profile, value });
  return value;
}

/**
 * The view choices for one selected step.
 *
 * Every registered specialized adapter is offered when its own availability
 * check passes, not only the one recognition picked. That is what lets merge
 * sort expose both Sorting and Recursion from one run. The why-reason for a
 * missing choice comes from the adapter itself, never from a name guess.
 */
export function adapterOptions(context = {}) {
  const recognitionId = autoAdapterId(context.recognition);
  const availableById = new Map();
  for (const id of ["recursion", "searching", "sorting"]) {
    availableById.set(
      id,
      id === "recursion" ? recursionAvailability(context) : availabilityOf(id, context),
    );
  }

  const choices = ADAPTER_CHOICES.map((choice) => {
    if (choice.id === AUTO_ADAPTER) {
      const target = availableById.get(recognitionId);
      if (recognitionId === "generic") {
        return {
          ...choice,
          available: true,
          state: ADAPTER_STATE.unsupported,
          recognized: false,
          target: recognitionId,
          reason:
            context.recognition?.unavailableReason ??
            "No specialized pattern is supported by both the profile and this trace.",
        };
      }
      if (!target?.available) {
        return {
          ...choice,
          available: true,
          state: target?.error ? ADAPTER_STATE.error : ADAPTER_STATE.waiting,
          recognized: false,
          target: recognitionId,
          reason: target?.error
            ? `Auto could not ask ${adapterLabel(recognitionId)} whether it is available: ${target.reason}`
            : `The program is recognized as ${adapterLabel(
                recognitionId,
              )}, but this selected step does not contain enough recorded state for it. Auto shows the validated Generic view.`,
        };
      }
      return {
        ...choice,
        available: true,
        state: ADAPTER_STATE.ready,
        recognized: false,
        target: recognitionId,
        reason: null,
      };
    }
    const status =
      choice.id === "generic"
        ? { available: true, error: false, reason: null }
        : availableById.get(choice.id);
    const state = status.available
      ? ADAPTER_STATE.ready
      : status.error
        ? ADAPTER_STATE.error
        : choice.id === recognitionId
          ? ADAPTER_STATE.waiting
          : ADAPTER_STATE.unavailable;
    return {
      ...choice,
      available: status.available,
      state,
      recognized: choice.id === recognitionId,
      reason: status.reason,
    };
  });

  return {
    recognitionId,
    choices,
    recognition: context.recognition ?? null,
  };
}

/** Build a scene for Auto or a manual choice. The registry validates it. */
export function buildAdaptiveScene(choice, context = {}) {
  const requested = requestedAdapterId(choice, context.recognition);
  const built = DEFAULT_REGISTRY.build(requested, {
    ...context,
    requestedAdapterId: requested,
  });
  return {
    ...built,
    choice: isAdapterChoice(choice) ? choice : AUTO_ADAPTER,
    requestedAdapterId: requested,
  };
}

/**
 * The chooser and the validated scene for one step. Kept here, not in App, so
 * the header and the canvas read the same build instead of building twice.
 */
export function resolveAdaptiveView(context = {}, choice = AUTO_ADAPTER) {
  const trace = Array.isArray(context.trace) ? context.trace : [];
  return {
    options: adapterOptions(context),
    built:
      trace.length > 0 && context.stepView?.event
        ? buildAdaptiveScene(choice, context)
        : null,
  };
}
