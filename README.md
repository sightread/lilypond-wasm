# @sightread/lilypond-wasm

Run the `lilypond` compiler anywhere you can run WASM. It ships the complete runtime
inside the npm package, so compiling requires no system LilyPond installation or runtime download.

This unlocks rendering lilypond in the browser, but be wary of this as it is quite slow, 
and at 38MB the package is quite heavy 

## Install

```sh
npm install @sightread/lilypond-wasm
```

## Compile

```js
import { compile } from '@sightread/lilypond-wasm'

const result = await compile('\\version "2.26.0" { c4 d e f }', { format: 'pdf' })
const pdf = result.files['score.pdf'] // Uint8Array
```

`compile(source, options)` creates a compiler, returns its named output files and logs,
then releases its resources. Options include `format`, `filename`, `resolution`, virtual `files`,
include paths, cancellation, and log streaming. Failed LilyPond runs throw
`LilyPondCompileError` with `exitCode` and `logs`.

If compiling a batch, then you can reduce some of the cost by making a reusable compiler.
Call `dispose()` to free up the resources when done.

```js
import { createReusableCompiler } from '@sightread/lilypond-wasm'

const compiler = createReusableCompiler()
try {
  const first = await compiler.compile('{ c4 }', { format: 'svg' })
  const second = await compiler.compile('{ d4 }', { format: 'midi' })
} finally {
  compiler.dispose()
}
```

## Acknowledgements

Fonts and libraries credited in [`licenses/THIRD-PARTY-NOTICES.txt`](licenses/THIRD-PARTY-NOTICES.txt).

