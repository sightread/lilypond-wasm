#!/usr/bin/env bun
import { copyFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { assertDist, DIST_DIR } from './fetch-dist.mjs'

const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url)))
if (packageJson.private) throw new Error('package.json still marks lilypond-wasm private')

await assertDist()
await copyFile(
  new URL('../licenses/THIRD-PARTY-NOTICES.txt', import.meta.url),
  join(DIST_DIR, 'THIRD-PARTY-NOTICES.txt'),
)
// Absolute build paths leak the packager's home directory into the shipped binary; scrubbing
// happens at link time, so anything left here means a build step was skipped.
const wasm = (await readFile(join(DIST_DIR, 'lilypond.wasm'))).toString('latin1')
for (const forbidden of ['/Users/', '/home/', 'github_pat_', 'ghp_']) {
  if (wasm.includes(forbidden))
    throw new Error(`lilypond.wasm contains forbidden text: ${forbidden}`)
}
console.log('Verified publishable LilyPond runtime artifacts')
