// The language selection grid's data: one entry per language, in display
// order. Pure so node --test can enforce the promise the page makes -
// Python is the ONLY available language, every other entry is honestly
// marked as not ready and carries no link (see languages.test.mjs).
//
// Monograms are plain text tiles: no third-party or trademarked logos.

export const LANGUAGES = [
  {
    id: "python",
    name: "Python",
    monogram: "Py",
    tagline: "Step through real Python, line by line.",
    status: "available",
    href: "/visualizer/python",
  },
  {
    id: "javascript",
    name: "JavaScript",
    monogram: "JS",
    tagline: "Tracing for browser and Node code.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "java",
    name: "Java",
    monogram: "Ja",
    tagline: "Objects, classes and call frames.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "cpp",
    name: "C++",
    monogram: "C+",
    tagline: "Memory and value semantics, visualised.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "c",
    name: "C",
    monogram: "C",
    tagline: "Pointers and structs, drawn out.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "csharp",
    name: "C#",
    monogram: "C#",
    tagline: "The CLR runtime, step by step.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "go",
    name: "Go",
    monogram: "Go",
    tagline: "Goroutines and channels, as they run.",
    status: "coming-soon",
    href: null,
  },
  {
    id: "rust",
    name: "Rust",
    monogram: "Rs",
    tagline: "Ownership and borrowing, made visible.",
    status: "coming-soon",
    href: null,
  },
];

/** The single language a learner can open today. */
export const AVAILABLE_LANGUAGE = LANGUAGES.filter((lang) => lang.status === "available");

/** The site's four homepage features; the last one is honestly "soon". */
export const FEATURES = [
  {
    id: "execution",
    title: "Step-by-step execution",
    body: "Move forward and back through a real run, one recorded step at a time.",
    soon: false,
  },
  {
    id: "variables",
    title: "Visualise variables",
    body: "Lists, dicts, sets and objects drawn as they change, not as a text dump.",
    soon: false,
  },
  {
    id: "calls",
    title: "Function call stack",
    body: "See every open call, its depth and the value it hands back.",
    soon: false,
  },
  {
    id: "languages",
    title: "Supports multiple languages",
    body: "Python runs today. Other languages are planned, not promised.",
    soon: true,
  },
];
