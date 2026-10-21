// Stable adapter registry. Adapters are pure objects: metadata, an availability
// check, and a scene builder. Nothing here imports React or chooses a layout.
//
// Every build is validated before it is returned. A specialized adapter cannot
// bypass the scene contract: if its scene is malformed, the registry uses the
// generic adapter and reports why in `fallbackReason`.

import { GENERIC_ADAPTER } from "./genericAdapter.js";
import { RECURSION_ADAPTER } from "./recursionAdapter.js";
import { SEARCHING_ADAPTER } from "./searchingAdapter.js";
import { SORTING_ADAPTER } from "./sortingAdapter.js";
import {
  SCENE_EVIDENCE_SOURCES,
  SCENE_KIND,
  SCENE_VERSION,
  validateScene,
} from "./scene.js";

const GENERIC = "generic";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isString(value) {
  return typeof value === "string";
}

function requireText(value, name) {
  if (!isString(value) || value.length === 0) {
    throw new TypeError(`adapter ${name} must be a non-empty string`);
  }
}

function copyAdapter(adapter) {
  if (!isObject(adapter)) throw new TypeError("adapter must be an object");
  requireText(adapter.id, "id");
  requireText(adapter.label, "label");
  requireText(adapter.description, "description");
  if (!Array.isArray(adapter.capabilities) || adapter.capabilities.length === 0) {
    throw new TypeError(`adapter "${adapter.id}" must declare at least one capability`);
  }
  const capabilities = [];
  for (const capability of adapter.capabilities) {
    requireText(capability, `capability of "${adapter.id}"`);
    if (capabilities.includes(capability)) {
      throw new TypeError(`adapter "${adapter.id}" declares "${capability}" twice`);
    }
    capabilities.push(capability);
  }
  if (typeof adapter.availability !== "function") {
    throw new TypeError(`adapter "${adapter.id}" needs an availability function`);
  }
  if (typeof adapter.build !== "function") {
    throw new TypeError(`adapter "${adapter.id}" needs a build function`);
  }
  return Object.freeze({ ...adapter, capabilities: Object.freeze(capabilities) });
}

function recognitionView(recognition) {
  if (!isObject(recognition) || !isString(recognition.adapterId)) return null;
  return {
    adapterId: recognition.adapterId,
    confidence:
      typeof recognition.confidence === "number" && Number.isFinite(recognition.confidence)
        ? recognition.confidence
        : 0,
    unavailableReason: isString(recognition.unavailableReason)
      ? recognition.unavailableReason
      : null,
  };
}

function lastResortScene(requestedAdapterId, context, reason) {
  const view = isObject(context?.stepView) ? context.stepView : null;
  const recognition = recognitionView(context?.recognition);
  const evidence = Array.isArray(context?.recognition?.evidence)
    ? context.recognition.evidence.filter(
        (item) =>
          isObject(item) &&
          SCENE_EVIDENCE_SOURCES.includes(item.source) &&
          isString(item.kind) &&
          isString(item.detail),
      )
    : [];
  return {
    version: SCENE_VERSION,
    kind: SCENE_KIND,
    adapterId: GENERIC,
    status: "unsupported",
    title: "Visualization unavailable",
    subtitle: "Safe fallback",
    capabilities: [GENERIC],
    sourceLine: null,
    focus: null,
    highlights: [],
    regions: [],
    changes: [],
    accessibility: {
      label: "Visualization unavailable",
      summary: reason,
    },
    evidence: [
      { source: "adapter", kind: "last_resort", detail: reason },
      ...evidence,
    ],
    unsupportedReason: reason,
    meta: {
      stepIndex: view?.event ? view.index : null,
      eventKind: view?.kind ?? null,
      function: view?.function ?? null,
      frameId: view?.frameId ?? null,
      truncated: false,
      requestedAdapterId,
      recognition,
    },
  };
}

function errorText(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Create an immutable registry with the generic adapter always present.
 * Duplicate or malformed adapters fail at construction, not at render time.
 */
export function createAdapterRegistry(adapters = [GENERIC_ADAPTER]) {
  if (!Array.isArray(adapters)) throw new TypeError("adapters must be an array");
  const byId = new Map();
  for (const adapter of adapters) {
    const copy = copyAdapter(adapter);
    if (byId.has(copy.id)) throw new TypeError(`duplicate adapter id "${copy.id}"`);
    byId.set(copy.id, copy);
  }
  if (!byId.has(GENERIC)) byId.set(GENERIC, GENERIC_ADAPTER);
  const ids = Object.freeze([...byId.keys()].sort());
  const list = Object.freeze(ids.map((id) => byId.get(id)));
  const generic = byId.get(GENERIC);

  function buildWith(adapter, requestedAdapterId, context) {
    const buildContext = { ...context, requestedAdapterId };
    try {
      const scene = adapter.build(buildContext);
      const validation = validateScene(scene, {
        ...buildContext,
        adapterId: adapter.id,
      });
      return { scene, validation, error: null };
    } catch (error) {
      return { scene: null, validation: null, error: errorText(error) };
    }
  }

  const registry = {
    get(id) {
      return byId.get(id) ?? null;
    },
    has(id) {
      return byId.has(id);
    },
    ids() {
      return ids;
    },
    list() {
      return list;
    },
    byCapability(capability) {
      if (!isString(capability) || capability.length === 0) return Object.freeze([]);
      return Object.freeze(list.filter((adapter) => adapter.capabilities.includes(capability)));
    },
    matching(capabilities) {
      if (!Array.isArray(capabilities)) return Object.freeze([]);
      const wanted = new Set(capabilities.filter((item) => isString(item) && item.length > 0));
      if (wanted.size === 0) return Object.freeze([]);
      return Object.freeze(
        list.filter((adapter) => adapter.capabilities.some((item) => wanted.has(item))),
      );
    },
    build(requestedAdapterId, context = {}) {
      const requested = isString(requestedAdapterId) && requestedAdapterId.length > 0
        ? requestedAdapterId
        : GENERIC;
      let fallbackReason = null;
      let adapter = byId.get(requested);
      if (!adapter) {
        fallbackReason = `adapter "${requested}" is not registered; using the generic adapter`;
        adapter = generic;
      } else {
        let availability = null;
        try {
          availability = adapter.availability(context);
        } catch (error) {
          fallbackReason = `adapter "${adapter.id}" could not check availability: ${errorText(error)}`;
          adapter = generic;
        }
        const available = availability === true || availability?.available === true;
        if (adapter !== generic && !available) {
          fallbackReason =
            isString(availability?.reason) && availability.reason.length > 0
              ? availability.reason
              : `adapter "${adapter.id}" is not available for this step`;
          adapter = generic;
        }
      }

      let built = buildWith(adapter, requested, context);
      if (adapter !== generic && !built.validation?.valid) {
        const why = built.error
          ? built.error
          : built.validation?.errors?.slice(0, 3).join("; ") || "the scene is invalid";
        fallbackReason = `adapter "${adapter.id}" could not build a valid scene: ${why}`;
        adapter = generic;
        built = buildWith(generic, requested, context);
      }

      if (!built.validation?.valid) {
        const why = built.error
          ? built.error
          : built.validation?.errors?.slice(0, 3).join("; ") || "the scene is invalid";
        const reason = `the generic adapter could not build a valid scene: ${why}`;
        const scene = lastResortScene(requested, context, reason);
        let validation;
        try {
          validation = validateScene(scene, { ...context, adapterId: GENERIC });
        } catch (error) {
          validation = { valid: false, errors: [errorText(error)], scene };
        }
        return {
          scene,
          adapterId: GENERIC,
          requestedAdapterId: requested,
          fallbackReason: fallbackReason ?? reason,
          validation,
        };
      }

      return {
        scene: built.scene,
        adapterId: adapter.id,
        requestedAdapterId: requested,
        fallbackReason,
        validation: built.validation,
      };
    },
  };
  return Object.freeze(registry);
}

export const DEFAULT_REGISTRY = createAdapterRegistry([
  GENERIC_ADAPTER,
  RECURSION_ADAPTER,
  SEARCHING_ADAPTER,
  SORTING_ADAPTER,
]);
