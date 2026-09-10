// node:worker_threads entry point, so Node and Bun get the same off-thread execution and the
// same cancellation the browser gets. The browser's is worker.mjs.
import { parentPort } from 'node:worker_threads'
import { handleMessage } from './worker-body.mjs'

parentPort.on('message', (data) =>
  handleMessage(data, (message, transfer) => parentPort.postMessage(message, transfer)),
)
