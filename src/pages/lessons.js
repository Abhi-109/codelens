/* The lessons, as data.
 *
 * Every lesson is a page at /learn/:section/:lesson, and every claim here has
 * to match what the visualizer actually does. That is why the lessons live in
 * a plain module: lessons.test.mjs can check that each one has objectives, a
 * runnable example from src/examples.js, and at least one checkpoint, without
 * a browser or a React renderer.
 *
 * A block is one of:
 *   { p: "paragraph" }
 *   { h: "sub-heading" }
 *   { list: ["item", "item"] }
 *   { note: "one honest aside" }
 */

export const LESSON_SECTIONS = [
  {
    id: "getting-started",
    title: "Getting started",
    lessons: [
      {
        id: "introduction",
        title: "Introduction to CodeLens",
        summary:
          "What a step is, what the two panels show, and why every value you see was recorded rather than guessed.",
        objectives: [
          "Explain what one step of a run is.",
          "Tell the code panel and the animation panel apart.",
          "Know why CodeLens never shows a value the trace did not record.",
        ],
        exampleId: "statements",
        body: [
          {
            p: "CodeLens runs a Python program in your browser, records what happened, and then lets you move through that recording one step at a time. The recording is called a trace.",
          },
          { h: "What a step is" },
          {
            p: "The tracer writes one event each time something real happens: a line is about to run, a function is called, a function returns, a comparison is made, text is printed, or an error is raised. A step in CodeLens is one of those events. Two steps can therefore show the same source line — the line about to run, and the comparison that line performed.",
          },
          {
            list: [
              "The code panel on the left marks the line the current event belongs to.",
              "The animation panel on the right draws the data that event touched.",
              "Inspect, below the animation, holds the recorded details: variables, the call stack, memory, output and the change history.",
            ],
          },
          { h: "Nothing is filled in" },
          {
            p: "The panels read the trace. If the trace has no value for a name, no panel invents one; if a position is not proven final, it is not painted green. That rule is the reason the animation can be trusted while you are learning: what you see is what the program did.",
          },
          {
            note: "You do not need an account and your code is not uploaded. Python runs locally in a Web Worker.",
          },
        ],
        checkpoints: [
          {
            q: "Why can two different steps show the same line of code?",
            a: "Because a line about to run and a comparison on that line are two separate recorded events. The comparison event is what lets the visualizer mark the exact two values that were compared.",
          },
          {
            q: "What does a green ring around a value mean?",
            a: "The recording proves that position settled — for example, the end of a sort. It is never painted on a position the run has not reached.",
          },
        ],
      },
      {
        id: "first-program",
        title: "Your first Python program",
        summary:
          "Read a short program one recorded event at a time: assignment, re-assignment, then output.",
        objectives: [
          "Follow a program from its first line to its last event.",
          "Use the Variables and Output tabs to confirm what happened.",
          "Predict the next step before you press Next.",
        ],
        exampleId: "variables",
        body: [
          {
            p: "This program gives five names values, then prints two of them. Open it in the visualizer, press Run, and step forward once.",
          },
          { h: "Read the run in order" },
          {
            list: [
              "The first event is the module call. It has no source line yet, so the code panel has nothing marked.",
              "Each assignment is one line event. The Variables tab shows the name and its value after that line runs.",
              "The print is a line event followed by an output event. The Output tab shows the text the program wrote.",
            ],
          },
          {
            p: "The animation shows only what moved. A step that changes nothing still has a sentence, but it does not pretend a value changed.",
          },
          {
            note: "Use the left and right arrow keys to step, or Space to play and pause. The step slider jumps anywhere in the run.",
          },
        ],
        checkpoints: [
          {
            q: "Which line runs first, and what is the very first event?",
            a: "The first event is the module call at line 0; line 1 is the first line event. The module call is bookkeeping for the program itself, not a line of your code.",
          },
          {
            q: "After the last step, what does the Output tab hold?",
            a: "Exactly the text the program printed — here `Asha 12` — and nothing the program did not print.",
          },
        ],
      },
    ],
  },
  {
    id: "python-basics",
    title: "Python basics",
    lessons: [
      {
        id: "variables-and-structures",
        title: "Variables, values and structures",
        summary:
          "What a name holds, how lists and dictionaries are drawn, and why two names can share one object.",
        objectives: [
          "Distinguish a name from the value it points at.",
          "Read a list and a dictionary as structures, not as text.",
          "Recognise aliasing: two names for the same object.",
        ],
        exampleId: "aliasing",
        body: [
          {
            p: "A variable is a name pointing at a value. For a number or a string, the value is the whole story. For a list or a dictionary, the value is an object that other names can point at too.",
          },
          { h: "A name is not the value" },
          {
            p: "The Variables tab lists names in the current call. The Memory tab shows the objects those names reach: a list with its slots, a dictionary with its keys, and the arrows from each name to the object it points at.",
          },
          { h: "One object, two names" },
          {
            p: "In this example `second = first` does not copy the dictionary. It makes a second name for the same object, so appending to `second[\"scores\"]` is visible through `first` as well. The Memory tab draws both names arriving at one dictionary; that shared arrow is the aliasing.",
          },
          {
            note: "Appending to a list inside a dictionary changes the dictionary's contents without reassigning the name. The change history records that as a change to the list's slots.",
          },
        ],
        checkpoints: [
          {
            q: "Why does changing `second` also change `first`?",
            a: "Both names point at the same dictionary. The append changes the list inside that one object, so every name that reaches it sees the new item.",
          },
          {
            q: "What does the Memory tab show that Variables does not?",
            a: "The objects and the arrows between them: which names share one list or dictionary, and what each object contains at this step.",
          },
        ],
      },
      {
        id: "conditionals-and-loops",
        title: "Conditions and loops",
        summary:
          "Follow a loop pass by pass and see which branch a condition chose, with the values that decided it.",
        objectives: [
          "Read a condition as a recorded comparison.",
          "Follow one pass of a loop at a time.",
          "Explain why a branch was taken or skipped.",
        ],
        exampleId: "even-sum",
        body: [
          {
            p: "This program adds the even numbers from 1 to 5. It is small on purpose: the loop and the branch are the whole program.",
          },
          { h: "A comparison is its own step" },
          {
            p: "The tracer records each supported comparison with both operands and the outcome. That is why CodeLens can show `Compare 2 % 2 == 0 → True` as its own step, instead of asking you to work it out from the line.",
          },
          { h: "One pass at a time" },
          {
            list: [
              "The for line runs once per value in the range.",
              "The if line runs once per pass; its comparison step follows.",
              "Only the pass that takes the branch changes `total`.",
              "When the loop ends, the print line runs once.",
            ],
          },
          {
            note: "Control flow mode draws the loop and both branches, and lights up the path this run actually took.",
          },
        ],
        checkpoints: [
          {
            q: "How many times does the if line run, and how many times does `total` change?",
            a: "The if line runs five times, once per value. `total` changes twice — on 2 and on 4 — because the other passes take the skipped branch.",
          },
          {
            q: "Where can you see which values the comparison used?",
            a: "In the comparison step itself: the animation names both operands and the outcome, and the Explain tab gives the same fact in a sentence.",
          },
        ],
      },
    ],
  },
  {
    id: "functions",
    title: "Functions",
    lessons: [
      {
        id: "functions-and-returns",
        title: "Functions, the call stack and return values",
        summary:
          "A call opens a frame, a return closes it, and the value comes back to the caller.",
        objectives: [
          "Explain what a call frame is.",
          "Read the call stack top to bottom.",
          "Follow a return value back into the caller.",
        ],
        exampleId: "functions",
        body: [
          {
            p: "A function call is a recorded event of its own. It opens a frame with its own parameters and local names; when the function returns, the frame closes and the value goes back to whoever called it.",
          },
          { h: "The stack is the open calls" },
          {
            p: "The Stack tab lists the frames that are open at this step, newest on top. The module frame is always at the bottom. Selecting a frame only changes whose variables you are reading — it never moves the step.",
          },
          { h: "A return carries a value" },
          {
            p: "The return event records the value the function handed back. The animation prints that value on the frame that returned it, so you can watch `message` become the caller's result without guessing.",
          },
          {
            note: "A function with no return statement hands back None, and the trace says so. That is not the same as a function that failed.",
          },
        ],
        checkpoints: [
          {
            q: "What appears in the stack while `greet` is running?",
            a: "Two frames: `greet` on top with its own `name` and `message`, and the module frame below it.",
          },
          {
            q: "After the return, where is the value?",
            a: "It is the result of the call expression on the print line, so the caller uses it there. The closed frame's names are gone from the stack.",
          },
        ],
      },
    ],
  },
  {
    id: "errors",
    title: "Errors",
    lessons: [
      {
        id: "exceptions",
        title: "When Python raises an error",
        summary:
          "A caught error keeps running; an uncaught one unwinds the stack and stops the program. Both are recorded.",
        objectives: [
          "Tell a caught exception from an uncaught one.",
          "Read an unwind as a frame leaving because of an error.",
          "Find the final error and the line that caused it.",
        ],
        exampleId: "exceptions",
        body: [
          {
            p: "The first division is fine. The second divides by zero, and the function catches it. The third divides by zero again, gets None back, and then adds one to it — which raises an error nothing catches.",
          },
          { h: "Caught" },
          {
            p: "A caught exception is recorded where it was raised, and the except branch runs next. The run continues, so the trace continues. The animation says the handler caught it.",
          },
          { h: "Uncaught" },
          {
            p: "An uncaught exception records an unwind for each frame it leaves, then an error event that ends the run. The code panel points at the failing line, and the Output tab keeps everything printed before it.",
          },
          {
            note: "A syntax error is different: the program never starts, so there is no trace to step through. CodeLens says that plainly instead of showing an empty canvas.",
          },
        ],
        checkpoints: [
          {
            q: "Why does the second division not stop the program?",
            a: "The except branch catches ZeroDivisionError inside `divide`, so the function returns None and the run continues.",
          },
          {
            q: "What ends the run, and on which line?",
            a: "Adding 1 to None raises a TypeError that nothing catches, so the run ends on the last print line.",
          },
        ],
      },
    ],
  },
  {
    id: "hash-tables",
    title: "Hash tables",
    lessons: [
      {
        id: "what-is-hashing",
        title: "What hashing does",
        summary:
          "A key becomes a number, the number becomes a bucket, and a lookup can go straight there instead of scanning.",
        objectives: [
          "Trace a key through raw hash, modulo and bucket index.",
          "Predict the bucket a key targets before pressing Insert.",
          "Explain why the same key always lands in the same bucket.",
        ],
        lab: { type: "hash-table", preset: "sparse" },
        body: [
          {
            p: "A hash table turns a key into a position. The key is not compared against every stored key; it is converted into a number, that number is reduced to a bucket index, and the table looks only there.",
          },
          { h: "One key, three numbers" },
          {
            list: [
              "The raw hash is the key converted to an integer. For text keys this lab sums the character codes; an integer-looking key uses its integer value.",
              "The bucket index is the raw hash reduced to the table's capacity. With division hashing that is raw mod capacity.",
              "The animation shows that journey above the buckets, and the detail row repeats the numbers as you step.",
            ],
          },
          {
            p: "Load the sparse dataset and insert a key. The first step is the hash step, the second stores the value. Back moves to the hash step again and removes the stored value, because each step is drawn from its own recorded snapshot.",
          },
          { h: "The hash function matters" },
          {
            p: "Four functions are offered under Advanced. Division and multiplication use the character sum or integer value; polynomial mixes the characters with a base-31 recurrence; first-character keeps only the first code, which is deliberately poor and will collide constantly. Try first-character on this dataset to see a bad hash produce a crowded table.",
          },
          {
            note: "Keys are exact and case-sensitive in this lab. `Apple` and `apple` are different keys and may hash to different buckets.",
          },
        ],
        checkpoints: [
          {
            q: "At capacity 13 with division hashing, why does `apple` land in bucket 10?",
            a: "The character codes sum to 530, and 530 mod 13 is 10. The raw hash is 530; the bucket is the remainder.",
          },
          {
            q: "Does changing the capacity change the raw hash of a key?",
            a: "No. The raw hash is a property of the key and the hash function. The capacity changes only how that number is reduced to an index.",
          },
        ],
      },
      {
        id: "collisions-are-normal",
        title: "Collisions are normal",
        summary:
          "Two different keys can share a bucket. A collision is a fact to resolve, not an error in the table.",
        objectives: [
          "Recognise a collision step in the animation.",
          "Explain why a finite table cannot avoid collisions entirely.",
          "Name the four strategies the lab offers for resolving one.",
        ],
        lab: { type: "hash-table", preset: "colliders" },
        body: [
          {
            p: "The keys `ab` and `ba` have the same character sum, so they have the same raw hash; at this capacity they also target the same bucket. The table cannot give them different buckets without changing the hash or the capacity, so it must have a rule for what to do next.",
          },
          { h: "What the step says" },
          {
            list: [
              "The collision step marks the occupied bucket in amber and names the key already there.",
              "The inserted step then shows where the new key actually went, which is not the bucket it hashed to.",
              "The probe count in the detail row includes every slot or chain entry the operation inspected.",
            ],
          },
          {
            p: "Try the same dataset under each strategy using Advanced settings. Chaining puts both keys in one bucket; probing walks to another slot. The collision is unchanged; only the resolution differs.",
          },
          {
            note: "With more keys than buckets, collisions are guaranteed by the pigeonhole principle. Good hashing spreads them out; it does not remove them.",
          },
        ],
        checkpoints: [
          {
            q: "Why can a hash table with 7 buckets and 8 keys not avoid a collision?",
            a: "There are more keys than buckets, so at least one bucket must receive two keys.",
          },
          {
            q: "Is a collision a bug in the program?",
            a: "No. It is an expected event that the collision strategy resolves. A bug would be losing a key or failing to find one that is stored.",
          },
        ],
      },
      {
        id: "separate-chaining",
        title: "Separate chaining",
        summary:
          "Each bucket holds a chain of entries, so one bucket can store many keys and the load factor may pass 1.",
        objectives: [
          "Read a chain and explain the order entries were added.",
          "Explain why chaining tolerates a load factor above 1.",
          "Tell how deletion differs from open addressing.",
        ],
        lab: { type: "hash-table", preset: "colliders" },
        body: [
          {
            p: "Separate chaining keeps a list in every bucket. A collision does not move the new key: it is appended to the chain in the bucket the key hashed to. Lookup then walks that chain comparing keys.",
          },
          { h: "Lookup is a short walk" },
          {
            list: [
              "The hash step names the bucket.",
              "Each comparison step marks the chain entry being compared and leaves the earlier ones in place.",
              "The found step marks the matching entry; a miss ends when the chain has no more entries.",
            ],
          },
          {
            p: "Deletion removes the entry from the chain and closes the gap. Nothing is left behind, because an empty chain position does not stop a future lookup — the chain itself is the record.",
          },
          { h: "Load above 1" },
          {
            p: "Load factor is keys divided by buckets. Chaining allows it to exceed 1: eight keys in seven buckets is a perfectly valid chained table with one bucket holding two entries. Probing strategies cannot do that, because they need a genuinely empty slot to stop a search. Raise the threshold above 1.00 under Advanced and watch the table keep accepting keys after it is technically full.",
          },
        ],
        checkpoints: [
          {
            q: "Two keys hash to bucket 3 and both are inserted. What does bucket 3 hold?",
            a: "A chain of two entries, in insertion order. Lookup compares the keys one at a time.",
          },
          {
            q: "Why is deletion simple under chaining?",
            a: "The chain is just removed from. There is no empty-slot marker that a later search depends on, so no tombstone is needed.",
          },
        ],
      },
      {
        id: "linear-probing",
        title: "Linear probing",
        summary:
          "When a slot is taken, the search moves one slot to the right until it finds an empty one.",
        objectives: [
          "Follow a probe sequence across slot boundaries.",
          "Explain what an empty slot proves to a lookup.",
          "Predict where a colliding key will be stored.",
        ],
        lab: { type: "hash-table", preset: "linear" },
        body: [
          {
            p: "Open addressing stores every entry in the table itself, so a collision must be resolved by choosing another slot. Linear probing chooses the next slot, then the next, wrapping around at the end.",
          },
          { h: "The probe sequence" },
          {
            p: "For a key hashing to bucket 6 at capacity 7, the sequence is 6, 0, 1, 2 and so on. Each occupied slot produces a collision step and advances one place. The insert step names the slot that finally accepted the key, which may be far from the hash bucket.",
          },
          { h: "Why an empty slot matters" },
          {
            p: "A lookup follows the same sequence and stops at the first empty slot: if the key were stored, it would have been placed before that point. This is the invariant the whole strategy depends on, and the reason deletion cannot simply empty a slot — the next lesson on tombstones covers that.",
          },
          {
            note: "In this lab the load factor is checked after an insert. Cross the threshold and the table grows and rehashes every key before the next operation.",
          },
        ],
        checkpoints: [
          {
            q: "`ac` hashes to bucket 5 and `ca` also hashes to bucket 5. Where does `ca` go?",
            a: "Bucket 5 is occupied, so the next probe is bucket 6; if that is free, `ca` is stored there.",
          },
          {
            q: "Why can a lookup stop as soon as it sees an empty slot?",
            a: "Every key that probed past that point would have been stored in the first empty slot it found. An empty slot means no such key continued past it.",
          },
        ],
      },
      {
        id: "primary-clustering",
        title: "Clusters and primary clustering",
        summary:
          "Linear probing turns collisions into runs of occupied slots, and a run makes the next collision more likely.",
        objectives: [
          "See a cluster form from several colliding keys.",
          "Explain why clustering makes probes longer than the load factor suggests.",
          "Describe how quadratic probing and double hashing reduce it.",
        ],
        lab: { type: "hash-table", preset: "clustering" },
        body: [
          {
            p: "This dataset is chosen so several keys collide. Under linear probing, each collision extends a run of occupied slots. A key that lands anywhere inside the run must walk to the far end of it, even if its own hash bucket was free a moment earlier.",
          },
          { h: "The run is the problem" },
          {
            list: [
              "Watch the collision steps: once a run starts, later keys keep hitting it.",
              "Compare the probe counts in the detail row with the load factor. The probes are longer than the load alone would suggest.",
              "A deletion leaves a tombstone inside the run, so later lookups still walk past it.",
            ],
          },
          {
            p: "The strategy comparison below the lab inserts the same keys into every strategy at this capacity. Chaining avoids long slot runs; quadratic probing jumps further; double hashing uses a per-key step so two keys that collide do not follow the same path.",
          },
          {
            note: "Clustering is not a bug in the implementation. It is the known cost of a probe sequence that is the same for every key, which is exactly what linear probing uses.",
          },
        ],
        checkpoints: [
          {
            q: "Why does one collision make the next insertion slower?",
            a: "It lengthens an occupied run. A later key whose probe path enters that run has to traverse it before finding a free slot.",
          },
          {
            q: "Does a bigger capacity remove clustering?",
            a: "It lowers the load factor and makes clusters less likely, but any two keys with the same probe path still form a run. The strategy, not just the size, causes it.",
          },
        ],
      },
      {
        id: "quadratic-probing",
        title: "Quadratic probing",
        summary:
          "Instead of stepping one slot at a time, the probe jumps 0, 2, 6, 12 places to break up runs.",
        objectives: [
          "Follow the quadratic offset sequence.",
          "Explain how the jumps reduce primary clustering.",
          "Recognise the coverage limit of this probe sequence.",
        ],
        lab: { type: "hash-table", preset: "quadratic" },
        body: [
          {
            p: "Quadratic probing keeps the same starting bucket but changes the step: the i-th probe is at base + i + i². The first few offsets are 0, 2, 6, 12, so two keys that start in the same bucket quickly take different paths.",
          },
          { h: "What improves" },
          {
            p: "Runs of adjacent occupied slots stop forming, because a collision does not simply hand the key to the next slot. Two keys that collide once are unlikely to collide again on the next probe.",
          },
          { h: "What it costs" },
          {
            p: "The offsets are still a fixed sequence, so keys with the same base can revisit the same slots: base + 6 and base + 20 can name one bucket at a small capacity. This lab stops when the sequence repeats and reports that every reachable slot was inspected. If free slots existed outside the sequence, the insert is refused rather than moved; grow the table or switch strategy.",
          },
          {
            note: "Quadratic probing does not guarantee that a non-full table can accept another key. Double hashing with a prime capacity does, which is the next lesson.",
          },
        ],
        checkpoints: [
          {
            q: "What are the first four offsets from the base bucket?",
            a: "0, 2, 6 and 12, from i + i² for i = 0, 1, 2, 3.",
          },
          {
            q: "Why can a quadratic insert fail while the table still shows an empty slot?",
            a: "The probe sequence can repeat before it visits every slot. An empty slot outside the reachable sequence cannot be used by this key.",
          },
        ],
      },
      {
        id: "double-hashing",
        title: "Double hashing",
        summary:
          "A second hash gives each key its own step size, so colliding keys do not follow the same probe path.",
        objectives: [
          "Explain where the step size comes from.",
          "Read the full-cycle guarantee that a prime capacity provides.",
          "Compare its probe counts with linear and quadratic probing.",
        ],
        lab: { type: "hash-table", preset: "double" },
        body: [
          {
            p: "Double hashing keeps open addressing but replaces the fixed step with a per-key step: 1 + (raw hash mod (capacity - 1)). The first probe is the hash bucket; every later probe adds that step and wraps.",
          },
          { h: "Different keys, different paths" },
          {
            p: "`ab` and `ba` hash to the same bucket but have the same raw hash here, so they share a step too. Change one character and the step changes: the next collision takes a different route. That is what removes the shared-run problem of linear probing.",
          },
          { h: "The prime capacity rule" },
          {
            p: "For the walk to reach every slot, the step must be coprime with the capacity. A prime capacity makes every step from 1 to capacity - 1 coprime, so the sequence covers the table. This lab therefore refuses a non-prime capacity for double hashing, and grows to the next prime rather than doubling.",
          },
          {
            note: "A step of zero would loop forever. The formula starts at 1, which is why the `1 +` is there.",
          },
        ],
        checkpoints: [
          {
            q: "Why does double hashing require a prime capacity in this lab?",
            a: "With a prime capacity every step value is coprime with the capacity, so the probe sequence visits every slot before repeating.",
          },
          {
            q: "Two keys collide on the first probe. Do they collide again immediately?",
            a: "Only if they also share a step. Their second slots are base + step, and the steps differ when the raw hashes differ.",
          },
        ],
      },
      {
        id: "tombstones",
        title: "Deletion and tombstones",
        summary:
          "An open-addressed delete cannot leave an empty slot, so it leaves a marker that says `keep looking`.",
        objectives: [
          "Explain why emptying a deleted slot would break lookups.",
          "Recognise a tombstone in the table and in the detail row.",
          "Describe when a tombstone is reused.",
        ],
        lab: { type: "hash-table", preset: "deletions" },
        body: [
          {
            p: "This dataset loads five keys under linear probing, then deletes two of them. The deleted slots are not empty: they hold a tombstone.",
          },
          { h: "Why not empty the slot" },
          {
            p: "A lookup stops at the first empty slot because an empty slot proves no key continued past it. If a delete wrote an empty slot in the middle of a probe path, a key stored after it would become unreachable: the search would stop before reaching it. The tombstone keeps the `keep looking` signal while removing the key from the count.",
          },
          { h: "Reuse" },
          {
            p: "An insert remembers the first tombstone it passes, keeps probing to an empty slot (or until the path repeats), and only then stores into the remembered tombstone. A tombstone is therefore a place to fill later, not an empty slot that ends a search.",
          },
          {
            note: "Tombstones occupy slots without counting as keys. A table can show a low load factor and still probe slowly because most of its slots are tombstones. A rehash drops them.",
          },
        ],
        checkpoints: [
          {
            q: "Why does the lookup of a key that probed past a deleted slot still succeed?",
            a: "The tombstone does not stop the probe. The search continues past it and finds the key further along.",
          },
          {
            q: "Does a tombstone count towards the load factor?",
            a: "No. The count is stored keys only, so the load factor ignores tombstones even though they still occupy slots and lengthen probes.",
          },
        ],
      },
      {
        id: "load-factor-and-resizing",
        title: "Load factor, growth and rehashing",
        summary:
          "When the table gets too full it allocates a bigger one and reinserts every key, because indices change.",
        objectives: [
          "Compute the load factor from keys and capacity.",
          "Explain why a resize must rehash every key.",
          "Read the before/after strip during a rebuild.",
        ],
        lab: { type: "hash-table", preset: "resize" },
        body: [
          {
            p: "Load factor is stored keys divided by capacity. This dataset loads eight keys into a seven-bucket table; once the inserts finish, the load factor is above the default 0.75 threshold, so the table grows and every key is rehashed.",
          },
          { h: "Rebuild, not copy" },
          {
            list: [
              "The first rebuild step states the old and new capacity and keeps the old table visible as a `before` strip.",
              "Each key is then reinserted with the new capacity, so its index is computed again rather than copied.",
              "The final step reports that every key is reachable at its new index.",
            ],
          },
          { h: "The threshold is a policy" },
          {
            p: "The threshold is not part of hashing; it is a trade between memory and probe length. Lower it and the table stays sparse and fast but wastes slots. Raise it and probes get longer before growth. Chaining may use a threshold above 1.00; open addressing may not, because it needs a genuinely empty slot to stop a search.",
          },
          {
            note: "One resize costs linear work even though an ordinary insert is expected constant time. Amortised across a doubling sequence the cost per insert is still constant.",
          },
        ],
        checkpoints: [
          {
            q: "Eight keys in a seven-bucket table: what is the load factor?",
            a: "8 / 7 ≈ 1.14. That is legal for chaining and impossible for open addressing, which must keep at least one empty slot.",
          },
          {
            q: "Why can the entries not simply be copied into the new table?",
            a: "The bucket index depends on the capacity. A key that was in bucket 6 at capacity 7 can be in bucket 13 at capacity 14, so it must be hashed again.",
          },
        ],
      },
      {
        id: "choosing-a-strategy",
        title: "Choosing a collision strategy",
        summary:
          "Chaining, linear, quadratic and double hashing trade memory, probe length and simplicity differently.",
        objectives: [
          "Read the comparison table as measured probe and collision counts.",
          "Name the workload where chaining is the safer choice.",
          "Explain why no strategy is always best.",
        ],
        lab: { type: "hash-table", preset: "colliders" },
        body: [
          {
            p: "The comparison below the lab runs the same key set through all four strategies at the current capacity with resizing off. The counts come from the real insert path, so they agree with the steps you just watched.",
          },
          { h: "What each column means" },
          {
            list: [
              "Collisions counts inspections that found a different key.",
              "Probes counts every entry or slot inspected, including the successful one.",
              "Average and max describe the distribution; a good average with one very long insert is still a latency risk.",
              "Placed and failed show whether every key found a home at this capacity.",
            ],
          },
          { h: "Rules of thumb" },
          {
            p: "Chaining is simple, tolerates load above 1 and makes deletion trivial, at the cost of pointers and cache locality. Linear probing is compact and fast until clusters form. Quadratic probing breaks up primary clusters but cannot promise full coverage. Double hashing gives the most uniform spread but needs a prime capacity and a second hash.",
          },
          {
            note: "Timing a tiny table in a browser measures noise, not algorithms. These counts are the honest comparison; the complexity table states what happens as n grows.",
          },
        ],
        checkpoints: [
          {
            q: "Which strategy can hold more keys than the table has buckets?",
            a: "Separate chaining. Every bucket can hold a chain, so the load factor may exceed 1. Open addressing needs at least one empty slot to terminate a search.",
          },
          {
            q: "Why does the comparison turn resizing off?",
            a: "So all four strategies are measured at the same capacity. A strategy that grew would be answering a different question.",
          },
        ],
      },
      {
        id: "hash-table-complexity",
        title: "Complexity and honest limits",
        summary:
          "Expected constant time depends on the hash and the load, and the worst case is linear.",
        objectives: [
          "State the expected and worst-case cost of insert, search and delete.",
          "Explain why a resize is linear even when inserts are not.",
          "Name the guarantees this teaching model deliberately does not make.",
        ],
        lab: { type: "hash-table", preset: "sparse" },
        body: [
          {
            p: "The complexity table below the lab states the usual answer: expected constant time for insert, search, delete and update; linear worst case; linear for a rebuild. The word `expected` is doing real work in that sentence.",
          },
          { h: "What expected means" },
          {
            p: "Constant time assumes a hash that spreads this workload and a load factor held below some bound. Neither is a property of the word `hash table`. A poor hash — first-character in this lab — sends many keys to one bucket, and then a lookup is a linear scan of that bucket or cluster.",
          },
          { h: "What this lab does not claim" },
          {
            list: [
              "It is a teaching model, not a production library. Keys are short strings and the table is capped at 97 slots.",
              "It does not implement Robin Hood hashing, cuckoo hashing, incremental rehashing or universal hashing. Those are separate designs with their own trade-offs.",
              "A resize is a full rebuild, not an incremental migration, so a single resize step is visibly linear.",
              "Hash values shown here are educational and deterministic, not cryptographic and not collision-resistant against an attacker.",
            ],
          },
          {
            note: "If you can predict which keys collide, an adversary can too. That is why production systems use keyed hashing; it is outside what this lab models.",
          },
        ],
        checkpoints: [
          {
            q: "When is a hash-table search O(n) rather than O(1)?",
            a: "When many keys share a bucket or cluster, so the search has to inspect a number of entries proportional to n.",
          },
          {
            q: "Why is a rehash O(n) if each insert is expected O(1)?",
            a: "A rehash must reinsert every stored key once, so its cost is proportional to the number of keys.",
          },
        ],
      },
    ],
  },
  {
    id: "practice",
    title: "Practice",
    lessons: [
      {
        id: "sorting-in-practice",
        title: "Practice: watch a sort",
        summary:
          "Use everything from the earlier lessons on a real algorithm: comparisons, a swap, and the moment the list is proven sorted.",
        objectives: [
          "Tell a comparison step from a swap step.",
          "Predict a swap from the comparison before it.",
          "Explain why the green rings appear only at the end.",
        ],
        exampleId: "bubble-sort",
        body: [
          {
            p: "Bubble sort compares neighbours and swaps them when they are out of order. In this run the list starts as [4, 2, 5, 1, 3].",
          },
          { h: "Compare, then swap" },
          {
            list: [
              "A comparison step marks the two values in gold and states the outcome.",
              "The swap step marks the same two positions in blue and moves them.",
              "A line that changes nothing still gets a sentence, so a quiet step is not a missing step.",
            ],
          },
          { h: "Green means proven" },
          {
            p: "Green rings appear only where the recording proves a position is final. Seeking backwards removes them again, because a later position is not evidence about an earlier one.",
          },
          {
            note: "Timeline mode lists every recorded step with its line, values and output — useful when you want to jump around instead of playing straight through.",
          },
        ],
        checkpoints: [
          {
            q: "The comparison says 4 > 2 is True. What should the next step do?",
            a: "It swaps the two values, so the cells move and the list becomes [2, 4, 5, 1, 3].",
          },
          {
            q: "Why is the whole list green only at the last step?",
            a: "The recording proves each position settled as the sort finishes; before that, only the positions it has already proven are green.",
          },
        ],
      },
    ],
  },
];

/** Every lesson in reading order, flattened, with its section attached. */
export const LESSON_ORDER = LESSON_SECTIONS.flatMap((section) =>
  section.lessons.map((lesson) => ({ ...lesson, section: section.id, sectionTitle: section.title })),
);

/** One lesson by section and id, or null when the pair names nothing. */
export function findLesson(sectionId, lessonId) {
  const section = LESSON_SECTIONS.find((entry) => entry.id === sectionId);
  if (!section) return null;
  const lesson = section.lessons.find((entry) => entry.id === lessonId);
  return lesson ? { ...lesson, section: section.id, sectionTitle: section.title } : null;
}

/** The lessons before and after this one, for the footer links. */
export function lessonNeighbours(sectionId, lessonId) {
  const at = LESSON_ORDER.findIndex(
    (entry) => entry.section === sectionId && entry.id === lessonId,
  );
  if (at < 0) return { previous: null, next: null };
  return {
    previous: at > 0 ? LESSON_ORDER[at - 1] : null,
    next: at < LESSON_ORDER.length - 1 ? LESSON_ORDER[at + 1] : null,
  };
}
