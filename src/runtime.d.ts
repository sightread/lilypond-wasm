export type LilyPondFormat = 'svg' | 'pdf' | 'png' | 'ps' | 'eps' | 'midi'
export type RuntimeAssets = readonly (readonly [path: string, bytes: Uint8Array])[]

export interface CompileOptions {
  /** From `loadRuntime`; load once and reuse across compiles. */
  readonly assets?: RuntimeAssets
  /** Extra files visible to `\include`, keyed by relative path. */
  readonly files?: Readonly<Record<string, Uint8Array | string>>
  /** Virtual directories from `files` to search for `\include` files, in order. */
  readonly includePaths?: readonly string[]
  /** The name the source is compiled under. Affects `\include` resolution and log messages;
   *  output files are always named `score.*` regardless. */
  readonly filename?: string
  /** One format or several. MIDI is written whenever the score has a \midi block; 'midi'
   *  alone skips engraving. SVG on its own uses LilyPond's SVG backend, everything else Cairo.
   *  EPS must be requested alone: LilyPond then writes one file per system. */
  readonly format?: LilyPondFormat | readonly LilyPondFormat[]
  /** Dots per inch for PNG output, 10 to 1200 (LilyPond's default is 101). */
  readonly resolution?: number
  /** A file from `files` passed as `-dinclude-settings`. */
  readonly includeSettings?: string
  readonly onLog?: (text: string) => void
}

export interface CompileResult {
  readonly exitCode: number
  readonly logs: readonly string[]
  readonly files: Readonly<Record<string, Uint8Array>>
}

export function loadRuntime(bytes?: ArrayBuffer | Uint8Array): Promise<RuntimeAssets>
export function compile(source: string, options?: CompileOptions): Promise<CompileResult>
