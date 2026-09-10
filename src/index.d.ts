import type { CompileOptions as InternalCompileOptions } from './runtime.mjs'

export type { LilyPondFormat } from './runtime.mjs'

export interface CompileOptions extends Omit<InternalCompileOptions, 'assets'> {
  /** Aborting terminates the worker mid-compile, in every environment. The promise rejects
   *  with `signal.reason`, or an `AbortError` DOMException. */
  readonly signal?: AbortSignal
}

export interface CompileResult {
  readonly logs: readonly string[]
  readonly files: Readonly<Record<string, Uint8Array>>
}

/** Thrown when LilyPond itself failed. `logs` holds everything it wrote, `exitCode` its status. */
export class LilyPondCompileError extends Error {
  readonly exitCode: number
  readonly logs: readonly string[]
  constructor(exitCode: number, logs: readonly string[])
}

export interface ReusableCompiler {
  /** Compiles run one at a time, in call order. */
  compile(source: string, options?: CompileOptions): Promise<CompileResult>
  /** Terminate the worker. A compile in flight rejects; later calls reject too. */
  dispose(): void
}

/** A compiler that keeps its worker and unpacked runtime assets across jobs. */
export function createReusableCompiler(): ReusableCompiler
/** Compile once, tearing the worker down afterward. Unpacks the runtime on every call. */
export function compile(source: string, options?: CompileOptions): Promise<CompileResult>
