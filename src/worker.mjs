// Browser/Bun Worker entry point. Node's is worker-node.mjs; both defer to worker-body.mjs.
import { handleMessage } from './worker-body.mjs'

self.onmessage = ({ data }) =>
  handleMessage(data, (message, transfer) => self.postMessage(message, transfer ?? []))
