# Data Structures Lab

The lab is an **authored operation model**, not a recorded Python program. Every
step you see was produced by applying one operation to a plain JavaScript state
and snapshotting the result. The page says so in its badge, and the separation
is the same one the Python canvas keeps: the model never runs Python, and the
drawing never invents a value or an event.

Source: `src/datastructures/`. The page lives at
`/visualizer/data-structures/:type`; lessons can deep-link a prepared dataset
with `?preset=<id>`.

## Registry

`model.js` is the registry: each structure declares a name, a blurb, a starting
state, the operations the page offers (with typed fields and defaults), and a
`run(state, op, input)` function that returns `{ state, frames }` or `{ error }`.

| Structure | Operations |
|---|---|
| Array | append, insert, remove, search, resize, clear |
| Linked list | prepend, append, remove, search, traverse, traverse backward, mode (singly/doubly), make cycle, break cycle, detect cycle |
| Stack | push, pop, peek, search |
| Queue | enqueue, dequeue, peek, mode (simple/circular/priority) |
| Binary search tree | insert, search, delete, in-order |
| Graph | add node, remove node, add edge, remove edge, set start, direction, breadth-first, depth-first |
| Hash table | insert/update, search, contains, delete, update value, clear, load dataset, apply settings, resize, force rehash |

An **error** leaves the state untouched and says why. Capacity, duplicate keys,
missing keys, an invalid index, a bad cycle target, an unreachable start node
and a capacity that would lose entries are all refused rather than repaired
silently.

## Frames are snapshots

`frames.js` defines one frame shape shared by every structure:

```js
{ state, text, marks, detail }
```

- `state` is a deep clone. Back, Next and the slider draw a past frame directly,
  so a highlight from a later step cannot survive and no inverse operation has
  to exist.
- `text` is one sentence about what happened. It is written by the operation,
  not by a second narrator.
- `marks` names keys in the drawing: `active`, `compare`, `done`, `found`,
  `collision`, `inserted`, `deleted`, `tombstone`.
- `detail` is structured, optional data for the readout (raw hash, bucket,
  probe count, load factor, tombstone flag). It is the same object the drawing's
  journey chips read, so the sentence and the numbers cannot disagree.

Applying a new operation always starts from the structure's final recorded
state, so a half-seeked playback cannot fork into a state that never happened.

## Hash table semantics

Keys are exact, case-sensitive strings (trimmed, at most 24 characters). Values
are strings. An integer-looking key (`-?\d+`) uses its integer value for the raw
hash; any other key uses the sum of its character codes, unless the hash
function says otherwise.

| Hash function | Raw hash |
|---|---|
| Division | integer value, or the character-code sum |
| Multiplication | same, then `floor(capacity × frac(raw × 0.618…))` |
| Polynomial | rolling `h = h × 31 + code` as an unsigned 32-bit integer |
| First character | the first code point only (deliberately poor) |

`bucketIndex()` is the only place a raw hash becomes an index, so a displayed
calculation can never disagree with the state that is changed. Division,
polynomial and first-character use a true modulo; multiplication uses the
golden-ratio fractional part.

### The formula breakdown

`hashBreakdown(hashFn, key, capacity)` returns the intermediate arithmetic as
data — the input, each character's code and running sum or accumulation, the
multiplication constant and fraction, the division remainder and quotient, the
final index — plus the formula string and the term each step is working on.
Every hash frame carries the same object in `detail.breakdown`.

The panel under the buckets renders that object; it never evaluates a formula
of its own. Stepping marks the matching formula term, the key field calls the
same engine function, and Reset returns to the key the current step used. A test
pins each breakdown's last accumulation to `rawHash()` and its index to
`bucketIndex()` for every hash function, several capacities and integer,
negative and string keys.


`hashStep()` is used only by double hashing:
`1 + (|raw| mod (capacity − 1))`. The `1 +` guarantees a non-zero step.

### Strategy contracts

| Strategy | Placement | Lookup stops at | Deleting |
|---|---|---|---|
| Separate chaining | append to the bucket's chain | the end of the chain | removes the entry; chain closes up |
| Linear probing | next slot, wrapping | the first empty slot | writes a tombstone |
| Quadratic probing | base + `i + i²`, wrapping | the first empty slot | writes a tombstone |
| Double hashing | base + `i × step`, wrapping | the first empty slot | writes a tombstone |

Two honest limits are part of the contract, not bugs:

- **Quadratic probing may not reach every slot.** The offset sequence can repeat
  before it has visited the table. The model then reports that every *reachable*
  slot was inspected and refuses the insert instead of jumping to a slot the
  key's own probe sequence would not use. Grow the table or change strategy.
- **Double hashing requires a prime capacity.** Every step from 1 to
  `capacity − 1` is then coprime with the capacity, so the walk reaches every
  slot. The model refuses a non-prime capacity and grows to the next prime
  rather than doubling.

### Tombstones

Open addressing cannot write an empty slot on delete: a lookup stops at the
first empty slot, so emptying a slot in the middle of a probe path would make a
later key unreachable. A delete writes `{ tombstone: true }` instead.

- A lookup walks past a tombstone.
- An insert remembers the first tombstone it passes, keeps probing to an empty
  slot (or until the path repeats), and only then reuses that tombstone.
- Tombstones are not keys: they do not count towards the load factor, but they
  do occupy slots and lengthen probes. A rehash drops them.
- Chaining needs no tombstones; its delete removes the entry.

### Load factor, threshold and growth

`load = count / capacity`. The default threshold is `0.75`; `Apply settings`
accepts `0.10–2.00`, and open addressing is capped at `0.95` because it needs a
genuine empty slot. Chaining may use a threshold above 1.00, which is how the
lab demonstrates a load factor above 1.

Growth is checked after an insert (and once after a dataset load), never during
a probe:

- Chaining, linear and quadratic double the capacity.
- Double hashing moves to the next prime.
- The maximum supported capacity is 97; growth stops there instead of failing.

A resize is a **full rebuild**: the old table is kept as a `before` strip while
the new one is allocated, every key is reinserted with the new capacity, and the
final frame states that all keys are reachable. Indices are never copied.
`Force rehash` does the same at the current capacity, which is the way to drop
tombstones.

### Presets

Datasets live in `HASH_PRESETS` so a lesson cannot invent one the engine
rejects. A preset may name the strategy it needs — the `deletions` preset must
load as open addressing, or no tombstone would ever appear.

| id | Story |
|---|---|
| `sparse` | few keys in a large table |
| `crowded` | many keys in a small table (grows on load) |
| `colliders` | keys with identical character sums |
| `linear`, `quadratic`, `double` | the same colliding keys under each probing strategy |
| `clustering` | linear probing with a growing cluster |
| `sequential` | sequential integer keys |
| `updates` | one key updated three times |
| `deletions` | open-addressing deletes that leave two tombstones |
| `resize` | a workload that crosses the threshold |

## Complexity

| Operation | Expected / average | Worst case |
|---|---|---|
| Insert | O(1) under a good hash and bounded load | O(n) |
| Search / contains | O(1) under the same assumptions | O(n) |
| Delete | O(1) under the same assumptions | O(n) |
| Update | O(1) under the same assumptions | O(n) |
| Rehash / resize | O(n) | O(n) |

The comparison table below the lab reports **measured operation-model counts**
(entries or slots inspected, and inspections that found a different key) for all
four strategies on the same workload. It deliberately turns resizing off so the
strategies answer the same question. These are not timings: timing a tiny table
in a browser measures noise.

## What this lab does not do

- No Robin Hood hashing, cuckoo hashing, incremental rehashing or universal
  hashing. They are separate designs with their own trade-offs and are recorded
  as a follow-up, not quietly implied.
- No cryptographic hash and no adversarial-collision resistance. The hashes are
  deterministic teaching functions; values are not secret and keys are not
  large.
- Keys and values are short strings, capacity is capped at 97, and a resize is
  one visible rebuild rather than an incremental migration.
- The priority queue is a stable sorted-array teaching model, not a binary heap.

## Tests

- `hashTable.test.mjs` — every hash function, every strategy, probes, tombstone
  reuse, growth policies, resizes, presets, determinism, and the invariant that
  every stored key can be read back.
- `structures.test.mjs` — array resize/clear, doubly linked traversal and cycle
  detection, stack search, circular/priority queues, BST deletion, graph editing
  and direction.
- `model.test.mjs` — registry shape, refusal without partial state, independent
  snapshots.
- `lessons.test.mjs` — a lab lesson names a real structure and a real preset.
- `npm run check:browser` drives the real page: the hash journey, chaining vs
  all three probe strategies on the same keys, tombstones, the before/after
  strip during a resize, the predict-the-bucket check, and a seeded lesson link.
