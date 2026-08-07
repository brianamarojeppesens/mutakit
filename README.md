# Mutakit

A mutable UI scaffold developed in javascript.

## Layout

```
source/     the source of truth — edit here
build/      generated output, both expanded and minified
test/       browser harness for exercising the library
unpinned.json   project manifest read by the dev shell
```

## Build

```bash
python3 build.py
```

Produces `build/mutakit.js` and `build/mutakit.min.js`.
Nothing in `build/` should be edited by hand.

## Test

Open `test/index.html` in a browser, or serve the project folder:

```bash
python3 -m http.server 8080
```

The harness loads `source/mutakit.js` directly, so a rebuild is not
needed while developing. Switch the `<script src>` in `test/index.html` to the
build output when verifying a release.

## Usage

```html
<script src="build/mutakit.min.js"></script>
<script>
  Mutakit.hello("world");
</script>
```

The module ships as UMD, so it also works with CommonJS and AMD loaders.
