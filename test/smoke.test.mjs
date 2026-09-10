import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { afterAll, test } from 'bun:test'
import { createReusableCompiler, LilyPondCompileError } from '../src/index.mjs'

const compiler = createReusableCompiler()
afterAll(() => compiler.dispose())
const source = await readFile(new URL('./scale.ly', import.meta.url), 'utf8')
const decode = (bytes) => new TextDecoder().decode(bytes)

test('SVG engraving and MIDI from bundled runtime', async () => {
  const svg = await compiler.compile(source)
  assert.match(decode(svg.files['score.svg']), /<svg[\s>]/)
  assert.match(decode(svg.files['score.svg']), /LilyPond in WebAssembly/)
  assert.equal(decode(svg.files['score.midi'].subarray(0, 4)), 'MThd')
})

test('Cairo PDF without Ghostscript', async () => {
  const pdf = await compiler.compile(source, { format: 'pdf' })
  assert.equal(decode(pdf.files['score.pdf'].subarray(0, 5)), '%PDF-')
})

// Four compiles, each a second or so; the default 5s budget is not enough on a shared runner.
test('PNG at 150 dpi, PS, SVG and PDF from one Cairo run; EPS alone', async () => {
  const many = await compiler.compile(source, {
    format: ['pdf', 'png', 'svg', 'ps'],
    resolution: 150,
  })
  assert.equal(decode(many.files['score.png'].subarray(1, 4)), 'PNG')
  assert.match(decode(many.files['score.ps'].subarray(0, 4)), /^%!PS/)
  assert.match(decode(many.files['score.svg']), /<svg[\s>]/)
  assert.equal(decode(many.files['score.pdf'].subarray(0, 5)), '%PDF-')

  const eps = await compiler.compile(source, { format: 'eps' })
  assert.match(decode(eps.files['score.eps'].subarray(0, 4)), /^%!PS/)
  await assert.rejects(
    compiler.compile(source, { format: ['eps', 'pdf'] }),
    /EPS cannot be combined/,
  )
  await assert.rejects(compiler.compile(source, { format: 'gif' }), /Unsupported format/)
}, 60_000)

test('virtual include files and MIDI-only mode', async () => {
  const included = await compiler.compile(
    '\\version "2.26.0"\n\\include "parts/notes.ly"\n\\score { \\notes \\midi {} }',
    { format: 'midi', files: { 'parts/notes.ly': 'notes = { c4 d e f }' } },
  )
  assert.deepEqual(Object.keys(included.files), ['score.midi'])
})

test('virtual include search paths', async () => {
  const searched = await compiler.compile(
    '\\version "2.26.0"\n\\include "notes.ly"\n\\score { \\notes \\midi {} }',
    {
      format: 'midi',
      files: { 'vendor/nested/unused.ly': '', 'vendor/notes.ly': 'notes = { c4 d e f }' },
      includePaths: ['vendor'],
    },
  )
  assert.equal(decode(searched.files['score.midi'].subarray(0, 4)), 'MThd')
})

test('invalid score returns failure and diagnostics', async () => {
  await assert.rejects(
    compiler.compile('\\version "2.26.0"\n\\score { \\notARealCommand }'),
    (error) => error instanceof LilyPondCompileError && /error:/.test(error.logs.join('\n')),
  )
})

test('input path validation', async () => {
  await assert.rejects(
    compiler.compile(source, { files: { '../escape.ly': '' } }),
    /Invalid input filename/,
  )
})

/** Count Note On (with nonzero velocity) events across every track chunk of a Standard MIDI
 *  File, honouring running status. Good enough for tracks with no meta/sysex events spanning
 *  more than 2 data bytes. LilyPond writes a tempo/meta track before the note track(s), so this
 *  has to walk all of `MThd`'s declared tracks, not just the first. */
function countNoteOns(bytes) {
  const ntrks = (bytes[10] << 8) | bytes[11]
  let at = 14 // past the MThd header
  let count = 0
  for (let track = 0; track < ntrks; track++) {
    at += 4 // "MTrk"
    const length = (bytes[at] << 24) | (bytes[at + 1] << 16) | (bytes[at + 2] << 8) | bytes[at + 3]
    at += 4
    const end = at + length
    let runningStatus = 0
    const readVarLen = () => {
      let value = 0
      for (;;) {
        const byte = bytes[at++]
        value = (value << 7) | (byte & 0x7f)
        if ((byte & 0x80) === 0) return value
      }
    }
    while (at < end) {
      readVarLen() // delta time
      let status = bytes[at]
      if (status < 0x80) status = runningStatus
      else at++
      runningStatus = status
      if (status === 0xff) {
        // Meta events use the full byte 0xff, not the 0xf0 nibble channel messages share.
        const metaType = bytes[at++]
        const metaLength = readVarLen()
        at += metaLength
        if (metaType === 0x2f) break // end of track
      } else if (status === 0xf0 || status === 0xf7) {
        at += readVarLen()
      } else {
        const type = status & 0xf0
        const dataLength = type === 0xc0 || type === 0xd0 ? 1 : 2
        if (type === 0x90 && bytes[at + 1] > 0) count++
        at += dataLength
      }
    }
    at = end
  }
  return count
}

test('grace-free-midi.ily unfolds repeats and drops grace notes', async () => {
  const helper = await readFile(new URL('../helpers/grace-free-midi.ily', import.meta.url))
  const graceAndRepeat = await compiler.compile(
    '\\version "2.26.0"\n\\score { \\repeat volta 2 { \\acciaccatura d8 c4 } }',
    {
      format: 'midi',
      files: { 'grace-free-midi.ily': helper },
      includeSettings: 'grace-free-midi.ily',
    },
  )
  // Discards the source's own (nonexistent) \midi output entirely: only the helper's score
  // renders, so there is exactly one output file.
  assert.deepEqual(Object.keys(graceAndRepeat.files), ['score.midi'])
  // The repeat unfolds to two `c4`s; the acciaccatura is filtered out before it can add a third
  // note-on for `d`.
  assert.equal(countNoteOns(graceAndRepeat.files['score.midi']), 2)
})

test('live Scheme objects survive repeated GC and a 1024-note score', async () => {
  const stress = await compiler.compile(
    await readFile(new URL('./gc-stress.ly', import.meta.url), 'utf8'),
    {
      format: 'midi',
    },
  )
  assert.ok(stress.files['score.midi'].length > 5000)
})
