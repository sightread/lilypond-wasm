#!/usr/bin/env bun
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const sources = JSON.parse(await readFile(new URL('./sources.json', import.meta.url)))
const root = process.env.WASM_WORK_DIR
  ? join(process.env.WASM_WORK_DIR, 'src')
  : fileURLToPath(new URL('../work/src/', import.meta.url))
await mkdir(root, { recursive: true })
for (const [name, url, hash] of sources) {
  const path = join(root, name)
  let bytes
  try {
    bytes = await readFile(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    console.log(`Downloading ${url}`)
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) })
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`)
    bytes = Buffer.from(await response.arrayBuffer())
  }
  if (createHash('sha256').update(bytes).digest('hex') !== hash)
    throw new Error(`SHA-256 mismatch: ${name}`)
  await writeFile(`${path}.verified`, bytes)
  await rename(`${path}.verified`, path)
  const dir = name.replace(/\.tar\.(gz|xz)$/, '')
  try {
    await access(join(root, dir))
  } catch {
    execFileSync('tar', ['-xf', path, '-C', root], { stdio: 'inherit' })
  }
  console.log(`Verified ${name}`)
}
