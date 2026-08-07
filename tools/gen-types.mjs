#!/usr/bin/env node
/**
 * Generate `build/mutakit.d.ts` from the prop schemas (§22.5).
 *
 * The schemas already drive validation (§8.1), devtools (§19.3), and the API
 * docs (§24). Types are the fourth consumer, and that count is the strongest
 * argument for §8.1's design: a plain defaults object would need types, docs,
 * and validation maintained separately and drifting independently.
 *
 * Everything a schema cannot express — the fluent handle chain, generics on
 * signals, the `Len` union — is hand-written in `source/types/manual.d.ts` and
 * merged here.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Mutakit } from "../source/entries/full.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "build", "mutakit.d.ts");

const TS_TYPES = {
  string: "string",
  number: "number",
  boolean: "boolean",
  object: "Record<string, unknown>",
  array: "unknown[]",
  any: "unknown",
  len: "Len",
  size: "Size | { w?: Len; h?: Len }",
  selector: "string | Element",
  node: "Node",
  function: "(...args: never[]) => unknown",
  html: "string",
  color: "string"
};

function tsType(descriptor) {
  if (descriptor.type === "enum" && descriptor.values) {
    return descriptor.values.map((v) => JSON.stringify(v)).join(" | ");
  }
  if (descriptor.type === "array" && descriptor.of) {
    return `${TS_TYPES[descriptor.of] || "unknown"}[]`;
  }
  return TS_TYPES[descriptor.type] || "unknown";
}

function docComment(name, descriptor, indent) {
  const parts = [];
  if (descriptor.doc) parts.push(descriptor.doc);
  if (descriptor.default !== undefined && typeof descriptor.default !== "function") {
    parts.push(`@default ${JSON.stringify(descriptor.default)}`);
  }
  if (descriptor.min != null) parts.push(`@minimum ${descriptor.min}`);
  if (descriptor.max != null) parts.push(`@maximum ${descriptor.max}`);
  if (descriptor.persist) parts.push("Persisted in serialized layouts (§19.1).");
  if (!parts.length) return "";
  return `${indent}/** ${parts.join(" · ")} */\n`;
}

function interfaceFor(type, definition) {
  const name = pascal(type) + "Props";
  const lines = [`export interface ${name} extends CommonProps {`];
  const props = definition.props || {};
  for (const key of Object.keys(props).sort()) {
    const descriptor = props[key];
    lines.push(docComment(key, descriptor, "  "));
    const optional = descriptor.required ? "" : "?";
    lines.push(`  ${safeKey(key)}${optional}: Reactive<${tsType(descriptor)}>;`);
  }
  lines.push("}");
  return lines.filter(Boolean).join("\n");
}

function commandsFor(type, definition) {
  const names = Object.keys(definition.commands || {});
  if (!names.length) return null;
  const lines = [`export interface ${pascal(type)}Handle extends Handle {`];
  for (const name of names.sort()) lines.push(`  ${safeKey(name)}(...args: never[]): unknown;`);
  lines.push("}");
  return lines.join("\n");
}

function pascal(type) {
  return type
    .split(/[:\-_]/)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

function safeKey(key) {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key);
}

const listed = Mutakit.registry.list();
const types = listed.type.map((entry) => entry.name);

const blocks = [];
const typeMapEntries = [];
const handleMapEntries = [];

for (const type of types) {
  const definition = Mutakit.registry.get("type", type);
  if (!definition || definition.abstract) continue;
  blocks.push(interfaceFor(type, definition));
  const commands = commandsFor(type, definition);
  if (commands) {
    blocks.push(commands);
    handleMapEntries.push(`  ${JSON.stringify(type)}: ${pascal(type)}Handle;`);
  }
  typeMapEntries.push(`  ${JSON.stringify(type)}: ${pascal(type)}Props;`);
}

const manual = await readFile(path.join(ROOT, "source/types/manual.d.ts"), "utf8");

const generated = `/**
 * GENERATED — do not edit. \`npm run types\` regenerates this file from the
 * prop schemas in \`source/\`, merged with \`source/types/manual.d.ts\`.
 *
 * Mutakit ${Mutakit.VERSION} · ${types.length} element types.
 */

${manual.replace(/^\/\*\*[\s\S]*?\*\/\n/, "")}

// ── Generated from the prop schemas (§8.1) ───────────────────────────────

${blocks.join("\n\n")}

/** Every registered element type, so \`create()\` is typed by its name. */
export interface ElementTypes {
${typeMapEntries.join("\n")}
  [type: string]: CommonProps & Record<string, unknown>;
}

/** Types whose declared commands appear as handle methods (§8.1). */
export interface ElementHandles {
${handleMapEntries.join("\n") || "  [type: string]: Handle;"}
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
`;

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, generated);
console.log(`gen-types: ${types.length} types → ${path.relative(ROOT, OUT)}`);
