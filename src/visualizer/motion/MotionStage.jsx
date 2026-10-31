import { Fragment, useLayoutEffect, useMemo, useRef } from "react";

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

/** A primitive variable from the current call: name, value and type. */
function ScalarTile({ tile }) {
  return (
    <div
      className={classNames(
        "motion-scalar",
        tile.changed && "is-changed",
        tile.highlighted && "is-highlighted",
      )}
      data-key={tile.key}
    >
      <span className="motion-scalar-name">{tile.name}</span>
      <span className="motion-scalar-row">
        {tile.was !== null && tile.was !== tile.text ? (
          <span className="motion-scalar-was" title={`previous value ${tile.was}`}>
            {tile.was} →
          </span>
        ) : null}
        <span
          className="motion-value motion-scalar-value"
          data-type={tile.valueType}
          title={tile.text}
        >
          {tile.text}
        </span>
      </span>
      <span className="motion-scalar-type">{tile.typeName}</span>
    </div>
  );
}

/** The most recent named function return, kept apart from printed output. */
function ReturnTile({ returned }) {
  return (
    <div className="motion-return">
      <span className="motion-return-fn">{returned.function}() returned</span>
      <span
        className="motion-value motion-return-value"
        data-type={returned.valueType}
        title={returned.text}
      >
        {returned.text}
      </span>
    </div>
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
        slot.compare && "is-compare",
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

/** One recorded invocation: a readable frame in the vertical call stack. */
function FrameCard({ frame, registerNode, registerVariable }) {
  const stateLabel =
    frame.state === "active" ? "active" : frame.state === "returning" ? "returning" : "waiting";
  return (
    <article
      ref={registerNode}
      className={classNames(
        "motion-frame",
        `is-${frame.state}`,
        frame.highlighted && "is-highlighted",
        frame.entering && "is-entering",
      )}
      data-key={frame.key}
      style={{ "--frame-depth": Math.min(frame.depth, 6) }}
      aria-label={`${frame.function}, ${stateLabel}`}
    >
      <span className="motion-frame-rail" aria-hidden="true" />
      <div className="motion-frame-body">
        <header className="motion-frame-head">
          <span className="motion-fn">{frame.function}</span>
          <span className={`motion-frame-state is-${frame.state}`}>{stateLabel}</span>
          {frame.depth > 0 ? (
            <span className="motion-frame-depth" title={`call depth ${frame.depth}`}>
              depth {frame.depth}
            </span>
          ) : null}
          {frame.activeLine !== null ? (
            <span className="motion-frame-line" title="the line this call is running">
              line {frame.activeLine}
            </span>
          ) : frame.callLine !== null ? (
            <span className="motion-frame-line" title="the line that made this call">
              called at line {frame.callLine}
            </span>
          ) : null}
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
          <p className="motion-frame-empty">No local variables yet</p>
        )}
      </div>
      {frame.returned ? (
        <span className="motion-frame-return" title="the value this call returned">
          returns
          <Value
            node={{
              text: frame.returned.text ?? "a value",
              valueType: frame.returned.value?.type ?? "other",
              refId: frame.returned.value?.type === "ref" ? frame.returned.value.id : null,
            }}
          />
        </span>
      ) : null}
    </article>
  );
}

function structureNodeClass(node, extra = "") {
  return classNames(
    "motion-node",
    extra,
    node.active && "is-active",
    node.changed && "is-changed",
    node.entering && "is-entering",
  );
}

function StructureNode({ node, registerNode, showLinks }) {
  return (
    <article
      ref={registerNode}
      className={structureNodeClass(node)}
      data-key={node.key}
      aria-label={`node ${node.value}${node.active ? ", active" : ""}`}
    >
      {node.role && node.role !== "root" ? (
        <span className="motion-node-role">{node.role}</span>
      ) : null}
      <span className="motion-node-value motion-value" data-type={node.valueType}>
        {node.value}
      </span>
      <span className="motion-node-label">{node.label}</span>
      {node.attrs.length > 0 ? (
        <span className="motion-node-attrs">
          {node.attrs.map((attr) => (
            <span key={attr.name} className="motion-node-attr">
              {attr.name}={attr.text}
            </span>
          ))}
        </span>
      ) : null}
      {showLinks && node.links.length > 0 ? (
        <span className="motion-node-links">→ {node.links.join(" · ")}</span>
      ) : null}
    </article>
  );
}

/**
 * A chain, tree or graph the recorded references prove. Positions are stable
 * rows per depth, so an insertion never reshuffles the whole picture; a list is
 * one ordered row with real arrows between the nodes.
 */
function Structure({ structure, registerNode }) {
  if (structure.kind === "linked-list") {
    return (
      <section className="motion-structure is-linked" aria-label="Linked list">
        <span className="motion-structure-title">{structure.title}</span>
        <div className="motion-list-row">
          {structure.order.map((node, index) => (
            <Fragment key={node.key}>
              {index > 0 ? (
                <span className="motion-link-arrow" aria-hidden="true">
                  →
                </span>
              ) : null}
              <StructureNode
                node={node}
                showLinks={false}
                registerNode={(element) => registerNode(node.key, element)}
              />
            </Fragment>
          ))}
          {structure.cyclic ? (
            <span className="motion-link-arrow is-cycle" aria-hidden="true">
              ↺
            </span>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      className={classNames("motion-structure", `is-${structure.kind}`)}
      aria-label={structure.title}
    >
      <span className="motion-structure-title">{structure.title}</span>
      <div className="motion-levels">
        {structure.levels.map((level, depth) => (
          <div className="motion-level" key={depth}>
            {level.map((node) => (
              <StructureNode
                key={node.key}
                node={node}
                showLinks={structure.kind === "graph"}
                registerNode={(element) => registerNode(node.key, element)}
              />
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}

/**
 * The real data canvas: persistent cards and cells keyed by the plan's stable
 * identities, with Web Animations for the verified enter/exit/value/move
 * operations. It owns measurements and animation handles only. It never calls
 * the session, so an animation finishing can never move the execution cursor.
 *
 * @param {{plan: Object|null, trace?: Array, result?: Object|null}} props
 */
export default function MotionStage({ plan, trace = [], result = null }) {
  const view = useMemo(() => motionView(plan, { trace, result }), [plan, trace, result]);
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
    // This is also why the previous effect's cleanup only invalidates the
    // controller: cancelling there would run before these measurements and undo
    // the whole point. The stored map keeps the last rect of elements that just
    // left the DOM, so their ghost can fade out from where it really was.
    const previousRects = new Map(positions.current);
    for (const [key, element] of nodeRefs.current) {
      if (element?.isConnected) previousRects.set(key, element.getBoundingClientRect());
    }

    // One plan owns the canvas at a time: every effect cancels the previous
    // set - after measuring - before it starts its own, so a burst of steps at
    // high speed replaces animations instead of queueing them, and a stale
    // completion cannot settle the controller or move the cursor.
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
      return () => motionController.invalidate();
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

    return () => motionController.invalidate();
  }, [plan, view]);

  if (!view) {
    return (
      <div className="motion-stage motion-empty">
        <p>Run the program to animate its values.</p>
      </div>
    );
  }

  const hasValues = view.scalars.length > 0 || view.objects.length > 0 || Boolean(view.lastReturn);
  const showEmpty = !hasValues && !view.output && !view.ending;
  // The call frames already list every local, so scalar tiles are only added
  // when there is no collection for them to compete with.
  const showScalars = view.scalars.length > 0 && view.objects.length === 0 && !view.structure;
  // Objects drawn as a chain/tree/graph are one composition, not separate
  // cards; an adjacency list is part of the edges, not a card of its own.
  const drawn = view.structure
    ? new Set([...view.structure.objectIds, ...(view.structure.auxiliaryIds ?? [])])
    : null;
  const cardObjects = drawn
    ? view.objects.filter((object) => !drawn.has(object.objectId))
    : view.objects;
  // A single module frame above a collection is context, not the subject; keep
  // it on one line so the values it explains keep the room.
  const compactFrames = cardObjects.length > 0 && view.frames.length <= 1;
  // The active call is the subject, so it leads the stack; parents follow
  // below in call order. This also keeps the active frame on screen without
  // scrolling when recursion is deep.
  const stack = [...view.frames].reverse();

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
        <section
          className={classNames("motion-frames", compactFrames && "is-compact")}
          aria-label="Call stack"
        >
          <span className="motion-frames-label">
            Call stack
            <span className="motion-frames-count">
              {view.frames.length + view.framesHidden} {view.frames.length + view.framesHidden === 1 ? "call" : "calls"}
            </span>
          </span>
          {stack.map((frame) => (
            <FrameCard
              key={frame.key}
              frame={frame}
              registerNode={(node) => registerIn(nodeRefs, frame.key, node)}
              registerVariable={(key, node) => registerIn(nodeRefs, key, node)}
            />
          ))}
          {view.framesHidden > 0 ? (
            <span className="motion-frames-more">
              +{view.framesHidden} earlier calls not shown. The Inspector lists them all.
            </span>
          ) : null}
        </section>
      ) : null}

      {/* The data and the sentence about it are one group, so the explanation
          sits directly under the array instead of at the foot of the canvas. */}
      <div className="motion-data">
        {view.lastReturn ? <ReturnTile returned={view.lastReturn} /> : null}

        {showScalars ? (
          <section className="motion-scalars" aria-label="Values">
            {view.scalars.map((tile) => (
              <ScalarTile key={tile.key} tile={tile} />
            ))}
          </section>
        ) : null}
        {showScalars && view.scalarsHidden > 0 ? (
          <p className="motion-scalars-more">
            +{view.scalarsHidden} more in the Variables tab
          </p>
        ) : null}

        {view.structure ? (
          <Structure
            structure={view.structure}
            registerNode={(key, element) => registerIn(nodeRefs, key, element)}
          />
        ) : null}

        {cardObjects.length > 0 ? (
          <section className="motion-objects" aria-label="Values">
            {cardObjects.map((object) => (
              <ObjectCard
                key={object.key}
                object={object}
                registerNode={(node) => registerIn(nodeRefs, object.key, node)}
                registerSlot={(key, node) => registerIn(nodeRefs, key, node)}
              />
            ))}
          </section>
        ) : null}

        {showEmpty ? (
          <div className="motion-no-values">
            <span className="motion-empty-title">
              {view.intro?.title ?? "No data change at this step"}
            </span>
            <p>
              {view.intro?.detail ??
                (view.lineText
                  ? `Line ${view.line}: ${view.lineText}`
                  : view.feedback?.text ?? "The recording shows no drawable values here.")}
            </p>
          </div>
        ) : null}

        {view.explanation ? <p className="motion-explain">{view.explanation}</p> : null}
      </div>

      {view.output ? (
        <section className="motion-output" aria-label="Program output">
          <span className="motion-output-label">Output</span>
          <pre className="motion-output-text">{view.output}</pre>
        </section>
      ) : null}

      {view.ending ? (
        <section className={classNames("motion-result", `is-${view.ending.id}`)} aria-label="Result">
          <span className="motion-result-status">{view.ending.label}</span>
          {view.ending.detail ? (
            <span className="motion-result-detail">{view.ending.detail}</span>
          ) : null}
          {view.output ? null : <span className="motion-result-note">No output</span>}
        </section>
      ) : null}

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
