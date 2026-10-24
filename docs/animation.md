# Animation diff: actions and rules

**Status:** Phase 1 in progress. Tasks 1–4 and task 5a are implemented and tested: the
vocabulary (`actions.js`), the safe evaluator (`evaluate.js`), the statement-shape parser
(`lineShape.js`), the diff core (`diff.js`), and the list/tuple half of the collection diff.
Tasks 5b (movement), 5c (pop/insert shapes and truncation fallbacks) and 6 (dict/set/object
contents) have not landed. Sections marked *(planned)* are the contract the rest of Phase 1 is
held to; they describe code that does not exist yet. Nothing in this document lets the
renderer invent an event: if a fact is not in the trace or the source, the action is a
highlight or a change, never a move.

**Task 5a is partial on purpose, and this document does not claim the layer is complete.**
List and tuple lifecycle, visible cell changes, append/delete, and state-proven tail
growth/shrink now produce exactly reversible state actions. Movement, pop/insert shapes and
truncation fallbacks are tasks 5b/5c; dict, set and object contents are task 6. A supported
list transition must not be silently ignored: it either round-trips or carries a highlight
with a reason and is classified as deferred. Section 11 records the remaining gap and the
tasks that close it; section 12 states exactly what task 5a's proof covers.

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

`stateOf` returns a deep copy of the heap as well as the frames: every entry and its
`items` array is copied, so `applyState` can never mutate the trace it is replaying.
References inside the heap stay references (an `id` string), so aliasing is preserved
without copying one object per variable.

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
| `highlight` | overlay | — | cell, entry, attribute, variable, object | optional `{ note }`; the action's `reason` field says why a move was refused |
| `move` | state | `swap`, `shift` | cell | the index pair the move describes |
| `grow` | state | `append`, `insert` | cell (the new cell) | the inserted value in `to` |
| `shrink` | state | `pop`, `delete` | cell (the removed cell) | the removed value in `from` |
| `connect` | overlay | — | cell, entry, attribute (the slot) | the object id the arrow points at |
| `disconnect` | overlay | — | same as `connect` | the object id the arrow pointed at |
| `call` | state | — | frame | `{ function, callLine, args }` |
| `return` | overlay | — | frame | `{ function, value, to: "console" \| null }` |
| `print` | overlay | — | console | `{ text }` |
| `error` | overlay | — | frame (an exception), or console (the run's outcome) | `{ type, message, line }` on an exception badge; `{ type, message, line, phase }` on the run's outcome |

`from` / `to` always carry trace values (or, for elements, the snapshot object), never
formatted display text. Formatting is the renderer's job and must not change an action.

`grow` and `shrink` motions are paired bijectively: `append` ↔ `pop`, `insert` ↔ `delete`.
`append` is legal only at the end and `pop` removes only the last cell; `insert` accepts any
index `0..length`, and `delete` removes any cell. A middle `pop(i)` is therefore modelled as
`delete` when it lands in 5c, not as a `pop` whose inverse would require an append at a
non-tail index. `applyState` rejects a malformed pair rather than half-applying it.

The `error` payload follows the trace: an `exception` event records only `{type, message}`
and the event's `line`, so the raising frame's badge has no `phase`; the terminal `error`
event carries the top-level error object, including `phase` (`"compile"` for a syntax error,
`"runtime"` for a recorded runtime error, `"tracer"` for a tracer failure — `diff.js` copies
whatever the event records and invents nothing).

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

## 8. Evidence rules for movement *(shapes: task 3; swap: 5b part 1; shift: 5b part 2)*

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

## 9. Collections *(list/tuple state: task 5a; movement: 5b; pop/insert/truncation: 5c; dict/set/object: task 6)*

Task 5a compares each heap entry by object id and supports the list/tuple half of the state:

* **list / tuple lifecycle** — an object that becomes reachable is one `appear` on the
  object target, carrying the whole entry in `to`; one that stops being reachable is one
  `disappear`, carrying its last entry in `from` so the reverse restores it. A list that
  appears already carries its cells; there is no second cell action.
* **cells** — equal-length cell changes are `change` on the cell, with the exact trace
  values. Sorting or reversing a list is a set of cell changes with `reason:
  "unknown-shape"`, because those lines carry no movement shape; a direct subscript
  assignment with a resolved shape has no reason. The diff never claims an order that the
  snapshot cannot prove.
* **movement (swap)** — when the executed line is a recognized swap and the snapshots show
  exactly those two cells exchanged (and no other cell changed), the diff emits **one**
  `move.swap` on the lower-index cell with `payload.indices = [i, j]` in the order the
  statement wrote them. Aliases are keyed by object id, so one swap is one action. Equal
  values at the two cells prove nothing visible: the step gets a `duplicate-values`
  highlight and no state action. If the indices, object or values do not agree, the step
  stays a cell `change` with `reason: "unknown-shape"`, never a guessed move. Shift
  (`a[i+1] = a[i]`) is 5b part 2 and is still a `change`.
* **append/delete** — task 5a emits `grow.append` for a recognized `append` and
  `shrink.delete` for a recognized `del`. Task 5c wires `insert`/`pop`; the vocabulary and
  `applyState`/`reverseActions` already support all four motions. `grow.append` is
  tail-only and `shrink.pop` is last-cell-only (section 5).
* **state-proven tail growth/shrink** — when the old list is a prefix of the new one, or the
  new one is a prefix of the old, the snapshot proves a tail change even when the syntax is
  inconclusive. The diff emits `grow.append` or `shrink.pop` with
  `reason: "unknown-shape"`. Multiple appended cells are multiple appends in ascending
  index order; multiple removals are multiple pops in descending order, so forward and
  reverse application both stay valid.
* **tuples** — lifecycle only. A tuple whose cells differ cannot be produced by valid
  Python, and the diff does not pretend it can: it emits a `highlight` on the object with
  `reason: "unsupported"` and no cell action. `applyState` and
  `reverseActions(actions, state)` reject a tuple cell mutation (section 12).
* **truncation** — a list with `more > 0` never claims movement, growth or shrinkage. Visible
  cells may still `change`, with `reason: "truncated"`. If `more` or the visible length
  changes, the diff emits a `highlight` on the object with `reason: "truncated"` and the
  transition is classified as deferred, because the hidden positions cannot be restored.
* **unsupported list structure** — a non-tail insertion/removal, or any structural change
  the line shape does not prove, gets a `highlight` on the object with
  `reason: "unknown-shape"` or `"unsupported"`; it is never guessed as a move. An empty
  action list still means "the compared state did not change", not "skipped".
* **dict / set / object** — task 6. Task 5a emits no entry or attribute action for them and
  classifies those transitions deferred (section 11).

`more` means "there are cells we cannot see"; the diff never claims a position past the
visible window.

## 10. Calls, returns and the console *(done: task 4)*

`diffSteps(prev, next, { source, consoleAfterReturn })` compares two snapshots and returns
that step's actions. The rules for the non-collection half of the state:

* **Stack.** A frame present in both snapshots is matched by `frame_id`. A frame that is new
  is one `call` action on its frame target, with `to` = the frame snapshot and
  `payload.args` = the arguments bound at the call event (there is no second `appear` for
  it). A frame that is gone is one `disappear` on the frame, carrying its last state in
  `from`, which is what makes the removal reversible. Recursion therefore gets one action
  per call, never one per function name.
* **Variables.** Within a frame that survives the transition, a new name is `appear`, a gone
  name is `disappear`, and a changed value is `change` with the exact trace values in
  `from`/`to`. Values are compared with `canonicalValue`, so a change never depends on key
  order. A frame's own `line` is cursor metadata and produces no action.
* **Events without a snapshot.** `output`, `input`, `error` and the limit events record no
  `frames`/`heap`. `snapshotAt(trace, i)` gives them the last recorded state, so a print step
  shows the state it printed from and never looks like an empty program.
* **Print.** Every `output` event is one `print` overlay on the console with the recorded
  `text`. `input` adds no overlay: the tracer echoes it as the next `output` event, and
  emitting both would print the line twice.
* **Return.** A `return` event is a `return` overlay on the returning frame, carrying
  `payload { function, value, to }` with `value` the recorded `return_value`. The frame is
  still on the stack at that event, so its removal is the next transition's `disappear`,
  where the snapshot actually shows it gone.
* **Console destination.** `to: "console"` only when recorded `output` events follow the
  return before the next control event — `consoleFollowsReturn(trace, i)` is that fact, and
  the caller passes it as `context.consoleAfterReturn`. Without it `to` is `null`. No landing
  variable is ever named.
* **Error.** An `exception` event is one `error` overlay on the raising frame with
  `{ type, message, line }` (an exception event records no `phase`). `unwind` repeats the
  same exception and adds nothing. The final `error` event is the run's recorded outcome:
  one `error` overlay on the console with `{ type, message, line, phase }`, which is also
  where a compile error lands (it has no frame at all; its `phase` is `"compile"`).
* **Limits.** `step_limit`, `timeout` and `output_limit` add no action: the state did not
  change, and the truncation banner is derived from the event's status, not from an action.

Task 5a now models list and tuple state as described in section 9: lifecycle, visible cell
changes, append/delete and state-proven tail growth/shrink, all exactly reversible. Movement
(swap/shift), pop/insert shapes and truncation fallbacks are tasks 5b/5c; dict, set and
object contents are task 6. Until those land, a transition that changes only dict, set or
object contents still yields no state action and is counted as deferred (section 11). A list
transition is never silently skipped: it either round-trips or carries a highlight with a
reason and is classified as deferred.

The module's surface, all pure and free of I/O, clocks and randomness:

| Function | Job |
|---|---|
| `snapshotAt(trace, i)` | the event at `i` plus the state it is shown against |
| `stateOf(snapshot)` | the compared state of section 3, with frames and heap deep-copied |
| `diffSteps(prev, next, context)` | this step's state actions, then its overlays |
| `stateActions(actions)` | the subset that changes the snapshot |
| `applyState(state, actions)` | the state after those actions, without mutating the input |
| `reverseActions(actions, state?)` | the actions that undo the step; overlays dropped; optional `state` enables tuple and container checks |
| `consoleFollowsReturn(trace, i)` | the recorded fact behind `to: "console"` |

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

**Task 5a closes the list/tuple half of the gap; dict, set and object contents remain task 6.**
The task-5a suite classifies **every** event step of the corpus and recognition fixtures:
2933 over 114 programs, of which 114 are run-start steps and the other 2819 are consecutive
state pairs. 2896 event steps round trip forward and backward. All 37 deferred steps are
consecutive pairs, so 2782 of the 2819 pairs round trip and 37 are deferred to task 6. The
deferred set is exactly dict/set/object content and non-sequence lifecycle changes; no list
transition is deferred for lack of an action. The
test also applies and reverses the actions of every list/tuple object inside a deferred
transition, so 5a's sequence part is proven even where a dict, set or object change makes the
whole snapshots unequal. A transition fails the suite if it neither round-trips nor carries a
highlight that explains itself.

The fixtures do not contain every fallback, so synthetic snapshot pairs pin the rest: a
`more` change under truncation, a visible-length change with `more` unchanged, a tuple cell
mutation, a non-tail structural change with no usable shape, and a recognized middle `del`.
The first three are conservative (`highlight` or visible `change` with a reason, never a
guessed state action); the middle `del` is a supported `shrink.delete`.

`list-mutation` additionally pins the sort, reverse, subscript assignment and tail `del`
with their recorded contents. `list-basics`, `alias-shared`, `class-basic`, `tuple-unpack`,
`filter-list`, `bubble-truncated` and `merge-sort` pin lifecycle, aliasing, nested receiver
resolution, tuple immutability, truncated changes and state-proven tail growth. Nothing here
may be read as coverage of movement (5b), pop/insert shapes (5c) or dict/set/object contents
(task 6); section 12 says exactly what the property proves.

## 12. Reversibility contract

**The required contract, from tasks 5–6 onward: state actions are exactly invertible over
the state in section 3.** For every consecutive pair of state events `(A, B)` in a trace,
with `actions = diffSteps(A, B, context)`:

```
applyState(stateOf(A), stateActions(actions))          ≡ stateOf(B)
applyState(stateOf(B), reverse(stateActions(actions))) ≡ stateOf(A)
```

The comparison is a deep equality of the exact state object in section 3 — every frame's
variables, the stack's frame ids/functions/call_lines, and the whole heap including
`more`, `class` and ordering. It is **not** normalised, sorted or filtered to make a test
pass. If a transition cannot satisfy it, the diff is wrong and must change, not the test.

**Task 5a's proof covers list and tuple state; swap movement is added in 5b part 1, while shift, pop/insert shapes and task 6 remain.**
The property is proven for all 2819 consecutive pairs' list/tuple state (the 2933 event steps
include 114 run-start steps): 2782 pairs round trip as whole snapshots, and in the 37 pairs
that are deferred to task 6 the test applies and reverses the actions of every list/tuple
object individually. The six task-4 golden programs
are unchanged and still round trip in full. Swap movement is proven with the same property;
what is not proven yet is shift (5b part 2), the pop/insert shapes (5c), and dict/set/object
contents (task 6); this layer emits none of those state actions.

Inverse pairs:

| Action | Inverse |
|---|---|
| `appear` (`to` = element) | `disappear` (`from` = the same element) |
| `disappear` (`from` = element) | `appear` / `call` restoring it |
| `change` (`from` → `to`) | `change` (`to` → `from`) |
| `grow` `append` (cell at the end) | `shrink` `pop` (the same cell) |
| `grow` `insert` (cell `i`) | `shrink` `delete` (cell `i`) |
| `shrink` `pop` (the last cell) | `grow` `append` (the same cell) |
| `shrink` `delete` (cell `i`) | `grow` `insert` (cell `i`) |
| `move` `swap` | itself (one action per pair, targeted at the lower index) |
| `move` `shift` (`a[i+1] = a[i]`, `i → i+1`) | `change` on cell `i+1` restoring its previous value; the source cell `i` is unchanged. (Task 5b part 2; no `move.shift` is emitted yet.) |
| `call` (frame) | `disappear` (frame, `from` = the frame) |

A shift-copy is not a rotation. `a[i+1] = a[i]` copies the source over the destination and
leaves the source in place, so reversing it must restore the overwritten destination value;
reversing the arrow would copy the wrong value back into `i`.

**Overlays are not inverted — they are discarded.** On backward playback and on a seek,
every overlay of the previous step is dropped (`overlayActionsAt` returns none for the new
step); a forward step installs only its own. This is tested separately from the snapshot
property, so a passing reversibility test can never hide a stuck flash or a stale arrow.

After tasks 5b/5c/6, the suite must run the property over **every** program in the corpus,
the recognition fixture and the animation fixture, and over **every** consecutive state pair
— not a sample. Task 5a already runs the same partition over every program and every pair,
and proves the list/tuple side of each pair; programs that cannot be modelled are still
diffed and produce the conservative actions their `reason` explains.

### Task 5a status of the property

`applyState`, `reverseActions` and `stateActions` implement the contract for the kinds task 5a
emits: `appear`, `disappear`, `change`, `call`, object lifecycle, cell changes,
`grow.append`/`grow.insert` and `shrink.pop`/`shrink.delete`. Overlays are dropped by
`reverseActions` and ignored by `applyState`, so they can never mutate the snapshot.
`move.swap` is applied as exactly one exchange of its index pair and reversed by itself;
`move.shift` is still refused by both functions until 5b part 2. A malformed `move` pair, a
malformed `grow`/`shrink` target, a tuple cell mutation, or a middle `pop` is rejected
rather than half-applied. `reverseActions(actions, state)` takes the optional after-state precisely so it
can reject a tuple-cell inverse; without it, the function cannot know a container's type.

The suite runs the property on the six task-4 golden programs, on every list/tuple program
of the fixtures, and on **every** event step of the corpus and recognition fixtures — 2933
over 114 programs, including 114 run starts and 2819 consecutive pairs. All 2896 supported
event steps round trip forward and backward; that is every run start plus 2782 pairs. The 37
deferred consecutive pairs are counted and classified as task 6, and their list/tuple objects
are checked individually. The comparison is strict deep equality of the state object of
section 3:
object key order is not part of the state, and nothing is normalised, sorted or filtered.
The fixture counts are pinned in the test, not used as thresholds, so a regenerated fixture
must update them deliberately.

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
| 4 | diff core: snapshots, frames, calls, returns, print, error, variables, `applyState`/`reverseActions` | **done** |
| 5 | list/tuple diff, movement inference, ambiguity fallbacks | **partly:** 5a (lifecycle, visible cell changes, append/delete, state-proven tail growth/shrink) and 5b swap done; 5b shift and 5c pop/insert shapes/truncation fallbacks planned |
| 6 | dict/set/object diff | planned |
| 7 | `apply.js` + whole-corpus reversibility property | partly: `applyState`/`reverseActions` and the property for variables, frames, console facts and task-5a list/tuple state plus swap movement landed; shift and dict/set/object state complete with tasks 5b part 2/5c/6 |
| 8 | golden action lists (20+ programs), determinism report, fixture wiring | partly: six task-4 goldens plus task-5a list/tuple, lifecycle, truncation and tail-growth goldens; the full set lands after 5b/5c |
