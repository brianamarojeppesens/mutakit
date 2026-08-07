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
 * Drive the harness with Playwright and print TAP.
 *
 * Playwright covers every §25.3 baseline engine from one script, which is what
 * turns R1's exit gate from a standing manual task into a CI job (§23.3). It
 * needs system libraries the browsers link against; where those are missing the
 * run reports it and exits non-zero rather than passing silently.
 */
async function run() {
  const server = await serve(PORT);
  const engines = (process.env.MK_ENGINES || "chromium").split(",");
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

  for (const engine of engines) {
    const launcher = playwright[engine];
    if (!launcher) {
      console.error(`# unknown engine '${engine}'`);
      failures++;
      continue;
    }
    let browser;
    try {
      browser = await launcher.launch();
    } catch (error) {
      console.error(`# ${engine}: could not launch — ${firstLine(error)}`);
      failures++;
      continue;
    }

    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const consoleErrors = [];
    page.on("pageerror", (error) => consoleErrors.push(String(error)));
    await page.goto(`http://localhost:${PORT}/test/index.html`, { waitUntil: "load" });
    await page.waitForFunction(() => window.harness && window.harness.done, null, { timeout: 30000 });
    const results = await page.evaluate(() => window.harness.results);

    console.log(`# ${engine}`);
    console.log(`1..${results.length}`);
    results.forEach((result, index) => {
      const status = result.skipped ? "ok" : result.passed ? "ok" : "not ok";
      const directive = result.skipped ? " # SKIP" : "";
      console.log(`${status} ${index + 1} - ${result.name}${directive}`);
      if (!result.passed && !result.skipped) {
        console.log(`  ---\n  message: ${result.error}\n  ...`);
        failures++;
      }
    });
    for (const error of consoleErrors) {
      console.log(`# uncaught: ${error}`);
      failures++;
    }
    await browser.close();
  }

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
