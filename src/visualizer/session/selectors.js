// Read-side access to the execution session. These are pure, so tests can prove
// that the step, the call selection and the output all come from one cursor.

import { getStepView } from "../../tracer/stepView.js";
import { getTraceIndex } from "../../tracer/traceIndex.js";
import { outputView } from "../output.js";
import { clampStep } from "../workspace.js";

export function selectTrace(session) {
  return Array.isArray(session?.result?.trace) ? session.result.trace : [];
}

/** The shared per-trace lookup tables; the same trace always gets the same index. */
export function selectTraceIndex(session) {
  return getTraceIndex(selectTrace(session));
}

export function selectStepIndex(session) {
  return clampStep(session?.index ?? 0, selectTrace(session).length);
}

export function selectStepView(session, { steps = null } = {}) {
  return getStepView(selectTrace(session), selectStepIndex(session), selectRunSource(session), {
    frameId: session?.selectedFrameId ?? null,
    steps,
  });
}

/** The source the shown run was made from, even after the editor moved on. */
export function selectRunSource(session) {
  return typeof session?.runSource === "string" ? session.runSource : session?.source ?? "";
}

export function selectOutput(session) {
  return outputView(selectTrace(session), selectStepIndex(session), session?.result ?? null);
}

export function selectProfile(session) {
  return session?.profile ?? null;
}

export function selectRecognition(session) {
  return session?.recognition ?? null;
}

export function selectAdapter(session) {
  return session?.adapter ?? "auto";
}

/** True when the editor text no longer matches the source of the shown run. */
export function selectSourceDirty(session) {
  return (
    Boolean(session?.result) &&
    typeof session?.runSource === "string" &&
    session.runSource !== session?.source
  );
}
