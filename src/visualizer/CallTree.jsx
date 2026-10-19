import { useMemo, useState } from "react";
import { buildCallTree, callStatus, onlyModule } from "../flowchart/callTree.js";
import { LINE_H, PAD_X, PAD_Y, layoutCallTree, linkPath } from "../flowchart/callTreeLayout.js";
import Canvas from "./Canvas.jsx";

/** Baseline of label line `i`, matched to the box height in the layout. */
const baseline = (i) => PAD_Y + 12 + i * LINE_H;

/** Shared empty set, so "nothing folded by hand" is a stable value. */
const EMPTY_SET = new Set();

const STATUS_TEXT = {
  running: "is running now",
  waiting: "has started and is waiting for the call it made",
  done: "already finished",
  failed: "stopped because an exception propagated out of it",
  future: "has not started yet",
};

/**
 * The call tree: one box per call the run really made, nested under the call
 * that made it, drawn top to bottom.
 *
 * Everything on screen comes from the trace — the parent of a frame is the
 * frame underneath it on the real stack, the arguments were captured when the
 * frame was first seen, and the value under a box is the `return` event's own
 * value. A program that never called a function draws its module frame and
 * nothing else: no branch is ever invented.
 *
 * The drawing itself does not depend on the current step, so boxes never move
 * while the learner steps; only their status classes change, which is what
 * lets the return-value chip fade in on the step the return actually happened.
 *
 * @param {Object} props
 * @param {Array} props.trace the trace from docs/trace-format.md
 * @param {string} props.source the user's code, for argument names and labels
 * @param {number} props.index which trace step is current
 * @param {number|null} props.currentFrameId the frame executing at that step
 * @param {(frameId: number) => void} props.onJumpCall called when a call is clicked
 * @param {string} [props.note] what to say when the code never ran
 */
export default function CallTree({
  trace,
  source,
  index,
  currentFrameId = null,
  onJumpCall,
  note = null,
}) {
  const tree = useMemo(() => buildCallTree(trace, source), [trace, source]);
  // Calls the learner folded by hand. A new run starts with none folded, which
  // is derived from the tree's identity rather than reset in an effect.
  const [foldState, setFoldState] = useState(() => ({ tree, set: EMPTY_SET }));
  const folded = foldState.tree === tree ? foldState.set : EMPTY_SET;
  const toggleFold = (frameId) => {
    setFoldState((current) => {
      const set = new Set(current.tree === tree ? current.set : EMPTY_SET);
      if (set.has(frameId)) set.delete(frameId);
      else set.add(frameId);
      return { tree, set };
    });
  };

  const laid = useMemo(() => layoutCallTree(tree, { collapsed: folded }), [tree, folded]);
  const boxesById = useMemo(() => new Map(laid.boxes.map((box) => [box.id, box])), [laid]);

  const statuses = useMemo(() => {
    const map = new Map();
    for (const node of tree.nodes) map.set(node.frameId, callStatus(node, index, currentFrameId));
    return map;
  }, [tree, index, currentFrameId]);

  // The value travelling back up: the most recent return the run has reached,
  // shown on the connector into its caller. One at a time, so a chain of
  // returns reads as the value climbing the tree rather than as decoration.
  const risingValue = useMemo(() => {
    let best = null;
    for (const node of tree.nodes) {
      if (node.parentId == null || node.returnIndex == null) continue;
      if (node.returnIndex > index) continue;
      if (!best || node.returnIndex > best.returnIndex) best = node;
    }
    return best;
  }, [tree, index]);

  const raisingFrameId =
    trace[index]?.event === "exception" ? (trace[index].frame_id ?? null) : null;

  // The frame running now, or the nearest drawn call above it when a learner
  // has folded it — the view always has somewhere real to centre.
  const subject = useMemo(() => {
    let id = currentFrameId;
    const seen = new Set();
    while (id != null && !seen.has(id)) {
      seen.add(id);
      const box = boxesById.get(id);
      if (box) return box;
      id = tree.byId.get(id)?.parentId ?? null;
    }
    return null;
  }, [boxesById, tree, currentFrameId]);
  const onlyTop = onlyModule(tree);

  const label = describe(trace, index, tree, currentFrameId);

  const empty = (
    <p className="viz-hint">
      {trace.length === 0
        ? "Run your code to see every call it makes, nested under the call that made it."
        : "Nothing to draw yet."}
    </p>
  );

  return (
    <Canvas
      bounds={{ width: laid.width, height: laid.height }}
      subject={subject}
      hasContent={laid.ready}
      layoutKey={laid}
      label={label}
      empty={empty}
      note={note}
      caption={
        onlyTop && trace.length > 0 ? (
          <span className="viz-caption-note">
            This run never left the top level, so the only call is the module itself.
          </span>
        ) : null
      }
      tools={
        folded.size > 0 ? (
          <button
            type="button"
            onClick={() => setFoldState({ tree, set: EMPTY_SET })}
            title="Open every call again"
          >
            Expand<span className="viz-wide"> all</span>
          </button>
        ) : null
      }
      legend={<Legend />}
    >
      {() => (
        <>
          <g className="ct-links" aria-hidden="true">
            {laid.links.map((link) => {
              const child = tree.byId.get(link.toId);
              const childStatus = child ? (statuses.get(child.frameId) ?? "future") : "future";
              const rising = child && risingValue ? risingValue.frameId === child.frameId : false;
              const midY = (link.points[0].y + (link.points[1]?.y ?? link.points[0].y)) / 2;
              return (
                <g
                  key={link.id}
                  className={`ct-link ct-link-${childStatus}${rising ? " ct-link-rising" : ""}`}
                >
                  <path className="ct-link-line" d={linkPath(link.points)} />
                  {/* The value stays in the DOM and only changes opacity, so the
                      fade is a real transition rather than a node appearing. */}
                  {child?.returnText ? (
                    <text
                      className="ct-link-value"
                      x={link.points[0].x + 7}
                      y={midY - 4}
                    >
                      {child.returnText}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>

          {laid.boxes.map((box) => {
            const status = statuses.get(box.id) ?? "future";
            const isCurrent = box.id === currentFrameId;
            const isRaising = raisingFrameId != null && box.id === raisingFrameId;
            const done = status === "done" || status === "failed";
            const readout = `${box.label}: ${STATUS_TEXT[status]}${
              done && box.value ? ` ${box.value}` : ""
            }`;
            return (
              <g key={box.id}>
                <g
                  className={[
                    "ct-node",
                    `ct-${status}`,
                    isCurrent && "ct-current",
                    isRaising && "ct-raising",
                  ]
                    .filter(Boolean)
                    .join(" ")}
                  transform={`translate(${box.x} ${box.y})`}
                  role="button"
                  tabIndex={0}
                  aria-label={`${readout}. Jump to the step this call started at.`}
                  onClick={(event) => {
                    event.stopPropagation();
                    onJumpCall?.(box.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onJumpCall?.(box.id);
                    }
                  }}
                >
                  <title>{readout}</title>
                  <rect className="ct-box" width={box.w} height={box.h} rx={9} />
                  {box.lines.map((text, i) => (
                    <text key={i} className="ct-label" x={PAD_X} y={baseline(i)}>
                      {text}
                    </text>
                  ))}
                  {/* Mounted from the start, revealed by a class: the value
                      fades in on the step the trace recorded its return. */}
                  {box.value ? (
                    <text
                      className={`ct-value${done ? " ct-value-in" : ""}`}
                      x={PAD_X}
                      y={baseline(box.lines.length)}
                    >
                      {box.value}
                    </text>
                  ) : null}
                </g>

                {box.hidden > 0 ? (
                  <g
                    className="ct-unfold"
                    transform={`translate(${box.cx} ${box.y + box.h + 6})`}
                    role="button"
                    tabIndex={0}
                    aria-label={`Show the ${box.hidden} call${box.hidden === 1 ? "" : "s"} inside ${box.label}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      toggleFold(box.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        toggleFold(box.id);
                      }
                    }}
                  >
                    <title>{`Open ${box.hidden} folded call${box.hidden === 1 ? "" : "s"}`}</title>
                    <rect
                      x={-foldWidth(box.hidden) / 2}
                      y={0}
                      width={foldWidth(box.hidden)}
                      height={17}
                      rx={8.5}
                    />
                    <text className="ct-unfold-text" y={12}>
                      +{box.hidden} more
                    </text>
                  </g>
                ) : null}
              </g>
            );
          })}
        </>
      )}
    </Canvas>
  );
}

/** Width of the "+N more" pill, so its text always fits. */
function foldWidth(count) {
  return 26 + String(count).length * 7;
}

/** The accessible name of the whole drawing: where the run is, in one line. */
function describe(trace, index, tree, currentFrameId) {
  if (!trace || trace.length === 0) return "Call tree. The program has not run yet.";
  const current = currentFrameId != null ? tree.byId.get(currentFrameId) : null;
  const where = current ? `Now in ${current.label}` : "No call is running";
  return `Call tree. Step ${index + 1} of ${trace.length}. ${where}.`;
}

function Legend() {
  return (
    <>
      <div className="viz-howto">
        <p>
          <strong>Each box is one call the program really made.</strong> The name and the values in
          it were read from that call, and the value underneath appears when the call hands it back.
        </p>
        <p>
          <strong>Read downwards for nesting.</strong> A box under another is a call made by the box
          above it, so recursion fans out into a tree — one box per call, never a shared one.
        </p>
        <p>
          <strong>Click a box to go to the step it started at.</strong> The outlined box is the call
          running right now.
        </p>
      </div>
      <dl className="viz-legend">
        <dt className="ct-legend ct-running">running</dt>
        <dd>the call executing now</dd>
        <dt className="ct-legend ct-waiting">waiting</dt>
        <dd>started, waiting for the call it made</dd>
        <dt className="ct-legend ct-done">finished</dt>
        <dd>handed a value back</dd>
        <dt className="ct-legend ct-failed">failed</dt>
        <dd>an exception stopped it</dd>
        <dt className="ct-legend ct-future">not started</dt>
        <dd>a call the run has not reached</dd>
      </dl>
    </>
  );
}
