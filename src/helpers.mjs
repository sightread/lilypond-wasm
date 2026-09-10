/** Where this package's example `.ily` recipes live on disk, for a Node caller that wants their
 *  content to stage into `compile`'s `files`/`includeSettings`. */
import path from 'node:path'

export const GRACE_FREE_MIDI_PATH = path.join(import.meta.dirname, '../helpers/grace-free-midi.ily')
