/* The hash table's authored operation model.
 *
 * Same contract as the rest of the lab: a pure function of (state, operation,
 * input) returns `{ state, frames }` or `{ error }`, every frame is a complete
 * snapshot, and nothing here is a Python trace.
 *
 * Hashing is explicit and deterministic — never the runtime's randomised
 * string hash — so a replay of the same operation always produces the same
 * bucket indices. Keys are compared as exact, case-sensitive strings.
 *
 * The table has one shape with two readings:
 *   chaining: table[i] is an array of { key, value } entries
 *   probing:  table[i] is null, { key, value }, or { tombstone: true }
 * `count` counts stored keys; `tombstones` counts deleted probes only.
 */

import { frame } from './frames.js';

export const MIN_CAPACITY = 4;
export const MAX_CAPACITY = 97;

export const HASH_FUNCTIONS = [
  { id: 'division', label: 'Division: raw hash mod capacity' },
  { id: 'multiplication', label: 'Multiplication: golden-ratio fraction' },
  { id: 'polynomial', label: 'Polynomial: base 31' },
  { id: 'first-char', label: 'First character only (deliberately poor)' },
];

export const HASH_STRATEGIES = [
  { id: 'chaining', label: 'Separate chaining' },
  { id: 'linear', label: 'Linear probing' },
  { id: 'quadratic', label: 'Quadratic probing' },
  { id: 'double', label: 'Double hashing' },
];

/** Playground datasets. `pairs` preserve insertion order; `deletes` run after
 *  the inserts and are what make tombstones visible in the lab. A dataset may
 *  name the strategy it needs, because the same keys tell a different story
 *  under chaining than under probing. */
const COLLIDING_PAIRS = [
  ['ab', '1'],
  ['ba', '2'],
  ['ac', '3'],
  ['ca', '4'],
  ['bb', '5'],
];

const CLUSTERING_PAIRS = [
  ['ant', '1'],
  ['bee', '2'],
  ['cat', '3'],
  ['dog', '4'],
  ['eel', '5'],
  ['fox', '6'],
  ['gnu', '7'],
  ['hen', '8'],
];

export const HASH_PRESETS = {
  sparse: {
    label: 'Few keys, large table',
    capacity: 13,
    pairs: [
      ['apple', '4'],
      ['banana', '9'],
      ['cherry', '2'],
      ['date', '7'],
    ],
  },
  crowded: {
    label: 'Many keys, small table',
    capacity: 7,
    pairs: CLUSTERING_PAIRS,
  },
  colliders: {
    label: 'Deliberately colliding keys',
    capacity: 7,
    pairs: COLLIDING_PAIRS,
  },
  linear: {
    label: 'Colliding keys under linear probing',
    capacity: 7,
    strategy: 'linear',
    pairs: COLLIDING_PAIRS,
  },
  clustering: {
    label: 'Linear probing with a growing cluster',
    capacity: 11,
    strategy: 'linear',
    pairs: CLUSTERING_PAIRS,
  },
  quadratic: {
    label: 'Colliding keys under quadratic probing',
    capacity: 7,
    strategy: 'quadratic',
    pairs: COLLIDING_PAIRS,
  },
  double: {
    label: 'Colliding keys under double hashing',
    capacity: 7,
    strategy: 'double',
    pairs: COLLIDING_PAIRS,
  },
  sequential: {
    label: 'Sequential integer keys',
    capacity: 13,
    pairs: [
      ['10', 'a'],
      ['11', 'b'],
      ['12', 'c'],
      ['13', 'd'],
      ['14', 'e'],
      ['15', 'f'],
      ['16', 'g'],
    ],
  },
  updates: {
    label: 'Repeated updates of one key',
    capacity: 7,
    pairs: [
      ['score', '10'],
      ['score', '25'],
      ['score', '40'],
    ],
  },
  deletions: {
    label: 'Deletions that leave tombstones',
    capacity: 11,
    strategy: 'linear',
    pairs: [
      ['ant', '1'],
      ['bee', '2'],
      ['cat', '3'],
      ['dog', '4'],
      ['eel', '5'],
    ],
    deletes: ['bee', 'dog'],
  },
  resize: {
    label: 'A workload that triggers resizing',
    capacity: 7,
    pairs: CLUSTERING_PAIRS,
  },
};

export const hashFunctionLabel = (id) =>
  HASH_FUNCTIONS.find((entry) => entry.id === id)?.label ?? id;
export const strategyLabel = (id) =>
  HASH_STRATEGIES.find((entry) => entry.id === id)?.label ?? id;

/** The multiplier multiplication hashing really uses. Exported so the
 *  breakdown and the index cannot drift apart. */
export const GOLDEN_FRACTION = 0.6180339887498949;

const isPrime = (value) => {
  if (!Number.isInteger(value) || value < 2) return false;
  for (let n = 2; n * n <= value; n += 1) if (value % n === 0) return false;
  return true;
};

const nextPrime = (value) => {
  let n = Math.max(5, value | 0);
  while (n <= MAX_CAPACITY && !isPrime(n)) n += 1;
  return n <= MAX_CAPACITY ? n : MAX_CAPACITY;
};

/** The capacity policy for one growth step: powers of two for chaining and
 *  linear/quadratic probing, the next prime for double hashing. */
export function nextCapacity(strategy, capacity) {
  if (capacity >= MAX_CAPACITY) return capacity;
  if (strategy === 'double') return Math.min(nextPrime(capacity * 2), MAX_CAPACITY);
  return Math.min(capacity * 2, MAX_CAPACITY);
}

export const emptyTable = (capacity, strategy) =>
  strategy === 'chaining'
    ? Array.from({ length: capacity }, () => [])
    : Array(capacity).fill(null);

export const HASH_START = {
  capacity: 7,
  strategy: 'chaining',
  hashFn: 'division',
  threshold: 0.75,
  table: emptyTable(7, 'chaining'),
  count: 0,
  tombstones: 0,
  previous: null,
};

const codeSum = (text) =>
  [...text].reduce((sum, character) => sum + (character.codePointAt(0) ?? 0), 0);

/** The raw hash, before the table's capacity is involved.
 *
 *  - division / multiplication: an integer-looking key uses its integer value;
 *    anything else uses the sum of its character codes;
 *  - polynomial: base-31 rolling hash, kept as an unsigned 32-bit integer;
 *  - first-char: the first character's code, which is deliberately bad so the
 *    lab can show clustering and collisions. */
export function rawHash(hashFn, key) {
  const text = String(key);
  if (hashFn === 'polynomial') {
    let hash = 0;
    for (const character of text) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
    return hash;
  }
  if (hashFn === 'first-char') return text ? (text.codePointAt(0) ?? 0) : 0;
  const numeric = /^-?\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(numeric) ? numeric : codeSum(text);
}

/** Normalise a raw hash into a valid bucket index. This is the only place the
 *  model turns a hash into an index, so a displayed calculation can never
 *  disagree with the state being changed. */
export function bucketIndex(hashFn, key, capacity) {
  const raw = rawHash(hashFn, key);
  if (hashFn === 'multiplication') {
    const scaled = raw * GOLDEN_FRACTION;
    return Math.floor(capacity * (scaled - Math.floor(scaled)));
  }
  return ((raw % capacity) + capacity) % capacity;
}

/** The probe offset for double hashing. With a prime capacity every step in
 *  1..capacity-1 is coprime to the capacity, so the walk can reach every slot. */
export function hashStep(hashFn, key, capacity) {
  return 1 + (Math.abs(rawHash(hashFn, key)) % (capacity - 1));
}

/* --- The calculation, as data --------------------------------------------- */

/* The panel that explains a hash renders these steps; it never evaluates a
 * formula of its own. Each step's `term` is a literal substring of `formula`,
 * so the UI can mark the part of the formula the step is working on. */

const moduloStep = (raw, capacity, index) => {
  const quotient = Math.floor(raw / capacity);
  return {
    term: 'mod m',
    title: 'Bucket index',
    expression:
      raw < 0
        ? `((${raw} mod ${capacity}) + ${capacity}) mod ${capacity} = ${index}`
        : `${raw} mod ${capacity} = ${index}`,
    result: String(index),
    note:
      raw < 0
        ? `The remainder is kept in 0..${capacity - 1}, so a negative key still lands in the table.`
        : `${raw} = ${quotient} × ${capacity} + ${index}`,
  };
};

const inputStep = (text) => ({
  term: 'k',
  title: 'Input',
  expression: `k = "${text}"`,
  result: text,
  note: 'Keys are compared as exact strings, so the hash first needs a number.',
});

/** The character-code walk that division and multiplication both use for a
 *  non-integer key. Returns the running sum, which must equal `rawHash`. */
const characterSteps = (text, steps) => {
  let sum = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    const before = sum;
    sum += code;
    steps.push({
      term: 'Σ char codes',
      title: `Character "${character}"`,
      expression: `${before} + ${code} = ${sum}`,
      result: String(sum),
      note: `code point ${code}`,
    });
  }
  return sum;
};

/** The integer encoding a key has for the arithmetic hashes, or null when it
 *  is a string that gets summed. */
const integerKey = (text) => {
  const numeric = /^-?\d+$/.test(text) ? Number(text) : NaN;
  return Number.isSafeInteger(numeric) ? numeric : null;
};

/**
 * Every intermediate number behind one bucket index, for the explanation panel.
 *
 * The first and last values come from `rawHash` and `bucketIndex`; the steps in
 * between are the arithmetic those two perform. `hashTable.test.mjs` pins the
 * accumulation to the returned raw hash for every function, so a step can never
 * quietly disagree with the index the table actually used.
 */
export function hashBreakdown(hashFn, key, capacity) {
  const text = String(key);
  const raw = rawHash(hashFn, key);
  const index = bucketIndex(hashFn, key, capacity);
  const steps = [];
  const numeric = integerKey(text);
  let formula;

  if (hashFn === 'polynomial') {
    formula = 'h₀ = 0; hᵢ = (hᵢ₋₁ × 31 + code(cᵢ)) mod 2³²; index = raw mod m';
    steps.push({ term: 'h₀', title: 'Start', expression: 'h = 0', result: '0', note: 'The accumulator starts empty.' });
    let hash = 0;
    for (const character of text) {
      const code = character.codePointAt(0) ?? 0;
      const before = hash;
      const unwrapped = before * 31 + code;
      hash = unwrapped >>> 0;
      steps.push({
        term: 'hᵢ₋₁ × 31',
        title: `Character "${character}"`,
        expression: `h = ${before} × 31 + ${code} = ${hash}`,
        result: String(hash),
        note:
          unwrapped > 0xffffffff
            ? 'Wrapped to an unsigned 32-bit integer, exactly as the engine does.'
            : `code point ${code}`,
      });
    }
    steps.push(moduloStep(raw, capacity, index));
    return { fn: hashFn, key: text, capacity, raw, index, formula, steps };
  }

  if (hashFn === 'first-char') {
    const first = [...text][0];
    formula = 'index = code(k[0]) mod m';
    steps.push(
      first
        ? {
            term: 'k[0]',
            title: 'First character only',
            expression: `code("${first}") = ${raw}`,
            result: String(raw),
            note:
              text.length > 1
                ? `The other ${text.length - 1} characters are ignored on purpose: that is what makes this function collide.`
                : 'There is only one character, so nothing is ignored.',
          }
        : { term: 'k[0]', title: 'Empty key', expression: 'raw = 0', result: '0', note: 'An empty key has no first character.' },
    );
    steps.push(moduloStep(raw, capacity, index));
    return { fn: hashFn, key: text, capacity, raw, index, formula, steps };
  }

  if (hashFn === 'multiplication') {
    formula = `raw = k or Σ char codes; scaled = raw × ${GOLDEN_FRACTION}; index = floor(m × frac(scaled))`;
    steps.push(inputStep(text));
    if (numeric !== null) {
      steps.push({
        term: 'k',
        title: 'Integer key',
        expression: `"${text}" → ${numeric}`,
        result: String(numeric),
        note: 'An integer-looking key hashes as its integer value.',
      });
    } else {
      characterSteps(text, steps);
    }
    const scaled = raw * GOLDEN_FRACTION;
    const whole = Math.floor(scaled);
    const fraction = scaled - whole;
    steps.push({
      term: GOLDEN_FRACTION,
      title: 'Multiply by the constant',
      expression: `${raw} × ${GOLDEN_FRACTION} = ${scaled}`,
      result: String(scaled),
      note: `The constant is the fractional part of the golden ratio; the table really uses ${GOLDEN_FRACTION}.`,
    });
    steps.push({
      term: 'frac',
      title: 'Keep the fractional part',
      expression: `${scaled} − ${whole} = ${fraction}`,
      result: String(fraction),
      note: `The whole part ${whole} is discarded.`,
    });
    steps.push({
      term: 'm × frac',
      title: 'Scale by the capacity',
      expression: `floor(${capacity} × ${fraction}) = ${index}`,
      result: String(index),
      note: 'This function scales the fraction instead of taking a remainder.',
    });
    return { fn: hashFn, key: text, capacity, raw, index, formula, steps };
  }

  formula = 'index = raw mod m, where raw = k or Σ char codes';
  steps.push(inputStep(text));
  if (numeric !== null) {
    steps.push({
      term: 'k',
      title: 'Integer key',
      expression: `"${text}" → ${numeric}`,
      result: String(numeric),
      note: 'An integer-looking key hashes as its integer value.',
    });
  } else {
    steps.push({
      term: 'Σ char codes',
      title: 'Encode the string',
      expression: `Σ char codes("${text}")`,
      result: '',
      note: `Each of the ${[...text].length} characters contributes its code point.`,
    });
    characterSteps(text, steps);
  }
  steps.push(moduloStep(raw, capacity, index));
  return { fn: hashFn, key: text, capacity, raw, index, formula, steps };
}


const probeIndex = (strategy, base, step, i, capacity) => {
  if (strategy === 'linear') return (base + i) % capacity;
  if (strategy === 'quadratic') return (base + i + i * i) % capacity;
  return (base + i * step) % capacity;
};

const entriesOf = (state) =>
  state.strategy === 'chaining'
    ? state.table.flat()
    : state.table.filter((cell) => cell && !cell.tombstone);

const loadOf = (state) => state.count / state.capacity;
const percent = (value) => `${(value * 100).toFixed(0)}%`;

const hashLine = (state, key, base) => {
  const raw = rawHash(state.hashFn, key);
  if (state.hashFn === 'multiplication') {
    return `Hash multiplication for ${key}: raw hash ${raw}; take the fractional part of ${raw} × 0.618… and scale it by ${state.capacity} to get bucket ${base}.`;
  }
  if (state.hashFn === 'first-char') {
    return `Hash first character for ${key}: code ${raw}; ${raw} mod ${state.capacity} = ${base}.`;
  }
  if (state.hashFn === 'polynomial') {
    return `Hash polynomial for ${key}: raw hash ${raw}; ${raw} mod ${state.capacity} = ${base}.`;
  }
  return `Hash division for ${key}: raw hash ${raw}; ${raw} mod ${state.capacity} = ${base}.`;
};

const hashShort = (state, key, base) => {
  const raw = rawHash(state.hashFn, key);
  return state.hashFn === 'multiplication'
    ? `raw ${raw} scales to bucket ${base}`
    : `raw ${raw} mod ${state.capacity} = ${base}`;
};

const detailOf = (state, kind, extra = {}) => ({
  kind,
  count: state.count,
  capacity: state.capacity,
  load: loadOf(state),
  ...extra,
});

/** The hash step's detail: its raw number, its bucket, and the engine's own
 *  step-by-step breakdown. The panel below the buckets renders this object. */
const hashDetail = (state, key, base) =>
  detailOf(state, 'hash', {
    key,
    index: base,
    raw: rawHash(state.hashFn, key),
    breakdown: hashBreakdown(state.hashFn, key, state.capacity),
  });

const probeWord = (count) => (count === 1 ? '1 probe' : `${count} probes`);

const keyError = (input) => {
  const key = String(input ?? '').trim();
  if (!key) return { error: 'Type a key first.' };
  if (key.length > 24) return { error: 'Keys are limited to 24 characters in this lab.' };
  return { key };
};

const valueError = (input) => {
  const value = String(input ?? '').trim();
  if (!value) return { error: 'Type a value first.' };
  if (value.length > 24) return { error: 'Values are limited to 24 characters in this lab.' };
  return { value };
};

const capacityError = (input, state, capacity) => {
  if (!Number.isInteger(capacity) || capacity < MIN_CAPACITY || capacity > MAX_CAPACITY) {
    return `Capacity ${input} must be a whole number from ${MIN_CAPACITY} to ${MAX_CAPACITY}.`;
  }
  if (state.strategy === 'double' && !isPrime(capacity)) {
    return `Double hashing needs a prime capacity; ${capacity} is not prime. Try 7, 11, 13, 17 or 23.`;
  }
  if (capacity < state.count) {
    return `Capacity ${capacity} cannot hold the ${state.count} stored keys.`;
  }
  if (state.strategy !== 'chaining' && capacity <= state.count) {
    return `Open addressing needs at least one empty slot: the capacity must be greater than ${state.count}.`;
  }
  return null;
};

/* --- Insert ---------------------------------------------------------------- */

/** Place or update one entry. `sink` is an array of frames, or null when the
 *  caller only wants the counters (the strategy comparison does that). */
function insertCore(state, key, value, sink) {
  const base = bucketIndex(state.hashFn, key, state.capacity);
  const detail = (kind, extra) => detailOf(state, kind, { key, index: base, ...extra });

  if (state.strategy === 'chaining') {
    const bucket = state.table[base];
    if (sink) {
      sink.push(
        frame(state, hashLine(state, key, base), { active: [`b${base}`] }, hashDetail(state, key, base)),
      );
    }
    let probes = 1;
    let collisions = 0;
    for (const entry of bucket) {
      probes += 1;
      if (entry.key === key) {
        const from = entry.value;
        entry.value = value;
        if (sink) {
          sink.push(
            frame(
              state,
              `Key ${key} is already in bucket ${base}; update its value from ${from} to ${value}. The number of keys does not change.`,
              { found: [`e:${key}`] },
              detail('update', { probes }),
            ),
          );
        }
        return { placed: true, updated: true, probes, collisions, slot: base };
      }
      collisions += 1;
      if (sink) {
        sink.push(
          frame(
            state,
            `Compare ${key} with ${entry.key} in bucket ${base}: not equal, follow the chain.`,
            { compare: [`e:${entry.key}`], active: [`b${base}`] },
            detail('compare', { probes }),
          ),
        );
      }
    }
    bucket.push({ key, value });
    state.count += 1;
    if (sink) {
      sink.push(
        frame(
          state,
          `Bucket ${base} is ${bucket.length === 1 ? 'empty' : 'already occupied'}, so append ${key}=${value} to its chain (${bucket.length} ${bucket.length === 1 ? 'entry' : 'entries'}).`,
          { inserted: [`e:${key}`], active: [`b${base}`] },
          detail('insert', { probes, collision: collisions > 0 }),
        ),
      );
    }
    return { placed: true, updated: false, probes, collisions, slot: base };
  }

  const step = state.strategy === 'double' ? hashStep(state.hashFn, key, state.capacity) : 0;
  const seen = new Set();
  let firstTombstone = -1;
  let probes = 0;
  let collisions = 0;
  if (sink) {
    sink.push(frame(state, hashLine(state, key, base), { active: [`b${base}`] }, hashDetail(state, key, base)));
  }

  for (let i = 0; i < state.capacity; i += 1) {
    const at = probeIndex(state.strategy, base, step, i, state.capacity);
    if (seen.has(at)) break;
    seen.add(at);
    probes += 1;
    const slot = state.table[at];

    if (slot === null) {
      const target = firstTombstone >= 0 ? firstTombstone : at;
      const reused = firstTombstone >= 0;
      if (reused) state.tombstones -= 1;
      state.table[target] = { key, value };
      state.count += 1;
      if (sink) {
        sink.push(
          frame(
            state,
            reused
              ? `Bucket ${target} is a tombstone; reuse it for ${key}=${value} after ${probeWord(probes)}.`
              : `Bucket ${target} is empty; store ${key}=${value} there after ${probeWord(probes)}.`,
            { inserted: [`e:${key}`], active: [`b${target}`] },
            detail('insert', { index: target, probes, collision: collisions > 0, reusedTombstone: reused }),
          ),
        );
      }
      return { placed: true, updated: false, probes, collisions, slot: target };
    }

    if (slot.tombstone) {
      if (firstTombstone < 0) firstTombstone = at;
      if (sink) {
        sink.push(
          frame(
            state,
            `Bucket ${at} is a tombstone: it is not empty, so the probe continues. It is remembered as a place ${key} could be inserted.`,
            { tombstone: [`b${at}`] },
            detail('tombstone', { index: at, probes }),
          ),
        );
      }
      continue;
    }

    if (slot.key === key) {
      const from = slot.value;
      slot.value = value;
      if (sink) {
        sink.push(
          frame(
            state,
            `Bucket ${at} already holds ${key}; update its value from ${from} to ${value}. No duplicate key is created.`,
            { found: [`e:${key}`] },
            detail('update', { index: at, probes }),
          ),
        );
      }
      return { placed: true, updated: true, probes, collisions, slot: at };
    }

    collisions += 1;
    if (sink) {
      sink.push(
        frame(
          state,
          `Bucket ${at} already holds ${slot.key}: collision. ${state.strategy === 'linear' ? 'The next slot is next in line.' : state.strategy === 'quadratic' ? 'Jump further along the quadratic sequence.' : 'Add the second hash step and try again.'}`,
          { collision: [`b${at}`] },
          detail('collision', { index: at, probes }),
        ),
      );
    }
  }

  if (firstTombstone >= 0) {
    const target = firstTombstone;
    state.tombstones -= 1;
    state.table[target] = { key, value };
    state.count += 1;
    if (sink) {
      sink.push(
        frame(
          state,
          `The probe path repeated, but bucket ${target} is a tombstone, so ${key}=${value} reuses it after ${probeWord(probes)}.`,
          { inserted: [`e:${key}`], active: [`b${target}`] },
          detail('insert', { index: target, probes, collision: true, reusedTombstone: true }),
        ),
      );
    }
    return { placed: true, updated: false, probes, collisions, slot: target };
  }

  if (sink) {
    sink.push(
      frame(
        state,
        `Every reachable slot was inspected in ${probeWord(probes)} and none is free, so ${key} cannot be inserted. Rehash or grow the table.`,
        {},
        detail('failed', { probes }),
      ),
    );
  }
  return { placed: false, updated: false, probes, collisions, slot: -1 };
}

/* --- Search, contains and deletion ---------------------------------------- */

function lookupCore(state, key, sink, forContains = false) {
  const base = bucketIndex(state.hashFn, key, state.capacity);
  const detail = (kind, extra) => detailOf(state, kind, { key, index: base, ...extra });
  let probes = 0;

  const missText = forContains
    ? `${key} is not in the table, so contains(${key}) is false.`
    : `${key} is not in the table.`;

  if (state.strategy === 'chaining') {
    if (sink) sink.push(frame(state, hashLine(state, key, base), { active: [`b${base}`] }, hashDetail(state, key, base)));
    const bucket = state.table[base];
    for (const entry of bucket) {
      probes += 1;
      if (entry.key === key) {
        if (sink) {
          sink.push(
            frame(
              state,
              forContains
                ? `Bucket ${base} holds ${key}=${entry.value}; contains(${key}) is true.`
                : `Found ${key}=${entry.value} in bucket ${base} after ${probeWord(probes)}.`,
              { found: [`e:${key}`] },
              detail('found', { probes, value: entry.value }),
            ),
          );
        }
        return { found: true, entry, probes, base };
      }
      if (sink) {
        sink.push(
          frame(
            state,
            `Compare ${key} with ${entry.key}: not equal, follow the chain.`,
            { compare: [`e:${entry.key}`], active: [`b${base}`] },
            detail('compare', { probes }),
          ),
        );
      }
    }
    if (sink) {
      sink.push(frame(state, `${missText} Bucket ${base} has no more entries.`, {}, detail('missing', { probes })));
    }
    return { found: false, probes, base };
  }

  const step = state.strategy === 'double' ? hashStep(state.hashFn, key, state.capacity) : 0;
  const seen = new Set();
  if (sink) sink.push(frame(state, hashLine(state, key, base), { active: [`b${base}`] }, hashDetail(state, key, base)));

  for (let i = 0; i < state.capacity; i += 1) {
    const at = probeIndex(state.strategy, base, step, i, state.capacity);
    if (seen.has(at)) break;
    seen.add(at);
    probes += 1;
    const slot = state.table[at];

    if (slot === null) {
      if (sink) {
        sink.push(
          frame(
            state,
            `Bucket ${at} is empty, so the probe stops: ${missText}`,
            {},
            detail('missing', { index: at, probes }),
          ),
        );
      }
      return { found: false, probes, base, slot: at };
    }

    if (slot.tombstone) {
      if (sink) {
        sink.push(
          frame(
            state,
            `Bucket ${at} is a tombstone: the key was deleted here, but a later key may have probed past it, so lookup must continue.`,
            { tombstone: [`b${at}`] },
            detail('tombstone', { index: at, probes }),
          ),
        );
      }
      continue;
    }

    if (slot.key === key) {
      if (sink) {
        sink.push(
          frame(
            state,
            forContains
              ? `Bucket ${at} holds ${key}=${slot.value}; contains(${key}) is true.`
              : `Found ${key}=${slot.value} in bucket ${at} after ${probeWord(probes)}.`,
            { found: [`e:${key}`] },
            detail('found', { index: at, probes, value: slot.value }),
          ),
        );
      }
      return { found: true, entry: slot, probes, base, slot: at };
    }

    if (sink) {
      sink.push(
        frame(
          state,
          `Bucket ${at} holds ${slot.key}, not ${key}: collision, keep probing.`,
          { collision: [`b${at}`] },
          detail('collision', { index: at, probes }),
        ),
      );
    }
  }

  if (sink) {
    sink.push(
      frame(
        state,
        `The probe sequence repeated without finding ${key}. ${missText}`,
        {},
        detail('missing', { probes }),
      ),
    );
  }
  return { found: false, probes, base };
}

function deleteCore(state, key, sink) {
  const found = lookupCore(state, key, sink);
  if (!found.found) {
    if (sink) {
      sink.push(
        frame(state, `Nothing was deleted: ${key} is not in the table.`, {}, detailOf(state, 'missing', { key })),
      );
    }
    return { deleted: false, probes: found.probes };
  }

  if (state.strategy === 'chaining') {
    const bucket = state.table[found.base];
    const at = bucket.findIndex((entry) => entry.key === key);
    bucket.splice(at, 1);
    state.count -= 1;
    if (sink) {
      sink.push(
        frame(
          state,
          `Delete ${key} from bucket ${found.base}'s chain; the rest of the chain closes up. The key is gone, not marked.`,
          { deleted: [`b${found.base}`] },
          detailOf(state, 'delete', { key, index: found.base, probes: found.probes }),
        ),
      );
    }
    return { deleted: true, probes: found.probes };
  }

  const at = found.slot;
  state.table[at] = { tombstone: true };
  state.count -= 1;
  state.tombstones += 1;
  if (sink) {
    sink.push(
      frame(
        state,
        `Delete ${key} by writing a tombstone at bucket ${at}, not an empty slot. An empty slot would stop later lookups for keys that probed past this one.`,
        { tombstone: [`b${at}`] },
        detailOf(state, 'delete', { key, index: at, probes: found.probes, tombstone: true }),
      ),
    );
  }
  return { deleted: true, probes: found.probes };
}

/* --- Rebuilds: resize, rehash and strategy changes ------------------------ */

function rebuild(state, sink, next, reason) {
  const entries = entriesOf(state);
  const from = state.capacity;
  const oldTable = state.table;
  sink.push(
    frame(
      state,
      reason,
      {},
      detailOf(state, 'resize-start', { key: null, from, to: next.capacity }),
    ),
  );

  const previous = from !== next.capacity ? { capacity: from, table: oldTable, count: state.count } : null;
  state.capacity = next.capacity;
  state.strategy = next.strategy;
  state.hashFn = next.hashFn;
  state.table = emptyTable(state.capacity, state.strategy);
  state.count = 0;
  state.tombstones = 0;
  state.previous = previous;

  sink.push(
    frame(
      state,
      `Allocate ${state.capacity} ${state.strategy === 'chaining' ? 'buckets' : 'slots'}, then reinsert ${entries.length} ${entries.length === 1 ? 'key' : 'keys'} using the new hash and capacity. Indices are not copied over.`,
      {},
      detailOf(state, 'resize-alloc', { from, to: state.capacity }),
    ),
  );

  let moved = 0;
  for (const entry of entries) {
    const base = bucketIndex(state.hashFn, entry.key, state.capacity);
    const result = insertCore(state, entry.key, entry.value, null);
    moved += 1;
    sink.push(
      frame(
        state,
        `Move ${entry.key}=${entry.value}: ${hashShort(state, entry.key, base)}; placed after ${probeWord(result.probes)} (${moved} of ${entries.length}).`,
        { inserted: [`e:${entry.key}`], active: [`b${result.slot}`] },
        detailOf(state, 'rehash', { key: entry.key, raw: rawHash(state.hashFn, entry.key), index: base, probes: result.probes }),
      ),
    );
  }

  state.previous = null;
  sink.push(
    frame(
      state,
      `Rebuild complete: ${state.count} ${state.count === 1 ? 'key is' : 'keys are'} stored in ${state.capacity} ${state.strategy === 'chaining' ? 'buckets' : 'slots'}, and every key is reachable with its new index.`,
      {},
      detailOf(state, 'resize-done', { from, to: state.capacity }),
    ),
  );
}

function maybeGrow(state, sink) {
  if (!(loadOf(state) > state.threshold)) return;
  const target = nextCapacity(state.strategy, state.capacity);
  if (target === state.capacity) return;
  rebuild(
    state,
    sink,
    { capacity: target, strategy: state.strategy, hashFn: state.hashFn },
    `The load factor ${state.count}/${state.capacity} = ${percent(loadOf(state))} is above the ${percent(state.threshold)} threshold, so the table grows to ${target} and every key is rehashed.`,
  );
}

/* --- Operations ------------------------------------------------------------ */

export function hashTableFrames(state, op, input = {}) {
  const frames = [];

  if (op === 'insert') {
    const key = keyError(input.key);
    if (key.error) return key;
    const value = valueError(input.value);
    if (value.error) return value;
    const result = insertCore(state, key.key, value.value, frames);
    if (result.placed && !result.updated) maybeGrow(state, frames);
    return { state, frames };
  }

  if (op === 'update') {
    const key = keyError(input.key);
    if (key.error) return key;
    const value = valueError(input.value);
    if (value.error) return value;
    const lookup = lookupCore(state, key.key, frames);
    if (!lookup.found) {
      return { error: `Key ${key.key} is not in the table; insert it instead of updating it.` };
    }
    const from = lookup.entry.value;
    lookup.entry.value = value.value;
    frames.push(
      frame(
        state,
        `Update ${key.key} from ${from} to ${value.value}. The key set is unchanged: this is not a second entry.`,
        { found: [`e:${key.key}`] },
        detailOf(state, 'update', { key: key.key, index: lookup.base, probes: lookup.probes }),
      ),
    );
    return { state, frames };
  }

  if (op === 'search' || op === 'contains') {
    const key = keyError(input.key);
    if (key.error) return key;
    lookupCore(state, key.key, frames, op === 'contains');
    return { state, frames };
  }

  if (op === 'delete') {
    const key = keyError(input.key);
    if (key.error) return key;
    deleteCore(state, key.key, frames);
    return { state, frames };
  }

  if (op === 'clear') {
    const stored = state.count;
    const stones = state.tombstones;
    state.table = emptyTable(state.capacity, state.strategy);
    state.count = 0;
    state.tombstones = 0;
    state.previous = null;
    frames.push(
      frame(
        state,
        `Clear the table: ${stored} ${stored === 1 ? 'key is' : 'keys are'} removed and ${stones} ${stones === 1 ? 'tombstone is' : 'tombstones are'} dropped. The capacity, hash function and strategy stay the same.`,
        {},
        detailOf(state, 'clear'),
      ),
    );
    return { state, frames };
  }

  if (op === 'resize') {
    const capacity = Number(input.capacity);
    const problem = capacityError(input.capacity, state, capacity);
    if (problem) return { error: problem };
    if (capacity === state.capacity) return { error: `The table already has capacity ${capacity}.` };
    rebuild(
      state,
      frames,
      { capacity, strategy: state.strategy, hashFn: state.hashFn },
      `Resize from ${state.capacity} to ${capacity}. The new capacity changes the bucket index of every key, so each one is rehashed.`,
    );
    return { state, frames };
  }

  if (op === 'rehash') {
    const target = nextCapacity(state.strategy, state.capacity);
    if (target === state.capacity) {
      return { error: `The table is already at the largest supported capacity (${MAX_CAPACITY}).` };
    }
    rebuild(
      state,
      frames,
      { capacity: target, strategy: state.strategy, hashFn: state.hashFn },
      `Force a rehash from ${state.capacity} to ${target}: ${state.tombstones} ${state.tombstones === 1 ? 'tombstone is' : 'tombstones are'} dropped and every key is reinserted.`,
    );
    return { state, frames };
  }

  if (op === 'configure') {
    const strategy = HASH_STRATEGIES.some((entry) => entry.id === input.strategy)
      ? input.strategy
      : state.strategy;
    const hashFn = HASH_FUNCTIONS.some((entry) => entry.id === input.hashFn)
      ? input.hashFn
      : state.hashFn;
    const threshold = Number(input.threshold);
    if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 2) {
      return { error: 'The load-factor threshold must be between 0.10 and 2.00.' };
    }
    if (strategy !== 'chaining' && threshold > 0.95) {
      return { error: 'Open addressing needs a load-factor threshold of 0.95 or below.' };
    }

    let capacity = state.capacity;
    if (strategy === 'double' && !isPrime(capacity)) capacity = nextPrime(capacity);
    if (strategy !== 'chaining' && capacity <= state.count) {
      while (capacity <= state.count && capacity < MAX_CAPACITY) capacity = nextCapacity(strategy, capacity);
    }

    const changed = strategy !== state.strategy || hashFn !== state.hashFn || capacity !== state.capacity;
    if (!changed && threshold === state.threshold) {
      return { error: 'That is already the table configuration.' };
    }

    state.threshold = threshold;
    if (!changed) {
      frames.push(
        frame(
          state,
          `Set the resize threshold to ${percent(threshold)}. No key moves until the load factor crosses it.`,
          {},
          detailOf(state, 'configure'),
        ),
      );
      return { state, frames };
    }

    rebuild(
      state,
      frames,
      { capacity, strategy, hashFn },
      `Switch to ${strategyLabel(strategy)} using ${hashFunctionLabel(hashFn)} at capacity ${capacity}. Every key is rehashed because the hash or the capacity changed.`,
    );
    return { state, frames };
  }

  if (op === 'load') {
    const preset = HASH_PRESETS[input.preset];
    if (!preset) return { error: `Unknown dataset: ${input.preset}.` };
    // A dataset that exists to show tombstones only works under open addressing.
    if (preset.strategy) state.strategy = preset.strategy;
    state.capacity = preset.capacity;
    state.table = emptyTable(state.capacity, state.strategy);
    state.count = 0;
    state.tombstones = 0;
    state.previous = null;
    frames.push(
      frame(
        state,
        `Load "${preset.label}": ${preset.pairs.length} insertions into capacity ${state.capacity} with ${strategyLabel(state.strategy)}.`,
        {},
        detailOf(state, 'load', { preset: input.preset }),
      ),
    );
    for (const [key, value] of preset.pairs) insertCore(state, key, value, frames);
    for (const key of preset.deletes ?? []) deleteCore(state, key, frames);
    maybeGrow(state, frames);
    return { state, frames };
  }

  return { error: `Unsupported hash-table operation: ${op}.` };
}

/* --- Strategy comparison --------------------------------------------------- */

const DEFAULT_KEYS = ['ant', 'bee', 'cat', 'dog', 'eel', 'fox', 'gnu', 'hen'];

/** Run the same deterministic key set through every strategy at one fixed
 *  capacity, with resizing off. These are counts from the real operation
 *  model, not estimates: `probes` is the number of entries or slots inspected
 *  and `collisions` is how many of those inspections found a different key. */
export function compareStrategies({ keys = DEFAULT_KEYS, capacity = 11, hashFn = 'division' } = {}) {
  const pairs = keys.map((entry) =>
    typeof entry === 'string' ? { key: entry, value: '1' } : { key: String(entry.key), value: String(entry.value ?? '1') },
  );
  return HASH_STRATEGIES.map((strategy) => {
    const state = {
      capacity,
      strategy: strategy.id,
      hashFn,
      threshold: 1,
      table: emptyTable(capacity, strategy.id),
      count: 0,
      tombstones: 0,
      previous: null,
    };
    let probes = 0;
    let collisions = 0;
    let maxProbes = 0;
    let failed = 0;
    for (const pair of pairs) {
      const result = insertCore(state, pair.key, pair.value, null);
      probes += result.probes;
      collisions += result.collisions;
      maxProbes = Math.max(maxProbes, result.probes);
      if (!result.placed) failed += 1;
    }
    return {
      id: strategy.id,
      label: strategy.label,
      capacity,
      keys: pairs.length,
      probes,
      collisions,
      maxProbes,
      averageProbes: pairs.length ? probes / pairs.length : 0,
      occupied: state.count,
      failed,
      loadFactor: state.count / capacity,
    };
  });
}

/** Two keys that land in the same bucket under the current configuration,
 *  found deterministically (no randomness), for the collision detective. */
export function findCollision(hashFn, capacity, keys = []) {
  const seen = new Map();
  for (const key of keys) {
    const index = bucketIndex(hashFn, key, capacity);
    if (seen.has(index)) return { a: seen.get(index), b: key, index };
    seen.set(index, key);
  }
  return null;
}

/** A small set of candidate keys used by the collision detective and the
 *  predict-the-bucket exercise. Fixed, so a lesson's answer never changes. */
export const CANDIDATE_KEYS = ['ab', 'ba', 'ac', 'ca', 'bb', 'ant', 'bee', 'cat'];
