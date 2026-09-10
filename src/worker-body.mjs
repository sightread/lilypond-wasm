/**
 * The message handling both worker entry points share. `post` is the environment's
 * postMessage; only the plumbing around it differs between a browser Worker and a
 * node:worker_threads one.
 */
import { compile, loadRuntime } from './runtime.mjs'

// Unpacked once per worker lifetime and reused across every message it receives.
let assets

export async function handleMessage(data, post) {
  try {
    assets ??= await loadRuntime()
    const { source, ...options } = data
    const result = await compile(source, {
      ...options,
      assets,
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
