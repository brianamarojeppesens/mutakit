/**
 * Hand-written types the prop schemas cannot express (§22.5).
 *
 * The generated half — one interface per element type, from the same schemas
 * that drive validation, docs, and devtools — is emitted by
 * `tools/gen-types.mjs` and merged with this file. What lives here is what a
 * schema has no vocabulary for: the fluent handle chain, generics on signals,
 * and the `Len` union itself.
 */

/** A length (§5.2). The union *is* the vocabulary; keep them in step. */
export type Len =
  | number
  | `${number}px` | `${number}rem` | `${number}em` | `${number}ch` | `${number}ex`
  | `${number}%`
  | `${number}vw` | `${number}vh` | `${number}vmin` | `${number}vmax`
  | `${number}dvh` | `${number}dvw` | `${number}svh` | `${number}lvh`
  | `${number}fr`
  | "auto" | "min-content" | "max-content" | "fit-content" | "none"
  | (string & {})
  | ((ctx: LenContext) => number);

export interface LenContext {
  basis: number;
  metrics: MetricsSnapshot;
  free?: number;
  frTotal?: number;
  intrinsic?: number;
}

export interface Point { x: number; y: number }
export interface Size { w: number; h: number }
export interface Rect { x: number; y: number; w: number; h: number }
export interface Inset { top: number; right: number; bottom: number; left: number }

export type AnchorKeyword =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right"
  | "block-start inline-start" | "block-start inline-end"
  | "block-end inline-start" | "block-end inline-end";

export type Anchor = AnchorKeyword | [number | string, number | string] | Point;

export type Priority = "required" | "strong" | "medium" | "weak";

/** What an ARIA attribute may be set to. `null` removes the attribute. */
export type AriaValue = string | number | boolean | null;

/** The geometry every element accepts, on top of its own props (§5). */
export interface Geometry {
  size?: Size | { w?: Len; h?: Len } | Len;
  width?: Len;
  height?: Len;
  min?: { w?: Len; h?: Len };
  max?: { w?: Len; h?: Len };
  minWidth?: Len; maxWidth?: Len; minHeight?: Len; maxHeight?: Len;
  at?: Anchor;
  anchor?: Anchor;
  of?: "viewport" | "parent" | Element | Handle | (() => Rect);
  offset?: [number, number] | Point;
  inset?: number | Partial<Inset> | "safe";
  left?: Len; right?: Len; top?: Len; bottom?: Len;
  inlineStart?: Len; inlineEnd?: Len; blockStart?: Len; blockEnd?: Len;
  insets?: false | string[];
  keepWithin?: boolean | Rect;
  positioning?: "parent" | "self";
  scrollWith?: "scrollport" | "content";
  priority?: Partial<Record<"start" | "end" | "size", Priority>>;
  z?: number;
}

/** Structural options every `create()` understands. */
export interface CommonProps extends Geometry {
  id?: string;
  key?: string;
  traits?: string[];
  algorithm?: string;
  layout?: Record<string, unknown>;
  layer?: string;
  content?: Content;
  slots?: Record<string, Content>;
  class?: string;
  style?: Partial<CSSStyleDeclaration>;
  hidden?: boolean;
  measureSync?: boolean;
  command?: string;
  on?: Record<string, (event: MkEvent) => void>;
  before?: Handle;
}

export type Content =
  | string
  | number
  | Node
  | DocumentFragment
  | ElementSpec
  | ElementSpec[]
  | ((ctx: ElementContext) => Node | ElementSpec)
  | (() => Promise<Node | ElementSpec | { default: Node | ElementSpec }>);

export interface ElementSpec extends CommonProps {
  type: string;
  children?: ElementSpec[];
  [prop: string]: unknown;
}

// ── Reactivity (§15.1) ───────────────────────────────────────────────────

export interface Signal<T> {
  (): T;
  (next: T | ((previous: T) => T)): T;
  peek(): T;
  set(next: T): T;
}

export interface Computed<T> {
  (): T;
  peek(): T;
}

export function signal<T>(initial: T, options?: { equals?: (a: T, b: T) => boolean }): Signal<T>;
export function computed<T>(fn: () => T, options?: { equals?: (a: T, b: T) => boolean }): Computed<T>;
export function effect(fn: () => void | (() => void)): () => void;
export function batch<T>(fn: () => T): T;
export function untrack<T>(fn: () => T): T;

/** Anywhere a value is accepted, a signal of that value is too. */
export type Reactive<T> = T | Signal<T> | Computed<T>;

// ── Events (§13.1) ───────────────────────────────────────────────────────

export interface MkEvent<D = unknown> {
  readonly type: string;
  readonly detail: D;
  readonly target: LayoutNode;
  readonly currentTarget: LayoutNode;
  readonly phase: "capture" | "at-target" | "bubble";
  readonly native: Event | null;
  readonly timeStamp: number;
  readonly defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

// ── The node tree and handles (§6.1, §18.1) ──────────────────────────────

export interface LayoutNode {
  readonly type: string;
  readonly id: string | null;
  readonly parent: LayoutNode | null;
  readonly children: readonly LayoutNode[];
  readonly props: Record<string, unknown>;
  readonly computed: Rect;
  readonly frame: Rect;
  readonly pathKey: string;
  readonly persistKey: string;
  readonly el: Element | null;
  readonly destroyed: boolean;
}

export interface SplitPane extends CommonProps {
  size?: Len;
  min?: Len;
  max?: Len;
  collapsible?: boolean | { at: number; to?: number };
  snap?: number[];
}

export interface SplitOptions {
  axis?: "x" | "y" | "vertical" | "horizontal";
  gutter?: number | { size?: number; draggable?: boolean; hitSlop?: number };
  panes: SplitPane[];
  resizeMode?: "neighbor" | "distribute" | "push";
  live?: boolean;
  step?: number;
}

export interface StackOptions {
  axis?: "x" | "y";
  gap?: Len;
  align?: "start" | "center" | "end" | "stretch" | "baseline";
  justify?: "start" | "center" | "end" | "between" | "around" | "evenly";
  wrap?: boolean;
  reverse?: boolean;
  children?: ElementSpec[];
}

/**
 * A handle. The declarative object form stays canonical (P2) — this is the
 * imperative escape hatch, and it carries the element's declared `commands`
 * as methods, which the generated half of these types adds per type.
 */
export interface Handle {
  readonly node: LayoutNode;
  readonly type: string;
  readonly id: string | null;
  readonly el: Element | null;
  readonly parent: Handle | null;
  readonly children: Handle[];

  create<T extends string>(type: T, props?: CommonProps & Record<string, unknown>): Handle;
  build(spec: ElementSpec | ElementSpec[]): Handle | Handle[];
  split(options: SplitOptions): Handle[];
  stack(options?: StackOptions): Handle[] | Handle;
  dock(options?: Record<string, unknown>): Handle[] | Handle;
  grid(options?: Record<string, unknown>): Handle[] | Handle;
  free(options?: Record<string, unknown>): Handle[] | Handle;
  flow(options?: Record<string, unknown>): Handle;
  anchor(options?: Record<string, unknown>): Handle;
  adopt(element: Element | string, options?: AdoptOptions): Handle;

  set(props: Record<string, unknown>): this;
  get(): Record<string, unknown>;
  get(name: string): unknown;
  constrain(values: Geometry): this;
  rect(): Readonly<Rect>;
  layout(): Record<string, unknown>;
  layout(values: Record<string, unknown>): this;

  on(name: string, fn: (event: MkEvent) => void, options?: { capture?: boolean; once?: boolean; order?: number }): () => void;
  once(name: string, fn: (event: MkEvent) => void): () => void;
  emit(name: string, detail?: unknown): MkEvent;

  trait(name: string): Record<string, unknown> | undefined;
  trait(name: string, options: Record<string, unknown>): Record<string, unknown> | undefined;

  byId(id: string): Handle | null;
  query(selector: string): Handle | null;
  queryAll(selector: string): Handle[];

  moveTo(parent: Handle, before?: Handle): this;
  show(): this;
  hide(): this;
  focus(options?: FocusOptions): this;
  remove(): boolean;
  destroy(): boolean;
  serialize(options?: SerializeOptions): SerializedDocument;
}

export interface AdoptOptions extends Geometry {
  id?: string;
  onDestroy?: "return" | "detach" | "remove";
  reparent?: boolean;
}

// ── The plugin contract (§8) ─────────────────────────────────────────────

export interface PropDescriptor {
  type?: "string" | "number" | "boolean" | "enum" | "object" | "array" | "any"
       | "len" | "size" | "selector" | "node" | "function" | "html" | "color";
  default?: unknown;
  values?: readonly unknown[];
  of?: string;
  min?: number;
  max?: number;
  integer?: boolean;
  required?: boolean;
  format?: "email" | "url" | "cssLength";
  reactive?: boolean;
  persist?: boolean;
  coerce?(value: unknown): unknown;
  validate?(value: unknown): string | null;
  doc?: string;
}

export interface ElementContext<P = Record<string, unknown>, S = Record<string, unknown>> {
  readonly node: LayoutNode;
  readonly el: Element;
  readonly props: P;
  readonly state: S;
  readonly mk: Instance;
  readonly geometry: Rect;
  readonly children: Handle[];
  readonly slots: Record<string, unknown>;
  readonly handle: Handle;
  constrain(values: Geometry): this;
  emit(name: string, detail?: unknown, options?: { bubbles?: boolean; cancelable?: boolean }): MkEvent;
  on(name: string, fn: (event: MkEvent) => void, options?: { capture?: boolean; once?: boolean }): () => void;
  invalidate(bits: "style" | "measure" | "arrange" | "paint" | Array<"style" | "measure" | "arrange" | "paint">): this;
  service<T = unknown>(name: string): T | undefined;
  trait(name: string): Record<string, unknown> | undefined;
  gesture(name: string, handlers: Record<string, (event: MkEvent) => void>): () => void;
  dom(tag: string, attrs?: Record<string, unknown> | null, parent?: Element | null): HTMLElement;
  css(props: Record<string, string | number | null>): this;
  setState(name: string, value: boolean | string | null): this;
  tokenPx(name: string, fallback?: number): number;
  len(value: Len, axis?: "x" | "y"): number;
  own<T>(disposable: T): T;
  effect(fn: () => void | (() => void)): () => void;
  announce(message: string, urgency?: "polite" | "assertive"): void;
  create(type: string, props?: CommonProps & Record<string, unknown>): Handle;
}

export interface ElementDefinition<P = Record<string, unknown>> {
  type: string;
  version?: string;
  extends?: string;
  requires?: Record<string, string>;
  abstract?: boolean;
  virtual?: boolean;
  props?: Record<string, PropDescriptor | string>;
  childProps?: Record<string, PropDescriptor | string>;
  geometry?: { defaults?: Geometry; resizable?: boolean | "proportional" };
  traits?: string[];
  algorithm?: string;
  slots?: Record<string, { max?: number }>;
  layer?: string;
  create?(ctx: ElementContext<P>, inherited?: Element): Element | null | void;
  mount?(ctx: ElementContext<P>): void;
  update?(ctx: ElementContext<P>, changed: Set<string>): void;
  measure?(ctx: ElementContext<P>, available: Rect): Size | void;
  arrange?(ctx: ElementContext<P>, rect: Rect): void;
  paint?(ctx: ElementContext<P>, time: number): void;
  unmount?(ctx: ElementContext<P>): void;
  destroy?(ctx: ElementContext<P>): void;
  serialize?(ctx: ElementContext<P>): Record<string, unknown> | void;
  commands?: Record<string, (ctx: ElementContext<P>, ...args: never[]) => unknown>;
  events?: string[];
  a11y?:
    | "presentation"
    | false
    | {
        role?: string | ((ctx: ElementContext<P>) => string);
        /**
         * ARIA values, recomputed on update. Deliberately not `unknown`: a
         * union with `unknown` collapses to `unknown` and the computed form
         * loses its contextual type, so the accepted value types are spelled
         * out and the callback parameter stays inferred.
         */
        props?: Record<string, AriaValue | ((ctx: ElementContext<P>) => AriaValue)>;
      };
  keys?: Record<string, string | ((ctx: ElementContext<P>) => void)>;
  styles?: string;
  tokens?: Record<string, string>;
  motion?: { enter?: string; exit?: string; reduced?: string };
  shadow?: boolean;
}

export interface TraitDefinition {
  name: string;
  version?: string;
  props?: Record<string, PropDescriptor | string>;
  requires?: string[];
  conflicts?: string[];
  attach?(ctx: ElementContext, options: Record<string, unknown>): Record<string, unknown> | void;
  mount?(ctx: ElementContext, api: Record<string, unknown>): void;
  detach?(ctx: ElementContext, api: Record<string, unknown>): void;
  api?: Record<string, (ctx: ElementContext, ...args: never[]) => unknown>;
  events?: string[];
  keys?: Record<string, unknown>;
}

export interface LayoutContext {
  readonly node: LayoutNode;
  readonly frame: Rect;
  readonly metrics: MetricsSnapshot;
  len(value: Len, axis?: "x" | "y"): number;
  tracks(axis: "x" | "y", lens: Len[], options?: { join?: boolean }): string | string[];
  place(child: LayoutNode, rect: Rect): LayoutNode;
  css(props: Record<string, string | number | null>): void;
  style(name: string, value: string | null): void;
  childProps(child: LayoutNode): Record<string, unknown>;
}

export interface LayoutAlgorithm {
  name: string;
  version?: string;
  schema?: Record<string, PropDescriptor | string>;
  childProps?: Record<string, PropDescriptor | string>;
  childrenFrom?(options: Record<string, unknown>): ElementSpec[] | null;
  setup?(node: LayoutNode, ctx: LayoutContext): void;
  measure?(node: LayoutNode, children: LayoutNode[], ctx: LayoutContext): Size;
  arrange?(node: LayoutNode, children: LayoutNode[], ctx: LayoutContext): void;
  css?(node: LayoutNode, ctx: LayoutContext): Record<string, string | null>;
  styles?: string;
  interactive?: boolean;
}

export interface Plugin {
  name: string;
  version?: string;
  requires?: Record<string, string>;
  install(mk: Instance, options?: unknown): { uninstall?(mk: Instance): void } | void;
}

export interface UnitDefinition {
  toNumber(value: number, ctx: LenContext): number;
  toCSS?(value: number, ctx: unknown): string;
  basis?: string;
}

// ── Metrics, serialization, instances ────────────────────────────────────

export interface MetricsSnapshot {
  readonly time: number;
  readonly vw: number;
  readonly vh: number;
  readonly offsetX: number;
  readonly offsetY: number;
  readonly scale: number;
  readonly dpr: number;
  readonly rem: number;
  readonly scrollbar: number;
  readonly keyboard: number;
  readonly safe: Inset;
  readonly reducedMotion: boolean;
  readonly darkScheme: boolean;
  readonly forcedColors: boolean;
  readonly coarsePointer: boolean;
  readonly features: Record<string, boolean>;
}

export interface SerializeOptions { pretty?: boolean }

export interface SerializedDocument {
  schema: number;
  mutakit: string;
  tree: ElementSpec | ElementSpec[];
}

export interface RestoreOptions {
  /** Default-strict: untrusted layout JSON reaches DOM sinks (§21.4). */
  allow?: "any" | { types?: string[]; props?: "schema" };
  into?: Handle;
}

export interface PersistOptions extends RestoreOptions {
  storage?: { getItem(key: string): string | null; setItem(key: string, value: string): unknown };
  debounce?: number;
}

export interface InstanceOptions {
  prefix?: string;
  theme?: string;
  inherit?: boolean;
  errorPolicy?: "isolate" | "propagate" | "silent";
  sanitize?: (markup: string) => string;
  nonce?: string;
  sizing?: "element" | "viewport" | "fixed";
  direction?: "ltr" | "rtl";
  shadow?: boolean | "all";
}

export interface MountOptions {
  sizing?: "element" | "viewport" | "fixed";
  size?: Size;
  algorithm?: string;
  id?: string;
}

export interface ConformanceFinding {
  level: "error" | "warn";
  code: string;
  message: string;
}

export interface Instance {
  readonly id: string;
  readonly version: string;
  readonly prefix: string;
  readonly root: LayoutNode | null;
  readonly metrics: { readonly current: MetricsSnapshot };

  mount(target: Element | string, options?: MountOptions): Handle;
  create(type: string, props?: CommonProps & Record<string, unknown>, parent?: Handle | LayoutNode): Handle;
  build(spec: ElementSpec | ElementSpec[], parent?: Handle | LayoutNode): Handle | Handle[];
  adopt(element: Element | string, options?: AdoptOptions, parent?: Handle): Handle;
  destroy(node: Handle | LayoutNode): boolean;
  destroyInstance(): void;

  define<P = Record<string, unknown>>(definition: ElementDefinition<P>, options?: { replace?: boolean }): unknown;
  trait(definition: TraitDefinition, options?: { replace?: boolean }): unknown;
  layout(algorithm: LayoutAlgorithm, options?: { replace?: boolean }): unknown;
  unit(name: string, definition: UnitDefinition, options?: { replace?: boolean }): unknown;
  theme(name: string, definition: { tokens?: Record<string, string> }): unknown;
  motion(name: string, preset: Record<string, unknown>): unknown;
  gesture(name: string, recognizer: Record<string, unknown>): unknown;
  input(name: string, source: Record<string, unknown>): unknown;
  serializer(migration: { from: number; to: number; migrate(doc: SerializedDocument): SerializedDocument }): unknown;

  use(plugin: Plugin | Plugin[], options?: unknown): this;
  unuse(name: string): boolean;
  provide<T>(name: string, service: T): T;
  service<T = unknown>(name: string): T | undefined;

  byId(id: string): Handle | null;
  query(selector: string, scope?: Handle): Handle | null;
  queryAll(selector: string, scope?: Handle): Handle[];

  serialize(scope?: Handle, options?: SerializeOptions): SerializedDocument;
  restore(doc: SerializedDocument, options?: RestoreOptions): Handle[];
  persist(key: string, options?: PersistOptions): { save(): void; stop(): void };

  tick(time?: number): this;
  flush(options?: { animations?: boolean }): Promise<void>;
  snapshot(scope?: Handle): Record<string, [number, number, number, number]>;
  applyTheme(name: string, node?: Handle): this;
}

export interface MutakitNamespace {
  readonly VERSION: string;
  readonly default: Instance;

  create(options?: InstanceOptions): Instance;
  create(type: string, props?: CommonProps & Record<string, unknown>): Handle;
  mount(target: Element | string, options?: MountOptions): Handle;
  reset(): MutakitNamespace;

  define<P = Record<string, unknown>>(definition: ElementDefinition<P>, options?: { replace?: boolean }): unknown;
  trait(definition: TraitDefinition, options?: { replace?: boolean }): unknown;
  layout(algorithm: LayoutAlgorithm, options?: { replace?: boolean }): unknown;
  unit(name: string, definition: UnitDefinition, options?: { replace?: boolean }): unknown;
  use(plugin: Plugin | Plugin[], options?: unknown): MutakitNamespace;

  signal: typeof signal;
  computed: typeof computed;
  effect: typeof effect;
  batch: typeof batch;
  untrack: typeof untrack;

  byId(id: string): Handle | null;
  query(selector: string, scope?: Handle): Handle | null;
  queryAll(selector: string, scope?: Handle): Handle[];
  build(spec: ElementSpec | ElementSpec[], parent?: Handle): Handle | Handle[];
  adopt(element: Element | string, options?: AdoptOptions, parent?: Handle): Handle;
  serialize(scope?: Handle, options?: SerializeOptions): SerializedDocument;
  restore(doc: SerializedDocument, options?: RestoreOptions): Handle[];
  persist(key: string, options?: PersistOptions): { save(): void; stop(): void };
  tick(time?: number): Instance;
  flush(options?: { animations?: boolean }): Promise<void>;
  conformance(definition: ElementDefinition): ConformanceFinding[];
  convert(p: Point, from: string, to: string, refs: Record<string, Rect>): Point;

  registry: {
    list(): Record<string, Array<{ name: string; version?: string; origin: string; own: boolean }>>;
    has(kind: string, name: string): boolean;
    get(kind: string, name: string): unknown;
  };

  diagnostics: {
    catalogue: Record<string, string>;
    sink(fn: ((record: { level: string; code: string; message: string }) => void) | null): void;
    reset(): void;
  };
}

declare const Mutakit: MutakitNamespace;
export default Mutakit;
export { Mutakit };
