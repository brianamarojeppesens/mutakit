/**
 * GENERATED — do not edit. `npm run types` regenerates this file from the
 * prop schemas in `source/`, merged with `source/types/manual.d.ts`.
 *
 * Mutakit 1.0.1 · 58 element types.
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
  /** `dock` returns *this* handle — its children are named, not ordered (§7.4). */
  dock(options?: Record<string, unknown>): Handle;
  /** A named child of a docked node, by region name or by the id it was given. */
  region(name: string): Handle | null;
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
  /** Where stylesheets go — §10.15. Defaults to injecting into the document. */
  styles?: (css: string, options: Record<string, unknown>) => (() => void) | void;
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
  /** A custom prop type: return `{ value }` to accept (coercing if useful), `{ error }` to reject. */
  validator(
    name: string,
    check: (value: unknown, descriptor: Record<string, unknown>, path: string) =>
      { value: unknown } | { error: string },
    options?: { replace?: boolean }
  ): unknown;
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
  /** A full-frame host in a named layer band — `mk.layer('hud', …)` (§16.1). */
  layer(name: string, options?: CommonProps & Record<string, unknown>): Handle;

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

  /**
   * Collect CSS instead of injecting it — §10.15's built-in sink, for server
   * rendering, static extraction, or a test.
   */
  collectStyles(): {
    sink: (css: string, options: Record<string, unknown>) => () => void;
    text(): string;
    keys(): string[];
  };
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
  layer(name: string, options?: CommonProps & Record<string, unknown>): Handle;
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


// ── Generated from the prop schemas (§8.1) ───────────────────────────────

export interface AccordionProps extends CommonProps {
  /** @default false */

  multiple?: Reactive<boolean>;
  /** Persisted in serialized layouts (§19.1). */

  open?: Reactive<string[]>;
  sections?: Reactive<unknown[]>;
}

export interface AccordionHandle extends Handle {
  toggle(...args: never[]): unknown;
}

export interface AlertProps extends CommonProps {
  actions?: Reactive<unknown[]>;
  /** @default true */

  backdrop?: Reactive<boolean>;
  /** @default "" */

  description?: Reactive<string>;
  /** @default "modal" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  initialFocus?: Reactive<string | Element>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default true */

  lockScroll?: Reactive<boolean>;
  /** @default true · Persisted in serialized layouts (§19.1). */

  open?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  title?: Reactive<string>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface AlertHandle extends Handle {
  cancel(...args: never[]): unknown;
  close(...args: never[]): unknown;
  open(...args: never[]): unknown;
  submit(...args: never[]): unknown;
}

export interface BannerProps extends CommonProps {
  /** @default false */

  dismissible?: Reactive<boolean>;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  text?: Reactive<string>;
  /** @default "info" */

  variant?: Reactive<"info" | "success" | "warning" | "danger">;
}

export interface ButtonProps extends CommonProps {
  /** @default "button" */

  buttonType?: Reactive<"button" | "submit" | "reset">;
  /** @default false */

  disabled?: Reactive<boolean>;
  pressed?: Reactive<boolean>;
  /** @default "" */

  text?: Reactive<string>;
  /** @default "default" */

  variant?: Reactive<"default" | "primary" | "danger" | "ghost">;
}

export interface ButtonHandle extends Handle {
  click(...args: never[]): unknown;
}

export interface CheckboxProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  value?: Reactive<boolean>;
}

export interface CheckboxHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface ColorProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "#000000" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface ColorHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface ComboboxProps extends CommonProps {
  /** @default false */

  allowCustom?: Reactive<boolean>;
  /** @default false */

  disabled?: Reactive<boolean>;
  filter?: Reactive<(...args: never[]) => unknown>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  options?: Reactive<unknown[]>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface ComboboxHandle extends Handle {
  close(...args: never[]): unknown;
  open(...args: never[]): unknown;
}

export interface CrosshairProps extends CommonProps {
  /** @default "idle" */

  state?: Reactive<"idle" | "target" | "hit" | "reload">;
}

export interface DateProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface DateHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface DialogProps extends CommonProps {
  actions?: Reactive<unknown[]>;
  /** @default true */

  backdrop?: Reactive<boolean>;
  /** @default "" */

  description?: Reactive<string>;
  /** @default "modal" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  initialFocus?: Reactive<string | Element>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default true */

  lockScroll?: Reactive<boolean>;
  /** @default true · Persisted in serialized layouts (§19.1). */

  open?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  title?: Reactive<string>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface DialogHandle extends Handle {
  cancel(...args: never[]): unknown;
  close(...args: never[]): unknown;
  open(...args: never[]): unknown;
  submit(...args: never[]): unknown;
}

export interface DividerProps extends CommonProps {
  /** @default "horizontal" */

  orientation?: Reactive<"horizontal" | "vertical">;
}

export interface DrawerProps extends CommonProps {
  /** @default true */

  backdrop?: Reactive<boolean>;
  /** @default "light" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default "end" */

  edge?: Reactive<"start" | "end" | "top" | "bottom">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  initialFocus?: Reactive<string | Element>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default true */

  lockScroll?: Reactive<boolean>;
  /** @default true · Persisted in serialized layouts (§19.1). */

  open?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default 320 */

  size?: Reactive<Len>;
  /** @default "" */

  title?: Reactive<string>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface DrawerHandle extends Handle {
  close(...args: never[]): unknown;
  open(...args: never[]): unknown;
}

export interface EmailProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface EmailHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface EmptyStateProps extends CommonProps {
  action?: Reactive<unknown>;
  /** @default "" */

  description?: Reactive<string>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  title?: Reactive<string>;
}

export interface FieldProps extends CommonProps {
  /** @default "" */

  description?: Reactive<string>;
  /** @default "" */

  error?: Reactive<string>;
  /** @default "" */

  for?: Reactive<string>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "stacked" */

  layout?: Reactive<"stacked" | "inline">;
  /** @default false */

  required?: Reactive<boolean>;
}

export interface FileProps extends CommonProps {
  /** @default "" */

  accept?: Reactive<string>;
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default false */

  multiple?: Reactive<boolean>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default null · Persisted in serialized layouts (§19.1). */

  value?: Reactive<unknown>;
}

export interface FileHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface FormProps extends CommonProps {
  /** @default false */

  disabled?: Reactive<boolean>;
  schema?: Reactive<Record<string, unknown>>;
  timing?: Reactive<Record<string, unknown>>;
  validate?: Reactive<Record<string, unknown>>;
  /** Persisted in serialized layouts (§19.1). */

  values?: Reactive<Record<string, unknown>>;
}

export interface FormHandle extends Handle {
  reset(...args: never[]): unknown;
  state(...args: never[]): unknown;
  submit(...args: never[]): unknown;
  validateField(...args: never[]): unknown;
  values(...args: never[]): unknown;
}

export interface GroupProps extends CommonProps {
  /** @default "" */

  label?: Reactive<string>;
}

export interface HudBarProps extends CommonProps {
  /** @default true */

  ghost?: Reactive<boolean>;
  /** @default 400 */

  ghostDelay?: Reactive<number>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 1 · @minimum 0 · @maximum 1 */

  value?: Reactive<number>;
  /** @default "health" */

  variant?: Reactive<"health" | "mana" | "stamina" | "xp">;
}

export interface HudLayerProps extends CommonProps {
  /** @default false */

  interactive?: Reactive<boolean>;
  /** @default false */

  spatial?: Reactive<boolean>;
}

export interface HudMarkerProps extends CommonProps {
  /** @default true */

  clampToEdge?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 24 */

  margin?: Reactive<number>;
  project?: Reactive<(...args: never[]) => unknown>;
}

export interface IconProps extends CommonProps {
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default 16 */

  size?: Reactive<Len>;
}

export interface KeyPromptProps extends CommonProps {
  /** @default "" */

  action?: Reactive<string>;
  /** @default "" */

  gamepad?: Reactive<string>;
  /** @default "" */

  keyboard?: Reactive<string>;
  /** @default "auto" */

  scheme?: Reactive<"auto" | "keyboard" | "gamepad">;
}

export interface ListProps extends CommonProps {
  items?: Reactive<unknown[]>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 28 */

  rowHeight?: Reactive<number>;
  /** @default "single" */

  selection?: Reactive<"none" | "single" | "multiple">;
  /** @default false */

  virtual?: Reactive<boolean>;
}

export interface ListHandle extends Handle {
  rendered(...args: never[]): unknown;
}

export interface MenuProps extends CommonProps {
  /** @default false */

  arrow?: Reactive<boolean>;
  /** @default true */

  autoFocus?: Reactive<boolean>;
  /** @default false */

  contextMode?: Reactive<boolean>;
  /** @default "light" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default true */

  flip?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  items?: Reactive<unknown[]>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 8 */

  offset?: Reactive<number>;
  padding?: Reactive<Len>;
  /** @default "bottom-start" */

  placement?: Reactive<string>;
  reference?: Reactive<unknown>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default true */

  shift?: Reactive<boolean>;
  strategy?: Reactive<string>;
  /** @default false */

  trapFocus?: Reactive<boolean>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface MenuHandle extends Handle {
  close(...args: never[]): unknown;
  closeChain(...args: never[]): unknown;
  select(...args: never[]): unknown;
}

export interface MeterProps extends CommonProps {
  high?: Reactive<number>;
  /** @default "" */

  label?: Reactive<string>;
  low?: Reactive<number>;
  /** @default 100 */

  max?: Reactive<number>;
  /** @default 0 */

  min?: Reactive<number>;
  /** @default 0 */

  value?: Reactive<number>;
}

export interface MinimapProps extends CommonProps {
  center?: Reactive<Record<string, unknown>>;
  /** @default 0 */

  rotation?: Reactive<number>;
  /** @default 1 · @minimum 0.1 */

  zoom?: Reactive<number>;
}

export interface ModalProps extends CommonProps {
  /** @default true */

  backdrop?: Reactive<boolean>;
  /** @default "modal" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  initialFocus?: Reactive<string | Element>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default true */

  lockScroll?: Reactive<boolean>;
  /** @default true · Persisted in serialized layouts (§19.1). */

  open?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  title?: Reactive<string>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface ModalHandle extends Handle {
  close(...args: never[]): unknown;
  open(...args: never[]): unknown;
}

export interface NotificationFeedProps extends CommonProps {
  /** @default false */

  announce?: Reactive<boolean>;
  /** @default 5 */

  max?: Reactive<number>;
  /** @default 6000 */

  ttl?: Reactive<number>;
}

export interface NotificationFeedHandle extends Handle {
  push(...args: never[]): unknown;
}

export interface NumberProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  max?: Reactive<number>;
  min?: Reactive<number>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default true */

  scrub?: Reactive<boolean>;
  /** @default 1 */

  step?: Reactive<number>;
  /** @default 0 · Persisted in serialized layouts (§19.1). */

  value?: Reactive<number>;
}

export interface NumberHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface PaneProps extends CommonProps {
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
}

export interface PasswordProps extends CommonProps {
  /** @default "current-password" */

  autocomplete?: Reactive<string>;
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface PasswordHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface PopoverProps extends CommonProps {
  /** @default false */

  arrow?: Reactive<boolean>;
  /** @default "light" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default true */

  flip?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 8 */

  offset?: Reactive<number>;
  padding?: Reactive<Len>;
  /** @default "bottom" */

  placement?: Reactive<string>;
  reference?: Reactive<unknown>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default true */

  shift?: Reactive<boolean>;
  strategy?: Reactive<string>;
  /** @default false */

  trapFocus?: Reactive<boolean>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface PopoverHandle extends Handle {
  close(...args: never[]): unknown;
}

export interface ProgressProps extends CommonProps {
  /** @default false */

  indeterminate?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @minimum 0 · @maximum 1 */

  value?: Reactive<number>;
}

export interface RadioGroupProps extends CommonProps {
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  options?: Reactive<unknown[]>;
  /** @default "vertical" */

  orientation?: Reactive<"vertical" | "horizontal">;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface ResizerProps extends CommonProps {
  /** @default "x" */

  axis?: Reactive<"x" | "y">;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default 0 */

  index?: Reactive<number>;
}

export interface ResizerHandle extends Handle {
  cancel(...args: never[]): unknown;
  nudge(...args: never[]): unknown;
  toggle(...args: never[]): unknown;
}

export interface ScrollProps extends CommonProps {
  /** @default "y" */

  axis?: Reactive<"y" | "x" | "both">;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** Persisted in serialized layouts (§19.1). */

  offset?: Reactive<Record<string, unknown>>;
  padding?: Reactive<Len>;
  /** @default true */

  restore?: Reactive<boolean>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
}

export interface SearchProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface SearchHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface SegmentedProps extends CommonProps {
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  options?: Reactive<unknown[]>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface SelectProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  options?: Reactive<unknown[]>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface SelectHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface SliderProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 100 */

  max?: Reactive<number>;
  /** @default 0 */

  min?: Reactive<number>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default 1 */

  step?: Reactive<number>;
  /** @default 0 · Persisted in serialized layouts (§19.1). */

  value?: Reactive<number>;
}

export interface SliderHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface SpacerProps extends CommonProps {
  /** @default "1fr" */

  size?: Reactive<Len>;
}

export interface SpinnerProps extends CommonProps {
  /** @default "Loading" */

  label?: Reactive<string>;
  /** @default 20 */

  size?: Reactive<Len>;
}

export interface SplitProps extends CommonProps {
  /** @default "x" · Persisted in serialized layouts (§19.1). */

  axis?: Reactive<unknown>;
  /** @default 6 */

  gutter?: Reactive<unknown>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default true */

  live?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "neighbor" */

  resizeMode?: Reactive<"neighbor" | "distribute" | "push">;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default 8 */

  step?: Reactive<number>;
}

export interface SplitHandle extends Handle {
  reset(...args: never[]): unknown;
  sizes(...args: never[]): unknown;
}

export interface StackProps extends CommonProps {
  /** @default "stretch" */

  align?: Reactive<"start" | "center" | "end" | "stretch" | "baseline">;
  /** @default "y" */

  axis?: Reactive<"x" | "y">;
  /** @default 0 */

  gap?: Reactive<Len>;
  /** @default "start" */

  justify?: Reactive<"start" | "center" | "end" | "between" | "around" | "evenly">;
  /** @default false */

  reverse?: Reactive<boolean>;
  /** @default false */

  wrap?: Reactive<boolean>;
}

export interface SurfaceProps extends CommonProps {
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface SwitchProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  value?: Reactive<boolean>;
}

export interface SwitchHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface TabsProps extends CommonProps {
  /** @default "" · Persisted in serialized layouts (§19.1). */

  active?: Reactive<string>;
  /** @default false */

  closable?: Reactive<boolean>;
  items?: Reactive<unknown[]>;
  /** @default "top" */

  placement?: Reactive<"top" | "bottom">;
  /** @default false */

  reorderable?: Reactive<boolean>;
}

export interface TabsHandle extends Handle {
  close(...args: never[]): unknown;
  select(...args: never[]): unknown;
}

export interface TagsProps extends CommonProps {
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  max?: Reactive<number>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** Persisted in serialized layouts (§19.1). */

  value?: Reactive<string[]>;
}

export interface TagsHandle extends Handle {
  add(...args: never[]): unknown;
  remove(...args: never[]): unknown;
}

export interface TextProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface TextHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface TextBlockProps extends CommonProps {
  /** @default "p" */

  as?: Reactive<string>;
  /** @default "" */

  content?: Reactive<string>;
  /** @default false */

  truncate?: Reactive<boolean>;
  /** @default "body" */

  variant?: Reactive<"body" | "heading" | "caption" | "mono">;
}

export interface TextareaProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default 3 */

  rows?: Reactive<number>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface TextareaHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface TimeProps extends CommonProps {
  /** @default "" */

  describedBy?: Reactive<string>;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false */

  invalid?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" */

  name?: Reactive<string>;
  /** @default "" */

  placeholder?: Reactive<string>;
  /** @default false */

  readonly?: Reactive<boolean>;
  /** @default false */

  required?: Reactive<boolean>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  value?: Reactive<string>;
}

export interface TimeHandle extends Handle {
  clear(...args: never[]): unknown;
  focus(...args: never[]): unknown;
  read(...args: never[]): unknown;
}

export interface ToastProps extends CommonProps {
  action?: Reactive<unknown>;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  text?: Reactive<string>;
  /** @default 6000 */

  ttl?: Reactive<number>;
  /** @default "polite" */

  urgency?: Reactive<"polite" | "assertive">;
  /** @default "info" */

  variant?: Reactive<"info" | "success" | "warning" | "danger">;
}

export interface ToastHandle extends Handle {
  dismiss(...args: never[]): unknown;
}

export interface ToggleProps extends CommonProps {
  /** @default "button" */

  buttonType?: Reactive<"button" | "submit" | "reset">;
  /** @default false */

  disabled?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  pressed?: Reactive<boolean>;
  /** @default "" */

  text?: Reactive<string>;
  /** @default "default" */

  variant?: Reactive<"default" | "primary" | "danger" | "ghost">;
}

export interface ToggleHandle extends Handle {
  click(...args: never[]): unknown;
}

export interface TooltipProps extends CommonProps {
  /** @default false */

  arrow?: Reactive<boolean>;
  /** @default 500 */

  delay?: Reactive<number>;
  /** @default "light" */

  dismiss?: Reactive<"light" | "modal" | "none">;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default true */

  flip?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default 100 */

  hideDelay?: Reactive<number>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default 8 */

  offset?: Reactive<number>;
  padding?: Reactive<Len>;
  /** @default "top" */

  placement?: Reactive<string>;
  reference?: Reactive<unknown>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default true */

  shift?: Reactive<boolean>;
  strategy?: Reactive<string>;
  /** @default "" */

  text?: Reactive<string>;
  /** @default false */

  trapFocus?: Reactive<boolean>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface TooltipHandle extends Handle {
  close(...args: never[]): unknown;
}

export interface TreeProps extends CommonProps {
  data?: Reactive<unknown[]>;
  /** Persisted in serialized layouts (§19.1). */

  expanded?: Reactive<string[]>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default "" · Persisted in serialized layouts (§19.1). */

  selected?: Reactive<string>;
}

export interface TreeHandle extends Handle {
  select(...args: never[]): unknown;
  toggle(...args: never[]): unknown;
}

export interface WindowProps extends CommonProps {
  /** @default true */

  closable?: Reactive<boolean>;
  /** @default 1 · @minimum 0 · @maximum 3 */

  elevation?: Reactive<number>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  hidden?: Reactive<boolean>;
  /** @default "" */

  label?: Reactive<string>;
  /** @default false */

  minimizable?: Reactive<boolean>;
  /** @default false · Persisted in serialized layouts (§19.1). */

  minimized?: Reactive<boolean>;
  padding?: Reactive<Len>;
  /** @default "none" */

  scroll?: Reactive<"none" | "auto" | "x" | "y">;
  /** @default "" */

  title?: Reactive<string>;
  /** @default "raised" */

  variant?: Reactive<"plain" | "raised" | "sunken">;
}

export interface WindowHandle extends Handle {
  bringToFront(...args: never[]): unknown;
  close(...args: never[]): unknown;
  minimize(...args: never[]): unknown;
}

/** Every registered element type, so `create()` is typed by its name. */
export interface ElementTypes {
  "accordion": AccordionProps;
  "alert": AlertProps;
  "banner": BannerProps;
  "button": ButtonProps;
  "checkbox": CheckboxProps;
  "color": ColorProps;
  "combobox": ComboboxProps;
  "crosshair": CrosshairProps;
  "date": DateProps;
  "dialog": DialogProps;
  "divider": DividerProps;
  "drawer": DrawerProps;
  "email": EmailProps;
  "empty-state": EmptyStateProps;
  "field": FieldProps;
  "file": FileProps;
  "form": FormProps;
  "group": GroupProps;
  "hud-bar": HudBarProps;
  "hud-layer": HudLayerProps;
  "hud-marker": HudMarkerProps;
  "icon": IconProps;
  "key-prompt": KeyPromptProps;
  "list": ListProps;
  "menu": MenuProps;
  "meter": MeterProps;
  "minimap": MinimapProps;
  "modal": ModalProps;
  "notification-feed": NotificationFeedProps;
  "number": NumberProps;
  "pane": PaneProps;
  "password": PasswordProps;
  "popover": PopoverProps;
  "progress": ProgressProps;
  "radio-group": RadioGroupProps;
  "resizer": ResizerProps;
  "scroll": ScrollProps;
  "search": SearchProps;
  "segmented": SegmentedProps;
  "select": SelectProps;
  "slider": SliderProps;
  "spacer": SpacerProps;
  "spinner": SpinnerProps;
  "split": SplitProps;
  "stack": StackProps;
  "surface": SurfaceProps;
  "switch": SwitchProps;
  "tabs": TabsProps;
  "tags": TagsProps;
  "text": TextProps;
  "text-block": TextBlockProps;
  "textarea": TextareaProps;
  "time": TimeProps;
  "toast": ToastProps;
  "toggle": ToggleProps;
  "tooltip": TooltipProps;
  "tree": TreeProps;
  "window": WindowProps;
  [type: string]: CommonProps & Record<string, unknown>;
}

/** Types whose declared commands appear as handle methods (§8.1). */
export interface ElementHandles {
  "accordion": AccordionHandle;
  "alert": AlertHandle;
  "button": ButtonHandle;
  "checkbox": CheckboxHandle;
  "color": ColorHandle;
  "combobox": ComboboxHandle;
  "date": DateHandle;
  "dialog": DialogHandle;
  "drawer": DrawerHandle;
  "email": EmailHandle;
  "file": FileHandle;
  "form": FormHandle;
  "list": ListHandle;
  "menu": MenuHandle;
  "modal": ModalHandle;
  "notification-feed": NotificationFeedHandle;
  "number": NumberHandle;
  "password": PasswordHandle;
  "popover": PopoverHandle;
  "resizer": ResizerHandle;
  "search": SearchHandle;
  "select": SelectHandle;
  "slider": SliderHandle;
  "split": SplitHandle;
  "switch": SwitchHandle;
  "tabs": TabsHandle;
  "tags": TagsHandle;
  "text": TextHandle;
  "textarea": TextareaHandle;
  "time": TimeHandle;
  "toast": ToastHandle;
  "toggle": ToggleHandle;
  "tooltip": TooltipHandle;
  "tree": TreeHandle;
  "window": WindowHandle;
}

declare module "mutakit" {
  interface Instance {
    create<T extends keyof ElementTypes & string>(
      type: T,
      props?: ElementTypes[T],
      parent?: Handle | LayoutNode
    ): T extends keyof ElementHandles ? ElementHandles[T] : Handle;
  }
}
