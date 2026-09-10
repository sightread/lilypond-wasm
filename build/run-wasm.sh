#!/bin/sh
# exe_wrapper for meson: run an Emscripten-built program under node. Meson names cross-built
# test programs `.exe`; node only loads a script by its extension, and the repo's package.json
# says "type": "module", so the (CommonJS) loader needs a `.cjs` name.
exe="$1"; shift
case "$exe" in
  *.cjs) ;;
  *) { [ -f "$exe.cjs" ] && [ "$exe.cjs" -nt "$exe" ]; } || cp "$exe" "$exe.cjs"; exe="$exe.cjs" ;;
esac
exec node "$exe" "$@"
