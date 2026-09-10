/* glib's gio module links against the DNS resolver even though nothing here ever resolves a
   name (LilyPond links glib and gobject only). Emscripten's libc has no resolver, so these
   stubs let glib configure; they are never reached. */
#include <errno.h>
#include <stddef.h>
int res_query(const char *n, int c, int t, unsigned char *a, int l) { errno = ENOSYS; return -1; }
int res_search(const char *n, int c, int t, unsigned char *a, int l) { errno = ENOSYS; return -1; }
int res_ninit(void *s) { errno = ENOSYS; return -1; }
int res_nquery(void *s, const char *n, int c, int t, unsigned char *a, int l) { errno = ENOSYS; return -1; }
void res_nclose(void *s) {}
void res_ndestroy(void *s) {}
int dn_expand(const unsigned char *m, const unsigned char *e, const unsigned char *s, char *d, int l) { errno = ENOSYS; return -1; }
int dn_skipname(const unsigned char *s, const unsigned char *e) { errno = ENOSYS; return -1; }
