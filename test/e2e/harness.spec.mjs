/**
 * The cross-engine gate (§23.3, §26 M1).
 *
 * Two specs, both of which read a page's own verdict rather than re-deriving
 * it: the harness reports through `window.harness`, and the R1 prototype
 * reports its own PASS/FAIL. Running them across all three baseline engines is
 * what §26's M1 exit gate asks for, and what §25.4's "run the thing, don't
 * cite it" item points at.
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

test("the R1 split-grid prototype reports PASS", async ({ page }) => {
  await page.goto("/test/proto/split-grid.html");
  await page.waitForFunction(() => document.documentElement.dataset.verdict !== undefined, null, {
    timeout: 15_000
  });
  const verdict = await page.evaluate(() => ({
    verdict: document.documentElement.dataset.verdict,
    rows: window.__r1 ? window.__r1.rows : []
  }));
  // `distribute` overrunning a maximum is the analysed, accepted outcome
  // (§27.2 R1) — the one result other engines should reproduce, not contradict.
  expect(verdict.verdict).toBe("pass");
});
