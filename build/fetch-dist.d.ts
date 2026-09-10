export const OWNER: string
export const REPO: string
export const RELEASE: string
export const FILES: Readonly<Record<string, readonly [sha256: string, size: number]>>
export const DIST_DIR: string
export const FETCH_HINT: string
/** Throw unless dist/ holds every pinned file, naming the command that fetches them. */
export function assertDist(): Promise<string>
