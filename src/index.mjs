export class LilyPondCompileError extends Error {
  constructor(exitCode, logs) {
    super(`LilyPond exited with code ${exitCode}\n${logs.join('\n')}`)
    this.name = 'LilyPondCompileError'
    this.exitCode = exitCode
    this.logs = logs
  }
}

function succeeded(result) {
  if (result.exitCode !== 0) throw new LilyPondCompileError(result.exitCode, result.logs)
  return { logs: result.logs, files: result.files }
}

function abortError(signal) {
  return signal?.reason ?? new DOMException('LilyPond compilation aborted', 'AbortError')
}

/**
 * One worker, whichever kind this runtime has. Browsers and Bun get the Worker global;
 * Node gets node:worker_threads. Both are real threads that can be terminated mid-compile,
 * so `signal` and `dispose()` mean the same thing everywhere — a compile in progress is a
 * long synchronous run inside WebAssembly, and killing the thread is the only way to stop it.
 */
async function spawnWorker() {
  if (typeof Worker === 'function') {
    const worker = new Worker(new URL('./worker.mjs', import.meta.url), { type: 'module' })
    return {
      post: (message) => worker.postMessage(message),
      terminate: () => worker.terminate(),
      listen: (onMessage, onError) => {
        worker.onmessage = ({ data }) => onMessage(data)
        worker.onerror = (event) => onError(new Error(event.message || 'LilyPond worker failed'))
      },
      silence: () => {
        worker.onmessage = null
        worker.onerror = null
      },
    }
  }
  const { Worker: NodeWorker } = await import('node:worker_threads')
  const worker = new NodeWorker(new URL('./worker-node.mjs', import.meta.url))
  worker.unref()
  let handlers = {}
  worker.on('message', (data) => handlers.onMessage?.(data))
  worker.on('error', (error) => handlers.onError?.(error))
  return {
    post: (message) => worker.postMessage(message),
    terminate: () => void worker.terminate(),
    listen: (onMessage, onError) => {
      handlers = { onMessage, onError }
    },
    silence: () => {
      handlers = {}
    },
  }
}

function createCompiler() {
  let worker
  let activeReject
  let queue = Promise.resolve()
  let disposed = false

  const terminate = (reason) => {
    worker?.terminate()
    worker = undefined
    activeReject?.(reason)
    activeReject = undefined
  }

  const run = async (source, { signal, onLog, ...options }) => {
    if (disposed) throw new Error('Compiler has been disposed')
    if (signal?.aborted) throw abortError(signal)
    const instance = (worker ??= await spawnWorker())
    // Disposing or aborting while the worker was starting up already tore this one down.
    if (worker !== instance)
      throw disposed ? new Error('Compiler has been disposed') : abortError(signal)
    return new Promise((resolve, reject) => {
      const settle = (fn) => (value) => {
        instance.silence()
        activeReject = undefined
        signal?.removeEventListener('abort', onAbort)
        fn(value)
      }
      const done = settle(resolve)
      const fail = settle(reject)
      activeReject = fail
      const onAbort = () => terminate(abortError(signal))
      signal?.addEventListener('abort', onAbort)
      instance.listen(
        (data) => {
          if (data.type === 'log') onLog?.(data.text)
          else if (data.type === 'error') fail(new Error(data.message))
          else {
            try {
              done(succeeded(data))
            } catch (error) {
              fail(error)
            }
          }
        },
        (error) => terminate(error),
      )
      instance.post({ source, ...options })
    })
  }

  return {
    compile(source, options = {}) {
      const job = queue.then(() => run(source, options))
      queue = job.then(
        () => undefined,
        () => undefined,
      )
      return job
    },
    dispose() {
      disposed = true
      terminate(new Error('Compiler has been disposed'))
    },
  }
}

/** Create a compiler that keeps its worker and unpacked runtime assets across jobs. Compiles
 *  run one at a time, in call order. Call `dispose()` when done: the worker outlives the last
 *  compile otherwise. */
export function createReusableCompiler() {
  return createCompiler()
}

/** Compile once, tearing the worker down afterward. Use `createReusableCompiler` for batches:
 *  this unpacks the ~30 MB runtime again on every call. */
export async function compile(source, options = {}) {
  const compiler = createReusableCompiler()
  try {
    return await compiler.compile(source, options)
  } finally {
    compiler.dispose()
  }
}
