#!/usr/bin/env bun
// Assemble docs/ into a servable site: the page, the package source it imports, and the engine.
// dist/ is not in the repo, so this is also the reason GitHub Pages cannot just serve docs/.
//
//   bun run demo    # assemble and serve at http://localhost:8000
import { cpSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertDist } from './fetch-dist.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const site = join(root, '_site')

await assertDist()
rmSync(site, { recursive: true, force: true })
mkdirSync(site, { recursive: true })
cpSync(join(root, 'docs'), site, { recursive: true })
for (const dir of ['src', 'dist']) cpSync(join(root, dir), join(site, dir), { recursive: true })
console.log(`Assembled ${site}`)

if (process.argv.includes('--serve')) {
  const server = Bun.serve({
    port: 8000,
    fetch(request) {
      const path = new URL(request.url).pathname
      const file = Bun.file(join(site, path === '/' ? 'index.html' : path))
      return new Response(file)
    },
  })
  console.log(`Serving on http://localhost:${server.port}`)
}
