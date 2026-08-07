#!/usr/bin/env node
/**
 * Generate `docs/api/` from the prop schemas (§24).
 *
 * API docs come from the same schemas that drive validation, types, and
 * devtools, so they cannot drift. That is the main argument for making `props`
 * a schema rather than a plain default object — and the reason this generator
 * is thirty lines rather than a documentation pipeline.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Mutakit } from "../source/entries/full.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "docs", "api");

function table(rows, headers) {
  if (!rows.length) return "_None._\n";
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`)
  ].join("\n") + "\n";
}

function code(value) {
  return value === undefined ? "—" : `\`${typeof value === "string" ? value : JSON.stringify(value)}\``;
}

function describeType(descriptor) {
  if (descriptor.type === "enum") return descriptor.values.map((v) => `\`${v}\``).join(" · ");
  if (descriptor.type === "array" && descriptor.of) return `\`${descriptor.of}[]\``;
  return `\`${descriptor.type}\``;
}

function constraints(descriptor) {
  const parts = [];
  if (descriptor.required) parts.push("required");
  if (descriptor.min != null) parts.push(`min ${descriptor.min}`);
  if (descriptor.max != null) parts.push(`max ${descriptor.max}`);
  if (descriptor.integer) parts.push("integer");
  if (descriptor.format) parts.push(descriptor.format);
  if (descriptor.persist) parts.push("persisted");
  return parts.join(", ") || "—";
}

const listed = Mutakit.registry.list();
const pages = [];

for (const entry of listed.type) {
  const definition = Mutakit.registry.get("type", entry.name);
  if (!definition) continue;

  const props = definition.props || {};
  const rows = Object.keys(props)
    .sort()
    .map((name) => [
      `\`${name}\``,
      describeType(props[name]),
      code(props[name].default),
      constraints(props[name]),
      props[name].doc || ""
    ]);

  const a11y =
    definition.a11y === "presentation"
      ? "`presentation` — decorative, explicitly opted out of the accessibility tree (§14)."
      : definition.a11y && definition.a11y.role
        ? `role \`${typeof definition.a11y.role === "function" ? "(computed)" : definition.a11y.role}\``
        : "_Not declared._";

  const body = `# \`${entry.name}\`

> Generated from the prop schema. Edit \`source/\`, not this file.

**Version** ${definition.version} · **Origin** ${definition.origin}${
    definition.extends ? ` · **Extends** \`${definition.extends}\`` : ""
  }

## Props

${table(rows, ["Name", "Type", "Default", "Constraints", "Notes"])}

## Events

${(definition.events || []).map((e) => `- \`${e}\``).join("\n") || "_None declared._"}

## Commands

${Object.keys(definition.commands || {}).map((c) => `- \`${c}()\``).join("\n") || "_None declared._"}

## Traits

${(definition.traits || []).map((t) => `- \`${t}\``).join("\n") || "_None._"}

## Accessibility

${a11y}

## Layout

Children are governed by the \`${definition.algorithm || "anchor"}\` algorithm (§7).
${definition.slots ? `\nSlots: ${Object.keys(definition.slots).map((s) => `\`${s}\``).join(", ")}` : ""}
`;

  pages.push({ name: entry.name, body });
}

await mkdir(OUT, { recursive: true });
for (const page of pages) {
  await writeFile(path.join(OUT, `${page.name.replace(":", "-")}.md`), page.body);
}

const index = `# API reference

Generated from the prop schemas in \`source/\` — they drive validation, types,
docs, and devtools from one declaration, so these pages cannot drift (§24).

## Element types

${pages.map((p) => `- [\`${p.name}\`](./${p.name.replace(":", "-")}.md)`).join("\n")}

## Layout algorithms

${listed.layout.map((l) => `- \`${l.name}\``).join("\n") || "_None registered._"}

## Traits

${listed.trait.map((t) => `- \`${t.name}\``).join("\n") || "_None registered._"}

## Diagnostics

Every code, with its cause and fix: [diagnostics.md](../diagnostics.md).
`;

await writeFile(path.join(OUT, "README.md"), index);
console.log(`gen-docs: ${pages.length} pages → ${path.relative(ROOT, OUT)}`);
