#!/usr/bin/env bun
// Download the built engine into dist/ from the pinned GitHub release, verifying every file.
//
//   bun run fetch-dist
//
// Nothing downloads on its own: a source checkout has no dist/, and every entry point that
// needs one says to run this. Building it instead needs Emscripten and a native toolchain,
// see DEVELOPMENT.md.
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DIST_FILES } from '../src/dist-files.mjs'

export const OWNER = 'sightread'
export const REPO = 'lilypond-wasm'
export const RELEASE = 'v0.1.1'
export const FILES = DIST_FILES
export const DIST_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')

export const FETCH_HINT = `run \`bun run fetch-dist\` in ${REPO} to download the pinned engine`

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function read(name) {
  try {
    return await readFile(join(DIST_DIR, name))
  } catch {
    return undefined
  }
}

/** Throw unless dist/ holds every pinned file, naming the command that fetches them. */
export async function assertDist() {
  for (const [name, [hash, size]] of Object.entries(FILES)) {
    const bytes = await read(name)
    if (!bytes) throw new Error(`dist/${name} is missing: ${FETCH_HINT}`)
    if (bytes.length !== size || sha256(bytes) !== hash)
      throw new Error(`dist/${name} does not match the pinned release: ${FETCH_HINT}`)
  }
  return DIST_DIR
}

/**
 * The engine is 30 MB across three files, so the budget has to cover reading the body, not just
 * getting a response: an AbortSignal passed to fetch cancels the stream too, and a 3 minute cap
 * was aborting a download that takes over 4 on a slow line. Failures are reported as themselves
 * rather than as a bare DOMException, whose default dump is a page of unrelated error codes.
 */
async function download(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(20 * 60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    const reason = error?.name === 'TimeoutError' ? 'timed out' : (error?.message ?? String(error))
    throw new Error(`${url}: ${reason}`)
  }
}

async function fetchAll() {
  await mkdir(DIST_DIR, { recursive: true })
  for (const [name, [hash, size]] of Object.entries(FILES)) {
    const existing = await read(name)
    if (existing && existing.length === size && sha256(existing) === hash) continue
    const url = `https://github.com/${OWNER}/${REPO}/releases/download/${RELEASE}/${name}`
    process.stderr.write(`lilypond-wasm: fetching ${name} (${(size / 1048576).toFixed(1)} MB)\n`)
    const bytes = await download(url)
    if (bytes.length !== size || sha256(bytes) !== hash)
      throw new Error(
        `${name}: checksum mismatch; the release asset does not match FILES in fetch-dist.mjs`,
      )
    const temporary = join(DIST_DIR, `.${name}.${process.pid}.${Date.now()}`)
    try {
      await writeFile(temporary, bytes)
      await rename(temporary, join(DIST_DIR, name))
    } finally {
      await rm(temporary, { force: true })
    }
  }
  return DIST_DIR
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await fetchAll()
