/**
 * Shared helpers for the DOM-free tier.
 *
 * Diagnostics are routed away from the console and collected, so a test can
 * assert *which* code was reported rather than merely that something was
 * logged — the codes are stable API (§21.2) and worth asserting on.
 */
import { setDiagnosticSink, resetDiagnostics } from "../../source/core/diagnostics.js";

export function quiet() {
  const records = [];
  resetDiagnostics();
  setDiagnosticSink((record) => records.push(record));
  return {
    records,
    codes: () => records.map((r) => r.code),
    has: (code) => records.some((r) => r.code === code),
    restore() {
      setDiagnosticSink(null);
      resetDiagnostics();
    }
  };
}

/** Round to two decimals, so sub-pixel noise never fails an assertion. */
export function round(value) {
  return Math.round(value * 100) / 100;
}

export function roundRect(r) {
  return [round(r.x), round(r.y), round(r.w), round(r.h)];
}
