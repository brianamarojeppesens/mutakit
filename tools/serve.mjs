#!/usr/bin/env node
/**
 * The development server and headless test driver (§23.3).
 *
 * ES modules are *fetched*, so `file://` is CORS-blocked and the direct-open
 * path drafts 1–6 assumed no longer works (§22.2). Serving is now a
 * requirement rather than a convenience, so it ships with the project instead
 * of being a README footnote.
 *
 *   node tools/serve.mjs           serve on :8080
 *   node tools/serve.mjs --run     serve, drive the harness, print TAP, exit
 *
 * Two environment variables select what `--run` covers:
 *
 *   MK_ENGINES=chromium,firefox,webkit   §25.3 baseline engines (default: chromium)
 *   MK_PAGES=harness,a11y,bench          harness pages (default: harness,a11y)
 */
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const argv = new Set(process.argv.slice(2));
const PORT = Number(process.env.PORT || 8080);

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2"
};

export function serve(port = PORT) {
  const server = createServer(async (request, response) => {
    const url = new URL(request.url, `http://localhost:${port}`);
    let filePath = path.join(ROOT, decodeURIComponent(url.pathname));

    // Never serve outside the project, whatever the path contains.
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403).end("forbidden");
      return;
    }

    try {
      const info = await stat(filePath);
      if (info.isDirectory()) filePath = path.join(filePath, "index.html");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": TYPES[path.extname(filePath)] || "application/octet-stream",
        "cache-control": "no-store"
      });
      response.end(body);
    } catch (error) {
      response.writeHead(404, { "content-type": "text/plain" }).end(`not found: ${url.pathname}`);
    }
  });

  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/**
 * The pages that publish a `window.harness`.
 *
 * All three implement the same contract — `{ done, results, summary }` — but
 * until this list existed the driver only ever visited the first one, so the
 * axe sweep and the benchmarks were automated in every respect except being
 * run. Checking them meant opening a browser by hand, which meant in practice
 * that they were checked when someone remembered to.
 *
 * `bench` is not in the default set. Its budgets are wall-clock, and a shared
 * CI runner is the wrong instrument for them: the split-drag scenario already
 * moves between 3.1 and 4.5 ms against a 4 ms budget on identical code (see
 * test/bench/bench.js). Gating merges on that would teach everyone to re-run
 * red builds until they go green, which costs more than the signal is worth.
 * CI runs it as a separate, non-blocking job.
 */
const PAGES = {
  harness: { url: "/test/index.html", label: "harness" },
  a11y: { url: "/test/a11y.html", label: "a11y" },
  bench: { url: "/test/bench/", label: "bench" }
};
const DEFAULT_PAGES = ["harness", "a11y"];

/**
 * Drive the harness with Playwright and print TAP.
 *
 * Playwright covers every §25.3 baseline engine from one script, which is what
 * turns R1's exit gate from a standing manual task into a CI job (§23.3). It
 * needs system libraries the browsers link against; where those are missing the
 * run reports it and exits non-zero rather than passing silently.
 */
async function run() {
  // An ephemeral port, as r1-measure.mjs already uses. A driven run has no
  // caller that needs to know the address, so binding the documented dev port
  // bought nothing and made `--run` fail outright whenever a dev server was
  // already up — which is most of the time someone is working on the library.
  const server = await serve(Number(process.env.PORT || 0));
  const port = server.address().port;
  const engines = (process.env.MK_ENGINES || "chromium").split(",");
  const pages = (process.env.MK_PAGES || DEFAULT_PAGES.join(",")).split(",");
  let failures = 0;
  let playwright;

  try {
    playwright = await import("playwright");
  } catch (error) {
    console.error("playwright is not installed; run `npm install`");
    server.close();
    process.exitCode = 1;
    return;
  }

  // One plan for the whole run, printed at the end. A `1..N` per engine looks
  // reasonable and is not valid TAP: consumers take the second plan as a new
  // stream and report the counts of one engine as the counts of all of them.
  const lines = [];
  let n = 0;
  const emit = (ok, name, detail) => {
    lines.push(`${ok ? "ok" : "not ok"} ${++n} - ${name}${detail || ""}`);
  };

  for (const engine of engines) {
    const launcher = playwright[engine];
    if (!launcher) {
      lines.push(`# unknown engine '${engine}'`);
      emit(false, `${engine} — unknown engine`);
      failures++;
      continue;
    }
    let browser;
    try {
      browser = await launcher.launch();
    } catch (error) {
      // An engine that cannot launch has not agreed with anything. Reporting
      // it as a failed assertion rather than a skipped one is deliberate: a
      // missing engine used to leave no trace in the TAP stream at all.
      lines.push(`# ${engine}: could not launch — ${firstLine(error)}`);
      emit(false, `${engine} — could not launch`);
      failures++;
      continue;
    }

    for (const key of pages) {
      const target = PAGES[key];
      if (!target) {
        lines.push(`# unknown page '${key}'`);
        emit(false, `${engine} — unknown page '${key}'`);
        failures++;
        continue;
      }

      const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
      const consoleErrors = [];
      page.on("pageerror", (error) => consoleErrors.push(String(error)));
      lines.push(`# ${engine} · ${target.label}`);

      try {
        await page.goto(`http://localhost:${port}${target.url}`, { waitUntil: "load" });
        await page.waitForFunction(() => window.harness && window.harness.done, null, { timeout: 60000 });
      } catch (error) {
        // A page that never finishes is the one case where reporting nothing
        // reads as success — there are no failed assertions because there are
        // no assertions at all.
        emit(false, `${engine} · ${target.label} — never completed`);
        lines.push(`  ---\n  message: ${firstLine(error)}\n  ...`);
        failures++;
        await page.close();
        continue;
      }

      const results = await page.evaluate(() => window.harness.results);
      for (const result of results) {
        const ok = result.skipped || result.passed;
        emit(ok, `${engine} · ${target.label} · ${result.name}`, result.skipped ? " # SKIP" : "");
        if (!ok) {
          lines.push(`  ---\n  message: ${result.error}\n  ...`);
          failures++;
        }
      }
      for (const error of consoleErrors) {
        emit(false, `${engine} · ${target.label} — uncaught: ${error}`);
        failures++;
      }
      await page.close();
    }
    await browser.close();
  }

  for (const line of lines) console.log(line);
  console.log(`1..${n}`);
  console.log(`# ${n - failures}/${n} passed across ${engines.join(", ")}`);

  server.close();
  if (failures) process.exitCode = 1;
}

function firstLine(error) {
  return String(error.message || error).split("\n")[0];
}

if (argv.has("--run")) {
  await run();
} else {
  await serve(PORT);
  console.log(`serving ${ROOT} on http://localhost:${PORT}`);
  console.log(`  harness   http://localhost:${PORT}/test/index.html`);
  console.log(`  prototype http://localhost:${PORT}/test/proto/split-grid.html`);
}
