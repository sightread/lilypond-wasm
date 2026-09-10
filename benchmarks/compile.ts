/**
 * Measure the standalone WASM runtime over this package's fixtures.
 *
 *   bun benchmarks/compile.ts [--runs N]
 *
 * Reports the first and warm compile times for a small score, a representative notation
 * fixture, and a Scheme/GC stress fixture, plus the process memory retained after each case.
 * Needs dist/ already fetched (`bun run fetch-dist`).
 */
import { readFile } from 'node:fs/promises'
import type { CompileOptions } from '@sightread/lilypond-wasm'
import { assertDist } from '../build/fetch-dist.mjs'

const runsArg = process.argv.indexOf('--runs')
const runs = runsArg >= 0 ? Number(process.argv[runsArg + 1]) : 3
if (!Number.isSafeInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer')

const cases: readonly {
  name: string
  fixture: string
  options: CompileOptions
}[] = [
  { name: 'scale (SVG + MIDI)', fixture: 'scale.ly', options: { format: 'svg' } },
  { name: 'notation (MIDI)', fixture: 'parity.ly', options: { format: 'midi' } },
  { name: 'Scheme/GC stress (MIDI)', fixture: 'gc-stress.ly', options: { format: 'midi' } },
]

async function time<T>(fn: () => Promise<T>): Promise<{ elapsed: number; value: T }> {
  const start = performance.now()
  const value = await fn()
  return { elapsed: performance.now() - start, value }
}

async function mean(fn: () => Promise<unknown>, count: number): Promise<number> {
  let total = 0
  for (let i = 0; i < count; i++) total += (await time(fn)).elapsed
  return total / count
}

const milliseconds = (value: number) => `${value.toFixed(0)}ms`
const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`

async function main() {
  await assertDist()
  // Import only after the check: a source checkout does not track the runtime distribution.
  const { createReusableCompiler } = await import('../src/index.mjs')
  const compiler = createReusableCompiler()

  const rows: { name: string; first: number; warm: number; rss: number; buffers: number }[] = []
  for (const benchmark of cases) {
    const source = await readFile(new URL(`../test/${benchmark.fixture}`, import.meta.url), 'utf8')
    const run = async () => compiler.compile(source, benchmark.options)
    const first = await time(run)
    const warm = await mean(run, runs)
    if (typeof Bun !== 'undefined') Bun.gc(true)
    const memory = process.memoryUsage()
    rows.push({
      name: benchmark.name,
      first: first.elapsed,
      warm,
      rss: memory.rss,
      buffers: memory.arrayBuffers,
    })
  }

  const nameWidth = Math.max('fixture'.length, ...rows.map((row) => row.name.length))
  console.log(
    `${'fixture'.padEnd(nameWidth)}  ${'first'.padStart(8)}  ${`warm x${runs}`.padStart(8)}  ${'RSS'.padStart(8)}  ${'buffers'.padStart(8)}`,
  )
  for (const row of rows) {
    console.log(
      `${row.name.padEnd(nameWidth)}  ${milliseconds(row.first).padStart(8)}  ${milliseconds(row.warm).padStart(8)}  ${megabytes(row.rss).padStart(8)}  ${megabytes(row.buffers).padStart(8)}`,
    )
  }
  compiler.dispose()
}

await main()
