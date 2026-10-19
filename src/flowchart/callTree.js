// The call tree of one run: every function call the trace really made, with its
// parent, its arguments, and what it handed back. Pure — trace and source in,
// a tree out — so `node --test` can prove the hierarchy is the trace's own.
//
// Everything here is read from docs/trace-format.md events:
//
//   * parentage comes from the stack each event carries: the frame under a
//     frame at the moment it first appears is its caller;
//   * arguments are the parameters the call was given, captured when the frame
//     is first seen;
//   * a return value is the `return` event's own `return_value`;
//   * a failure is an `unwind` for that frame.
//
// Nothing is inferred for a call the trace does not contain: a program with no
// calls yields a single `<module>` root and no children at all.

import { callFrames, MODULE } from "./executionGraph.js";

/**
 * One call in the tree.
 * @typedef {Object} CallNode
 * @property {number} frameId
 * @property {number|null} parentId the frame this one was called from
 * @property {string} function
 * @property {string} label `fact(4)` — name plus the arguments it received
 * @property {Array<{name: string, text: string}>} args
 * @property {number} depth 0 for the module frame
 * @property {number} firstIndex the step the call started at (its click target)
 * @property {number|null} returnIndex the step it returned or unwound at
 * @property {string|null} returnText what it handed back, once it has
 * @property {boolean} raised true when it exited because of an exception
 * @property {boolean} classBody true for `class Name:` bodies
 * @property {CallNode[]} children in the order the calls were made
 */

/**
 * Builds the call tree for a whole run.
 * @param {Array} trace the trace array from docs/trace-format.md
 * @param {string} [source] the user's code, for argument names and labels
 * @returns {{ nodes: CallNode[], byId: Map<number, CallNode>, roots: CallNode[] }}
 *   `nodes` is pre-order (a parent always before its children), which is the
 *   drawing order; `roots` is the forest the layout starts from.
 */
export function buildCallTree(trace, source = "") {
  const empty = { nodes: [], byId: new Map(), roots: [] };
  const list = Array.isArray(trace) ? trace : [];
  if (list.length === 0) return empty;

  const calls = callFrames(list, source);
  if (calls.size === 0) return empty;

  // The exception type each frame saw. Read from the trace's own `exception`
  // events, so a failed call can name the real error rather than a generic one.
  const raisedType = new Map();
  for (const event of list) {
    if (event.event !== "exception" || event.frame_id == null) continue;
    const type = event.exception?.type ?? event.exception?.message;
    if (type && !raisedType.has(event.frame_id)) raisedType.set(event.frame_id, type);
  }

  const byId = new Map();
  for (const info of calls.values()) {
    const stack = list[info.firstIndex]?.frames ?? [];
    const rawParent = stack.length > 1 ? stack[stack.length - 2].frame_id : null;
    // A frame is never its own parent; anything odd simply roots the subtree.
    const parentId = rawParent === info.frameId ? null : rawParent;
    const node = { ...info, parentId, children: [] };
    if (raisedType.has(node.frameId)) node.raisedType = raisedType.get(node.frameId);
    byId.set(node.frameId, node);
  }

  // Link children under parents in the order the calls were made. `byId` is
  // filled in `firstIndex` order (Map preserves insertion), so the sort is a
  // no-op in practice but keeps the promise explicit and testable.
  const roots = [];
  for (const node of byId.values()) {
    const parent = node.parentId != null ? byId.get(node.parentId) : null;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  for (const node of byId.values()) {
    node.children.sort((a, b) => a.firstIndex - b.firstIndex);
  }
  roots.sort((a, b) => a.firstIndex - b.firstIndex);

  // Pre-order without recursion: a 700-deep call chain must not depend on the
  // JavaScript stack being deep enough.
  const nodes = [];
  const stack = [...roots].reverse();
  while (stack.length > 0) {
    const node = stack.pop();
    nodes.push(node);
    for (let i = node.children.length - 1; i >= 0; i -= 1) stack.push(node.children[i]);
  }

  // A frame that only propagated someone else's exception inherits the type
  // from the call that actually raised it — deepest first, so it is known by
  // the time we reach its caller.
  for (let i = nodes.length - 1; i >= 0; i -= 1) {
    const node = nodes[i];
    if (node.raisedType || !node.raised) continue;
    for (const child of node.children) {
      if (child.raisedType) {
        node.raisedType = child.raisedType;
        break;
      }
    }
  }

  return { nodes, byId, roots };
}

/**
 * Where a call is in its life at one step of the run.
 *
 *   future   the call has not started yet
 *   running  this frame is the one executing right now
 *   waiting  started, still on the stack, below the running frame
 *   done     returned normally
 *   failed   exited because an exception propagated out of it
 *
 * The status is a function of the node and the step alone, so it can never
 * disagree with the step the rest of the workspace is showing.
 *
 * @param {CallNode|null} node
 * @param {number} index the current step
 * @param {number|null} currentFrameId the frame executing at that step
 * @returns {"future"|"running"|"waiting"|"done"|"failed"}
 */
export function callStatus(node, index, currentFrameId) {
  if (!node) return "future";
  if (index < node.firstIndex) return "future";
  if (node.returnIndex !== null && index >= node.returnIndex) {
    return node.raised ? "failed" : "done";
  }
  return node.frameId === currentFrameId ? "running" : "waiting";
}

/** True when the run had no function calls, only the module frame itself. */
export function onlyModule(tree) {
  return tree.nodes.length === 1 && tree.nodes[0].function === MODULE;
}
