import { useLayoutEffect, useMemo, useRef } from "react";

import { MOTION_ARC, MOTION_EASING, moveKeyframes } from "./choreography.js";
import { createMotionController, motionTargetKey } from "./plan.js";
import { motionView } from "./view.js";
import "./motion.css";

const EXIT_MS = 180;

function registerIn(map, key, node) {
  if (node) map.current.set(key, node);
  else map.current.delete(key);
}

function classNames(...parts) {
  return parts.filter(Boolean).join(" ");
}

function cellKey(objectId, index) {
  return motionTargetKey({ kind: "cell", objectId, index });
}

/** The short name a ghost keeps while it animates away. */
function ghostName(ghost) {
  const node = ghost.node;
  switch (ghost.kind) {
    case "frame":
      return node.function;
    case "object":
      return node.label;
    case "variable":
      return node.name;
    case "cell":
      return `[${node.index}]`;
    case "entry":
      return node.container === "set" ? "" : node.label;
    case "attribute":
      return node.label;
    default:
      return node.label ?? "";
  }
}

function ghostValue(ghost) {
  if (ghost.kind === "object") return ghost.node.objectType;
  if (ghost.kind === "frame") {
    return ghost.node.callLine === null ? "frame" : `line ${ghost.node.callLine}`;
  }
  return ghost.node.text ?? "";
}

function Value({ node }) {
  return (
    <span className="motion-value" data-type={node.valueType}>
      {node.text}
      {node.refId ? (
        <span className="motion-ref" title={`reference to ${node.refId}`}>
          ref
        </span>
      ) : null}
    </span>
  );
}

function Slot({ slot, registerNode }) {
  const keyed =
    slot.kind === "attribute" || (slot.kind === "entry" && slot.container !== "set");
  return (
    <div
      ref={registerNode}
      className={classNames(
        "motion-slot",
        `motion-slot-${slot.kind}`,
        slot.kind === "cell" && "motion-cell",
        slot.changed && "is-changed",
        slot.highlighted && "is-highlighted",
        slot.active && "is-active",
        slot.settled && "is-settled",
        slot.entering && "is-entering",
      )}
      data-key={slot.key}
    >
      {slot.kind === "cell" ? (
        <>
          <span className="motion-cell-value" title={slot.text}>
            <Value node={slot} />
          </span>
          <span className="motion-cell-index">{slot.index}</span>
        </>
      ) : (
        <>
          {keyed ? <span className="motion-slot-key">{slot.label}</span> : null}
          <Value node={slot} />
        </>
      )}
    </div>
  );
}

function ObjectCard({ object, registerNode, registerSlot }) {
  return (
    <article
      ref={registerNode}
      className={classNames(
        "motion-object",
        (object.type === "list" || object.type === "tuple") && "is-sequence",
        object.highlighted && "is-highlighted",
        object.entering && "is-entering",
      )}
      data-key={object.key}
    >
      <header className="motion-object-head">
        <span className="motion-object-label" title={object.objectId}>
          {object.label}
        </span>
        <span className="motion-object-type">{object.objectType}</span>
      </header>
      {object.slots.length > 0 ? (
        <div className={classNames("motion-slots", `slots-${object.type}`)}>
          {object.slots.map((slot) => (
            <Slot
              key={slot.key}
              slot={slot}
              registerNode={(node) => registerSlot(slot.key, node)}
            />
          ))}
        </div>
      ) : (
        <p className="motion-object-empty">No visible contents</p>
      )}
      {object.more > 0 ? (
        <p className="motion-object-more">+{object.more} more</p>
      ) : null}
    </article>
  );
}

function FrameCard({ frame, registerNode, registerVariable }) {
  return (
    <article
      ref={registerNode}
      className={classNames(
        "motion-frame",
        frame.current && "is-current",
        frame.highlighted && "is-highlighted",
        frame.entering && "is-entering",
      )}
      data-key={frame.key}
    >
      <header className="motion-frame-head">
        <span className="motion-fn">{frame.function}</span>
        {frame.callLine === null ? null : (
          <span className="motion-frame-line">line {frame.callLine}</span>
        )}
      </header>
      {frame.variables.length > 0 ? (
        <div className="motion-vars">
          {frame.variables.map((variable) => (
            <span
              key={variable.key}
              ref={(node) => registerVariable(variable.key, node)}
              className={classNames(
                "motion-var",
                variable.changed && "is-changed",
                variable.highlighted && "is-highlighted",
                variable.entering && "is-entering",
              )}
              data-key={variable.key}
            >
              <span className="motion-var-name">{variable.name}</span>
              <Value node={variable} />
            </span>
          ))}
        </div>
      ) : (
        <p className="motion-frame-empty">No local variables</p>
      )}
    </article>
  );
}

/**
 * The real data canvas: persistent cards and cells keyed by the plan's stable
 * identities, with Web Animations for the verified enter/exit/value/move
 * operations. It owns measurements and animation handles only. It never calls
 * the session, so an animation finishing can never move the execution cursor.
 *
 * @param {{plan: Object|null}} props
 */
export default function MotionStage({ plan }) {
  const view = useMemo(() => motionView(plan), [plan]);
  const stageRef = useRef(null);
  const nodeRefs = useRef(new Map());
  const ghostRefs = useRef(new Map());
  const positions = useRef(new Map());
  const animations = useRef([]);
  const controller = useRef(createMotionController());

  useLayoutEffect(() => {
    const motionController = controller.current;

    // Measure before cancelling. A running animation holds a transform, so this
    // is where each element actually is; cancelling first would snap an
    // interrupted move back to its layout slot and the next step would jump.
    // The stored map also keeps the last rect of elements that just left the
    // DOM, so their ghost can fade out from where it really was.
    const previousRects = new Map(positions.current);
    for (const [key, element] of nodeRefs.current) {
      if (element?.isConnected) previousRects.set(key, element.getBoundingClientRect());
    }

    // One plan owns the canvas at a time: every effect cancels the previous
    // set before it starts its own, so a burst of steps at high speed replaces
    // animations instead of queueing them, and a stale completion cannot settle
    // the controller or move the cursor.
    const cancelAll = () => {
      const running = animations.current;
      animations.current = [];
      for (const animation of running) {
        try {
          animation.cancel();
        } catch {
          // A finished animation is already gone.
        }
      }
    };
    cancelAll();

    const ticket = motionController.request(plan);
    const body = stageRef.current;
    if (!plan || !view || !body) {
      positions.current = new Map();
      return undefined;
    }

    const bodyRect = body.getBoundingClientRect();
    const currentRects = new Map();
    for (const [key, element] of nodeRefs.current) {
      if (element?.isConnected) currentRects.set(key, element.getBoundingClientRect());
    }
    positions.current = previousRects;

    for (const element of ghostRefs.current.values()) {
      element.style.visibility = "hidden";
    }

    if (!view.animate) {
      return () => {
        cancelAll();
        motionController.invalidate();
      };
    }

    const play = (element, frames, options = {}) => {
      if (!element?.animate) return null;
      const animation = element.animate(frames, {
        duration: Math.max(1, Math.round(options.duration ?? view.durationMs ?? 1)),
        easing: options.easing ?? MOTION_EASING.move,
      });
      animations.current.push(animation);
      animation.finished
        .then(() => motionController.complete(ticket))
        .catch(() => {});
      return animation;
    };

    const explicit = new Set();
    const animateMove = (key, fromRect, arc = 0) => {
      if (!fromRect || explicit.has(key)) return;
      const element = nodeRefs.current.get(key);
      const toRect = currentRects.get(key);
      if (!element || !toRect) return;
      // The start frame is the live measurement, so an interrupted move keeps
      // the position the eye last saw; the end frame is the layout slot, so the
      // element always lands exactly where the recorded state puts it.
      const frames = moveKeyframes(fromRect.left - toRect.left, fromRect.top - toRect.top, {
        arc,
      });
      if (!frames) return;
      explicit.add(key);
      play(element, frames);
    };

    for (const move of view.moves) {
      if (!Array.isArray(move.indices)) continue;
      if (move.motion === "swap" && move.indices.length === 2) {
        const [i, j] = move.indices;
        // Both cells travel opposite ways with the same duration and easing, so
        // the arc's side falls out of the direction and they curve past each
        // other instead of overlapping on one path.
        animateMove(
          cellKey(move.objectId, i),
          previousRects.get(cellKey(move.objectId, j)),
          MOTION_ARC.swap,
        );
        animateMove(
          cellKey(move.objectId, j),
          previousRects.get(cellKey(move.objectId, i)),
          MOTION_ARC.swap,
        );
      } else if (move.motion === "shift" && move.indices.length === 2) {
        const [origin, destination] = move.indices;
        animateMove(
          cellKey(move.objectId, destination),
          previousRects.get(cellKey(move.objectId, origin)),
        );
      }
    }

    // Structural cell actions reindex the list's positional keys. The action's
    // recorded index is the only mapping we use; we never guess where a value
    // "moved" from its value alone.
    for (const operation of plan.operations) {
      const action = operation.action;
      if (action?.target?.kind !== "cell") continue;
      const { objectId, index } = action.target;
      const object = view.objects.find((candidate) => candidate.objectId === objectId);
      if (!object) continue;
      if (operation.op === "enter" && action.kind === "grow" && action.motion === "insert") {
        for (const slot of object.slots) {
          if (slot.index > index) {
            animateMove(slot.key, previousRects.get(cellKey(objectId, slot.index - 1)));
          }
        }
      } else if (operation.op === "exit" && action.kind === "shrink") {
        for (const slot of object.slots) {
          if (slot.index >= index) {
            animateMove(slot.key, previousRects.get(cellKey(objectId, slot.index + 1)));
          }
        }
      }
    }

    const entering = new Set(view.entering);
    for (const key of entering) {
      const element = nodeRefs.current.get(key);
      if (!element) continue;
      play(
        element,
        [
          { opacity: 0, transform: "scale(0.96)" },
          { opacity: 1, transform: "scale(1)" },
        ],
        { easing: MOTION_EASING.enter },
      );
    }

    for (const key of view.changed) {
      if (entering.has(key)) continue;
      const element = nodeRefs.current.get(key);
      if (!element) continue;
      play(element, [{ opacity: 0.45 }, { opacity: 1 }], {
        duration: Math.min(view.durationMs || 180, 220),
        easing: MOTION_EASING.fade,
      });
    }

    // Keyed cards and frames keep their identity, so a normal FLIP is enough
    // when a sibling enters or leaves. Positional list cells are handled above
    // by the action's own indices.
    for (const [key, fromRect] of previousRects) {
      if (explicit.has(key) || entering.has(key)) continue;
      if (!key.startsWith("object:") && !key.startsWith("frame:")) continue;
      animateMove(key, fromRect);
    }

    for (const ghost of view.ghosts) {
      const element = ghostRefs.current.get(ghost.key);
      const fromRect = previousRects.get(ghost.key);
      if (!element || !fromRect) continue;
      element.style.visibility = "visible";
      element.style.left = `${fromRect.left - bodyRect.left + body.scrollLeft}px`;
      element.style.top = `${fromRect.top - bodyRect.top + body.scrollTop}px`;
      element.style.width = `${fromRect.width}px`;
      element.style.height = `${fromRect.height}px`;
      const animation = play(
        element,
        [
          { opacity: 1, transform: "scale(1)" },
          { opacity: 0, transform: "scale(0.94)" },
        ],
        { duration: EXIT_MS, easing: MOTION_EASING.fade },
      );
      if (animation) {
        animation.finished
          .then(() => {
            if (ghostRefs.current.get(ghost.key) === element) {
              element.style.visibility = "hidden";
            }
          })
          .catch(() => {});
      }
    }

    return () => {
      cancelAll();
      motionController.invalidate();
    };
  }, [plan, view]);

  if (!view) {
    return (
      <div className="motion-stage motion-empty">
        <p>Run the program to animate its values.</p>
      </div>
    );
  }

  return (
    <div className="motion-stage" ref={stageRef}>
      {/* One place for the step: which line ran, what it verifiably did, and the
          source itself. A comparison can sit beside the operation later without
          rearranging this block. */}
      <div className="motion-stage-head">
        {view.line === null ? null : <span className="motion-line">line {view.line}</span>}
        {view.feedback ? (
          <span className={`motion-event is-${view.feedback.kind}`} title={view.feedback.text}>
            {view.feedback.text}
          </span>
        ) : null}
        {view.lineText ? (
          <code className="motion-source" title={view.lineText}>
            {view.lineText}
          </code>
        ) : null}
      </div>

      {view.frames.length > 0 ? (
        <section className="motion-frames" aria-label="Active calls">
          {view.frames.map((frame) => (
            <FrameCard
              key={frame.key}
              frame={frame}
              registerNode={(node) => registerIn(nodeRefs, frame.key, node)}
              registerVariable={(key, node) => registerIn(nodeRefs, key, node)}
            />
          ))}
        </section>
      ) : null}

      {view.objects.length > 0 ? (
        <section className="motion-objects" aria-label="Values">
          {view.objects.map((object) => (
            <ObjectCard
              key={object.key}
              object={object}
              registerNode={(node) => registerIn(nodeRefs, object.key, node)}
              registerSlot={(key, node) => registerIn(nodeRefs, key, node)}
            />
          ))}
        </section>
      ) : (
        <p className="motion-no-values">No list, dictionary, set or object values at this step.</p>
      )}

      {view.ghosts.length > 0 ? (
        <div className="motion-ghost-layer" aria-hidden="true">
          {view.ghosts.map((ghost) => (
            <div
              key={`${ghost.kind}:${ghost.key}`}
              ref={(node) => registerIn(ghostRefs, ghost.key, node)}
              className={classNames(
                "motion-ghost",
                `ghost-${ghost.kind}`,
                ghost.active && "is-active",
              )}
            >
              <span className="motion-ghost-name">{ghostName(ghost)}</span>
              <span className="motion-ghost-value">{ghostValue(ghost)}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
