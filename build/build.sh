#!/usr/bin/env bash
# Build LilyPond and everything under it to WebAssembly with Emscripten, and package the result
# into dist/. See DEVELOPMENT.md for the host prerequisites and the full walkthrough.
#
#   bun run fetch-sources       # download and verify the source archives first
#   ./build/build.sh            # every step, in order, ending with a complete dist/
#   ./build/build.sh guile      # one step (see the case at the bottom)
#
# Sources are expected under work/src/<name>-<version>; everything is installed into
# work/prefix, a wasm32 sysroot that pkg-config is pointed at. work/ is scratch: it is created
# here, ignored by Git, and can be deleted at any time to start over.
#
# Host tools: emcc, meson, ninja, cmake, autoconf, pkg-config, python3, bison, flex, bun, a
# native guile of the same version built here (it cross-compiles Guile's own Scheme to wasm32
# bytecode), and a native LilyPond 2.26.0 install, whose data directory supplies the fonts and
# Scheme that the WebAssembly build cannot generate for itself (see step_data).
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WORK="${WASM_WORK_DIR:-$ROOT/work}"
SRC="$WORK/src"
PREFIX="$WORK/prefix"
BUILD="$WORK/build"
JOBS="${JOBS:-$(sysctl -n hw.ncpu 2>/dev/null || nproc)}"
mkdir -p "$PREFIX" "$BUILD"
# A PATH entry with a space in it (macOS app bundles) breaks the shell one-liners Guile's build
# generates around its build-machine compiler; drop them, nothing here needs them.
PATH="$(printf '%s' "$PATH" | tr ':' '\n' | grep -v ' ' | paste -sd: -)"; export PATH

# One set of code-generation flags for every object: setjmp/longjmp (Guile's non-local exits)
# and C++ exceptions both go through the Wasm exception-handling proposal, which is far faster
# than the JavaScript-trampoline emulation and lets the two coexist.
# clang now refuses function-pointer type mismatches outright; glib's deprecated corners have a
# few, in code nothing here calls.
WARN="-Wno-error=incompatible-function-pointer-types"
PREFIX_MAP="-ffile-prefix-map=$WORK=/build -fdebug-prefix-map=$WORK=/build"
export CPPFLAGS="" # a Homebrew shell exports zlib's keg here; none of that belongs in a wasm build
export CFLAGS="-O2 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm $WARN $PREFIX_MAP -I$PREFIX/include"
export CXXFLAGS="$CFLAGS"
export LDFLAGS="-fwasm-exceptions -sSUPPORT_LONGJMP=wasm -L$PREFIX/lib"
export PKG_CONFIG_LIBDIR="$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig"
export PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR"
export EM_PKG_CONFIG_PATH="$PKG_CONFIG_LIBDIR" # emconfigure resets PKG_CONFIG_LIBDIR; this survives

CROSS="$BUILD/emscripten.ini"
write_cross_file() {
  local emdir
  emdir="$(dirname "$(command -v emcc)")"
  cat >"$CROSS" <<EOF
[binaries]
c = '$emdir/emcc'
cpp = '$emdir/em++'
ar = '$emdir/emar'
ranlib = '$emdir/emranlib'
strip = '$emdir/emstrip'
nm = '$emdir/emnm'
pkg-config = '$(command -v pkg-config)'
exe_wrapper = '$HERE/run-wasm.sh'

[built-in options]
c_args = ['-O2', '-fwasm-exceptions', '-sSUPPORT_LONGJMP=wasm', '$WARN', '-ffile-prefix-map=$WORK=/build', '-fdebug-prefix-map=$WORK=/build', '-I$PREFIX/include']
cpp_args = ['-O2', '-fwasm-exceptions', '-sSUPPORT_LONGJMP=wasm', '$WARN', '-ffile-prefix-map=$WORK=/build', '-fdebug-prefix-map=$WORK=/build', '-I$PREFIX/include']
c_link_args = ['-fwasm-exceptions', '-sSUPPORT_LONGJMP=wasm', '-L$PREFIX/lib']
cpp_link_args = ['-fwasm-exceptions', '-sSUPPORT_LONGJMP=wasm', '-L$PREFIX/lib']
default_library = 'static'
prefix = '$PREFIX'

[properties]
needs_exe_wrapper = true
pkg_config_libdir = '$PREFIX/lib/pkgconfig:$PREFIX/share/pkgconfig'

[host_machine]
system = 'emscripten'
cpu_family = 'wasm32'
cpu = 'wasm32'
endian = 'little'
EOF
}

log() { printf '\n\033[1;34m== %s\033[0m\n' "$*"; }

meson_build() { # name srcdir [meson options...]
  local name="$1" src="$2"; shift 2
  log "$name (meson)"
  rm -rf "$BUILD/$name"
  meson setup "$BUILD/$name" "$src" --cross-file "$CROSS" --prefix "$PREFIX" \
    --buildtype=release --default-library=static -Dc_std=gnu11 "$@"
  ninja -C "$BUILD/$name" -j "$JOBS" install
  strip_pthread_from_pc
}

# Like meson_build, for a project whose command-line tools do not link on Emscripten: build what
# can be built, then install only the development files (headers, .a, .pc), all that is needed.
meson_devel_build() { # name srcdir [meson options...]
  local name="$1" src="$2"; shift 2
  log "$name (meson, libraries only)"
  rm -rf "$BUILD/$name"
  meson setup "$BUILD/$name" "$src" --cross-file "$CROSS" --prefix "$PREFIX" \
    --buildtype=release --default-library=static "$@"
  ninja -C "$BUILD/$name" -j "$JOBS" -k 0 || true
  meson install -C "$BUILD/$name" --no-rebuild --tags devel --skip-subprojects
  strip_pthread_from_pc
}

# Meson's `threads` dependency writes a threaded link into every .pc it touches. There are no
# threads here (single-threaded Emscripten, and the GC has none), and a threaded link would
# demand SharedArrayBuffer from every host page.
strip_pthread_from_pc() {
  find "$PREFIX/lib/pkgconfig" -type f -name '*.pc' -exec \
    perl -pi -e 's/ -pthread//g; s/ -sPTHREAD_POOL_SIZE=[0-9]*//g' {} +
}

autotools_build() { # name srcdir [configure options...]
  local name="$1" src="$2"; shift 2
  log "$name (autotools)"
  rm -rf "$BUILD/$name"; mkdir -p "$BUILD/$name"; cd "$BUILD/$name"
  emconfigure "$src/configure" --host=wasm32-unknown-emscripten --prefix="$PREFIX" \
    --build="$(cc -dumpmachine)" --disable-shared --enable-static "$@"
  emmake make -j "$JOBS"
  emmake make install
}

step_zlib() {
  log zlib
  rm -rf "$BUILD/zlib"; mkdir -p "$BUILD/zlib"; cd "$BUILD/zlib"
  emcmake cmake "$SRC/zlib-1.3.1" -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
    -DZLIB_BUILD_EXAMPLES=OFF -DCMAKE_C_FLAGS="$CFLAGS"
  cmake --build . -j "$JOBS" --target install
  rm -f "$PREFIX"/lib/libz.so* "$PREFIX"/lib/libz*.dylib
}

step_libpng() {
  log libpng
  rm -rf "$BUILD/libpng"; mkdir -p "$BUILD/libpng"; cd "$BUILD/libpng"
  emcmake cmake "$SRC/libpng-1.6.50" -DCMAKE_INSTALL_PREFIX="$PREFIX" -DCMAKE_BUILD_TYPE=Release \
    -DPNG_SHARED=OFF -DPNG_STATIC=ON -DPNG_TESTS=OFF -DPNG_TOOLS=OFF -DPNG_FRAMEWORK=OFF \
    -DCMAKE_FIND_ROOT_PATH="$PREFIX" -DZLIB_LIBRARY="$PREFIX/lib/libz.a" -DZLIB_INCLUDE_DIR="$PREFIX/include" -DCMAKE_C_FLAGS="$CFLAGS"
  cmake --build . -j "$JOBS" --target install
}

step_expat() {
  autotools_build expat "$SRC/expat-2.7.3" --without-docbook --without-examples --without-tests
}

step_freetype() {
  meson_build freetype "$SRC/freetype-2.13.3" -Dbrotli=disabled -Dbzip2=disabled -Dharfbuzz=disabled \
    -Dpng=enabled -Dzlib=system -Dtests=disabled
}

step_harfbuzz() {
  meson_build harfbuzz "$SRC/harfbuzz-11.2.1" -Dfreetype=enabled -Dglib=disabled -Dgobject=disabled \
    -Dcairo=disabled -Dicu=disabled -Dtests=disabled -Ddocs=disabled -Dutilities=disabled -Dbenchmark=disabled \
    -Dintrospection=disabled -Dcpp_std=c++17
}

step_libunistring() {
  patch_once "$SRC/libunistring-1.4.2" libunistring-emscripten-locale.patch
  autotools_build libunistring "$SRC/libunistring-1.4.2" --disable-namespacing
}

step_libffi() {
  autotools_build libffi "$SRC/libffi-3.5.2" --disable-docs --disable-multi-os-directory
}

step_gc() {
  # No threads (Boehm GC has none on Emscripten), and see patches/gc-emscripten-static-roots.patch:
  # Guile keeps SCM values in static variables, so the data segment must be a GC root.
  patch_once "$SRC/gc-8.2.12" gc-emscripten-static-roots.patch
  autotools_build gc "$SRC/gc-8.2.12" --disable-threads --disable-parallel-mark --enable-cplusplus=no \
    --disable-docs --with-libatomic-ops=none --enable-large-config
}

step_guile() {
  # Cross-compiled: the host guile (same version) compiles Guile's Scheme to wasm32 bytecode.
  # No threads (the GC has none here), no JIT (no wasm backend), mini-gmp instead of GMP.
  local host_guile
  host_guile="$(command -v guile)"
  [ "$("$host_guile" --version | head -1 | awk '{print $NF}')" = "3.0.11" ] || {
    echo "need a native guile 3.0.11 on PATH to cross-compile Guile's Scheme (brew install guile)" >&2; exit 1; }
  # patches/guile-wasm.patch: wasm checks every indirect call's signature, so the void(void)
  # initializers and two-argument hash callbacks Guile casts into other pointer types trap;
  # and the compiler's native word size must be read at run time, not baked in by the host.
  patch_once "$SRC/guile-3.0.11" guile-wasm.patch
  patch_once "$SRC/guile-3.0.11" guile-module-init.patch
  autotools_build guile "$SRC/guile-3.0.11" --with-threads=no --enable-mini-gmp --disable-jit \
    --disable-deprecated --disable-networking --without-libgmp-prefix \
    GUILE_FOR_BUILD="$host_guile" CC_FOR_BUILD=/usr/bin/cc ac_cv_func_strtol_l=no
}

step_glib() {
  patch_once "$SRC/glib-2.82.5" glib-emscripten-size-type.patch
  # gio wants a DNS resolver; Emscripten has none and LilyPond never links gio (see stubs/resolv.c).
  emcc $CFLAGS -c "$HERE/stubs/resolv.c" -o "$BUILD/resolv.o" && emar rcs "$PREFIX/lib/libresolv.a" "$BUILD/resolv.o"
  meson_devel_build glib "$SRC/glib-2.82.5" \
    -Dtests=false -Dnls=disabled -Dselinux=disabled -Dxattr=false \
    -Dlibmount=disabled -Dman-pages=disabled -Dsysprof=disabled -Ddocumentation=false \
    -Dglib_debug=disabled -Dglib_assert=false -Dglib_checks=false -Dlibelf=disabled \
    -Dintrospection=disabled -Dinstalled_tests=false -Dforce_fallback_for=pcre2 \
    -Dpcre2:grep=false -Dpcre2:test=false
  cp "$BUILD/glib/subprojects/pcre2-10.42/libpcre2-8.a" "$PREFIX/lib/" # glib-2.0.pc requires it
  # Pango's build runs these two (Python scripts, so host-agnostic) through glib-2.0.pc.
  mkdir -p "$PREFIX/bin"; cp "$BUILD/glib/gobject/glib-mkenums" "$BUILD/glib/gobject/glib-genmarshal" "$PREFIX/bin/"
  printf 'prefix=%s\nlibdir=${prefix}/lib\nincludedir=${prefix}/include\nName: libpcre2-8\nDescription: PCRE2, built as a glib subproject\nVersion: 10.42\nLibs: -L${libdir} -lpcre2-8\nCflags: -I${includedir}\n' \
    "$PREFIX" >"$PREFIX/lib/pkgconfig/libpcre2-8.pc"
  strip_pthread_from_pc
}

step_fribidi() {
  meson_build fribidi "$SRC/fribidi-1.0.16" -Ddocs=false -Dbin=false -Dtests=false
}

step_pixman() {
  meson_build pixman "$SRC/pixman-0.46.4" -Dtests=disabled -Ddemos=disabled -Dgtk=disabled \
    -Dopenmp=disabled -Dlibpng=disabled
}

step_cairo() {
  meson_devel_build cairo "$SRC/cairo-1.18.4" --wrap-mode=nofallback -Dtests=disabled -Dfontconfig=enabled -Dfreetype=enabled \
    -Dpng=enabled -Dzlib=enabled -Dglib=disabled -Dxlib=disabled -Dxcb=disabled -Dquartz=disabled \
    -Dspectre=disabled -Dsymbol-lookup=disabled -Ddwrite=disabled -Dgtk_doc=false
}

step_fontconfig() {
  meson_build fontconfig "$SRC/fontconfig-2.17.1" --wrap-mode=nofallback -Dtests=disabled -Dtools=disabled -Ddoc=disabled \
    -Dnls=disabled -Dcache-build=disabled -Dxml-backend=expat -Diconv=disabled \
    -Dfontations=disabled -Ddefault-fonts-dirs=/fonts -Dadditional-fonts-dirs=
}

step_pango() {
  patch_once "$SRC/pango-1.56.4" pango-single-thread.patch
  meson_devel_build pango "$SRC/pango-1.56.4" --wrap-mode=nofallback -Dfontconfig=enabled -Dfreetype=enabled -Dcairo=enabled \
    -Dxft=disabled -Dintrospection=disabled -Dbuild-testsuite=false -Dbuild-examples=false \
    -Ddocumentation=false
}

step_lilypond() {
  # Only the C++ is built here: flower (LilyPond's utility library) and the lilypond binary's
  # objects. Fonts, Scheme, and .ly init files are runtime data, taken from a native install of
  # the same version at packaging time (stubs/bin fakes the font tools configure insists on).
  log "lilypond (configure + flower + lily)"
  rm -rf "$BUILD/lilypond"; mkdir -p "$BUILD/lilypond"; cd "$BUILD/lilypond"
  # Prefer Homebrew's keg-only GNU tools when available, while retaining normal PATH discovery
  # on Linux and other build hosts.
  local tools="$HERE/stubs/bin" flex_include="" make_command="make"
  if command -v brew >/dev/null 2>&1; then
    for formula in make bison flex; do
      local formula_prefix
      formula_prefix="$(brew --prefix "$formula")"
      tools="$tools:$formula_prefix/bin:$formula_prefix/libexec/gnubin"
      [ "$formula" = flex ] && flex_include="$formula_prefix/include"
    done
  fi
  command -v gmake >/dev/null 2>&1 && make_command="gmake"
  if [ -z "$flex_include" ]; then
    for candidate in /usr/include /usr/local/include; do
      [ -f "$candidate/FlexLexer.h" ] && flex_include="$candidate" && break
    done
  fi
  [ -n "$flex_include" ] || { echo "cannot find FlexLexer.h; install Flex and put it on PATH" >&2; exit 1; }
  PATH="$tools:$PATH" emconfigure "$SRC/lilypond-2.26.0/configure" \
    --host=wasm32-unknown-emscripten --build="$(cc -dumpmachine)" --prefix="$PREFIX" --disable-documentation --disable-debugging \
    --with-flexlexer-dir="$flex_include"
  PATH="$tools:$PATH" emmake "$make_command" -C flower -j "$JOBS"
  # lily's default target links out/lilypond, which needs libunistring/libffi/libgc and the
  # spawn stub that only step_link supplies — that link is expected to fail here. Every .o file
  # it depends on is already built by the time it does, which is all this step needs; step_link
  # does the real link. Fail loudly only if that assumption breaks.
  PATH="$tools:$PATH" emmake "$make_command" -C lily -j "$JOBS" || true
  [ -n "$(find lily/out -maxdepth 1 -name '*.o' -print -quit)" ] ||
    { echo "lilypond: no object files produced" >&2; exit 1; }
}

DIST="${WASM_DIST_DIR:-$ROOT/dist}"
step_link() {
  # The link LilyPond's own makefile would do, with the Emscripten flags the runtime needs:
  #  --spill-pointers  Boehm GC scans the C stack for roots; wasm locals live in unscannable
  #                    registers, so every live pointer is spilled to the linear-memory stack.
  #  -g2               keeps function names, which the spill pass needs to find the stack pointer
  #                    (and which make wasm stack traces readable).
  #  STACK_SIZE        LilyPond and Guile's evaluator recurse deeply.
  log "link lilypond.mjs"
  mkdir -p "$DIST" "$BUILD/link"; cd "$BUILD/lilypond"
  emcc $CFLAGS -c "$HERE/stubs/spawn.c" -o "$BUILD/link/spawn.o"
  local libs
  libs="$(pkg-config --libs --static pangoft2 pangocairo cairo guile-3.0 bdw-gc fontconfig freetype2 harfbuzz fribidi gobject-2.0 glib-2.0 libpng zlib)"
  em++ -O2 -g2 -fwasm-exceptions -sSUPPORT_LONGJMP=wasm \
    lily/out/*.o flower/out/library.a "$BUILD/link/spawn.o" \
    -Wl,--start-group $libs -lunistring -lffi -lgc -Wl,--end-group \
    -sBINARYEN_EXTRA_PASSES=--spill-pointers \
    -sEMULATE_FUNCTION_POINTER_CASTS=1 \
    -sSTACK_SIZE=32MB -sINITIAL_MEMORY=256MB -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=4GB \
    -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=createLilyPond -sENVIRONMENT=web,worker,node \
    -sEXIT_RUNTIME=1 -sINVOKE_RUN=0 -sFORCE_FILESYSTEM=1 \
    -sEXPORTED_RUNTIME_METHODS=FS,callMain,ENV,MEMFS \
    -o "$DIST/lilypond.mjs"
  node "$HERE/scrub-build-paths.mjs" "$DIST/lilypond.wasm"
  ls -la "$DIST"
}

# LilyPond's runtime data: its .ly and .scm sources, its PostScript, and its fonts. Only the
# first two come out of the source tarball; Emmentaler is generated by MetaFont and FontForge,
# and the URW and TeX Gyre families are not in the tarball at all. Rather than reproduce a font
# toolchain here, take the whole data directory from a native install of the same version --
# which is what the stubs in stubs/bin stand in for during the wasm configure. That install is
# the one input to dist/ that sources.json does not pin; THIRD-PARTY-NOTICES.txt says so.
step_data() {
  log "runtime data"
  local datadir
  datadir="${LILYPOND_DATADIR_NATIVE:-$(lilypond -e '(display (ly:get-option (quote datadir)))' \
    -e '(exit)' 2>/dev/null </dev/null)}" || datadir=""
  [ -n "$datadir" ] && [ -d "$datadir/fonts/otf" ] || {
    echo "cannot find a native LilyPond data directory; install LilyPond 2.26.0 (brew install" >&2
    echo "lilypond) or set LILYPOND_DATADIR_NATIVE to its share/lilypond/2.26.0 folder" >&2; exit 1; }
  case "$datadir" in
    */2.26.0|*/2.26.0/) ;;
    *) echo "native LilyPond data directory is not 2.26.0: $datadir" >&2; exit 1 ;;
  esac
  bun "$HERE/package-runtime.mjs" "$datadir"
}

step_notices() {
  log "third-party notices"
  bun "$HERE/package-licenses.mjs"
}

patch_once() { # srcdir patchname
  local stamp="$1/.patched-$2"
  [ -f "$stamp" ] && return 0
  (cd "$1" && patch -p1 <"$HERE/patches/$2")
  touch "$stamp"
}

case "${1:-all}" in
  cross) write_cross_file ;;
  zlib|libpng|expat|freetype|harfbuzz|libunistring|libffi|gc|guile|glib|fribidi|pixman|cairo|fontconfig|pango|lilypond|link|data|notices)
    write_cross_file; "step_$1" ;;
  all)
    write_cross_file
    for s in zlib libpng expat freetype harfbuzz libunistring libffi gc guile glib fribidi pixman fontconfig cairo pango lilypond link data notices; do "step_$s"; done ;;
  *) echo "unknown step $1" >&2; exit 2 ;;
esac
