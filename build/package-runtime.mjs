#!/usr/bin/env bun
// Build-time only: materialize runtime assets, following native-install font symlinks, then
// byte-compile LilyPond's own Scheme with the engine in dist/ and bundle that bytecode too.
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = process.env.WASM_WORK_DIR || join(root, 'work')
const dist = process.env.WASM_DIST_DIR || join(root, 'dist')
const nativeData = process.argv[2]
if (!nativeData) throw new Error('Usage: bun package-runtime.mjs /path/to/share/lilypond/2.26.0')
const entries = []
const chunks = []
let offset = 0
async function add(path, bytes) {
  entries.push([path, offset, bytes.length])
  chunks.push(bytes)
  offset += bytes.length
}
async function tree(from, to) {
  for (const name of (await readdir(from)).sort()) {
    const source = join(from, name)
    if ((await stat(source)).isDirectory()) await tree(source, `${to}/${name}`)
    else await add(`${to}/${name}`, await readFile(source))
  }
}
for (const dir of ['ly', 'scm', 'fonts', 'ps'])
  await tree(resolve(nativeData, dir), `/lilypond/${dir}`)
await tree(join(work, 'prefix/share/guile/3.0'), '/guile/share/3.0')
await tree(join(work, 'prefix/lib/guile/3.0/ccache'), '/guile/ccache')
await add(
  '/fonts.conf',
  Buffer.from(`<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "fonts.dtd">
<fontconfig>
  <dir>/lilypond/fonts/otf</dir>
  <cachedir>/tmp/fontconfig</cachedir>
  <include>/lilypond/fonts/00-lilypond-fonts.conf</include>
  <include>/lilypond/fonts/99-lilypond-fonts.conf</include>
</fontconfig>`),
)

// LilyPond's scm/lily/*.scm are shipped as source above; without matching bytecode Guile
// would interpret all of them at every start, which is most of a compile's wall time. A native
// install's .go files are for the host's word size, so they are compiled here instead, inside
// the WASM engine, the same way LilyPond's own build does it: run the file that loads every
// module with auto-compilation on, then collect what Guile wrote to the fallback path main.cc
// sets (`<datadir>/guile-bytecode`). They go where main.cc puts `<libdir>/ccache` on
// %load-compiled-path. The module list mirrors scm/compile.ly in the LilyPond source tree.
const compileLy = `\\version "2.26.0"
#(use-modules
  (lily accreg)
  (lily framework-cairo)
  (lily framework-ps)
  (lily framework-svg)
  (lily graphviz)
  (lily output-ps)
  (lily output-svg)
  (lily page)
  (lily to-xml))
`
const bytecode = await compileBytecode()
for (const [name, bytes] of bytecode) await add(`/lilypond/lib/ccache/lily/${name}`, bytes)

async function compileBytecode() {
  const { default: createLilyPond } = await import(join(dist, 'lilypond.mjs'))
  const logs = []
  const mod = await createLilyPond({
    print: (text) => logs.push(text),
    printErr: (text) => logs.push(text),
    preRun: [
      (m) => {
        const write = (path, bytes) => {
          m.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/')
          m.FS.writeFile(path, bytes)
        }
        for (let i = 0; i < entries.length; i++) write(entries[i][0], chunks[i])
        write('/input/compile.ly', compileLy)
        for (const path of ['/output', '/tmp/fontconfig', '/lilypond/lib', '/home/wasm'])
          m.FS.mkdirTree(path)
        Object.assign(m.ENV, {
          LILYPOND_DATADIR: '/lilypond',
          LILYPOND_LIBDIR: '/lilypond/lib',
          GUILE_LOAD_PATH: '/guile/share/3.0',
          GUILE_LOAD_COMPILED_PATH: '/guile/ccache',
          GUILE_AUTO_COMPILE: '1',
          FONTCONFIG_FILE: '/fonts.conf',
          HOME: '/home/wasm',
          TMPDIR: '/tmp',
          LANG: 'C.UTF-8',
        })
        m.FS.chdir('/input')
      },
    ],
  })
  const previousExitCode = process.exitCode
  let status
  try {
    status = mod.callMain(['-dno-print-pages', '-o', '/output/compile', '/input/compile.ly'])
  } catch (error) {
    if (error.name !== 'ExitStatus') throw error
    status = error.status
  } finally {
    process.exitCode = previousExitCode
  }
  if (status !== 0)
    throw new Error(`byte-compiling LilyPond Scheme failed (exit ${status}):\n${logs.join('\n')}`)
  const compiled = []
  const walk = (dir) => {
    for (const name of mod.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue
      const path = `${dir}/${name}`
      if (mod.FS.isDir(mod.FS.stat(path).mode)) walk(path)
      else compiled.push(path)
    }
  }
  walk('/lilypond/guile-bytecode')
  const result = []
  for (const path of compiled.sort()) {
    const match = /\/scm\/lily\/([^/]+)\.scm\.go$/.exec(path)
    if (!match) throw new Error(`unexpected compiled file ${path}`)
    result.push([`${match[1]}.go`, mod.FS.readFile(path)])
  }
  if (result.length < 50)
    throw new Error(
      `only ${result.length} LilyPond modules were byte-compiled:\n${logs.join('\n')}`,
    )
  return result
}

const manifest = Buffer.from(JSON.stringify({ version: 1, lilypond: '2.26.0', entries }))
const header = Buffer.alloc(4)
header.writeUInt32LE(manifest.length)
const packed = gzipSync(Buffer.concat([header, manifest, ...chunks]), { level: 9 })
await mkdir(dist, { recursive: true })
await writeFile(join(dist, 'runtime.data.bin'), packed)
console.log(
  `Packaged ${entries.length} files (${bytecode.length} byte-compiled LilyPond modules): ${offset} bytes, ${packed.length} compressed bytes`,
)
