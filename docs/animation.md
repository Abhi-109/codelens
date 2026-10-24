# Animation diff: actions and rules

**Status:** Phase 1 in progress. Task 1 (the vocabulary, canonical targets and
deterministic ids, in `src/animation/actions.js`) is implemented and tested. Sections
marked *(planned)* are the contract the rest of Phase 1 is held to; they describe code
that does not exist yet. Nothing in this document lets the renderer invent an event: if a
fact is not in the trace or the source, the action is a highlight or a change, never a
move.

## 1. What the layer is

`src/animation/` turns two consecutive states of a **format-2** trace plus the executed
line's source into a list of actions (spec §6). It is pure JavaScript: no React, no
Pyodide, no I/O, no clock, no randomness, no new dependency. It never runs Python and it
never adds a fact the trace does not record.

```
trace event A  ─┐
trace event B  ─┼─►  diffSteps(A, B, context)  ─►  actions  ─►  scene  ─►  renderer
source line(s) ─┘
```

## 2. What the diff may use

* the two events' `frames` and `heap` (the snapshot state, section 3);
* the event kinds and their metadata (`line`, `function`, `frame_id`, `return_value`,
  `exception`, `exit_kind`);
* the recorded `output` / `input` events between the two states, and only those;
* the user's source, for line text and statement shape;
* the frame's variables at the earlier event, for index expressions.

It may **not** use the editor's current text as if it were the run's text, the future of
the trace beyond the transition, ambient state, or the clock. An action that would need
any of these is not emitted; a conservative action takes its place.

## 3. The compared snapshot state

Two states are compared as exactly this object:

```
{
  frames: [ { frame_id, function, call_line, variables } ],   // oldest first
  heap:   { oN: { type, items | entries | attrs, more?, class? } }
}
```

Everything else is **event metadata**, not snapshot state, and is never reconstructed by
replaying actions:

| Excluded | Why |
|---|---|
| `frame.line` (the current line of a frame) | describes where the cursor is, not what the program's data is |
| `event.line`, `event.step`, `event.function`, `event.frame_id`, `event.event` | the event's own identity |
| `return_value`, `exception`, `exit_kind` | reported by the event, not stored in a variable |
| `output` / `input` text and the accumulated console | derived from the output events up to the cursor |
| `status`, top-level `error` | the run's outcome, not a step's state |

This split is the reversibility contract (section 13): a seek must rebuild the *data* by
replaying state actions, and rebuild the *cursor facts* by reading the trace. It is also
the reason the contract is not weakened later: the comparison covers every frame's
variables, the frame stack's shape, and the whole reachable heap.

## 4. Three kinds of information

Every action has exactly one **effect**, decided by its kind and never by its caller:

1. **State mutation** (`effect: "state"`) — changes the compared snapshot. It must be
   exactly reversible. Kinds: `appear`, `disappear`, `change`, `move`, `grow`, `shrink`,
   `call`.
2. **Transient overlay** (`effect: "overlay"`) — never changes the snapshot. It describes
   something the state already implies or something the event recorded: a flash, an edge,
   printed text, a return flight, an error badge. Kinds: `highlight`, `connect`,
   `disconnect`, `return`, `print`, `error`.
3. **Event metadata** — the `step`, `line`, `frame_id` and kind-specific `payload` fields
   that ride on every action. They are read by the renderer and never applied to state.

`connect` and `disconnect` are overlays on purpose: the reference an arrow represents is
already written by the slot's `grow` / `change` / `disappear`. Emitting the arrow as a
second state mutation would either double-apply the reference or require the reverse of a
`connect` to guess what the slot held before. One mutation, one annotation.

### Overlay reset rule

An overlay belongs to **one step**. `overlayActionsAt(actions, step)` returns only the
overlays whose `step === currentStep`; any other cursor position (one step back, a slider
seek, a restart) yields none. A forward move installs only the new step's overlays. This is
the same rule that keeps a late animation from overwriting a newer target state (spec §8):
an overlay is keyed by step and can never outlive it.

## 5. The vocabulary

| Kind | Effect | Motion | Typical target | Payload |
|---|---|---|---|---|
| `appear` | state | — | variable, cell, entry, attribute, object, frame | `null`; `to` holds the new element |
| `disappear` | state | — | same as `appear` | `null`; `from` holds the removed element |
| `change` | state | — | variable, cell, entry, attribute | `null`; `from`/`to` are the trace values |
| `highlight` | overlay | — | cell, entry, attribute, variable | optional note; `reason` says why a move was refused |
| `move` | state | `swap`, `shift` | cell | the index pair the move describes |
| `grow` | state | `append`, `insert` | cell (the new cell) | the inserted value in `to` |
| `shrink` | state | `pop`, `delete` | cell (the removed cell) | the removed value in `from` |
| `connect` | overlay | — | cell, entry, attribute (the slot) | the object id the arrow points at |
| `disconnect` | overlay | — | same as `connect` | the object id the arrow pointed at |
| `call` | state | — | frame | `{ function, callLine, args }` |
| `return` | overlay | — | frame | `{ function, value, to: "console" \| null }` |
| `print` | overlay | — | console | `{ text }` |
| `error` | overlay | — | frame, or console for a syntax error | `{ type, message, line }` |

`from` / `to` always carry trace values (or, for elements, the snapshot object), never
formatted display text. Formatting is the renderer's job and must not change an action.

## 6. Action shape and deterministic ids

```js
{
  id,        // "<step>:<kind>[.<motion>]:<path>"  e.g. "12:move.swap:o1[3]"
  step,      // the trace index the action belongs to
  kind,      // one of the 13 kinds
  motion,    // null, or swap|shift|append|insert|pop|delete
  effect,    // "state" | "overlay", derived from kind
  target,    // { kind, frameId?, objectId?, index?, key?, name? }
  path,      // canonical target path (section 7)
  from,      // before value, or null
  to,        // after value, or null
  reason,    // null, or a FALLBACK_REASON code (section 12)
  payload,   // null, or a frozen plain object of kind-specific facts
}
```

The id is derived from `(step, kind, motion, path)` **and nothing else** — not a counter,
not a clock, not the emission order, not the values. Recomputing a step after a seek must
produce the same ids or the stage would re-key and re-animate elements that did not move.
Two actions in one step never share an id: a kind and a target identify one element's
transition, and the diff merges rather than duplicates.

## 7. Targets and paths

| Target | Shape | Path |
|---|---|---|
| variable | `{ kind: "variable", frameId, name }` | `f<frameId>.<name>` |
| cell | `{ kind: "cell", objectId, index }` | `<objectId>[<index>]` |
| dict entry | `{ kind: "entry", objectId, key }` | `<objectId>[<canonical key>]` |
| attribute | `{ kind: "attribute", objectId, name }` | `<objectId>.<name>` |
| object | `{ kind: "object", objectId }` | `<objectId>` |
| frame | `{ kind: "frame", frameId }` | `f<frameId>` |
| console | `{ kind: "console" }` | `console` |

Dict keys are serialized canonically (object keys sorted at every depth), so two runs —
or two recomputations of the same step — produce the same path. Variable targets are
frame-qualified: `n` in the module frame and `n` in a recursive frame are different paths,
which is what lets the same name animate in two cards without colliding.

## 8. Evidence rules for movement *(planned: tasks 3 and 5)*

A movement action needs **both**:

1. **source-shape evidence** — the executed statement says so: a tuple target with two
   subscripts (`a[i], a[j] = a[j], a[i]`) is a swap; `a[j + 1] = a[j]` is a shift; the
   parsed shape comes from `lineShape.js` and anything it cannot parse is `unknown`;
2. **state evidence** — the before and after values are exactly what that shape produces.

With either missing, or with more than one minimal-movement explanation, the step gets
`change` / `highlight` instead. Specifically:

* duplicate values make a removal or insertion position ambiguous → `highlight` with
  `reason: "duplicate-values"`;
* a swap that leaves the list identical (`i === j`, or equal values at the two cells) shows
  no evidence at all → `highlight`, never a no-op `move`;
* containers truncated by the tracer (`more > 0`) hide positions → no positional claim,
  `reason: "truncated"`;
* an index expression the evaluator cannot resolve → no marker; the move may still be
  inferred from shape and values, but no index label is invented (`reason:
  "index-unavailable"` on the marker, not on the move);
* a statement shape the parser does not recognise → `change` / `highlight` with `reason:
  "unknown-shape"`;
* aliases: actions are keyed by object id, so two names for one object never produce two
  moves, two changes, or two cards. If an inference would need to attribute a mutation to
  one particular name, no name is attributed.

The smallest movement that is consistent wins only when the shape and the values leave
exactly one candidate. "Smallest" never overrides ambiguity.

### Safe index evaluation *(done: task 2)*

`evaluateExpression(text, env)` resolves the index expressions an executed line contains.
Its grammar is deliberately tiny:

```
expression := term (("+" | "-") term)*
term       := factor (("*" | "//") factor)*
factor     := "-" INT | INT | NAME | "(" expression ")"
```

* names are ASCII identifiers, matched only against the caller-supplied `env` and only
  its **own** properties; a name that is missing, inherited (`toString`, `__proto__`), or a
  global (`Math`, `window`) does not resolve. The environment maps a name to a JavaScript
  safe integer; the diff converts a frame variable to one only when it is a trace `int`
  inside the safe range, so booleans, floats, big integers and references are not indices;
* integer literals may carry a leading `-`; a unary minus anywhere else (`-i`, `-(1)`) is
  outside the grammar;
* `//` is Python's floor division (`-7 // 2 === -4`). Arithmetic is done with `BigInt`, so
  a product is never silently rounded; a result outside the safe-integer range is refused
  rather than approximated;
* everything else is refused: calls (`f(1)`), attributes (`a.b`), subscripts (`a[0]`),
  strings, floats (`1.5`, `1e3`), `/`, `**`, `%`, comparisons, `and`/`or`/`not`, and any
  character outside the list above. Refusal is **not** an error: the result is `null`;
* the evaluator never throws (it catches getter failures and stack pressure), is pure, and
  reads no module state; limits are 200 characters and 24 nested parentheses;
* there is no dynamic code execution: no `eval` call and no `Function` constructor, and a
  test reads this file to keep it that way.

**Bounds are a separate step.** `resolveIndex(index, length)` uses Python's rule: a negative
index counts from the end, `length + index` must land inside `[0, length)`, and anything
else is `null`. Evaluation never receives a length, so `"-1"` evaluates to `-1` and only
`resolveIndex(-1, 3)` turns it into cell 2. If either step returns `null`, the stage shows
no marker; it does not guess one.

### Statement shapes *(done: task 3)*

`lineShape(source, line, { env })` answers **what the source says**, never what happened. A
shape is a hint for `diff.js`; the snapshot evidence still has to agree before a movement
action is emitted.

```js
{
  kind,                         // "swap" | "shift" | "subscript-assign" | "attribute-assign"
                                // | "augmented" | "del" | "append" | "insert" | "pop" | "unknown"
  reason,                       // null for a recognized shape; a closed-set reason for unknown
  statement: { text, startLine, endLine },
  targets: [reference],         // written targets, or the receiver of a method
  sources: [reference],         // the cells a swap/shift copies from
  operator,                     // "=", an augmented operator, "del", or the method name
  args,                         // method arguments as written
  direction,                    // "left" | "right" for an adjacent cell copy, else null
}
```

A reference carries its written `text`, its `base` name, a token-level `canonical` used to
compare two references without caring about spacing, its `tail`, and each accessor:
`.attr` or `[subscript]` with the subscript's text, its evaluated `value` (null when it
cannot be evaluated), whether it is a single string literal (`literal: "str"`) and whether
it is a slice.

| Kind | Recognized statement form |
|---|---|
| `swap` | two single-subscript cells of the **same** container, right side exactly those two cells reversed (`a[i], a[j] = a[j], a[i]`) |
| `shift` | one cell assigned from another cell of the same container whose evaluated indices are **adjacent** (`a[j + 1] = a[j]` is `right`, `a[j] = a[j + 1]` is `left`) |
| `subscript-assign` | one target ending in a subscript (`a[0]`, `d['k']`, `rows[0]['score']`) |
| `attribute-assign` | one target ending in an attribute (`obj.x = 1`, `self.tricks = []`) |
| `augmented` | `x += 1`, `a[i] += 2`, `obj.n //= 2` (any Python augmented operator) |
| `del` | `del a[0]`, `del d['k']`, `del obj.attr`, `del x` (exactly one, not a slice) |
| `append` / `insert` / `pop` | `a.append(x)`, `a.insert(i, x)`, `a.pop()` / `a.pop(i)`, with a receiver that is a reference (no call result) and the exact arity; the call has to be the whole statement, so `x = a.pop()` is not this shape |

The parser is structural, not regex-based: it scans characters, skips strings and comments,
and chooses every split point by bracket depth. Consequences that are load-bearing:

* a chain (`a[i] = b[j] = 0`) or a top-level `;` is `ambiguous`; nothing in it is
  recognized partially;
* everything inside a string is opaque (`a[']'] = 1`, `a[';'] = 2`, and a line that only
  *mentions* `a[i], a[j] = a[j], a[i]` in a string or comment is not a swap);
* a slice target (`a[1:3] = …`, `del a[1:3]`) is `unsupported`, because it covers more than
  one cell and the diff cannot claim one cell moved;
* a **multi-line** statement is resolved as one unit from the statement's first line to its
  last, because the trace fires a line event for continuation lines too. If the boundaries
  or the syntax cannot be established safely, the answer is `unknown` with a reason —
  never a guess;
* a mutation the parser will not model is reported as `unsupported`, not silently dropped:
  a call-result receiver (`groups.setdefault('f', []).append('a')`), a tuple of plain names
  (`x, y = y, x`), a slice, a parenthesised target tuple, a compound one-line suite;
* `shift` is only claimed when **both** indices evaluate and are adjacent. Without an
  environment, or when they are not adjacent, the same statement is a `subscript-assign`;
  the diff may still show a change, but it is not told a cell moved.

Unknown reasons are a closed set: `not-a-mutation` (a statement with no mutation shape the
parser models — a plain variable assignment, `print`, control flow), `unsupported`,
`ambiguous`, `malformed`, `outside-statement` (a blank/comment line, a line inside a
multi-line string, or a line outside the source). Every `unknown` carries one; there is no
silent skip.

**Real-corpus check.** Run over every distinct `line` event in `corpus.json.gz` and
`recognition.json.gz` (665 statements, environment taken from the line event's innermost
frame): `unknown/not-a-mutation` 630, `append` 9, `subscript-assign` 7, `swap` 7 (six
bubble-sort variants and `selection-sort`), `attribute-assign` 6, `unknown/unsupported` 4,
`del` 1, `shift` 1 (`insertion-sort`, `right`). The four `unsupported` statements are
exactly the documented cases: `groups.setdefault(...).append(...)` twice and the two
`x, y = …` tuple assignments in `tuple-unpack`. Nothing in the corpus is silently dropped,
and no statement is reported as a movement shape without the indices to prove adjacency.

## 9. Collections *(planned: tasks 5 and 6)*

* **list / tuple** — cells by index; grow/shrink at the ends or at an inserted position once
  the shape proves it; a shift is a set of cell moves, not a rewrite.
* **dict** — entries by key, in the trace's insertion order; a new key is a `grow` at the
  end, an update is a `change` in place, a removal is a `shrink`.
* **set** — an unordered bag. Elements `appear` and `disappear`; there are no positions, no
  markers and no `move` / `shift` / `grow at an index` for a set. The tracer sorts sets, so
  an index diff would move every cell on every change; that would be a lie.
* **object** — attributes by name; new attribute is `appear` on the attribute, an update is
  `change`, a removal is `disappear`. An object that becomes reachable is `appear` on the
  object; one that stops being reachable is `disappear`, carrying its last state in `from`
  so the reverse can restore it.
* **truncation** — `more` means "there are cells we cannot see"; the diff never claims a
  position past the visible window.

## 10. Calls, returns and the console *(planned: task 4)*

* A `call` event adds the callee frame: one `call` action on the frame target, with the
  bound arguments in `payload.args`. The frame is added once — there is no second `appear`
  for it.
* A `return` event keeps the returning frame on the stack (audit §4). Its `return` action
  is an overlay carrying the value; the frame's removal is a `disappear` on the *next*
  transition, where the snapshot actually shows it gone.
* For `print(f(x))`, the return may carry `to: "console"` **only** when the trace proves the
  relationship: recorded `output` events sit between the return and the next control event.
  No landing variable is ever named. Otherwise `to` is `null` and the return animation is
  the simple one.
* `print` overlays mirror the output events up to the cursor. The console text is derived
  from those events, so it is never stored in a snapshot and never replayed as state.

## 11. Reporting ambiguity and unsupported cases *(planned: tasks 5, 6 and 8)*

Fallback reasons are a closed set:

| Code | Meaning |
|---|---|
| `duplicate-values` | more than one minimal explanation; a value diff cannot choose |
| `truncated` | the tracer's `more` hides positions |
| `unknown-shape` | the statement parser could not classify the line |
| `index-unavailable` | an index expression could not be evaluated safely |
| `unsupported` | the state exists but this layer cannot model it honestly |

Rules:

* no step is dropped. A step with no visible change legitimately yields `[]`; a step that
  cannot be modelled yields a conservative action carrying a reason, never silence;
* every fallback action explains itself in `reason` (and optionally `payload.note`);
* the Phase 1 test suite prints a per-program report of the corpus, the recognition
  fixture and the animation fixture: transitions, state actions, overlays, and fallbacks
  by reason. A case is only allowed to use a fallback if the report names it;
* an empty result means "the compared state did not change" — it never means "skipped".

## 12. Reversibility contract

**State actions are exactly invertible over the state in section 3.** For every consecutive
pair of state events `(A, B)` in a trace, with `actions = diffSteps(A, B, context)`:

```
applyState(stateOf(A), stateActions(actions))          ≡ stateOf(B)
applyState(stateOf(B), reverse(stateActions(actions))) ≡ stateOf(A)
```

The comparison is a deep equality of the exact state object in section 3 — every frame's
variables, the stack's frame ids/functions/call_lines, and the whole heap including
`more`, `class` and ordering. It is **not** normalised, sorted or filtered to make a test
pass. If a transition cannot satisfy it, the diff is wrong and must change, not the test.

Inverse pairs:

| Action | Inverse |
|---|---|
| `appear` (`to` = element) | `disappear` (`from` = the same element) |
| `disappear` (`from` = element) | `appear` / `call` restoring it |
| `change` (`from` → `to`) | `change` (`to` → `from`) |
| `grow` (cell `i`, `to`) | `shrink` (cell `i`, `from = to`) |
| `shrink` (cell `i`, `from`) | `grow` (cell `i`, `to = from`) |
| `move` `swap` | itself |
| `move` `shift` (`i → i+1`) | `move` `shift` (`i+1 → i`) |
| `call` (frame) | `disappear` (frame, `from` = the frame) |

**Overlays are not inverted — they are discarded.** On backward playback and on a seek,
every overlay of the previous step is dropped (`overlayActionsAt` returns none for the new
step); a forward step installs only its own. This is tested separately from the snapshot
property, so a passing reversibility test can never hide a stuck flash or a stale arrow.

The suite runs the property over **every** program in the corpus, the recognition fixture
and the animation fixture, and over **every** consecutive state pair — not a sample.
Programs that cannot be modelled are still diffed; they simply produce the conservative
actions their `reason` explains.

## 13. What the layer never does

* run Python, compile Python, or evaluate user code;
* invent an event, a value, a position, a name, or an index;
* treat a set as ordered, or a truncated container as complete;
* name a landing variable for a return value;
* lose an action it cannot classify — it downgrades it and says why;
* depend on a clock, randomness, a counter or global mutable state.

## 14. Task status

| Task | Contents | Status |
|---|---|---|
| 1 | vocabulary, effects, canonical targets, deterministic ids, overlay reset helper | **done** |
| 2 | safe index-expression evaluator + separate bounds resolver | **done** |
| 3 | statement-shape parser (`lineShape.js`) | **done** |
| 4 | diff core: frames, calls, returns, print, error, variables | planned |
| 5 | list/tuple diff, movement inference, ambiguity fallbacks | planned |
| 6 | dict/set/object diff | planned |
| 7 | `apply.js` + whole-corpus reversibility property | planned |
| 8 | golden action lists (20+ programs), determinism report, fixture wiring | planned |
