#!/usr/bin/env node
/**
 * The architectural lint (§22.4).
 *
 * This is what keeps P3 and P5 true a year from now, when nobody remembers the
 * rules. It enforces:
 *
 *   1. No upward imports between layers (§4.1).
 *   2. No file outside `core/dom.js` touches `document` or `window`.
 *   3. Every element type declares `a11y`, or opts out explicitly (P5).
 *   4. Every diagnostic code used in source exists in the catalogue and in
 *      `docs/diagnostics.md`.
 *   5. No import cycles.
 *
 * Draft 7 moved this from Python to Node so it can walk a real ES module
 * graph. The first two rules are import-graph questions that a parser answers
 * exactly and a text search only approximates; the third was specified as
 * "grep for private-prefixed identifiers", which is precisely the kind of check
 * that yields false confidence.
 */
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "source");

/** The layer map of §4.1, lowest first. A layer may not import from above it. */
const LAYERS = [
  "core", "geometry", "engine", "layout", "traits", "services", "elements",
  // `plugins` sits above the catalog: a bundled plugin is architecturally a
  // third-party one that happens to live in this repository (P3), so it may
  // reach anything an external plugin could.
  "plugins",
  "styles", "entries"
];

/** `styles` is a leaf: it holds strings and is imported by anything. */
const LEAF_LAYERS = new Set(["styles"]);

const problems = [];
const usedCodes = new Set();

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith(".js")) out.push(full);
  }
  return out;
}

function layerOf(file) {
  const relative = path.relative(SOURCE, file);
  const first = relative.split(path.sep)[0];
  return relative.includes(path.sep) ? first : "entries";
}

/** Static imports only — this codebase has no dynamic imports by design. */
function importsOf(text) {
  const found = [];
  const pattern = /(?:^|\n)\s*import\s+(?:[^"';]*?from\s*)?["']([^"']+)["']/g;
  let match;
  while ((match = pattern.exec(text))) found.push(match[1]);
  const reexport = /(?:^|\n)\s*export\s+(?:\*|\{[^}]*\})\s*from\s*["']([^"']+)["']/g;
  while ((match = reexport.exec(text))) found.push(match[1]);
  return found;
}

const DEFINITION =
  /(?:export\s+const\s+\w+\s*=\s*|\.define\(\s*)\{\s*(?:\/\/[^\n]*\n\s*)*type:\s*["']([\w:-]+)["']/g;

/** The source of the brace-balanced object literal starting at `open`. */
function objectAt(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return text.slice(open, i + 1);
  }
  return text.slice(open);
}

function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

const files = await walk(SOURCE);
const graph = new Map();

for (const file of files) {
  const text = await readFile(file, "utf8");
  const code = stripComments(text);
  const relative = path.relative(ROOT, file);
  const layer = layerOf(file);
  const specifiers = importsOf(text);
  const resolved = specifiers
    .filter((s) => s.startsWith("."))
    .map((s) => path.resolve(path.dirname(file), s));
  graph.set(file, resolved);

  // ── 1. downward imports only ─────────────────────────────────────────
  for (const target of resolved) {
    const targetLayer = layerOf(target);
    if (LEAF_LAYERS.has(targetLayer) || targetLayer === layer) continue;
    if (LAYERS.indexOf(targetLayer) > LAYERS.indexOf(layer)) {
      problems.push(
        `${relative}: imports upward from '${layer}' into '${targetLayer}' ` +
          `(${path.relative(ROOT, target)}). Dependencies point downward only (§4.1).`
      );
    }
  }

  // ── 2. one DOM adapter ───────────────────────────────────────────────
  if (!file.endsWith(path.join("core", "dom.js"))) {
    const direct = code.match(/(?<![\w.$])(document|window)\s*\./g) || [];
    const allowed = code.match(/typeof\s+(document|window)/g) || [];
    if (direct.length > allowed.length) {
      problems.push(
        `${relative}: touches document/window directly. Route it through ` +
          `core/dom.js — it is the only module allowed to (§22.1).`
      );
    }
  }

  // ── 3. every element type declares a11y ──────────────────────────────
  // An element *definition* is an object literal whose first key is `type` —
  // either exported or passed straight to define(). Matching a bare `type:`
  // anywhere would also hit every prop schema, where `type: 'number'` means
  // something entirely different.
  for (const match of code.matchAll(DEFINITION)) {
    const start = match.index;
    const body = objectAt(code, code.indexOf("{", start));
    // A type that `extends` another inherits its declaration, which a text
    // scan cannot resolve. The runtime check (MK3006) sees the merged
    // definition and is exact, so deferring to it here beats a false positive.
    if (!/\ba11y:/.test(body) && !/\babstract:\s*true/.test(body) && !/\bextends:/.test(body)) {
      problems.push(
        `${relative}: element type '${match[1]}' declares no \`a11y\`. Declare a role, ` +
          `or opt out explicitly with a11y: 'presentation' (P5).`
      );
    }
  }

  // ── 4. diagnostic codes are catalogued ───────────────────────────────
  for (const match of code.matchAll(/["'](MK\d{4})["']/g)) {
    usedCodes.add(match[1]);
  }
}

// ── 4 (continued) ──────────────────────────────────────────────────────
const catalogueText = await readFile(path.join(SOURCE, "core/diagnostics.js"), "utf8");
const catalogued = new Set([...catalogueText.matchAll(/\b(MK\d{4}):/g)].map((m) => m[1]));
let documented = new Set();
try {
  const docs = await readFile(path.join(ROOT, "docs/diagnostics.md"), "utf8");
  documented = new Set([...docs.matchAll(/\b(MK\d{4})\b/g)].map((m) => m[1]));
} catch (error) {
  problems.push("docs/diagnostics.md is missing; every code needs a documented cause and fix.");
}

for (const code of [...usedCodes].sort()) {
  if (!catalogued.has(code)) problems.push(`diagnostic ${code} is used but not in the catalogue (§21.2).`);
  else if (documented.size && !documented.has(code)) {
    problems.push(`diagnostic ${code} is used but not in docs/diagnostics.md (§21.2).`);
  }
}
for (const code of [...catalogued].sort()) {
  if (!usedCodes.has(code)) {
    problems.push(`diagnostic ${code} is catalogued but never used — delete it or use it.`);
  }
}

// ── 5. every module parses ─────────────────────────────────────────────
// Cheap, and it catches the one mistake this codebase keeps making: a backtick
// inside a comment *inside* a tagged template literal ends the template, and
// the rest of the file is then parsed as code. Twice now.
for (const file of files) {
  try {
    await import(pathToFileURL(file).href);
  } catch (error) {
    if (error instanceof SyntaxError) {
      problems.push(`${path.relative(ROOT, file)}: does not parse — ${error.message}`);
    }
    // A module that throws at import time for any other reason is a runtime
    // concern, not this check's business.
  }
}

// ── 6. no cycles ───────────────────────────────────────────────────────
const state = new Map();
function visit(file, trail) {
  if (state.get(file) === "done") return;
  if (state.get(file) === "open") {
    const cycle = [...trail.slice(trail.indexOf(file)), file].map((f) => path.relative(ROOT, f));
    problems.push(`import cycle: ${cycle.join(" → ")}`);
    return;
  }
  state.set(file, "open");
  for (const target of graph.get(file) || []) {
    if (graph.has(target)) visit(target, [...trail, file]);
  }
  state.set(file, "done");
}
for (const file of files) visit(file, []);

if (problems.length) {
  console.error(`lint-arch: ${problems.length} problem(s)\n`);
  for (const problem of problems) console.error("  " + problem);
  process.exitCode = 1;
} else {
  console.log(`lint-arch: ${files.length} files, ${usedCodes.size} diagnostic codes, clean`);
}
