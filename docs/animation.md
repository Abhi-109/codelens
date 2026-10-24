# Animation diff: actions and rules

**Status:** Phase 1 in progress. Tasks 1–4, 5a–5c and 6 are implemented and tested: the
vocabulary (`actions.js`), the safe evaluator (`evaluate.js`), the statement-shape parser
(`lineShape.js`), the diff core (`diff.js`), and the collection diff for lists, tuples,
dictionaries, sets and objects, with verified swap/shift movement, insert/pop shapes and
exactly reversible content and lifecycle actions. Task 7 (`apply.js`; the whole-corpus
property is already proven) and task 8 (the per-program report and remaining goldens) are
still ahead.
Nothing in this document lets the renderer invent an event: if a fact is not in the trace or
the source, the action is a highlight or a change, never a move.

**The layer is partial on purpose, and this document does not claim it is complete.**
List and tuple lifecycle, visible cell changes, append/insert/pop/delete, state-proven tail
growth/shrink, truncation fallbacks and swap/shift movement produce exactly reversible state
actions. Dictionary entries, set membership, object attributes and non-sequence lifecycle do
too, keyed by entry/attribute identity rather than visible position. Ambiguous cases stay
deferred with a highlight: reordering surviving dict entries or attributes, structural changes
under truncation, an attribute that appears while the object already shows 30 attributes, and
a class change. A change wholly hidden behind `more` can still leave no action, so an empty
action list is not proof that the whole state is unchanged. Section 11 records exactly what
remains deferred; section 12 states what the proof covers.

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
index `0..length`, and `delete` removes any cell. An explicit `pop(i)` is always modelled as
`delete`, even when `i` is the last cell, because its inverse is `insert` at that same index;
only bare `pop()` uses `pop`. `applyState` rejects a malformed pair rather than half-applying
it.

`appear` and `disappear` on an `entry` or `attribute` target also carry
`payload.index`: for a dictionary or object, the position of that entry/attribute on the
side the action describes, and for a set, the position in the trace's sorted serialization.
The index exists so the exact snapshot can be restored; for a set it is not a visible
position and the diff never emits movement from it. A `change` on an entry or attribute has
no payload.

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
or two recomputations of the same step — produce the same path. A set uses the member value
as its `entry.key`, because membership has no position; two equal members are one member.
Object attributes are keyed by name, and the object id keeps the attribute's owner stable
across rebinding. Variable targets are frame-qualified: `n` in the module frame and `n` in a
recursive frame are different paths, which is what lets the same name animate in two cards
without colliding.

## 8. Evidence rules for movement *(shapes: task 3; movement: 5b)*

A movement action needs **both**:

1. **source-shape evidence** — the executed statement says so: a tuple target with two
   subscripts (`a[i], a[j] = a[j], a[i]`) is a swap; `a[j + 1] = a[j]` is a shift; the
   parsed shape comes from `lineShape.js` and anything it cannot parse is `unknown`;
2. **state evidence** — the before and after values are exactly what that shape produces.

With either missing, or with more than one minimal-movement explanation, the step gets
`change` / `highlight` instead. Specifically:

* duplicate values make a swap's two cells indistinguishable → `highlight` with
  `reason: "duplicate-values"`; a removal or insertion is disambiguated by its resolved
  source index, and falls back only when that index is unavailable or disagrees with the
  snapshots;
* a swap or shift that leaves the list identical (`i === j`, or equal values at the two
  cells) shows no evidence at all → `highlight`, never a no-op `move`;
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

## 9. Collections *(list/tuple: tasks 5a–5c; dict/set/object: task 6)*

The diff compares each heap entry by object id. The list/tuple half of the state:

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
  stays a cell `change` with `reason: "unknown-shape"`, never a guessed move.
* **movement (shift)** — when the executed line is a recognized adjacent copy
  (`a[j+1] = a[j]` or `a[j] = a[j+1]`), the destination must receive the source's previous
  value, the source must be unchanged, and every other cell must be unchanged. The diff then
  emits **one** `move.shift` on the destination cell with `payload.indices = [source,
  destination]` in that order, `from` the overwritten destination value, and `to` the copied
  value. Equal source/destination values get a `duplicate-values` highlight and no state
  action. Any disagreement stays a cell `change` with `reason: "unknown-shape"`.
* **append/insert/pop/delete** — a recognized `append` emits `grow.append` on the new
  tail cell, and a recognized `del` emits `shrink.delete` at its resolved cell. A recognized
  `insert` emits exactly one `grow.insert` only when the resolved receiver, resolved source
  index, length increase of one, and exact prefix/suffix placement all agree. Indices use
  Python's `list.insert` normalization: a negative index counts from the end, then the
  result is clamped to `0..length`; literal and variable indices are evaluated safely.
  Duplicate values are disambiguated by that source index, never by value matching, and an
  alias still produces one action keyed by object id. A bare `pop()` emits `shrink.pop` only
  when the last cell was removed; an explicit `pop(i)` emits `shrink.delete` at the resolved
  index, including when `i` is the last cell. If the index is unresolved or the snapshots
  disagree, no insert/delete is invented: a state-proven tail change uses the `unknown-shape`
  append/pop fallback below, and any other structural change becomes a highlight.
* **delayed/nested calls** — `lineShape` recognizes `insert`/`pop` only when the call is
  the whole statement. `print(a.pop())`, `x = a.pop()` and nested calls stay `unknown`; if
  the later state proves a tail change they get the existing `unknown-shape` append/pop
  fallback, otherwise a highlight. No intermediate mutation is invented.
* **state-proven tail growth/shrink** — when the old list is a prefix of the new one, or the
  new one is a prefix of the old, the snapshot proves a tail change even when the syntax is
  inconclusive. The diff emits `grow.append` or `shrink.pop` with
  `reason: "unknown-shape"`. Multiple appended cells are multiple appends in ascending
  index order; multiple removals are multiple pops in descending order, so forward and
  reverse application both stay valid.
* **tuples** — lifecycle only. A tuple whose cells differ cannot be produced by valid
  Python, and the diff does not pretend it can: it emits a `highlight` on the object with
  `reason: "unsupported"` and no cell action, including for an insert/pop source line.
  `applyState` and `reverseActions(actions, state)` reject a tuple cell mutation (section 12).
* **truncation** — a list with `more > 0` never claims movement, growth or shrinkage, even
  when the source line is an insert or pop. Visible cells may still `change`, with
  `reason: "truncated"`. If `more` or the visible length changes, the diff emits a
  `highlight` on the object with `reason: "truncated"` and the transition is classified as
  deferred, because the hidden positions cannot be restored.
* **unsupported list structure** — a structural change the shape and snapshots do not
  prove gets a `highlight` on the object with `reason: "unknown-shape"` or `"unsupported"`;
  it is never guessed as a move. An empty action list means no change this layer models was
  detected, not that the step was skipped. It is not proof that the whole state did not
  change: hidden content and unmodelled facts can still differ (section 11). A dict or set on
  an insert/pop-looking source line never produces a list-cell action.

The non-sequence half is keyed by identity, never by visible position:

* **dictionary entries** — entries are matched by canonical key in insertion order. A new
  key is one `appear` on its `entry` target with `payload.index`; a removed key is one
  `disappear` carrying its value and old index; a changed value is one `change`. Unchanged
  entries produce nothing. Removals are emitted from the highest old index down, then
  changes, then additions from the lowest new index up, so applying the actions recreates the
  after order and reversing them restores the before order exactly. If surviving keys change
  relative order, or a structural change happens while `more > 0`, the transition is
  deferred with a highlight instead of guessing a remove-and-reinsert.
* **set membership** — a set is a bag of values. Its serialization is sorted, so positions
  are not history and never produce movement. Membership is keyed by the member value: an
  added member is one `appear`, a removed member one `disappear`, both on an `entry` target,
  and `payload.index` only restores the sorted snapshot. While a set is truncated, any
  visible membership change or a change in `more` defers the whole transition with a
  highlight; a class change always does.
* **object attributes** — attributes are matched by name on one stable object id. An added
  attribute is one `appear` with `payload.index`, a removed one one `disappear`, and a
  changed one one `change`; unchanged attributes produce nothing. Reordering surviving
  attributes is deferred. The tracer shows at most 30 attributes and records no `more`
  marker, so an addition to an object already showing 30 could be a hidden attribute
  surfacing; that case is deferred rather than invented. A class change is deferred, and a
  changed `other` entry (for example a `__slots__` instance) is `unsupported`.
* **non-sequence lifecycle** — a dictionary, set or object that becomes reachable is one
  `appear` on the `object` target carrying the whole entry; one that stops being reachable
  is one `disappear` carrying its last entry. Lifecycle is not followed by content actions,
  and reversing the whole-entry action restores the object and its contents exactly.
  A transition between sequence and non-sequence kinds is `unsupported`.

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

Tasks 5a–5c model list and tuple state as described in section 9: lifecycle, visible cell
changes, append/insert/pop/delete, state-proven tail growth/shrink and truncation fallbacks,
all exactly reversible, plus verified swap/shift movement. Task 6 adds dictionary entries,
set membership, object attributes and non-sequence lifecycle with the same exact inverse.
A transition is never silently skipped: a modelled part either round-trips or carries a
highlight with a reason. Ambiguous or hidden changes can still produce no action for that
change, so an empty list is not proof that the whole state is unchanged (section 11).

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

## 11. Reporting ambiguity and unsupported cases *(reporting: task 8)*

Fallback reasons are a closed set:

| Code | Meaning |
|---|---|
| `duplicate-values` | more than one minimal explanation; a value diff cannot choose |
| `truncated` | the tracer's `more` hides positions |
| `unknown-shape` | the statement parser could not classify the line |
| `index-unavailable` | an index expression could not be evaluated safely |
| `unsupported` | the state exists but this layer cannot model it honestly |

Rules:

* no step is dropped. A step with no visible change may legitimately yield `[]`. Most
  changes this layer cannot model yield a conservative action carrying a reason, but that is
  not an absolute rule: a change wholly hidden behind `more`, or a hidden attribute on a
  capped object, can leave no visible evidence and therefore no action. Absence of an action
  is not a claim that the state did not change;
* every fallback action explains itself in `reason` (and optionally `payload.note`);
* the task-6 suite asserts the classification and exact counts for the corpus and
  recognition fixtures — event steps, supported steps, deferred steps and fallback reasons.
  It does not print a per-program report; that report belongs to task 8;
* an empty result means this diff detected no change it models. It is **not** proof that
  nothing changed, because hidden content behind `more` can change without altering the
  visible snapshot. It never means "skipped".

**Task 6 closes the non-sequence gap. Every corpus transition is now supported.**
The suite classifies **every** event step of the corpus and recognition fixtures: 2933 over
114 programs, of which 114 are run-start steps and the other 2819 are consecutive state
pairs. All 2933 event steps round trip forward and backward, including all 2819 consecutive
pairs, so **0 pairs are deferred**. The 37 pairs deferred at task 5 were exactly
dict/set/object content and non-sequence lifecycle changes; each now applies and reverses its
own actions to the exact before and after state. No list transition was deferred for lack of
an action, and none is now. The test still applies and reverses the frame and variable
actions separately for every step and checks every list/tuple object on either side
individually, so a whole-state pass cannot hide a broken frame, variable or sequence object.
The fixture counts remain pinned exactly, not used as thresholds.

The fixtures do not contain an insert/pop source, so genuine insert/pop trace coverage remains
deferred. Synthetic snapshot pairs pin those shapes instead: literal and variable insertion
indices, including negative and out-of-range values; duplicate insertion and removal
disambiguation by source index; aliases; bare versus explicit pop, including the last and only
cell; empty lists; evidence mismatches; unresolved indices; tuple, dict and set sources;
truncated lists; delayed nested calls; and malformed actions. Insert and pop state actions round-trip exactly,
and the conservative cases never claim an insert or delete. The fixtures also do not contain
every fallback, so synthetic pairs pin the rest: a `more` change under truncation, a
visible-length change with `more` unchanged, a tuple cell mutation, a non-tail structural
change with no usable shape, and a recognized middle `del`. The first three are conservative
(`highlight` or visible `change` with a reason, never a guessed state action); the middle
`del` is a supported `shrink.delete`.

`list-mutation` additionally pins the sort, reverse, subscript assignment and tail `del`
with their recorded contents. `list-basics`, `alias-shared`, `class-basic`, `tuple-unpack`,
`filter-list`, `bubble-truncated` and `merge-sort` pin lifecycle, aliasing, nested receiver
resolution, tuple immutability, truncated changes and state-proven tail growth. Swap, shift
and insert/pop shapes are pinned separately; real insert/pop trace coverage remains deferred
until a fixture records one.

Dictionary, set and object coverage is deliberately split between real traces and synthetic
pairs. Real traces pin a dictionary key addition and value change (`dict-basics` steps 3 and
4), a set member addition (`set-basics` step 3), an object lifecycle appearance plus two
attribute additions (`class-basic` steps 8, 10 and 11), and an attribute value change
(`combo-class-loop-dict` step 16). Non-sequence lifecycle disappearance is also observed:
dictionary and object entries leave the heap in `comprehension`, `function-star-args`,
`exception-custom` and `recognition/linear-dict`, and the whole-corpus round trip covers it.
The corpus contains no dictionary, set or attribute removal, so removals, empty containers,
mixed add/remove/change transitions and keyed action-id determinism are pinned synthetically;
the focused lifecycle test uses synthetic snapshots even though the corpus also exercises
both directions. Synthetic pairs also pin every deferred non-sequence case named in section
9: dictionary reordering, truncated dictionary membership, set truncation and class changes,
object reordering, an addition to a capped object, and malformed entry/attribute actions.
Synthetic-only behavior is never described as observed in a real trace.

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
pass. If a supported transition cannot satisfy it, the diff is wrong and must change, not the
test. A transition explicitly deferred under section 11 is not yet a counterexample, but
its frame, variable and modelled object parts must still satisfy the property.

**Tasks 5a–5c and 6 prove exact inversion over every fixture transition.**
The property is proven for all 2819 consecutive pairs (the 2933 event steps include 114
run-start steps): all 2819 pairs round trip as whole snapshots, and all 2933 event steps are
supported. The 37 pairs deferred at task 5 were exactly dict/set/object content and
non-sequence lifecycle changes; each now applies and reverses to the exact before and after
state. The six task-4 golden programs are unchanged and still round trip in full. Movement,
insert/pop, keyed entries and attributes and non-sequence lifecycle are proven with the same
property. Genuine insert/pop trace coverage is still absent because the current fixtures
contain no such source, and real dictionary/set/attribute removals are likewise absent;
synthetic snapshot pairs prove those shapes and the exact inverse pairs. A hidden-only change
behind `more` cannot be observed in either snapshot, which is why an empty action list remains
weaker than state equality; the suite does not claim to detect one.

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
| `move` `shift` (`a[i+1] = a[i]`, `i → i+1`) | one `change` on the destination cell `i+1`, `from` the copied value and `to` the overwritten value; the source cell `i` is unchanged. Never a shift in the opposite direction. |
| `call` (frame) | `disappear` (frame, `from` = the frame) |

For a dictionary entry, set member or object attribute, the element in the first two rows is
that entry or attribute, including its `payload.index`; reversing an appearance removes it
by key/name, and reversing a disappearance reapplies it at the recorded index. That is what
restores insertion order, not merely membership.

A shift-copy is not a rotation. `a[i+1] = a[i]` copies the source over the destination and
leaves the source in place, so reversing it must restore the overwritten destination value;
reversing the arrow would copy the wrong value back into `i`.

**Overlays are not inverted — they are discarded.** On backward playback and on a seek,
every overlay of the previous step is dropped (`overlayActionsAt` returns none for the new
step); a forward step installs only its own. This is tested separately from the snapshot
property, so a passing reversibility test can never hide a stuck flash or a stale arrow.

The suite runs the property over **every** program in the corpus and the recognition
fixture and over **every** consecutive state pair — not a sample. Every frame, variable,
list/tuple, dictionary, set and object is compared as part of the exact section-3 state, so a
passing whole-state comparison cannot hide a broken frame or object.

### Tasks 5a–5c and 6 status of the property

`applyState`, `reverseActions` and `stateActions` implement the contract for the kinds tasks
5a–5c and 6 emit: `appear`, `disappear`, `change`, `call`, object lifecycle, cell changes,
`grow.append`/`grow.insert`, `shrink.pop`/`shrink.delete`, and keyed entry/attribute content.
A verified insert applies at its normalized index and reverses to a delete at the same index;
a bare pop reverses to an append, and an explicit pop (including the last cell) reverses to an
insert. A dictionary entry or object attribute appearance splices at its carried
`payload.index`; its inverse removes the same key or name, and a disappearance reverses to an
appearance at the old index. Set membership is value-keyed and carries its sorted index only
for exact restoration. Overlays are dropped by `reverseActions` and ignored by `applyState`,
so they can never mutate the snapshot. `move.swap` is applied as exactly one exchange of its
index pair and reversed by itself; `move.shift` updates only its destination and reverses to
one `change` restoring the overwritten value. A malformed `move` pair, target or index pair,
a malformed `grow`/`shrink` target, a missing payload index, a tuple cell mutation, a
non-dictionary entry change, or a middle `shrink.pop` is rejected rather than half-applied.
`reverseActions(actions, state)` takes the optional after-state precisely so it can reject a
tuple-cell inverse; without it, the function cannot know a container's type.

The suite runs the property on the six task-4 golden programs, on every collection program
of the fixtures, and on **every** event step of the corpus and recognition fixtures — 2933
over 114 programs, including 114 run starts and 2819 consecutive pairs. All 2933 event steps
round trip forward and backward; that is every run start plus all 2819 pairs, with no
deferred pair left. Synthetic pairs check the ambiguous cases separately and require a
highlight with no state action, so a deferred shape is never counted as supported. The
comparison is strict deep equality of the state object of section 3: object key order is not
part of the state, and nothing is normalised, sorted or filtered. The fixture counts are
pinned in the test, not used as thresholds, so a regenerated fixture must update them
deliberately.

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
| 5 | list/tuple diff, movement inference, ambiguity fallbacks | **done:** 5a (lifecycle, visible cell changes, append/delete, state-proven tail growth/shrink), 5b (swap/shift movement), 5c (insert/pop shapes, truncation and delayed-call fallbacks) |
| 6 | dict/set/object contents, keyed entries/attributes and non-sequence lifecycle | **done:** keyed add/remove/change with exact inverse, whole-entry lifecycle, ambiguous reorder/truncation/cap cases deferred with a highlight |
| 7 | `apply.js` + whole-corpus reversibility property | partly: `applyState`/`reverseActions` and the property for variables, frames, console facts, list/tuple state and dict/set/object state landed over the whole fixture corpus; `apply.js` remains |
| 8 | golden action lists (20+ programs), determinism report, fixture wiring | partly: six task-4 goldens plus task-5 collection goldens and task-6 real/synthetic keyed-action tests; the per-program report and full golden set remain |
