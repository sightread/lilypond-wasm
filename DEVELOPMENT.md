# Building 

Most of the time you don't need this — `bun run fetch-dist` downloads the pinned build. This is
for iterating on the wasm build, not using it.

You need Emscripten on `PATH`, plus meson, ninja, cmake, autoconf, pkg-config, python3, bison,
flex, guile 3.0.11 and lilypond 2.26.0. On a Mac:

```sh
brew install emscripten meson ninja cmake autoconf pkg-config bison flex guile lilypond
```

Then:

```sh
bun run fetch-sources     # downloads and hash-checks everything in build/sources.json
./build/build.sh          # ~40 minutes on my M1 MBP; writes dist/
```

`build.sh <step>` runs one step — see the `case` at the bottom for the names. Everything
intermediate lands in `work/`, which is scratch: delete it to start over.

The last two steps (`data`, `notices`) copy LilyPond's data directory and regenerate
`licenses/`. 

# Releasing

Attach `dist/lilypond.mjs`, `dist/lilypond.wasm` and `dist/runtime.data.bin` to a GitHub
release, then update `RELEASE` and the hashes in `build/fetch-dist.mjs` to match.
