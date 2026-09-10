#!/usr/bin/env bun
import { readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = resolve(process.env.WASM_WORK_DIR || join(root, 'work'))
const localPrefixes = [work, root]

export function scrubBuildPaths(bytes, extraPrefixes = []) {
  const text = bytes.toString('latin1')
  const discovered = [...text.matchAll(/\/(?:Users|home)\/[^\0\r\n]*?\/lilypond-wasm\/work/g)].map(
    (match) => match[0],
  )
  const prefixes = [...new Set([...extraPrefixes, ...discovered])].sort(
    (a, b) => b.length - a.length,
  )
  const result = Buffer.from(bytes)
  let replacements = 0

  for (const prefix of prefixes) {
    const needle = Buffer.from(prefix)
    const clean = Buffer.from('/build/lilypond-wasm'.padEnd(needle.length, '_'))
    if (clean.length !== needle.length)
      throw new Error(`Build path is too short to scrub: ${prefix}`)
    for (
      let offset = result.indexOf(needle);
      offset >= 0;
      offset = result.indexOf(needle, offset + clean.length)
    ) {
      clean.copy(result, offset)
      replacements++
    }
  }

  const scrubbed = result.toString('latin1')
  for (const home of ['/Users/', '/home/'])
    if (scrubbed.includes(home))
      throw new Error(`Private build path remains after scrubbing: ${home}`)
  return { bytes: result, replacements }
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const target = process.argv[2]
  if (!target) throw new Error('Usage: bun scrub-build-paths.mjs <lilypond.wasm>')
  const { bytes, replacements } = scrubBuildPaths(await readFile(target), localPrefixes)
  const temporary = `${target}.scrubbed`
  await writeFile(temporary, bytes)
  await rename(temporary, target)
  console.log(`Scrubbed ${replacements} build-path occurrence(s) from ${target}`)
}
