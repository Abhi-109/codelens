// Generates src/pages/preview-fixture.json: the source and recorded trace of
// the one program the homepage replays.
//
// The corpus fixture (src/tracer/__fixtures__/corpus.json.gz) is the single
// source of truth - dump_corpus.py wrote it by really running the tracer. This
// script copies one program out of it so the homepage bundle carries ~3 KB
// instead of the whole 48-program corpus, and so the copy cannot silently
// drift: src/pages/preview.test.mjs re-reads the corpus and asserts the two
// still agree.
//
//   node scripts/preview-fixture.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const PROGRAM = "function-basic";
const corpus = JSON.parse(
  gunzipSync(readFileSync(new URL("../src/tracer/__fixtures__/corpus.json.gz", import.meta.url))),
);

const entry = corpus[PROGRAM];
if (!entry) throw new Error(`no corpus program named "${PROGRAM}"`);

const fixture = {
  program: PROGRAM,
  title: entry.title,
  category: entry.category,
  source: entry.source,
  trace: entry.trace,
  // What the program really printed, for the test to compare against.
  output: entry.result?.output ?? "",
};

const out = new URL("../src/pages/preview-fixture.json", import.meta.url);
writeFileSync(out, JSON.stringify(fixture, null, 1) + "\n");
console.log(
  `wrote ${out.pathname.split("/").pop()}: ${fixture.trace.length} events, ${JSON.stringify(fixture).length} bytes`,
);
