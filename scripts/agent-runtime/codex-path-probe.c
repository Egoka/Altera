/* D2 читает только lexical CODEX_HOME и bounded cwd; filesystem identity не проверяется. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include "d2-build.h"

#define PATH_LIMIT 1024U
#define RECORD_LIMIT 1800U

static size_t bounded_length(const char *value) {
    size_t length;
    for (length = 0; length <= PATH_LIMIT; length++) {
        if (value[length] == '\0') return length;
    }
    return PATH_LIMIT + 1U;
}

static int candidate(const char *value, size_t length) {
    const size_t root_length = sizeof(D2_ROOT) - 1U;
    size_t offset, digits = 0, i;
    if (length > PATH_LIMIT || length < root_length + 31U) return 0;
    if (memcmp(value, D2_ROOT, root_length) != 0) return 0;
    offset = root_length;
    if (memcmp(value + offset, "/alte-", 6U) != 0) return 0;
    offset += 6U;
    while (digits < 9U && offset < length && value[offset] >= '0' && value[offset] <= '9') {
        offset++;
        digits++;
    }
    if (digits == 0U || offset >= length || value[offset++] != '-') return 0;
    if (length - offset != 23U) return 0;
    for (i = 0; i < 12U; i++) {
        const char character = value[offset + i];
        if (!((character >= '0' && character <= '9') || (character >= 'a' && character <= 'f'))) return 0;
    }
    return memcmp(value + offset + 12U, "/codex-home", 11U) == 0;
}

int main(int argc, char **argv) {
    const char *home;
    char cwd[PATH_LIMIT + 1U];
    char record[RECORD_LIMIT + 1U];
    size_t home_length = 0;
    int valid, cwd_matches, count;
    /* Static probes не обращаются к getenv/getcwd и не имитируют Codex CLI. */
    if (argc == 2 && (strncmp(argv[1], "--version", 10U) == 0 || strncmp(argv[1], "--help", 7U) == 0)) {
        fputs("altera-codex-path-probe 1.0.0; metadata-only, not Codex; diagnostic exits 78\n", stdout);
        return 0;
    }
    home = getenv("CODEX_HOME");
    if (home != NULL) home_length = bounded_length(home);
    valid = home != NULL && candidate(home, home_length);
    cwd_matches = getcwd(cwd, sizeof(cwd)) != NULL && bounded_length(cwd) == sizeof(D2_CWD) - 1U &&
                  memcmp(cwd, D2_CWD, sizeof(D2_CWD) - 1U) == 0;
    count = snprintf(record, sizeof(record),
        "ALTERA_CODEX_PATH_ONLY_V1 {\"source_sha256\":\"%s\",\"build_sha256\":\"%s\","
        "\"read_status\":\"%s\",\"cwd_matches_expected\":%s,\"argc\":%d,"
        "\"canonical_identity\":\"not_checked\",\"task_acceptance\":\"not_checked\"%s%.*s%s}\n",
        D2_SOURCE_SHA, D2_BUILD_SHA, valid ? "lexical_candidate" : "managed_paths_unresolved",
        cwd_matches ? "true" : "false", argc, valid ? ",\"candidate_path\":\"" : "",
        valid ? (int)home_length : 0, valid ? home : "", valid ? "\"" : "");
    /* Даже при будущем росте record усечённый путь никогда не считается candidate. */
    if (count < 0 || (size_t)count > RECORD_LIMIT) {
        count = snprintf(record, sizeof(record),
            "ALTERA_CODEX_PATH_ONLY_V1 {\"source_sha256\":\"%s\",\"build_sha256\":\"%s\","
            "\"read_status\":\"managed_paths_unresolved\",\"cwd_matches_expected\":%s,\"argc\":%d,"
            "\"canonical_identity\":\"not_checked\",\"task_acceptance\":\"not_checked\"}\n",
            D2_SOURCE_SHA, D2_BUILD_SHA, cwd_matches ? "true" : "false", argc);
    }
    if (count > 0 && (size_t)count <= RECORD_LIMIT) fwrite(record, 1U, (size_t)count, stderr);
    return 78;
}
