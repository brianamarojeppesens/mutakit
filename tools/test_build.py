#!/usr/bin/env python3
"""Regression tests for build.py's minifier.

    python3 tools/test_build.py

The minifier only removes comments and collapses unprotected whitespace, so a
mis-tracked literal boundary is invisible unless the literal contains
whitespace or comment markers that must survive. Every case below is therefore
whitespace- or comment-significant: it fails loudly if the scanner's idea of
"inside a literal" drifts.

The nested-template cases exist because the original scanner treated a template
as a plain quoted string, which ended it at the first backtick of a nested
template. Real string content after that point was scanned as code — collapsing
its whitespace, and deleting the rest of the line if it contained `//`.
"""
import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("buildmod", ROOT / "build.py")
buildmod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(buildmod)
minify = buildmod.minify

# Sources that must pass through minify() completely unchanged.
UNCHANGED = [
    # -- regex vs division ------------------------------------------------
    ("arrow then regex",        "const f = x => /^a+$/.test(x);"),
    ("nullish then regex",      "const r = pat ?? /fallback/g;"),
    ("regex after return",      "function g() { return /x/y; }"),
    ("division after )",        "const half = (a + b) / 2;"),
    ("division after ident",    "const q = width / height;"),
    ("division after ]",        "const d = arr[0] / arr[1];"),
    ("regex with quotes",       "const re = /['\"]/g;"),
    ("regex with slash class",  "const re = /[/]/;"),

    # -- modern syntax ----------------------------------------------------
    ("optional chaining",       "const v = a?.b?.[c]?.(d);"),
    ("logical assignment",      "a ||= 1; b &&= 2; c ??= 3;"),
    ("private + static fields", "class A { #n = 0; static s = 1; }"),
    ("for await",               "async function h() { for await (const c of s) {} }"),
    ("spread and rest",         "const { a = 1, ...rest } = o; f(...xs);"),
    ("numeric sep + BigInt",    "const big = 1_000_000n; const hex = 0xff_ff;"),

    # -- literals that must not be touched --------------------------------
    ("url in string",           "const url = 'https://example.com';"),
    ("comment marker in str",   "const c = 'a /* not a comment */ b';"),
    ("double space in str",     "const t = 'KEEP  ME';"),
    ("template inner spaces",   "const s = `a    b`;"),
    ("template with slash",     "const u = `${base}/api/v1`;"),

    # -- nested templates (the regression this file exists for) -----------
    ("nested tpl, spaces",      "const s = `x  ${ `y    z` }  w`;"),
    ("nested tpl, tail",        "const s = `${ `a` }  TAIL  SPACES`;"),
    ("nested tpl, backtick str","const s = `v: ${ q('`') }  end`;"),
    ("nested tpl, css payload", "const css = `.a {  color: ${ `var(--x)` };  }`;"),
    ("nested tpl, tagged",      "html`<p>${ html`<b>  bold  </b>` }</p>`;"),
    ("nested tpl, // inside",   "const s = `${ `a // not a comment` }  T`;"),
    ("nested tpl, /* inside",   "const s = `${ `a /* x */ b` }  T`;"),
    ("nested tpl, apostrophe",  "const s = `${ `it's here` }  T`;"),
    ("nested tpl, then code",   "const s = `a${`b`}c`; const t = 'KEEP  ME';"),
]


def main():
    failures = []

    for name, src in UNCHANGED:
        try:
            out = minify(src).strip()
        except Exception as exc:                                # noqa: BLE001
            failures.append((name, src, f"raised {exc!r}"))
            continue
        if out != src.strip():
            failures.append((name, src, f"became {out!r}"))

    # Comments are still stripped, and a /*! banner */ is still kept.
    if "gone" in minify("var a = 1; // gone\n"):
        failures.append(("line comment stripped", "// gone", "survived"))
    if not minify("/*! keep */\nvar a = 1;\n").lstrip().startswith("/*!"):
        failures.append(("banner kept", "/*! keep */", "was stripped"))

    # Minifying twice must equal minifying once.
    sample = "\n".join(src for _, src in UNCHANGED)
    if minify(minify(sample)) != minify(sample):
        failures.append(("idempotence", "<all cases>", "second pass differed"))

    total = len(UNCHANGED) + 3
    print(f"{total - len(failures)}/{total} passing")
    for name, src, why in failures:
        print(f"\n  FAIL {name}\n    in : {src!r}\n    {why}")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
