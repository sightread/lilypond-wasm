const decoder = new TextDecoder()

const MISSING_DIST =
  'the lilypond-wasm engine is missing from dist/; run `bun run fetch-dist` in the package'

/** dist/ is fetched, not committed, so both of its entry points fail the same helpful way. */
async function distUrl(name) {
  const url = new URL(`../dist/${name}`, import.meta.url)
  if (url.protocol !== 'file:') return url
  const { access } = await import('node:fs/promises')
  try {
    await access(url)
  } catch {
    throw new Error(`${url.pathname}: ${MISSING_DIST}`)
  }
  return url
}

let engine
function loadEngine() {
  return (engine ??= distUrl('lilypond.mjs').then((url) =>
    import(/* @vite-ignore */ url.href).then((module) => module.default),
  ))
}

/** Unpack the runtime data into the assets `compile` installs. Load once and reuse across
 *  fresh engine instances; every compile needs a fresh engine but not fresh assets. */
export async function loadRuntime(bytes) {
  if (!bytes) {
    const url = await distUrl('runtime.data.bin')
    if (url.protocol === 'file:') {
      // Node and Bun: fetch() refuses file: URLs, and this is a local read anyway.
      const { readFile } = await import('node:fs/promises')
      bytes = await readFile(url)
    } else {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Runtime download failed: ${response.status}`)
      bytes = await response.arrayBuffer()
    }
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  const buffer = await new Response(stream).arrayBuffer()
  const length = new DataView(buffer).getUint32(0, true)
  if (length > buffer.byteLength - 4) throw new Error('Invalid runtime manifest length')
  const manifest = JSON.parse(decoder.decode(new Uint8Array(buffer, 4, length)))
  if (manifest.version !== 1 || manifest.lilypond !== '2.26.0')
    throw new Error('Unsupported runtime data')
  const data = new Uint8Array(buffer, 4 + length)
  return manifest.entries.map(([path, offset, size]) => {
    if (!/^\/(lilypond|guile)\//.test(path) && path !== '/fonts.conf')
      throw new Error('Invalid runtime path')
    if (
      path.split('/').includes('..') ||
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(size) ||
      offset < 0 ||
      size < 0 ||
      offset + size > data.length
    )
      throw new Error('Invalid runtime entry')
    return [path, data.subarray(offset, offset + size)]
  })
}

function inputPath(name) {
  if (
    !name ||
    name.startsWith('/') ||
    name.includes('\\') ||
    name.includes('\0') ||
    name.split('/').some((p) => !p || p === '.' || p === '..')
  )
    throw new Error(`Invalid input filename: ${name}`)
  return `/input/${name}`
}

const FORMATS = ['svg', 'pdf', 'png', 'ps', 'eps', 'midi']

/**
 * LilyPond has two drawing backends and they do not produce the same SVG, so which one runs
 * depends on what was asked for:
 *
 *   - `-dbackend=svg` is LilyPond's own writer. It emits notation glyphs as paths with the
 *     staff geometry LilyPond intends, and it is the only backend that can write SVG alone.
 *   - `-dbackend=cairo` is the one that can write PDF, PNG, PS and EPS, so anything involving
 *     those goes through Cairo — including a request that mixes SVG with them, because one
 *     LilyPond run has one backend.
 *
 * MIDI is orthogonal: it comes from the score's own \midi block whichever backend is loaded,
 * so 'midi' alone still needs a backend selected, with page output switched off.
 */
function outputArgs(format, resolution) {
  const formats = new Set(Array.isArray(format) ? format : [format])
  for (const f of formats) if (!FORMATS.includes(f)) throw new Error(`Unsupported format: ${f}`)
  if (formats.size === 0) throw new Error('No output format requested')
  if (
    resolution !== undefined &&
    (!Number.isInteger(resolution) || resolution < 10 || resolution > 1200)
  )
    throw new Error(`Invalid PNG resolution: ${resolution}`)
  const graphical = [...formats].filter((f) => f !== 'midi')
  // LilyPond's EPS mode writes one file per system and silently replaces every other format.
  if (formats.has('eps') && graphical.length > 1)
    throw new Error('EPS cannot be combined with other graphical formats')
  if (graphical.length === 0) return ['-dbackend=svg', '--svg', '-dno-print-pages']
  if (graphical.length === 1 && graphical[0] === 'svg') return ['-dbackend=svg', '--svg']
  const args = ['-dbackend=cairo', ...graphical.map((f) => `--${f}`)]
  if (formats.has('png') && resolution !== undefined) args.push(`-dresolution=${resolution}`)
  return args
}

/**
 * Run one score in a fresh in-memory filesystem holding nothing but the runtime assets, the
 * caller's `files` and the source. Returns exitCode, logs, and the output files as Uint8Arrays.
 * The engine is rebuilt per call because LilyPond exits and frees its global state once it has
 * processed its input; only `assets` survives between calls.
 *
 * This is the low-level entry point and it runs on whatever thread calls it. Use index.mjs,
 * which drives it from a worker.
 */
export async function compile(
  source,
  {
    assets,
    files = {},
    filename = 'score.ly',
    includePaths = [],
    format = 'svg',
    resolution,
    includeSettings,
    onLog = () => {},
  } = {},
) {
  if (typeof source !== 'string') throw new TypeError('LilyPond source must be a string')
  const outputFlags = outputArgs(format, resolution)
  const mainPath = inputPath(filename)
  const inputs = Object.entries(files).map(([name, bytes]) => [inputPath(name), bytes])
  const searchPaths = includePaths.map(inputPath)
  const settingsPath = includeSettings === undefined ? undefined : inputPath(includeSettings)
  assets ??= await loadRuntime()
  const logs = []
  const log = (text) => {
    logs.push(text)
    onLog(text)
  }
  let exitCode = 0
  const createLilyPond = await loadEngine()
  const mod = await createLilyPond({
    print: log,
    printErr: log,
    onExit: (code) => {
      exitCode = code
    },
    preRun: [
      (m) => {
        const write = (path, bytes) => {
          m.FS.mkdirTree(path.slice(0, path.lastIndexOf('/')) || '/')
          m.FS.writeFile(path, bytes)
        }
        for (const [path, bytes] of assets) write(path, bytes)
        for (const [path, bytes] of inputs) write(path, bytes)
        write(mainPath, source)
        for (const path of ['/output', '/tmp/fontconfig', '/lilypond/lib', '/home/wasm'])
          m.FS.mkdirTree(path)
        Object.assign(m.ENV, {
          LILYPOND_DATADIR: '/lilypond',
          LILYPOND_LIBDIR: '/lilypond/lib',
          GUILE_LOAD_PATH: '/guile/share/3.0',
          GUILE_LOAD_COMPILED_PATH: '/guile/ccache',
          GUILE_AUTO_COMPILE: '0',
          FONTCONFIG_FILE: '/fonts.conf',
          HOME: '/home/wasm',
          TMPDIR: '/tmp',
          LANG: 'C.UTF-8',
        })
        m.FS.chdir('/input')
      },
    ],
  })
  const args = ['-dno-point-and-click', '-o', '/output/score']
  for (const path of searchPaths) args.push('-I', path)
  if (settingsPath) args.push(`-dinclude-settings=${settingsPath}`)
  args.push(...outputFlags)
  // Emscripten's Node loader changes the host exit code even for library calls.
  const nodeProcess = typeof process !== 'undefined' && process.versions?.node ? process : undefined
  const previousExitCode = nodeProcess?.exitCode
  try {
    const status = mod.callMain([...args, mainPath])
    if (typeof status === 'number') exitCode = status
  } catch (error) {
    if (error.name !== 'ExitStatus') throw error
    exitCode = error.status
  } finally {
    if (nodeProcess) nodeProcess.exitCode = previousExitCode
  }
  const output = {}
  for (const name of mod.FS.readdir('/output')) {
    if (name !== '.' && name !== '..' && mod.FS.isFile(mod.FS.stat(`/output/${name}`).mode))
      output[name] = mod.FS.readFile(`/output/${name}`)
  }
  return { exitCode, logs, files: output }
}
