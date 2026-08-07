#!/usr/bin/env node
/**
 * The build (§22.3).
 *
 * esbuild is the only build-critical dependency: a single binary that covers
 * bundling, tree-shaking, minification, and source maps. It replaces
 * `build.py`, whose hand-written line-preserving minifier cost a real
 * nested-template bug to get correct (§22.6) — that entire category of bug
 * belongs to esbuild now.
 *
 *   node build.mjs            build every preset
 *   node build.mjs --watch    rebuild on save
 *   node build.mjs --check    verify without writing
 */
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(ROOT, "build");

const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
const manifest = JSON.parse(await readFile(path.join(ROOT, "unpinned.json"), "utf8"));

/** One entry file per §4.2 preset. The imports *are* the file list (§22.2). */
const PRESETS = [
  { name: "mutakit", entry: "source/entries/full.js", label: "everything" },
  { name: "mutakit.core", entry: "source/entries/core.js", label: "core" }
];

const banner = (name) =>
  `/*! Mutakit ${pkg.version} — ${name} · ${pkg.license} · https://mutakit.dev */`;

const argv = new Set(process.argv.slice(2));
const WATCH = argv.has("--watch");
const CHECK = argv.has("--check");
const STRICT = argv.has("--strict-budget");

/**
 * Shared options. The split above is what §21.1's two builds rest on:
 * behaviour never differs between builds except in diagnostics.
 */
function options(preset, { format, minify }) {
  const suffix = `${format === "esm" ? ".esm" : ""}${minify ? ".min" : ""}`;
  return {
    entryPoints: [path.join(ROOT, preset.entry)],
    outfile: path.join(OUT, `${preset.name}${suffix}.js`),
    bundle: true,
    format,
    target: ["chrome111", "firefox113", "safari16.4"],
    platform: "browser",
    globalName: format === "iife" ? manifest.global : undefined,
    footer:
      format === "iife"
        ? {
            // The UMD output shape survives the migration (§2.2): the bundler
            // emits it rather than a hand-written wrapper.
            js: `if(typeof module==="object"&&module.exports){module.exports=${manifest.global}}else if(typeof define==="function"&&define.amd){define([],function(){return ${manifest.global}})}`
          }
        : undefined,
    minify,
    sourcemap: minify ? false : "linked",
    metafile: true,
    legalComments: "inline",
    banner: { js: banner(preset.label) },
    define: { __MK_DEV__: String(!minify) },
    drop: minify ? ["debugger"] : [],
    loader: { ".css": "text" },
    write: !CHECK,
    logLevel: "silent"
  };
}

async function buildAll() {
  if (!CHECK) {
    await rm(OUT, { recursive: true, force: true });
    await mkdir(OUT, { recursive: true });
    await writeFile(path.join(OUT, ".gitkeep"), "");
  }

  const outputs = [];
  const metafiles = {};

  for (const preset of PRESETS) {
    for (const format of ["iife", "esm"]) {
      for (const minify of [false, true]) {
        const config = options(preset, { format, minify });
        const result = await esbuild.build(config);
        const file = path.relative(ROOT, config.outfile);
        const text = CHECK
          ? result.outputFiles?.[0]?.text || ""
          : await readFile(config.outfile, "utf8");
        outputs.push({
          preset: preset.name,
          format,
          minified: minify,
          file,
          bytes: Buffer.byteLength(text),
          gzip: await gzipSize(text),
          sri: sri(text)
        });
        Object.assign(metafiles, result.metafile.outputs);
      }
    }
  }

  const report = {
    name: pkg.name,
    version: pkg.version,
    built: null, // stamped by the release process, so builds stay reproducible
    presets: outputs,
    modules: moduleSizes(metafiles)
  };
  if (!CHECK) {
    await writeFile(path.join(OUT, "manifest.json"), JSON.stringify(report, null, 2) + "\n");
  }
  return report;
}

/**
 * Per-module shipped sizes, from esbuild's metafile — what §20.5's accounting
 * table is regenerated from. Unlike the old manifest this reports what
 * actually shipped *after* tree-shaking, so it is a measurement rather than a
 * projection.
 */
function moduleSizes(outputs) {
  const target = Object.keys(outputs).find((k) => k.endsWith("mutakit.min.js"));
  if (!target) return {};
  const inputs = outputs[target].inputs || {};
  const byGroup = {};
  for (const [file, info] of Object.entries(inputs)) {
    const group = file.split("/").slice(1, 3).join("/");
    byGroup[group] = (byGroup[group] || 0) + info.bytesInOutput;
  }
  return Object.fromEntries(Object.entries(byGroup).sort((a, b) => b[1] - a[1]));
}

async function gzipSize(text) {
  const { gzipSync } = await import("node:zlib");
  return gzipSync(Buffer.from(text), { level: 9 }).length;
}

/** SRI hashes for the CDN path, published in the release notes (§25.5). */
function sri(text) {
  return "sha384-" + createHash("sha384").update(text).digest("base64");
}

function report(result) {
  const rows = result.presets
    .filter((p) => p.minified && p.format === "iife")
    .map((p) => `  ${p.file.padEnd(30)} ${kb(p.bytes).padStart(10)}  ${kb(p.gzip).padStart(10)} gzip`);
  console.log(`mutakit ${result.version} — ${CHECK ? "checked" : "built"}`);
  console.log(rows.join("\n"));

  // §20.1's budgets, measured from the artifact that actually ships. Over
  // budget is reported on every build and *fails* only under --strict-budget,
  // which the release checklist (§25.4) passes: §20.5 asks for an over-budget
  // module to be recorded as a finding rather than absorbed as a quiet revision,
  // and a build that refuses to complete records nothing.
  const budgets = { mutakit: 32 * 1024, "mutakit.core": 8.5 * 1024 };
  let over = false;
  for (const preset of result.presets) {
    if (!preset.minified || preset.format !== "iife") continue;
    const budget = budgets[preset.preset];
    if (!budget) continue;
    const delta = preset.gzip / budget;
    if (preset.gzip > budget) {
      console.error(
        `  ! ${preset.preset} is ${kb(preset.gzip)} gzipped against a ${kb(budget)} budget ` +
          `(${delta.toFixed(1)}x) — §20.1`
      );
      over = true;
    }
  }
  if (over && STRICT) {
    console.error("\n  --strict-budget: refusing to release over budget.");
    process.exitCode = 1;
  }
}

function kb(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

if (WATCH) {
  const contexts = [];
  for (const preset of PRESETS) {
    const context = await esbuild.context(options(preset, { format: "iife", minify: false }));
    await context.watch();
    contexts.push(context);
  }
  console.log("watching source/ …");
} else {
  if (!existsSync(path.join(ROOT, "source"))) throw new Error("source/ is missing");
  report(await buildAll());
}
