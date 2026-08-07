#!/usr/bin/env python3
"""Build Mutakit.

Concatenates the source files listed in unpinned.json into
build/mutakit.js, then writes a minified build/mutakit.min.js
beside it.

The bundled minifier is deliberately conservative: it removes comments and
redundant whitespace but never joins lines, so automatic semicolon insertion
cannot change behaviour. When a project outgrows it, replace `minify()` with a
call out to esbuild or terser — everything else here stays the same.

    python3 build.py            # build
    python3 build.py --check    # report what would be built, write nothing
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
MANIFEST = ROOT / "unpinned.json"


# --------------------------------------------------------------------------
# Minifier
# --------------------------------------------------------------------------

# Characters after which a `/` begins a regex literal rather than a division.
_REGEX_PRECEDERS = set("(,=:[!&|?{};+-*%~^<>")
_REGEX_KEYWORDS = {
    "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
    "case", "do", "else", "yield", "await",
}


def _scan(source):
    """Strip comments. Returns (chars, protected) where protected marks the
    characters that sit inside a string, template literal or regex literal.

    Template literals are tracked with a stack, so a `${ ... }` substitution is
    scanned as ordinary code (and may itself contain further templates) while
    the template *text* around it stays protected. Scanning a template as a
    plain quoted string instead would end it at the first backtick of a nested
    template, after which real string content is treated as code — which
    silently collapses its whitespace and, if it contains `//` or `/*`, deletes
    it as a comment.
    """
    out, protected = [], []
    i, n = 0, len(source)
    prev_token = ""
    prev_char = ""

    # Brace depths at which a `${` was entered. Non-empty means we are inside a
    # substitution; popping returns to the enclosing template's text.
    tpl_stack = []
    brace_depth = 0
    in_tpl_text = False

    def emit(ch, is_protected):
        out.append(ch)
        protected.append(is_protected)

    while i < n:
        ch = source[i]
        nxt = source[i + 1] if i + 1 < n else ""

        # Template literal text: literal until an unescaped ` or a ${
        if in_tpl_text:
            if ch == "\\" and i + 1 < n:
                emit(ch, True)
                emit(source[i + 1], True)
                i += 2
                continue
            if ch == "`":
                emit(ch, True)
                i += 1
                in_tpl_text = False
                prev_token, prev_char = "", "`"
                continue
            if ch == "$" and nxt == "{":
                emit(ch, True)
                emit(nxt, True)
                i += 2
                tpl_stack.append(brace_depth)
                in_tpl_text = False
                prev_token, prev_char = "", "{"
                continue
            emit(ch, True)
            i += 1
            continue

        # Comments
        if ch == "/" and nxt == "/":
            while i < n and source[i] != "\n":
                i += 1
            continue
        if ch == "/" and nxt == "*":
            keep = i + 2 < n and source[i + 2] == "!"  # /*! banner */ is kept
            start = i
            i += 2
            while i < n and not (source[i] == "*" and i + 1 < n and source[i + 1] == "/"):
                i += 1
            i += 2
            if keep:
                for c in source[start:i]:
                    emit(c, True)
                emit("\n", False)
            continue

        # Template literal start
        if ch == "`":
            emit(ch, True)
            i += 1
            in_tpl_text = True
            continue

        # Ordinary strings
        if ch in ("'", '"'):
            quote = ch
            emit(ch, True)
            i += 1
            while i < n:
                c = source[i]
                emit(c, True)
                if c == "\\" and i + 1 < n:
                    emit(source[i + 1], True)
                    i += 2
                    continue
                i += 1
                if c == quote:
                    break
            prev_token, prev_char = "", quote
            continue

        # Regex literals
        if ch == "/":
            starts_regex = (
                prev_char in _REGEX_PRECEDERS
                or prev_char == ""
                or prev_token in _REGEX_KEYWORDS
            )
            if starts_regex:
                emit(ch, True)
                i += 1
                in_class = False
                while i < n:
                    c = source[i]
                    emit(c, True)
                    if c == "\\" and i + 1 < n:
                        emit(source[i + 1], True)
                        i += 2
                        continue
                    i += 1
                    if c == "[":
                        in_class = True
                    elif c == "]":
                        in_class = False
                    elif c == "/" and not in_class:
                        break
                while i < n and source[i].isalpha():  # trailing flags
                    emit(source[i], True)
                    i += 1
                prev_token, prev_char = "", "/"
                continue

        # Brace tracking, so the `}` closing a `${` returns us to template text.
        if ch == "{":
            brace_depth += 1
        elif ch == "}":
            if tpl_stack and brace_depth == tpl_stack[-1]:
                tpl_stack.pop()
                emit(ch, True)
                i += 1
                in_tpl_text = True
                prev_token, prev_char = "", "}"
                continue
            brace_depth -= 1

        # Ordinary code
        emit(ch, False)
        if ch.isalnum() or ch in "_$":
            prev_token += ch
        elif not ch.isspace():
            prev_token = ""
        if not ch.isspace():
            prev_char = ch
        i += 1

    return out, protected


def minify(source):
    """Remove comments and redundant whitespace, preserving line structure."""
    chars, protected = _scan(source)

    # Split into lines on unprotected newlines.
    lines, current = [], []
    for ch, prot in zip(chars, protected):
        if ch == "\n" and not prot:
            lines.append(current)
            current = []
        else:
            current.append((ch, prot))
    lines.append(current)

    result = []
    for line in lines:
        # Drop unprotected leading whitespace.
        start = 0
        while start < len(line) and line[start][0].isspace() and not line[start][1]:
            start += 1
        end = len(line)
        while end > start and line[end - 1][0].isspace() and not line[end - 1][1]:
            end -= 1
        trimmed = line[start:end]

        # Collapse unprotected whitespace runs to a single space.
        collapsed, in_space = [], False
        for ch, prot in trimmed:
            if ch.isspace() and not prot:
                if not in_space:
                    collapsed.append(" ")
                in_space = True
            else:
                collapsed.append(ch)
                in_space = False

        text = "".join(collapsed)
        if text:
            result.append(text)

    return "\n".join(result) + "\n"


# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------

def load_manifest():
    if not MANIFEST.exists():
        sys.exit("error: unpinned.json not found next to build.py")
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def source_files(manifest):
    source = manifest.get("source", {})
    files = source.get("files")
    if not files:
        entry = source.get("entry")
        files = [entry] if entry else []
    resolved = []
    for rel in files:
        path = ROOT / rel
        if not path.exists():
            sys.exit(f"error: missing source file {rel}")
        resolved.append(path)
    if not resolved:
        sys.exit("error: no source files listed in unpinned.json")
    return resolved


def banner(manifest):
    return (
        "/*! {title} v{version}{desc}\n"
        " * built {date} — do not edit, this file is generated\n"
        " */\n"
    ).format(
        title=manifest.get("title") or manifest.get("name", "project"),
        version=manifest.get("version", "0.0.0"),
        desc=" — " + manifest["description"] if manifest.get("description") else "",
        date=__import__("datetime").date.today().isoformat(),
    )


def main(argv):
    check_only = "--check" in argv
    manifest = load_manifest()
    files = source_files(manifest)

    build_cfg = manifest.get("build", {})
    name = manifest.get("name", ROOT.name)
    expanded = ROOT / build_cfg.get("expanded", f"build/{name}.js")
    minified = ROOT / build_cfg.get("minified", f"build/{name}.min.js")

    bundle = banner(manifest) + "\n".join(
        f.read_text(encoding="utf-8").rstrip() for f in files
    ) + "\n"

    if check_only:
        print(f"would build {len(files)} source file(s):")
        for f in files:
            print(f"  {f.relative_to(ROOT)}")
        print(f"  -> {expanded.relative_to(ROOT)}")
        print(f"  -> {minified.relative_to(ROOT)}")
        return 0

    expanded.parent.mkdir(parents=True, exist_ok=True)
    expanded.write_text(bundle, encoding="utf-8")

    small = minify(bundle)
    minified.parent.mkdir(parents=True, exist_ok=True)
    minified.write_text(small, encoding="utf-8")

    saved = 100 - (len(small) * 100 // max(len(bundle), 1))
    print(f"built {expanded.relative_to(ROOT)}  {len(bundle):,} bytes")
    print(f"built {minified.relative_to(ROOT)}  {len(small):,} bytes  (-{saved}%)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
