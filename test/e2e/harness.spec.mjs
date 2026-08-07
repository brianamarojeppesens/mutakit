/**
 * The cross-engine gate (§23.3, §26 M1).
 *
 * The harness reports through `window.harness`, and this reads that verdict
 * rather than re-deriving it. Running it across all three baseline engines is
 * what §26's M1 exit gate asks for, and what §25.4's "run the thing, don't
 * cite it" item points at.
 *
 * There was a second spec here, asserting that test/proto/split-grid.html set
 * `document.documentElement.dataset.verdict` to "pass". That page has never
 * set that attribute, nor the `window.__r1` the spec went on to read: it
 * renders a sentence into `#verdict` for a person to read after dragging a
 * gutter. The spec was written against an API that does not exist and was
 * never run, so nothing said so — it went straight to a 15-second timeout the
 * first time CI executed it.
 *
 * It is not replaced, because what it was reaching for is already covered
 * better. `npm run r1` drives the deterministic split-grid-measure.html in
 * every installed engine and diffs all 42 cases against the committed
 * baseline, which is a stronger claim than one page's PASS/FAIL, and it runs
 * as its own CI job.
 */
import { expect, test } from "@playwright/test";

test("the harness passes", async ({ page }) => {
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(String(error)));

  await page.goto("/test/index.html");
  await page.waitForFunction(() => window.harness && window.harness.done);

  const results = await page.evaluate(() => window.harness.results);
  const failed = results.filter((r) => !r.passed && !r.skipped);
  expect(failed.map((r) => `${r.name}: ${r.error}`)).toEqual([]);
  expect(results.length).toBeGreaterThan(0);
  expect(pageErrors).toEqual([]);
});
