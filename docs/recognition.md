# Algorithm recognition

`src/tracer/recognition.js` combines the static program profile
(`docs/program-profile.md`) with the execution trace (`docs/trace-format.md`)
and returns one deterministic decision:

```js
{
  adapterId: "generic" | "recursion" | "searching" | "sorting",
  confidence: 0.0,
  evidence: [],
  unavailableReason: null,
}
```

The static profile says what the syntax can do. The trace says what actually
ran. A specialized adapter is returned only when **both** sides provide every
mandatory piece of evidence. The generic adapter is the safe default, and it is
always available. This phase does not choose a visualizer adapter or change the
UI.

`recognizeProgram({ profile, trace, status? })` and
`recognizeProgram({ profile, result })` are accepted. The function never throws
for malformed input. A missing or malformed profile, a syntax error, an empty
trace, a partial trace, or a trace without frames becomes `generic` with a
reason.

## Adapter priority

All required checks for an adapter must pass before it can win. When more than
one adapter qualifies, the more specific runtime evidence wins:

1. `sorting`
2. `searching`
3. `recursion`
4. `generic`

The priority is fixed, so the same inputs always produce the same result.

## Evidence shape

Every result has an inspectable `evidence` array. Each entry has:

| Field | Meaning |
|---|---|
| `source` | `"profile"` or `"trace"` |
| `kind` | A stable evidence identifier |
| `detail` | A short explanation |
| optional fields | Source line, function name, container name, observed count, or bound names |

Evidence never contains a value that was not present in the profile or trace.
Counts such as `index_value_count` are counts of distinct observed index
values, not invented index values. `bounds` is a list of variable names, not
fabricated bound values.

## Sorting

A sorting result requires all of the following:

- A loop comparison using an ordering operator (`<`, `<=`, `>`, `>=`).
- The comparison reads sequence elements. Either it has two indexed operands,
  or it has one indexed operand and a scalar element-like operand.
- A sequence mutation inside a related loop in the same function. Related means
  the same loop, or an outer/inner loop of the same comparison structure.
  Built-in `sort` / `reverse` operations are not accepted as evidence.
- The comparison line ran.
- The mutation line ran.
- The same list object visibly changed immediately after the mutation line.

For a single-indexed comparison (for example a key or pivot), the mutated
container must be the indexed container, and the scalar operand must be
observed as an element of that container. This rejects filtering into a
different result list.

Confidence: `0.95` for a two-element comparison; `0.9` for a single-indexed
comparison. Built-in ordering alone is reported as
`builtin_ordering`, with a generic result: Python's internal comparisons were
not recorded by the tracer.

## Searching

### Binary-like

A binary result requires all of the following:

- An ordering comparison inside a loop, with exactly one indexed operand and
  one simple scalar target operand.
- An `index_read` at the comparison line in the profile.
- The comparison line ran repeatedly in one call frame.
- The indexed container is a list, tuple, or string at runtime.
- The target value is stable within that frame.
- The observed index has at least two distinct values.
- Two other observed numeric variables change monotonically so their interval
  narrows.
- At least one observed index lies between those bounds.

Confidence: `0.95`. If the structure exists but the trace does not show
narrowing bounds, the result stays generic. The engine does not guess `low`,
`high`, `mid`, or `target` values that the trace did not record.

### Linear-like, indexed

A linear result requires all of the following:

- An equality comparison inside a loop, with exactly one indexed operand and
  one simple scalar target operand.
- An `index_read` at the comparison line in the profile.
- A return inside the loop that contains the comparison.
- Repeated comparisons in one frame, with a stable target and a changing
  numeric index.
- A list, tuple, or string at runtime.

Confidence: `0.85`.

### Linear-like, iterated

A linear result can also come from a simple `for item in sequence` loop when:

- The comparison is equality between the loop target and a simple target
  variable.
- A return is inside that loop.
- The iterated object is a list, tuple, or string at runtime.
- The target is stable and the loop variable takes more than one observed
  value in one frame.

Confidence: `0.8`. The trace does not record an index for this form, so no
index is reported or invented.

Dictionaries, sets, range loops without a sequence, loops that only count
matches, and linear loops without a return inside the search loop remain
generic.

## Recursion

### Direct

A direct recursion result requires:

- A profile self-call or `direct_self_recursion` flag.
- A runtime stack where the same function appears immediately inside itself at
  two different frame ids.

Confidence: `0.95` when the inner frame's call line matches a static self-call;
`0.9` when the frames match but the line cannot be matched.

### Mutual

A mutual recursion result requires:

- A profile `mutual_candidates` group.
- A nested runtime run of at least three frames from that group with one
  function repeated at a different depth.

Confidence: `0.9`.

An ordinary chain of unrelated calls has nested frames but no repeated
function, so it stays generic. Nested runtime frames without a matching static
cycle also stay generic.

## Confidence and fallback

| Adapter | Confidence rule |
|---|---|
| `sorting` | `0.95` two-element comparison, `0.9` single-indexed comparison |
| `searching` | `0.95` binary-like, `0.85` indexed linear, `0.8` iterated linear |
| `recursion` | `0.95` direct with call-line match, `0.9` direct without, `0.9` mutual |
| `generic` | `0.0` |

Confidence is a fixed classification score, not model judgment. It cannot make
a result specialized when a mandatory check failed.

For generic results, `unavailableReason` names the most useful observed reason:
a syntax error, an empty trace, a built-in ordering call, missing mutation
evidence, missing narrowing bounds, an incomplete trace, or no matching
structure. The same explanation is also placed in the evidence array.

## Tests and corpus coverage

`src/tracer/recognition.test.mjs` reads `recognition.json.gz`, produced by
`tracer-poc/dump_recognition.py`. The fixture contains:

- Real traces and real analyzer profiles for linear/binary search, several
  sorting programs, already-sorted and duplicate input, built-in sorting,
  plain loops, dictionary iteration, ambiguous scans, and a call chain.
- A real analyzer profile for every corpus program; corpus traces still come
  from the existing `corpus.json.gz`.

The suite checks positive and negative cases, all corpus programs, determinism,
evidence shape, malformed input, empty and truncated traces, syntax errors, and
that built-in sorting is never presented as traced comparisons.

## Known limits

- The profile has only syntax-level call candidates; dynamic calls and
  duplicate names can leave a recursion candidate ambiguous.
- A recursive binary search with one comparison per call frame is not
  recognized as binary-like; the current rule needs repeated observations in
  one frame.
- Linear search implemented with `break` or a found flag, rather than a return
  inside the loop, remains generic.
- A sorting program whose list changes are not visible in the trace snapshot
  (for example, changes beyond a truncated container) remains generic.
- An already-sorted sorting run has no mutation evidence, so it remains generic
  rather than guessing from the final order.
- Attribute containers, dynamic containers, comprehensions, and built-in
  ordering internals may stay generic. No type inference is performed.
