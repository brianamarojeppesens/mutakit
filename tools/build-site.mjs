#!/usr/bin/env node
/**
 * Assemble the GitHub Pages site into `_site/`.
 *
 *   node tools/build-site.mjs        build _site
 *   node tools/serve.mjs             then open http://localhost:8080/_site/
 *
 * The examples import `../source/entries/*.js` directly — raw ES modules, no
 * bundle — because `source/core/dev.js` defaults `__MK_DEV__` to true when
 * nothing has defined it. That is the whole trick here: the site is the
 * repository, served. Copying the tree preserves every relative path exactly
 * as it resolves on the dev server, so a page that works locally works
 * published, and there is no second set of paths to keep in step.
 *
 * `test/` is deliberately included. A library that says "run the thing, don't
 * cite it" (§25.4) should let a visitor run it: the harness, the axe sweep and
 * the benchmarks all execute in the reader's own browser and report what they
 * find there, rather than asking anyone to believe a number in a README. The
 * R1 measurement page is published for the same reason — it is the evidence
 * behind the one risk this design rested on.
 */
import { cp, mkdir, rm, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const OUT = path.join(ROOT, "_site");

/** Copied verbatim; every relative path inside them keeps working. */
const TREES = ["source", "examples", "test", "build", "docs"];

const EXAMPLES = [
  {
    href: "examples/ide-layout.html",
    scenario: "S1",
    title: "IDE layout",
    blurb:
      "Recursive splits with a draggable gutter, collapsed to a rail and back, " +
      "restored from storage. The layout that motivated the geometry model."
  },
  {
    href: "examples/app-shell.html",
    scenario: "S2",
    title: "Application chrome",
    blurb:
      "Menus, dialogs, toasts, a command palette and a form — the overlay and " +
      "control catalog, each one a tab stop and each one announced."
  },
  {
    href: "examples/game-hud.html",
    scenario: "S3",
    title: "Game HUD",
    blurb:
      "Meters, a minimap and a ticker driven from signals at frame rate, " +
      "inside the §20.3 budget for a full HUD update."
  }
];

const LIVE = [
  {
    href: "test/index.html",
    title: "The test suite",
    blurb: "154 assertions, in your browser, right now."
  },
  {
    href: "test/a11y.html",
    title: "The axe sweep",
    blurb: "Every element type in several states, under WCAG 2.1 AA plus best-practice."
  },
  {
    href: "test/bench/",
    title: "The benchmarks",
    blurb: "The §20.3 budgets, measured on your machine — so the numbers are yours, not mine."
  },
  {
    href: "test/proto/split-grid-measure.html",
    title: "R1: CSS clamping",
    blurb: "42 cases of nested clamp()/min() in a grid. The evidence P1 rests on."
  }
];

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });

  for (const tree of TREES) {
    await cp(path.join(ROOT, tree), path.join(OUT, tree), { recursive: true }).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      console.warn(`# skipped ${tree}/ — not present`);
    });
  }

  const pkg = JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8"));
  await writeFile(path.join(OUT, "index.html"), landing(pkg));
  // Pages runs Jekyll over the upload unless told not to, and Jekyll drops
  // every path beginning with an underscore. Nothing here starts with one
  // today, which is exactly the kind of thing that silently stops being true.
  await writeFile(path.join(OUT, ".nojekyll"), "");

  console.log(`built _site for ${pkg.name} ${pkg.version}`);
}

function card({ href, title, blurb, scenario }) {
  return `      <a class="card" href="${href}">
        ${scenario ? `<span class="tag">${scenario}</span>` : ""}
        <h3>${title}</h3>
        <p>${blurb}</p>
      </a>`;
}

function landing(pkg) {
  const repo = "https://github.com/brianamarojeppesens/mutakit";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mutakit — a dependency-free browser GUI library</title>
<meta name="description" content="${pkg.description}">
<style>
  :root {
    color-scheme: light dark;
    --bg: #ffffff; --fg: #16181d; --muted: #5b6270;
    --line: #e3e6ea; --card: #f7f8fa; --accent: #0a6fb0;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0f1115; --fg: #e6e8ec; --muted: #98a0ae;
      --line: #262b33; --card: #171a20; --accent: #6cb8e8;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; background: var(--bg); color: var(--fg);
    font: 16px/1.6 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 62rem; margin: 0 auto; padding: 4rem 1.25rem 5rem; }
  header { border-bottom: 1px solid var(--line); padding-bottom: 2rem; margin-bottom: 2.5rem; }
  h1 { font-size: clamp(2rem, 6vw, 3rem); margin: 0 0 .5rem; letter-spacing: -.02em; }
  .lede { font-size: 1.15rem; color: var(--muted); margin: 0 0 1.5rem; max-width: 46rem; }
  .pills { display: flex; flex-wrap: wrap; gap: .5rem; }
  .pill {
    font: 500 .8rem/1 ui-monospace, Menlo, monospace; padding: .45rem .65rem;
    border: 1px solid var(--line); border-radius: 999px; color: var(--muted);
  }
  h2 { font-size: 1.1rem; text-transform: uppercase; letter-spacing: .08em;
       color: var(--muted); margin: 3rem 0 1rem; }
  .grid { display: grid; gap: 1rem; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); }
  .card {
    display: block; padding: 1.25rem; border: 1px solid var(--line); border-radius: 12px;
    background: var(--card); text-decoration: none; color: inherit; transition: border-color .15s;
  }
  .card:hover, .card:focus-visible { border-color: var(--accent); }
  .card h3 { margin: .35rem 0 .4rem; font-size: 1.05rem; }
  .card p { margin: 0; color: var(--muted); font-size: .92rem; }
  .tag { font: 600 .7rem/1 ui-monospace, monospace; color: var(--accent); letter-spacing: .06em; }
  pre {
    background: var(--card); border: 1px solid var(--line); border-radius: 12px;
    padding: 1rem; overflow-x: auto; font-size: .85rem; line-height: 1.5;
  }
  code { font-family: ui-monospace, Menlo, monospace; }
  footer { margin-top: 4rem; padding-top: 1.5rem; border-top: 1px solid var(--line);
           color: var(--muted); font-size: .9rem; }
  a { color: var(--accent); }
  .note { color: var(--muted); font-size: .92rem; max-width: 46rem; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>Mutakit</h1>
    <p class="lede">${pkg.description} You describe <em>what element</em> and
      <em>where</em>; CSS remains the layout engine.</p>
    <div class="pills">
      <span class="pill">v${pkg.version}</span>
      <span class="pill">0 runtime deps</span>
      <span class="pill">31.8 kB core &middot; 73.9 kB full, gzipped</span>
      <span class="pill">MIT</span>
    </div>
  </header>

  <h2>The three driving scenarios</h2>
  <div class="grid">
${EXAMPLES.map(card).join("\n")}
  </div>

  <h2>Run it yourself</h2>
  <p class="note">These are not screenshots or recorded numbers. Each page executes
    in your browser and reports what it finds there — including the benchmarks,
    which will show your machine's figures rather than the ones in the README.</p>
  <div class="grid">
${LIVE.map(card).join("\n")}
  </div>

  <h2>Getting it</h2>
  <pre><code>&lt;script src="${repo}/releases/latest/download/mutakit.min.js"&gt;&lt;/script&gt;
&lt;script&gt;
  const app = Mutakit.mount(document.body, { sizing: 'viewport' });
  const [side, main] = app.split({ axis: 'x', gutter: 6, panes: [
    { id: 'side', size: 240, min: 160 },
    { id: 'main', size: '1fr' }
  ]});
&lt;/script&gt;</code></pre>

  <footer>
    <p><a href="${repo}">Source on GitHub</a> &middot;
       <a href="${repo}/releases/latest">Latest release</a> &middot;
       <a href="${repo}/blob/main/PLAN.md">The design document</a> &middot;
       <a href="docs/size-accounting.md">Size accounting</a></p>
    <p>The examples here load raw ES modules from <code>source/</code>, so what
       you are reading is the library itself, not a bundle of it.</p>
  </footer>
</div>
</body>
</html>
`;
}

main();
