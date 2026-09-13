
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static char *controlled_getenv(const char *name) {
    if (strcmp(name, "CODEX_HOME") == 0) _exit(91);
    return NULL;
}
__attribute__((used, section("__DATA,__interpose")))
static struct { const void *replacement; const void *original; } binding = {
    (const void *)&controlled_getenv, (const void *)&getenv
};
