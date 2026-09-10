#!/usr/bin/env bun
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const work = process.env.WASM_WORK_DIR || join(root, 'work')
const licenses = join(root, 'licenses')
const sources = new Map(
  JSON.parse(await readFile(join(here, 'sources.json'))).map(([archive, url]) => [
    archive.replace(/\.tar\.(?:gz|xz)$/, ''),
    url,
  ]),
)
const source = (component) => sources.get(component)
const fromSource = (...parts) => join(work, 'src', ...parts)

async function copyLicense(from, name) {
  await writeFile(join(licenses, name), await readFile(from, 'utf8'))
}

await mkdir(licenses, { recursive: true })

// Store one canonical copy of each copyleft license used by multiple linked components.
// GPLv3 is already the package's root LICENSE. URW uses AGPLv3, so its separate COPYING stays.
await copyLicense(fromSource('guile-3.0.11', 'COPYING.LESSER'), 'LGPL-3.0.txt')
await copyLicense(fromSource('cairo-1.18.4', 'COPYING-LGPL-2.1'), 'LGPL-2.1.txt')
await copyLicense(fromSource('freetype-2.13.3', 'docs', 'FTL.TXT'), 'FreeType.txt')
await copyLicense(fromSource('lilypond-2.26.0', 'LICENSE.OFL'), 'OFL-1.1.txt')

const permissive = [
  ['zlib 1.3.1', fromSource('zlib-1.3.1', 'LICENSE')],
  ['libpng 1.6.50', fromSource('libpng-1.6.50', 'LICENSE')],
  ['Expat 2.7.3', fromSource('expat-2.7.3', 'COPYING')],
  ['HarfBuzz 11.2.1', fromSource('harfbuzz-11.2.1', 'COPYING')],
  ['libffi 3.5.2', fromSource('libffi-3.5.2', 'LICENSE')],
  // bdwgc ships no LICENSE file; its terms open README.QUICK, above the build instructions.
  [
    'Boehm GC 8.2.12',
    fromSource('gc-8.2.12', 'README.QUICK'),
    (text) => text.split('INSTALLATION:')[0],
  ],
  ['Pixman 0.46.4', fromSource('pixman-0.46.4', 'COPYING')],
  ['Fontconfig 2.17.1', fromSource('fontconfig-2.17.1', 'COPYING')],
  ['PCRE2 10.42', fromSource('glib-2.82.5', 'subprojects', 'pcre2-10.42', 'LICENCE')],
]
const permissiveSections = []
for (const [name, file, trim = (text) => text] of permissive)
  permissiveSections.push(`===== ${name} =====\n\n${trim(await readFile(file, 'utf8')).trim()}\n`)
await writeFile(join(licenses, 'PERMISSIVE-NOTICES.txt'), `${permissiveSections.join('\n\n')}\n`)

const rows = [
  ['LilyPond 2.26.0', 'GPL-3.0-or-later', 'LICENSE', source('lilypond-2.26.0')],
  ['Guile 3.0.11', 'LGPL-3.0-or-later', 'LICENSE + licenses/LGPL-3.0.txt', source('guile-3.0.11')],
  [
    'libunistring 1.4.2',
    'LGPL-3.0-or-later',
    'LICENSE + licenses/LGPL-3.0.txt',
    source('libunistring-1.4.2'),
  ],
  ['GLib 2.82.5', 'LGPL-2.1-or-later', 'licenses/LGPL-2.1.txt', source('glib-2.82.5')],
  ['FriBidi 1.0.16', 'LGPL-2.1-or-later', 'licenses/LGPL-2.1.txt', source('fribidi-1.0.16')],
  [
    'Cairo 1.18.4',
    'LGPL-2.1-or-later (selected from dual license)',
    'licenses/LGPL-2.1.txt',
    source('cairo-1.18.4'),
  ],
  ['Pango 1.56.4', 'LGPL-2.1-or-later', 'licenses/LGPL-2.1.txt', source('pango-1.56.4')],
  [
    'FreeType 2.13.3',
    'FreeType License (selected from dual license)',
    'licenses/FreeType.txt',
    source('freetype-2.13.3'),
  ],
  ['zlib 1.3.1', 'zlib', 'licenses/PERMISSIVE-NOTICES.txt', source('zlib-1.3.1')],
  ['libpng 1.6.50', 'libpng', 'licenses/PERMISSIVE-NOTICES.txt', source('libpng-1.6.50')],
  ['Expat 2.7.3', 'MIT', 'licenses/PERMISSIVE-NOTICES.txt', source('expat-2.7.3')],
  ['HarfBuzz 11.2.1', 'MIT', 'licenses/PERMISSIVE-NOTICES.txt', source('harfbuzz-11.2.1')],
  ['libffi 3.5.2', 'MIT', 'licenses/PERMISSIVE-NOTICES.txt', source('libffi-3.5.2')],
  ['Boehm GC 8.2.12', 'permissive', 'licenses/PERMISSIVE-NOTICES.txt', source('gc-8.2.12')],
  ['Pixman 0.46.4', 'MIT', 'licenses/PERMISSIVE-NOTICES.txt', source('pixman-0.46.4')],
  [
    'Fontconfig 2.17.1',
    'MIT-style collection',
    'licenses/PERMISSIVE-NOTICES.txt',
    source('fontconfig-2.17.1'),
  ],
  [
    'PCRE2 10.42',
    'BSD-3-Clause',
    'licenses/PERMISSIVE-NOTICES.txt',
    'https://github.com/PhilipHazel/pcre2/releases/download/pcre2-10.42/pcre2-10.42.tar.bz2',
  ],
  [
    'Emscripten runtime',
    'MIT and NCSA',
    'licenses/emscripten.txt',
    'https://github.com/emscripten-core/emscripten',
  ],
  ['Emmentaler fonts', 'OFL-1.1', 'licenses/OFL-1.1.txt', source('lilypond-2.26.0')],
  [
    'URW Base35 fonts (Nimbus Sans, Nimbus Mono PS, C059)',
    'AGPL-3.0-only WITH Font-exception-2.0',
    'licenses/urw-COPYING.txt + licenses/urw-LICENSE.txt',
    'https://github.com/ArtifexSoftware/urw-base35-fonts',
  ],
  [
    'TeX Gyre fonts (Cursor, Heros, Schola)',
    'GUST Font License',
    'licenses/GUST-FONT-LICENSE.txt',
    'https://www.gust.org.pl/projects/e-foundry/tex-gyre',
  ],
]

const table = rows
  .map(
    ([component, license, text, url]) =>
      `${component}\n  License: ${license}\n  Text: ${text}\n  Source: ${url}`,
  )
  .join('\n\n')

const notice = `LilyPond WebAssembly — third-party notices

The port -- the JavaScript, the build scripts and the patches in build/patches/ -- is
Copyright (C) 2026 Jake Fried, GPL-3.0-or-later; see LICENSE. Everything listed below keeps its
own copyright holders and its own terms, and is statically linked or bundled here. Copyright and
permission notices for the permissively licensed components are preserved in
licenses/PERMISSIVE-NOTICES.txt. Canonical copyleft and font license texts are stored once and
referenced by every component that uses them.

The bundled fonts are redistributed under their own licenses, not under the GPL: Emmentaler under
the SIL Open Font License, the URW Base35 text faces under AGPLv3 with the Artifex font exception,
and the TeX Gyre faces under the GUST Font License. None of those restrict documents typeset with
them.

This port modifies Guile, Boehm GC, GLib, libunistring, and Pango. The corresponding patches are
in build/patches/, each opening with what it changes and why. Exact source archive URLs and
SHA-256 hashes are in build/sources.json; build/fetch-sources.mjs retrieves and verifies them,
and build/build.sh rebuilds the WebAssembly distribution from them.

Two inputs to the distribution do not come from build/sources.json, because neither is in a
source archive or produced by this build:

  - PCRE2 is fetched by GLib's own Meson subproject at build time, from the URL and SHA-256 in
    glib-2.82.5/subprojects/pcre2.wrap; the archive listed for it below is that URL.
  - LilyPond's data directory (its .ly and .scm sources, its PostScript, and every font above)
    is copied from a native LilyPond 2.26.0 install at packaging time. Emmentaler is generated
    by MetaFont and FontForge, which do not run under Emscripten, and the URW and TeX Gyre
    families ship with LilyPond's binary releases rather than with its source. The upstream
    projects for all of them are named below.

${table}
`

await writeFile(join(licenses, 'THIRD-PARTY-NOTICES.txt'), notice)
console.log('Packaged curated third-party notices and license texts')
