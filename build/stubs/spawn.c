/* glib's gspawn calls posix_spawnp; Emscripten's libc has no processes to spawn. LilyPond never
   spawns anything except through its (unused here) Ghostscript path. Fails like an OS without
   fork would. */
#include <errno.h>
int posix_spawnp(void *pid, const char *file, const void *fa, const void *attr, char *const argv[], char *const envp[]) { return ENOSYS; }
int posix_spawn(void *pid, const char *path, const void *fa, const void *attr, char *const argv[], char *const envp[]) { return ENOSYS; }
