import { createReusableCompiler } from './src/index.mjs'

const $ = (id) => document.getElementById(id)

// Theme toggle: overrides the prefers-color-scheme default and remembers the choice.
function currentTheme() {
  return (
    document.documentElement.dataset.theme ??
    (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
  )
}
$('theme-toggle').onclick = () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark'
  document.documentElement.dataset.theme = next
  localStorage.setItem('theme', next)
}
let compiler = createReusableCompiler()
let controller, timer
let urls = []
const includes = new Map() // relative name -> text, sent to the Worker as virtual files

function killWorker() {
  controller?.abort()
  compiler.dispose()
  compiler = createReusableCompiler()
}
function idle() {
  clearTimeout(timer)
  // Only the engine being loaded re-enables Compile; until then the Load button owns the flow.
  $('compile').disabled = !$('load').hidden
  $('cancel').hidden = true
}
function cancel() {
  killWorker()
  idle()
}
// LilyPond is ~20 MB of engine and runtime data, downloaded before anything can compile. That
// is a real cost on a phone, so it is never spent without asking: no bytes leave the network
// until someone presses the button, and the button says what it will cost. Loading it up front
// rather than inside the first compile also keeps the two-minute watchdog below honest -- it
// covers compiling, which is seconds, not a download that can take minutes.
let warm
function loadEngine() {
  return (warm ??= (async () => {
    $('load').disabled = true
    $('status').textContent = 'Loading LilyPond…'
    try {
      await compiler.compile('\\version "2.26.0" { c4 }', { format: 'midi' })
      $('load').hidden = true
      $('compile').disabled = false
      $('status').textContent = 'Ready'
    } catch (error) {
      warm = undefined
      $('load').disabled = false
      $('status').textContent = 'Could not load LilyPond'
      $('status').dataset.state = 'error'
      $('log').textContent += `${error.message}\n`
      throw error
    }
  })())
}
$('load').onclick = () => loadEngine().catch(() => {})
// A connection that has told us it is metered or slow never gets a head start; everyone else
// gets the download running while they are still reading the page.
const link = navigator.connection
if (!link?.saveData && !/^([23]g|slow-2g)$/.test(link?.effectiveType ?? '')) loadEngine()
function renderIncludes() {
  $('includes').replaceChildren(
    ...[...includes.keys()].map((name) => {
      const li = document.createElement('li')
      li.textContent = `\\include "${name}" `
      const remove = document.createElement('button')
      remove.textContent = 'remove'
      remove.style.padding = '2px 8px'
      remove.style.margin = '0'
      remove.onclick = () => {
        includes.delete(name)
        renderIncludes()
      }
      li.append(remove)
      return li
    }),
  )
}
$('file').onchange = async ({ target }) => {
  const files = [...target.files]
  target.value = ''
  // The first .ly is the score; everything else rides along as an include file.
  const main = files.find((f) => /\.ly$/i.test(f.name)) ?? files[0]
  for (const file of files) {
    if (file === main) $('source').value = await file.text()
    else includes.set(file.name, await file.text())
  }
  renderIncludes()
}
// EPS replaces every other graphical format (but not MIDI), so ticking it unticks
// the rest and vice versa. The DPI input only matters when PNG is requested.
for (const box of document.querySelectorAll('input[name=format]')) {
  box.onchange = () => {
    if (box.value === 'png') $('resolution').disabled = !box.checked
    if (!box.checked || box.value === 'midi') return
    for (const other of document.querySelectorAll('input[name=format]')) {
      if (other === box || other.value === 'midi') continue
      if (box.value === 'eps' || other.value === 'eps') other.checked = false
    }
  }
}
$('cancel').onclick = () => {
  cancel()
  $('status').textContent = 'Cancelled'
  delete $('status').dataset.state
}
$('compile').onclick = async () => {
  urls.forEach((url) => URL.revokeObjectURL(url))
  urls = []
  $('downloads').replaceChildren()
  $('preview').replaceChildren()
  $('log').textContent = ''
  $('status').textContent = 'Compiling…'
  delete $('status').dataset.state
  $('compile').disabled = true
  $('cancel').hidden = false
  const format = [...document.querySelectorAll('input[name=format]:checked')].map(
    (box) => box.value,
  )
  if (format.length === 0) {
    $('status').textContent = 'Pick at least one output format'
    $('status').dataset.state = 'error'
    idle()
    return
  }
  const files = Object.fromEntries(includes)
  await loadEngine()
  const started = performance.now()
  controller = new AbortController()
  // Compiling only: the engine is already loaded by the time this is armed.
  timer = setTimeout(() => {
    $('status').textContent = 'Stopped after two minutes'
    cancel()
  }, 120_000)
  try {
    const result = await compiler.compile($('source').value, {
      format,
      resolution: Number($('resolution').value) || undefined,
      files,
      signal: controller.signal,
      onLog: (text) => ($('log').textContent += text + '\n'),
    })
    $('status').textContent =
      `Compiled successfully in ${((performance.now() - started) / 1000).toFixed(1)}s`
    $('status').dataset.state = 'success'
    for (const [name, bytes] of Object.entries(result.files).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      const ext = name.slice(name.lastIndexOf('.') + 1)
      const type =
        {
          svg: 'image/svg+xml',
          pdf: 'application/pdf',
          png: 'image/png',
          ps: 'application/postscript',
          eps: 'application/postscript',
          json: 'application/json',
        }[ext] ?? 'audio/midi'
      const url = URL.createObjectURL(new Blob([bytes], { type }))
      urls.push(url)
      const link = document.createElement('a')
      link.href = url
      link.download = name
      link.textContent = `Download ${name} (${(bytes.length / 1024).toFixed(0)} KB)`
      $('downloads').append(link)
      if (ext === 'svg' || ext === 'png') {
        const img = document.createElement('img')
        img.src = url
        img.alt = `Engraved score: ${name}`
        $('preview').append(img)
      } else if (ext === 'pdf') {
        const frame = document.createElement('iframe')
        frame.src = url
        frame.title = `PDF preview: ${name}`
        $('preview').append(frame)
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      $('status').textContent = 'Compilation failed'
      $('status').dataset.state = 'error'
      $('log').textContent += error.message
    }
  } finally {
    controller = undefined
    idle()
  }
}
