#!/usr/bin/env node
/**
 * R1's exit gate, run rather than described (§27.2).
 *
 * R1 asks whether CSS Grid's `minmax()`/`fr` clamping reproduces §7.3's
 * clamping cascade, and its exit condition is precise: *"run the same
 * measurements (not the on-screen verdict) in Firefox and Safari"*. Chrome was
 * measured in draft 6; the other two baseline engines were never available in a
 * session, so the gate stayed open.
 *
 * The reason it stayed open is worth naming, because it is not the hard part of
 * the question. `test/proto/split-grid.html` is interactive: discharging the
 * gate meant a person dragging a gutter in three browsers and reading a
 * PASS/FAIL off the screen. Nobody was ever going to do that twice, so the
 * numbers were never going to be comparable.
 *
 * `split-grid-measure.html` asks the same question deterministically — 42 cases
 * sweeping container widths against requested track sizes, covering every
 * boundary §27.2 names — and publishes what the engine resolved. This runner
 * collects that from whatever engines are installed and diffs them against the
 * committed Chrome baseline.
 *
 *   node tools/r1-measure.mjs             compare every available engine
 *   node tools/r1-measure.mjs --record    rewrite the baseline from Chromium
 *   node tools/r1-measure.mjs --json      machine-readable output
 *
 * An engine that cannot launch is reported as *unavailable*, never as passing.
 * A gate that silently counts a missing engine as agreement is worse than an
 * open gate, because it looks closed.
 */
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const PAGE = path.join(ROOT, "test/proto/split-grid-measure.html");
const BASELINE = path.join(ROOT, "test/proto/r1-baseline.json");

const argv = new Set(process.argv.slice(2));
const RECORD = argv.has("--record");
const AS_JSON = argv.has("--json");

/** The §25.3 baseline engines. WebKit stands in for Safari on Linux. */
const ENGINES = ["chromium", "firefox", "webkit"];

async function main() {
  const html = await readFile(PAGE, "utf8");
  const server = createServer((_, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;

  let playwright = null;
  try {
    playwright = await import("playwright");
  } catch {
    // Not installed is a different answer from installed-and-unlaunchable, and
    // the report should say which.
  }

  const results = {};
  for (const name of ENGINES) {
    results[name] = playwright
      ? await collect(playwright[name], url, name)
      : { status: "unavailable", reason: "playwright is not installed" };
  }
  server.close();

  const baseline = JSON.parse(await readFile(BASELINE, "utf8"));

  if (RECORD) {
    const source = results.chromium;
    if (source.status !== "ok") {
      fail(`--record needs chromium, which is ${source.status}: ${source.reason || ""}`);
      return;
    }
    await writeFile(
      BASELINE,
      JSON.stringify({ ...baseline, engine: source.engine, cases: source.cases }, null, 1) + "\n"
    );
    console.log(`recorded ${source.cases.length} cases from ${source.engine}`);
    return;
  }

  const report = { baseline: baseline.engine, recorded: baseline.crossEngine || null, engines: {} };
  for (const name of ENGINES) {
    const result = results[name];
    report.engines[name] =
      result.status === "ok"
        ? { status: "measured", engine: result.engine, divergences: diff(baseline.cases, result.cases) }
        : { status: result.status, reason: result.reason };
  }

  if (AS_JSON) {
    console.log(JSON.stringify(report, null, 1));
  } else {
    print(report);
  }

  // Divergence fails; unavailability does not. The gate is discharged by
  // *evidence*, and this command cannot manufacture an engine it does not have.
  const diverged = Object.values(report.engines).some(
    (entry) => entry.status === "measured" && entry.divergences.length
  );
  process.exitCode = diverged ? 1 : 0;
}

async function collect(browserType, url, name) {
  if (!browserType) return { status: "unavailable", reason: "not in this playwright build" };
  let browser = null;
  try {
    browser = await browserType.launch();
    const page = await browser.newPage();
    await page.goto(url);
    await page.waitForSelector("html[data-r1='done']", { timeout: 15000 });
    const report = await page.evaluate(() => window.__r1);
    return { status: "ok", engine: report.engine, cases: report.cases };
  } catch (error) {
    return { status: "unavailable", reason: firstLine(error.message) };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

/**
 * Where an engine resolved a different number.
 *
 * Half a pixel: the measurement keeps two decimal places precisely because
 * §27.2's stated signal is "a `cap0` that does not resolve to the exact
 * arithmetic value", which would mean percentages resolving against a
 * different box. Rounding that away would hide the thing being looked for.
 */
function diff(expected, actual) {
  const out = [];
  for (let i = 0; i < expected.length; i++) {
    const a = expected[i];
    const b = actual[i];
    if (!b) {
      out.push({ case: i, reason: "missing" });
      continue;
    }
    const moved = a.tracks
      .map((value, track) => ({ track, expected: value, actual: b.tracks[track] }))
      .filter((entry) => Math.abs(entry.expected - entry.actual) > 0.5);
    if (moved.length) {
      out.push({ case: i, width: a.width, w0: a.w0, w1: a.w1, flex: a.flex, tracks: moved });
    }
  }
  return out;
}

function print(report) {
  console.log(`R1 — CSS clamping across engines (baseline: ${report.baseline})\n`);
  for (const [name, entry] of Object.entries(report.engines)) {
    if (entry.status !== "measured") {
      console.log(`  ${name.padEnd(9)} unavailable — ${entry.reason}`);
      continue;
    }
    if (!entry.divergences.length) {
      console.log(`  ${name.padEnd(9)} agrees with the baseline on all 42 cases`);
      continue;
    }
    console.log(`  ${name.padEnd(9)} ${entry.divergences.length} divergence(s):`);
    for (const divergence of entry.divergences.slice(0, 8)) {
      const detail = divergence.tracks
        .map((t) => `track ${t.track}: ${t.expected} → ${t.actual}`)
        .join(", ");
      console.log(`      width ${divergence.width}, w0 ${divergence.w0}, w1 ${divergence.w1} — ${detail}`);
    }
  }
  const measured = Object.values(report.engines).filter((e) => e.status === "measured").length;
  console.log(`\n  ${measured} of ${ENGINES.length} engines measured in this run.`);

  // What this run saw and what the gate has on record are different facts, and
  // conflating them goes wrong in both directions: an environment with no
  // browsers would report a discharged gate as open, and a recorded pass would
  // excuse a run that measured nothing. Print both, labelled.
  if (measured === ENGINES.length) {
    console.log("  R1's exit gate is discharged by this run.");
  } else if (report.recorded) {
    const { verified, engines, result } = report.recorded;
    console.log(`  R1 was discharged on ${verified}: ${engines.join(", ")} — ${result}.`);
    console.log("  This run adds nothing to that; an engine that cannot launch has not agreed.");
  } else {
    console.log("  R1 stays open: an engine that cannot run has not agreed.");
  }
}

/**
 * One actionable line from a launch failure.
 *
 * Playwright frames its missing-dependency error in a box-drawing banner, so
 * naively taking the first line yields an empty string — which reads as "it
 * failed for no reason" and is exactly the sort of report that gets ignored.
 */
function firstLine(message) {
  const text = String(message);
  if (/missing dependencies/i.test(text)) {
    const install = text.match(/sudo [^\s║]+[^║]*/);
    return `host is missing browser libraries — ${(install ? install[0] : "install browser deps").trim()}`;
  }
  const line = text
    .split("\n")
    .map((l) => l.replace(/[║╔╚═╝╗]/g, "").trim())
    .find((l) => l && !/^browserType\.launch:?$/.test(l));
  return (line || text).trim().slice(0, 120);
}

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

main();
