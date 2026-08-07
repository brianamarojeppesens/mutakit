/**
 * Base CSS, as JS string constants (§20.5).
 *
 * Keeping the stylesheet inline is deliberate: a separate `.css` file would
 * break the single-`<script>`-tag promise (§1.4) to save a quarter kilobyte
 * gzipped. It is written as JavaScript rather than as `.css` imported through
 * a text loader so that raw source loads in a browser with no build step at
 * all — which is what the development harness relies on (§23.3).
 */

/** Tagged template, for editor syntax highlighting and nothing else. */
export function css(strings, ...values) {
  return strings.reduce((out, part, i) => out + part + (i < values.length ? values[i] : ""), "");
}

/**
 * The cascade layer order (§12.1). `mutakit.user` last means an author never
 * needs `!important` to restyle anything.
 */
export const LAYER_ORDER = `@layer mutakit.reset, mutakit.tokens, mutakit.base, mutakit.layout, mutakit.element, mutakit.theme, mutakit.user;`;

/** Minimal, and scoped to Mutakit roots only — never a page-wide reset. */
export const RESET_CSS = css`
  [data-mk-root],
  [data-mk-root] .mk-node {
    box-sizing: border-box;
  }
  [data-mk-root] .mk-node {
    margin: 0;
    min-width: 0;
    min-height: 0;
  }
  [data-mk-root] :where(button, input, select, textarea) {
    font: inherit;
    color: inherit;
  }
`;

/**
 * Three token tiers (§12.3), so a theme author changes a dozen values rather
 * than three hundred. Component tokens default to semantic ones; semantic
 * tokens default to primitives.
 */
export const TOKENS_CSS = css`
  [data-mk-root] {
    /* tier 1 — primitives */
    --mk-gray-50: #f8fafc;
    --mk-gray-100: #f1f5f9;
    --mk-gray-200: #e2e8f0;
    --mk-gray-300: #cbd5e1;
    --mk-gray-500: #64748b;
    --mk-gray-700: #334155;
    --mk-gray-800: #1e293b;
    --mk-gray-900: #0f172a;
    --mk-blue-500: #3b82f6;
    --mk-blue-600: #2563eb;
    --mk-red-500: #ef4444;
    --mk-amber-500: #f59e0b;
    --mk-green-500: #22c55e;

    --mk-space-1: 4px;
    --mk-space-2: 8px;
    --mk-space-3: 12px;
    --mk-space-4: 16px;
    --mk-space-6: 24px;

    --mk-radius-sm: 3px;
    --mk-radius-md: 6px;
    --mk-radius-lg: 10px;

    --mk-dur-fast: 120ms;
    --mk-dur-med: 200ms;
    --mk-dur-slow: 320ms;
    --mk-ease-out: cubic-bezier(0.16, 1, 0.3, 1);
    --mk-ease-in-out: cubic-bezier(0.65, 0, 0.35, 1);

    --mk-font: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    --mk-font-mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --mk-text-sm: 13px;
    --mk-text-md: 14px;
    --mk-text-lg: 16px;

    /* tier 2 — semantic */
    --mk-color-surface: var(--mk-gray-50);
    --mk-color-surface-raised: #ffffff;
    --mk-color-surface-sunken: var(--mk-gray-100);
    --mk-color-accent: var(--mk-blue-600);
    --mk-color-danger: var(--mk-red-500);
    --mk-color-warning: var(--mk-amber-500);
    --mk-color-success: var(--mk-green-500);
    --mk-color-muted: var(--mk-gray-300);
    --mk-text-primary: var(--mk-gray-900);
    --mk-text-secondary: var(--mk-gray-500);
    --mk-border-subtle: var(--mk-gray-200);
    --mk-border-strong: var(--mk-gray-300);
    --mk-elevation-1: 0 1px 2px rgb(15 23 42 / 0.08);
    --mk-elevation-2: 0 4px 12px rgb(15 23 42 / 0.12);
    --mk-elevation-3: 0 12px 32px rgb(15 23 42 / 0.18);
    --mk-focus-ring: 2px solid var(--mk-color-accent);

    /* geometry defaults, so the contract's properties always resolve */
    --mk-gutter: 6px;
    --mk-density: 1;
    --mk-target-min: 24px;

    color: var(--mk-text-primary);
    font-family: var(--mk-font);
    font-size: var(--mk-text-md);
  }

  [data-mk-root][data-mk-scheme="dark"],
  [data-mk-root][data-mk-theme="dark"] {
    --mk-color-surface: var(--mk-gray-900);
    --mk-color-surface-raised: var(--mk-gray-800);
    --mk-color-surface-sunken: #0a1120;
    --mk-color-muted: var(--mk-gray-700);
    --mk-text-primary: var(--mk-gray-100);
    --mk-text-secondary: var(--mk-gray-300);
    --mk-border-subtle: #24324a;
    --mk-border-strong: #35486a;
    --mk-elevation-1: 0 1px 2px rgb(0 0 0 / 0.4);
    --mk-elevation-2: 0 4px 12px rgb(0 0 0 / 0.5);
    --mk-elevation-3: 0 12px 32px rgb(0 0 0 / 0.6);
  }

  @media (prefers-color-scheme: dark) {
    [data-mk-root][data-mk-theme="system"] {
      --mk-color-surface: var(--mk-gray-900);
      --mk-color-surface-raised: var(--mk-gray-800);
      --mk-text-primary: var(--mk-gray-100);
      --mk-text-secondary: var(--mk-gray-300);
      --mk-border-subtle: #24324a;
    }
  }

  [data-mk-root][data-mk-density="compact"] {
    --mk-density: 0.75;
  }
  [data-mk-root][data-mk-density="spacious"] {
    --mk-density: 1.35;
  }
`;

/**
 * Structural rules every element relies on. This is where P1 shows: the
 * position and size of a node are `var()` reads, so the engine's whole WRITE
 * output is a handful of custom properties.
 */
export const BASE_CSS = css`
  [data-mk-root] {
    position: relative;
    contain: layout style;
  }
  .mk-root--viewport {
    position: fixed;
    inset: 0;
    width: 100%;
    height: 100%;
  }

  .mk-node {
    position: absolute;
    left: var(--mk-x, 0px);
    top: var(--mk-y, 0px);
    width: var(--mk-w, auto);
    height: var(--mk-h, auto);
    contain: layout style;
  }

  /* Algorithms that put children in flow own their boxes (§9.1). */
  [data-mk-algorithm="stack"] > .mk-node,
  [data-mk-algorithm="flow"] > .mk-node,
  [data-mk-algorithm="grid"] > .mk-node,
  [data-mk-algorithm="split"] > .mk-node,
  [data-mk-algorithm="dock"] > .mk-node {
    position: relative;
    left: auto;
    top: auto;
  }
  [data-mk-algorithm="flow"] > .mk-node {
    width: auto;
    height: auto;
  }

  [data-mk-hidden] {
    display: none !important;
  }
  [data-mk-errored] {
    outline: 1px dashed var(--mk-color-danger);
    outline-offset: -1px;
  }

  .mk-node:focus-visible {
    outline: var(--mk-focus-ring);
    outline-offset: 2px;
  }

  /* Focus indicators use outline, which forced-colors preserves (§14). */
  @media (forced-colors: active) {
    .mk-node:focus-visible {
      outline: 2px solid Highlight;
    }
  }

  [data-mk-dragging] {
    user-select: none;
    will-change: transform;
  }
`;
