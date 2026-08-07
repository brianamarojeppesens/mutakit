/**
 * The benchmark suite (§20.3).
 *
 * Five scenarios with the thresholds §20.1 states. Each reports a number and a
 * verdict rather than a rating: a benchmark whose result cannot fail is a
 * demo.
 *
 * Timings are medians of repeated runs. A mean over five runs on a machine
 * that is also running a browser is mostly a measure of what else the machine
 * was doing.
 */
import { Mutakit } from "../../source/entries/full.js";

const scratch = document.getElementById("scratch");
const results = document.getElementById("results");
const summary = document.getElementById("summary");
const report = [];

function stage(w = 1200, h = 800) {
  const host = document.createElement("div");
  host.style.cssText = `position:relative;width:${w}px;height:${h}px`;
  scratch.appendChild(host);
  const mk = Mutakit.create();
  const app = mk.mount(host, { sizing: "fixed", size: { w, h } });
  return { mk, app, dispose: () => { mk.destroyInstance(); host.remove(); } };
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(runs, fn) {
  const timings = [];
  for (let i = 0; i < runs; i++) {
    const started = performance.now();
    fn(i);
    timings.push(performance.now() - started);
  }
  return median(timings);
}

const BENCHMARKS = [
  {
    name: "cold init, 100-node tree",
    threshold: 16,
    unit: "ms",
    run() {
      return measure(5, () => {
        const { app, mk, dispose } = stage();
        for (let i = 0; i < 100; i++) {
          app.create("pane", { at: "top-left", inset: i, size: { w: 40, h: 20 } });
        }
        mk.tick();
        dispose();
      });
    }
  },
  {
    name: "split drag, 200 nodes",
    threshold: 4,
    unit: "ms/frame",
    run() {
      const { app, mk, dispose } = stage();
      const [left] = app.split({
        axis: "x",
        panes: [{ id: "l", size: 300, min: 100 }, { id: "r", size: "1fr" }]
      });
      for (let i = 0; i < 200; i++) left.create("pane", { at: "top-left", inset: i, size: { w: 20, h: 8 } });
      mk.tick();

      const gutter = mk.handleFor(app.node.children.find((n) => n.type === "resizer"));
      const time = measure(20, (i) => {
        gutter.nudge(i % 2 ? 8 : -8);
        mk.tick();
      });
      dispose();
      return time;
    }
  },
  {
    name: "100 HUD elements, animating",
    threshold: 8,
    unit: "ms/frame",
    run() {
      const { app, mk, dispose } = stage();
      const hud = app.create("hud-layer", {});
      const bars = [];
      for (let i = 0; i < 100; i++) {
        bars.push(hud.create("hud-bar", { at: "top-left", inset: i, size: { w: 60, h: 6 }, ghost: false }));
      }
      mk.tick();
      const time = measure(30, (i) => {
        for (const bar of bars) bar.set({ value: ((i % 10) + 1) / 10 });
        mk.tick();
      });
      dispose();
      return time;
    }
  },
  {
    name: "modal open and close",
    threshold: 8,
    unit: "ms",
    run() {
      const { app, mk, dispose } = stage();
      mk.tick();
      const time = measure(20, () => {
        const modal = app.create("modal", { title: "Bench", backdrop: true });
        mk.tick();
        modal.close();
        mk.tick();
      });
      dispose();
      return time;
    }
  },
  {
    name: "1000-row list, build and arrange",
    threshold: 120,
    unit: "ms",
    run() {
      return measure(3, () => {
        const { app, mk, dispose } = stage();
        const list = app.create("stack", { axis: "y", left: 0, top: 0, width: 400, height: 800 });
        for (let i = 0; i < 1000; i++) list.create("pane", { layout: { size: 24 }, content: `Row ${i}` });
        mk.tick();
        dispose();
      });
    }
  },
  {
    name: "idle frame, 500 nodes (must write nothing)",
    threshold: 1,
    unit: "writes",
    run() {
      const { app, mk, dispose } = stage();
      for (let i = 0; i < 500; i++) {
        app.create("pane", { at: "top-left", inset: i % 700, size: { w: 20, h: 10 } });
      }
      mk.tick();
      const before = mk.compiler.writes;
      mk.tick();
      mk.tick();
      const writes = mk.compiler.writes - before;
      dispose();
      return writes;
    }
  }
];

for (const benchmark of BENCHMARKS) {
  let value;
  let error = null;
  try {
    value = benchmark.run();
  } catch (problem) {
    error = String(problem.message || problem);
  }
  const passed = error === null && value <= benchmark.threshold;
  report.push({ name: benchmark.name, value, unit: benchmark.unit, threshold: benchmark.threshold, passed, error });

  const item = document.createElement("li");
  item.className = passed ? "pass" : "fail";
  const label = document.createElement("span");
  label.className = "name";
  label.textContent = benchmark.name;
  item.appendChild(label);
  const detail = document.createElement("span");
  detail.className = "why";
  detail.textContent = error
    ? error
    : `${round(value)} ${benchmark.unit} (budget ${benchmark.threshold})`;
  item.appendChild(detail);
  results.appendChild(item);
}

const failed = report.filter((entry) => !entry.passed).length;
summary.textContent = `${report.length - failed} within budget · ${failed} over`;
summary.className = `summary ${failed ? "fail" : "pass"}`;
document.documentElement.setAttribute("data-harness", failed ? "fail" : "pass");

window.harness = {
  done: true,
  results: report.map((entry) => ({
    name: entry.name,
    passed: entry.passed,
    skipped: false,
    error: entry.error || (entry.passed ? null : `${round(entry.value)} ${entry.unit} over ${entry.threshold}`),
    value: entry.value
  })),
  summary: { passed: report.length - failed, failed, skipped: 0, report }
};

function round(value) {
  return Math.round(value * 100) / 100;
}
