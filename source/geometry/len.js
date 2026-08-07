/**
 * `Len` — the length algebra (§5.2).
 *
 * A single-pass tokenizer produces a `LenAST`, which is deliberately *not*
 * evaluated eagerly. Two backends compile it:
 *
 *   toCSS(ast)          → a CSS string, used in the common path
 *   toNumber(ast, ctx)  → a float, used only when interaction needs a number
 *
 * Keeping both backends over one AST is what lets P1 hold without duplicating
 * the unit vocabulary: the browser resolves lengths at rest, and JavaScript
 * resolves the same expression to a number only while a pointer is down.
 *
 * `toNumber` reads viewport- and font-relative units from a cached
 * `MetricsSnapshot` (§6.4), never from a fresh `getComputedStyle`.
 */
import "../core/dev.js";
import { fail, warn } from "../core/diagnostics.js";

/** Node kinds. Kept as short strings — they appear in serialized fixtures. */
export const PX = "px";
export const PCT = "pct";
export const FR = "fr";
export const KEYWORD = "kw";
export const UNIT = "unit";
export const CALL = "call";
export const OP = "op";
export const VAR = "var";
export const COMPUTED = "js";

const KEYWORDS = new Set([
  "auto",
  "none",
  "min-content",
  "max-content",
  "fit-content",
  "stretch",
  "inherit"
]);

/** Units resolvable without the registry. Everything else is a custom unit. */
const ABSOLUTE = { px: 1, cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, q: 96 / 101.6 };
const FONT_RELATIVE = new Set(["em", "rem", "ex", "ch", "cap", "ic", "lh", "rlh"]);
const VIEWPORT_RELATIVE = new Set([
  "vw", "vh", "vmin", "vmax", "vi", "vb",
  "dvw", "dvh", "dvmin", "dvmax",
  "svw", "svh", "svmin", "svmax",
  "lvw", "lvh", "lvmin", "lvmax"
]);
const CALLS = new Set(["calc", "min", "max", "clamp", "var", "env", "round"]);

const cache = new Map();
const CACHE_LIMIT = 512;

// ── Tokenizer ────────────────────────────────────────────────────────────

function tokenize(input) {
  const tokens = [];
  const length = input.length;
  let i = 0;

  while (i < length) {
    const code = input.charCodeAt(i);

    if (code === 32 || code === 9 || code === 10 || code === 13) {
      i++;
      continue;
    }

    // number, with an optional unit or '%'
    if ((code >= 48 && code <= 57) || code === 46 /* . */ ||
        ((code === 43 || code === 45) && isNumberStart(input, i + 1))) {
      let start = i;
      if (code === 43 || code === 45) i++;
      while (i < length && isDigit(input.charCodeAt(i))) i++;
      if (input.charCodeAt(i) === 46) {
        i++;
        while (i < length && isDigit(input.charCodeAt(i))) i++;
      }
      if (input.charCodeAt(i) === 101 || input.charCodeAt(i) === 69) {
        const save = i;
        i++;
        if (input.charCodeAt(i) === 43 || input.charCodeAt(i) === 45) i++;
        if (isDigit(input.charCodeAt(i))) while (i < length && isDigit(input.charCodeAt(i))) i++;
        else i = save;
      }
      const value = parseFloat(input.slice(start, i));
      let unit = "";
      if (input.charCodeAt(i) === 37) {
        unit = "%";
        i++;
      } else {
        const unitStart = i;
        while (i < length && isIdentChar(input.charCodeAt(i))) i++;
        unit = input.slice(unitStart, i).toLowerCase();
      }
      tokens.push({ t: "num", v: value, u: unit });
      continue;
    }

    // Identifier, possibly a function name or a custom property. A leading
    // hyphen only starts an identifier when another identifier character
    // follows (`--mk-w`); otherwise it is subtraction, which is the whole of
    // `calc(100% - 32px)`.
    if (isIdentStart(code) && (code !== 45 || isIdentStart(input.charCodeAt(i + 1)))) {
      const start = i;
      while (i < length && isIdentChar(input.charCodeAt(i))) i++;
      const word = input.slice(start, i);
      if (input.charCodeAt(i) === 40) {
        i++;
        tokens.push({ t: "fn", v: word.toLowerCase() });
      } else {
        tokens.push({ t: "ident", v: word });
      }
      continue;
    }

    if (code === 40) { tokens.push({ t: "(" }); i++; continue; }
    if (code === 41) { tokens.push({ t: ")" }); i++; continue; }
    if (code === 44) { tokens.push({ t: "," }); i++; continue; }
    if (code === 43 || code === 45 || code === 42 || code === 47) {
      tokens.push({ t: "op", v: input[i] });
      i++;
      continue;
    }

    return null; // an unexpected character; the caller reports MK1002
  }
  return tokens;
}

function isDigit(code) {
  return code >= 48 && code <= 57;
}

function isNumberStart(input, index) {
  const code = input.charCodeAt(index);
  return isDigit(code) || code === 46;
}

function isIdentStart(code) {
  return (
    (code >= 97 && code <= 122) || (code >= 65 && code <= 90) || code === 95 || code === 45 || code > 127
  );
}

function isIdentChar(code) {
  return isIdentStart(code) || isDigit(code);
}

// ── Parser ───────────────────────────────────────────────────────────────

function parseTokens(tokens) {
  let position = 0;

  function peek() {
    return tokens[position];
  }

  function next() {
    return tokens[position++];
  }

  function expression() {
    let left = product();
    if (left == null) return null;
    let token = peek();
    while (token && token.t === "op" && (token.v === "+" || token.v === "-")) {
      next();
      const right = product();
      if (right == null) return null;
      left = { k: OP, op: token.v, a: left, b: right };
      token = peek();
    }
    return left;
  }

  function product() {
    let left = unary();
    if (left == null) return null;
    let token = peek();
    while (token && token.t === "op" && (token.v === "*" || token.v === "/")) {
      next();
      const right = unary();
      if (right == null) return null;
      left = { k: OP, op: token.v, a: left, b: right };
      token = peek();
    }
    return left;
  }

  function unary() {
    const token = peek();
    if (token && token.t === "op" && (token.v === "-" || token.v === "+")) {
      next();
      const operand = unary();
      if (operand == null) return null;
      return token.v === "-"
        ? { k: OP, op: "*", a: { k: PX, v: -1 }, b: operand }
        : operand;
    }
    return primary();
  }

  function primary() {
    const token = next();
    if (!token) return null;

    if (token.t === "num") return numberNode(token);

    if (token.t === "ident") {
      const word = token.v.toLowerCase();
      if (KEYWORDS.has(word)) return { k: KEYWORD, v: word };
      // A bare identifier in an expression is a CSS keyword we pass through.
      return { k: KEYWORD, v: word };
    }

    if (token.t === "(") {
      const inner = expression();
      if (inner == null || !peek() || peek().t !== ")") return null;
      next();
      return inner;
    }

    if (token.t === "fn") {
      const args = [];
      if (peek() && peek().t === ")") {
        next();
      } else {
        for (;;) {
          if (token.v === "var" && peek() && peek().t === "ident" && args.length === 0) {
            args.push({ k: KEYWORD, v: next().v });
          } else if (token.v === "env" && peek() && peek().t === "ident" && args.length === 0) {
            args.push({ k: KEYWORD, v: next().v });
          } else {
            const argument = expression();
            if (argument == null) return null;
            args.push(argument);
          }
          const after = next();
          if (!after) return null;
          if (after.t === ")") break;
          if (after.t !== ",") return null;
        }
      }
      if (token.v === "calc") return args[0] || null;
      if (token.v === "var") return { k: VAR, name: args[0] && args[0].v, fallback: args[1] || null };
      if (!CALLS.has(token.v)) return { k: CALL, name: token.v, args };
      return { k: CALL, name: token.v, args };
    }

    return null;
  }

  const ast = expression();
  if (ast == null || position !== tokens.length) return null;
  return ast;
}

function numberNode(token) {
  if (token.u === "" ) return { k: PX, v: token.v };
  if (token.u === "%") return { k: PCT, v: token.v };
  if (token.u === "fr") return { k: FR, v: token.v };
  if (token.u === "px") return { k: PX, v: token.v };
  return { k: UNIT, v: token.v, u: token.u };
}

// ── Public parsing ───────────────────────────────────────────────────────

/**
 * Parse a `Len` into an AST. Results are cached by input string — the same
 * handful of length expressions is re-parsed constantly during a drag.
 *
 * An unparseable input is MK1002 and resolves to `auto`, because an element
 * that silently fails to appear is the worst outcome (§21.3).
 */
export function parse(input) {
  if (input == null) return null;
  if (typeof input === "number") {
    return isFinite(input) ? { k: PX, v: input } : invalid(input);
  }
  if (typeof input === "function") return { k: COMPUTED, fn: input };
  if (typeof input === "object" && input.k) return input; // already an AST

  if (typeof input !== "string") return invalid(input);
  const text = input.trim();
  if (text === "") return invalid(input);

  const cached = cache.get(text);
  if (cached !== undefined) return cached;

  const tokens = tokenize(text);
  const ast = tokens ? parseTokens(tokens) : null;
  const result = ast || invalid(input);
  if (cache.size >= CACHE_LIMIT) cache.clear();
  cache.set(text, result);
  return result;
}

function invalid(input) {
  warn("MK1002", __MK_DEV__ &&
    `cannot parse the length ${JSON.stringify(input)}; falling back to 'auto'`, {
    subject: String(input)
  });
  return { k: KEYWORD, v: "auto", invalid: true };
}

/** Clear the parse cache. Tests use this; nothing else should need it. */
export function clearCache() {
  cache.clear();
}

// ── CSS backend ──────────────────────────────────────────────────────────

/**
 * Compile to a CSS string. `options.wrap` forces a `calc()` wrapper, which the
 * caller wants when the result is interpolated into a larger expression.
 */
export function toCSS(ast, options) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return "";
  const text = emit(node, options || {});
  if (node.k === OP && !(options && options.raw)) return `calc(${text})`;
  return text;
}

function emit(node, options) {
  switch (node.k) {
    case PX:
      return node.v === 0 ? "0px" : `${round(node.v)}px`;
    case PCT:
      return `${round(node.v)}%`;
    case FR:
      return `${round(node.v)}fr`;
    case UNIT: {
      const custom = options.units && options.units(node.u);
      if (custom && custom.toCSS) return custom.toCSS(node.v, options);
      return `${round(node.v)}${node.u}`;
    }
    case KEYWORD:
      return node.v;
    case VAR:
      return node.fallback
        ? `var(${node.name}, ${emit(node.fallback, options)})`
        : `var(${node.name})`;
    case CALL: {
      if (node.name === "env") {
        const [first, ...rest] = node.args;
        const tail = rest.map((a) => emit(a, options));
        return `env(${[first.v, ...tail].join(", ")})`;
      }
      return `${node.name}(${node.args.map((a) => emit(a, options)).join(", ")})`;
    }
    case OP: {
      const a = emit(node.a, options);
      const b = emit(node.b, options);
      const left = node.a.k === OP ? `(${a})` : a;
      const right = node.b.k === OP ? `(${b})` : b;
      return `${left} ${node.op} ${right}`;
    }
    case COMPUTED:
      // A computed length has no CSS form; the engine writes the number it
      // produced into a custom property instead, so this is the fallback only.
      return "auto";
    default:
      return "auto";
  }
}

function round(value) {
  return Math.abs(value % 1) < 1e-6 ? value.toFixed(0) : parseFloat(value.toFixed(4));
}

// ── Number backend ───────────────────────────────────────────────────────

/**
 * Resolve to a number of CSS pixels.
 *
 * `ctx` supplies: `basis` (the resolution basis of §5.3), `metrics` (a
 * MetricsSnapshot), `free` and `frTotal` for `fr` distribution, `vars` for
 * custom-property lookup, `units` for the custom-unit registry, and
 * `intrinsic` for measured `auto`.
 */
export function toNumber(ast, ctx) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return NaN;
  const c = ctx || {};
  return evaluate(node, c);
}

function evaluate(node, ctx) {
  switch (node.k) {
    case PX:
      return node.v;
    case PCT:
      return (node.v / 100) * (ctx.basis || 0);
    case FR: {
      if (!ctx.frTotal) return 0;
      return (node.v / ctx.frTotal) * (ctx.free || 0);
    }
    case KEYWORD:
      return keywordValue(node.v, ctx);
    case UNIT:
      return unitValue(node, ctx);
    case VAR: {
      const raw = ctx.vars ? ctx.vars(node.name) : undefined;
      if (raw === undefined || raw === "" || raw === null) {
        return node.fallback ? evaluate(node.fallback, ctx) : NaN;
      }
      return typeof raw === "number" ? raw : toNumber(raw, ctx);
    }
    case CALL:
      return callValue(node, ctx);
    case OP: {
      const a = evaluate(node.a, ctx);
      const b = evaluate(node.b, ctx);
      switch (node.op) {
        case "+": return a + b;
        case "-": return a - b;
        case "*": return a * b;
        case "/": return b === 0 ? NaN : a / b;
        default: return NaN;
      }
    }
    case COMPUTED:
      return node.fn(ctx);
    default:
      return NaN;
  }
}

function keywordValue(word, ctx) {
  if (word === "auto" || word === "fit-content" || word === "stretch") {
    return ctx.intrinsic != null ? ctx.intrinsic : NaN;
  }
  if (word === "min-content") return ctx.minContent != null ? ctx.minContent : ctx.intrinsic ?? NaN;
  if (word === "max-content") return ctx.maxContent != null ? ctx.maxContent : ctx.intrinsic ?? NaN;
  if (word === "none") return Infinity;
  return NaN;
}

function unitValue(node, ctx) {
  const unit = node.u;
  const metrics = ctx.metrics || {};

  if (unit in ABSOLUTE) return node.v * ABSOLUTE[unit];

  if (FONT_RELATIVE.has(unit)) {
    switch (unit) {
      case "rem": case "rlh": return node.v * (metrics.rem || 16);
      case "em": case "lh": return node.v * (ctx.em || metrics.rem || 16);
      case "ex": return node.v * (metrics.ex || (ctx.em || metrics.rem || 16) * 0.5);
      case "ch": case "ic": return node.v * (metrics.ch || (ctx.em || metrics.rem || 16) * 0.5);
      case "cap": return node.v * (metrics.cap || (ctx.em || metrics.rem || 16) * 0.7);
      default: return node.v * (metrics.rem || 16);
    }
  }

  if (VIEWPORT_RELATIVE.has(unit)) {
    const w = metrics.vw || 0;
    const h = metrics.vh || 0;
    const axis = unit.replace(/^[dsl]/, "");
    switch (axis) {
      case "vw": case "vi": return (node.v / 100) * w;
      case "vh": case "vb": return (node.v / 100) * h;
      case "vmin": return (node.v / 100) * Math.min(w, h);
      case "vmax": return (node.v / 100) * Math.max(w, h);
      default: return NaN;
    }
  }

  const custom = ctx.units && ctx.units(unit);
  if (custom) return custom.toNumber(node.v, ctx);

  warn("MK1005", __MK_DEV__ &&
    `unknown length unit '${unit}'`, { subject: unit });
  return NaN;
}

function callValue(node, ctx) {
  const args = node.args.map((a) => (a.k === KEYWORD && node.name === "env" ? NaN : evaluate(a, ctx)));
  switch (node.name) {
    case "min": return Math.min(...args);
    case "max": return Math.max(...args);
    case "clamp": return Math.min(Math.max(args[1], args[0]), args[2]);
    case "round": return Math.round(args[args.length - 1]);
    case "env": {
      const name = node.args[0] && node.args[0].v;
      const safe = (ctx.metrics && ctx.metrics.safe) || {};
      const value = safeAreaValue(name, safe);
      if (value != null) return value;
      return node.args[1] ? evaluate(node.args[1], ctx) : 0;
    }
    default:
      return NaN;
  }
}

function safeAreaValue(name, safe) {
  switch (name) {
    case "safe-area-inset-top": return safe.top || 0;
    case "safe-area-inset-right": return safe.right || 0;
    case "safe-area-inset-bottom": return safe.bottom || 0;
    case "safe-area-inset-left": return safe.left || 0;
    default: return null;
  }
}

// ── Queries the engine asks about a length ───────────────────────────────

/** True when the value contains an `fr` anywhere — track contexts only. */
export function isFlexible(ast) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return false;
  if (node.k === FR) return true;
  if (node.k === OP) return isFlexible(node.a) || isFlexible(node.b);
  if (node.k === CALL) return node.args.some(isFlexible);
  return false;
}

/** True when the value needs measurement before it resolves (§6.5). */
export function isIntrinsic(ast) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return false;
  if (node.k === KEYWORD) {
    return node.v === "auto" || node.v === "min-content" || node.v === "max-content" || node.v === "fit-content";
  }
  if (node.k === OP) return isIntrinsic(node.a) || isIntrinsic(node.b);
  if (node.k === CALL) return node.args.some(isIntrinsic);
  return false;
}

/** The `fr` coefficient, or 0 for a value with none. */
export function frCoefficient(ast) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return 0;
  if (node.k === FR) return node.v;
  if (node.k === OP && node.op === "+") return frCoefficient(node.a) + frCoefficient(node.b);
  return 0;
}

/** True when the browser can resolve this without JavaScript (P1). */
export function isCSSResolvable(ast) {
  const node = typeof ast === "object" && ast && ast.k ? ast : parse(ast);
  if (!node) return false;
  if (node.k === COMPUTED) return false;
  if (node.k === OP) return isCSSResolvable(node.a) && isCSSResolvable(node.b);
  if (node.k === CALL) return node.args.every((a) => a.k === KEYWORD || isCSSResolvable(a));
  return true;
}

/** Convenience: parse then compile to CSS in one call. */
export function css(value, options) {
  return toCSS(parse(value), options);
}

/** Convenience: parse then resolve to a number in one call. */
export function px(value, ctx) {
  return toNumber(parse(value), ctx);
}

/**
 * `fr` distribution (§5.2).
 *
 * Free space is split in proportion to the coefficients, then each track is
 * clamped by its own min/max; whatever clamping takes back is redistributed to
 * the tracks that are still free. Iterates to a fixed point, at most four
 * passes, then accepts — which is what CSS Grid does, and why delegating to
 * `grid-template-*` produces identical results in the common case.
 */
export function distributeFr(tracks, free) {
  const state = tracks.map((track) => ({
    fr: track.fr || 0,
    min: track.min != null ? track.min : 0,
    max: track.max != null ? track.max : Infinity,
    size: 0,
    flexible: (track.fr || 0) > 0,
    frozen: false
  }));

  // Non-flexible tracks take their declared base, clamped, and leave the rest.
  let fixed = 0;
  for (let i = 0; i < state.length; i++) {
    if (state[i].flexible) continue;
    const base = tracks[i].base != null ? tracks[i].base : 0;
    state[i].size = clampTo(base, state[i].min, state[i].max);
    state[i].frozen = true;
    fixed += state[i].size;
  }

  const budget = free - fixed;
  let pool = budget;

  for (let pass = 0; pass < 4; pass++) {
    const active = state.filter((t) => t.flexible && !t.frozen);
    if (!active.length) break;
    const total = active.reduce((sum, t) => sum + t.fr, 0);
    if (total <= 0) break;

    let froze = false;
    for (const track of active) {
      const wanted = (track.fr / total) * pool;
      const clamped = clampTo(wanted, track.min, track.max);
      track.size = clamped;
      if (Math.abs(clamped - wanted) > 1e-6) {
        track.frozen = true;
        froze = true;
      }
    }
    if (!froze) break;

    // Whatever the clamped tracks took is off the table; the rest share again.
    let taken = 0;
    for (const track of state) if (track.flexible && track.frozen) taken += track.size;
    pool = budget - taken;
  }

  return state.map((t) => t.size);
}

function clampTo(value, min, max) {
  return Math.min(Math.max(value, min), max);
}
