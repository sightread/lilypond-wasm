/**
 * The message handling both worker entry points share. `post` is the environment's
 * postMessage; only the plumbing around it differs between a browser Worker and a
 * node:worker_threads one.
 */
import { DIST_FILES } from './dist-files.mjs'
import { compile, loadRuntime, loadWasm } from './runtime.mjs'

// Downloaded and unpacked once per worker lifetime and reused across every message it receives.
let engine

/** Start both downloads together, reporting their combined progress through `post`. A later
 *  call reuses the first one's promise, so only the first preload or compile reports progress. */
function loadEngineFiles(post) {
  if (engine) return engine
  // Start from the pinned sizes, so the first report already has the whole engine's total.
  const progress = {
    runtime: [0, DIST_FILES['runtime.data.bin'][1]],
    wasm: [0, DIST_FILES['lilypond.wasm'][1]],
  }
  const report = (file) => (loadedBytes, totalBytes) => {
    progress[file] = [loadedBytes, totalBytes]
    post({
      type: 'progress',
      loadedBytes: progress.runtime[0] + progress.wasm[0],
      totalBytes: progress.runtime[1] + progress.wasm[1],
    })
  }
  engine = Promise.all([
    loadRuntime(undefined, { onProgress: report('runtime') }),
    loadWasm({ onProgress: report('wasm') }),
  ]).then(([assets, wasmModule]) => ({ assets, wasmModule }))
  // A failed download is retried by the next message instead of failing every one after it.
  engine.catch(() => {
    engine = undefined
  })
  return engine
}

export async function handleMessage(data, post) {
  try {
    const { assets, wasmModule } = await loadEngineFiles(post)
    if (data.type === 'preload') {
      post({ type: 'ready' })
      return
    }
    const { source, ...options } = data
    const result = await compile(source, {
      ...options,
      assets,
      wasmModule,
      onLog: (text) => post({ type: 'log', text }),
    })
    post(
      { type: 'result', ...result },
      Object.values(result.files).map((bytes) => bytes.buffer),
    )
  } catch (error) {
    post({ type: 'error', message: String(error?.stack || error) })
  }
}
