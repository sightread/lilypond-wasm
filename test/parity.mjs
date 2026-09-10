#!/usr/bin/env bun
// Optional development reference test; the runtime itself never invokes native LilyPond.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compile } from '../src/index.mjs'

const source = process.argv[2]
  ? execFileSync('convert-ly', [process.argv[2]], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  : await readFile(new URL('./parity.ly', import.meta.url), 'utf8')
const wasm = await compile(source, { format: 'midi' })
const dir = await mkdtemp(join(tmpdir(), 'lilypond-wasm-parity-'))
await writeFile(join(dir, 'score.ly'), source)
execFileSync('lilypond', ['-dno-print-pages', '-o', join(dir, 'score'), join(dir, 'score.ly')], {
  stdio: 'pipe',
})
const nativeMidi = await readFile(join(dir, 'score.midi'))
assert.deepEqual(Buffer.from(wasm.files['score.midi']), nativeMidi)
console.log(
  `PASS: byte-identical native/WASM MIDI (${process.argv[2] || 'polyphony, repeats, tuplets, grace notes and ties'})`,
)
