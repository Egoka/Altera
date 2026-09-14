/* D0: только metadata. Нет stdin, открытия файлов, subprocess или сети.
 * PROBE_SOURCE_SHA256 передаёт trusted build, runtime его не читает из файла.
 * Binary SHA256 закрепляется отдельно, чтобы не открывать executable. */
#include <stdio.h>
#include <string.h>
#include <unistd.h>

#ifndef PROBE_SOURCE_SHA256
#error Build with the SHA256 of this source as PROBE_SOURCE_SHA256
#endif

static char output[16384];
static size_t used;

static void append(const char *s) {
    size_t n = strlen(s);
    if (used + n < sizeof(output)) {
        memcpy(output + used, s, n);
        used += n;
    }
}

static void quoted(const char *s) {
    append("\"");
    for (size_t i = 0; s[i]; i++) {
        unsigned char c = (unsigned char)s[i];
        char escaped[7];
        if (c < 32 || c >= 127) {
            snprintf(escaped, sizeof(escaped), "\\u%04x", c);
            append(escaped);
        } else if (c == '\\' || c == '"') {
            char pair[] = {'\\', (char)c, 0};
            append(pair);
        } else {
            char one[] = {(char)c, 0};
            append(one);
        }
    }
    append("\"");
}

static int under(const char *path, const char *root) {
    size_t n = strlen(root);
    return n > 1 && !strncmp(path, root, n) && (path[n] == '/' || path[n] == 0);
}

/* Только консервативная каноническая запись пути, без раскрытия symlinks. */
static int approved_path(const char *s, const char *cwd) {
    if (s[0] != '/' || strlen(s) > 768) return 0;
    for (size_t i = 0; s[i]; i++) {
        unsigned char c = (unsigned char)s[i];
        if (c < 32 || c >= 127) return 0;
        if (c == '/' && (s[i+1] == '/' ||
            (s[i+1] == '.' && (s[i+2] == '/' || s[i+2] == 0 ||
             (s[i+2] == '.' && (s[i+3] == '/' || s[i+3] == 0)))))) return 0;
    }
    return under(s, cwd) ||
        under(s, "/Users/egorbondarenko/WebstormProjects/Altera") ||
        under(s, "/Users/egorbondarenko/multica_workspaces_desktop-api.multica.ai/altera-fd1da0aa3ec6");
}

struct flag { const char *name; int value; int path; };
static const struct flag flags[] = {
    {"--model",1,0}, {"--effort",1,0}, {"--permission-mode",1,0},
    {"--input-format",1,0}, {"--output-format",1,0}, {"--print",0,0},
    {"-p",0,0}, {"--verbose",0,0}, {"--include-partial-messages",0,0},
    {"--dangerously-skip-permissions",0,0}, {"--strict-mcp-config",0,0},
    {"--mcp-config",1,1}, {"--settings",1,1}, {"--add-dir",1,1},
    {"--cwd",1,1}, {"--session-id",1,0}, {"--resume",1,0},
    {"--setting-sources",1,0}, {"--system-prompt",1,0},
    {"--append-system-prompt",1,0}, {"--allowedTools",1,0},
    {"--disallowedTools",1,0}, {"--max-budget-usd",1,0},
    {"--version",0,0}, {"--help",0,0}
};

static int presence(char **env, const char *name) {
    size_t n = strlen(name);
    for (size_t i = 0; env[i]; i++)
        if (!strncmp(env[i], name, n) && env[i][n] == '=') return 1;
    return 0;
}

int main(int argc, char **argv, char **env) {
    if (argc == 2 && (!strcmp(argv[1], "--version") || !strcmp(argv[1], "--help"))) {
        static const char answer[] = "altera-metadata-probe 1.0.0 (metadata only; no model protocol)\n";
        return write(STDOUT_FILENO, answer, sizeof(answer)-1) < 0 ? 74 : 0;
    }
    char cwd[1024], number[32];
    if (!getcwd(cwd, sizeof(cwd))) strcpy(cwd, "unresolved");
    append("{\"marker\":\"ALTERA_METADATA_ONLY_V1\",\"schema_version\":1,\"probe_source_sha256\":");
    quoted(PROBE_SOURCE_SHA256);
    append(",\"cwd\":"); quoted(cwd);
    snprintf(number, sizeof(number), ",\"argc\":%d,\"argv\":[", argc);
    append(number);
    int i, emitted = 0;
    for (i = 1; i < argc && emitted < 64 && used < 11000; i++, emitted++) {
        if (emitted) append(",");
        snprintf(number, sizeof(number), "{\"position\":%d,\"flag\":", i);
        append(number);
        const struct flag *flag = NULL;
        const char *equals = strchr(argv[i], '=');
        size_t length = equals ? (size_t)(equals - argv[i]) : strlen(argv[i]);
        for (size_t j = 0; j < sizeof(flags)/sizeof(flags[0]); j++)
            if (strlen(flags[j].name) == length && !strncmp(argv[i], flags[j].name, length))
                flag = &flags[j];
        if (!flag) {
            quoted("redacted"); append(",\"value_type\":\"redacted\"}"); continue;
        }
        quoted(flag->name);
        const char *value = equals ? equals+1 : NULL;
        if (!value && flag->value && i+1 < argc && argv[i+1][0] != '-') value = argv[++i];
        append(",\"value_type\":"); quoted(value ? "redacted" : "absent");
        if (flag->path) {
            if (value && approved_path(value, cwd)) { append(",\"path\":"); quoted(value); }
            else append(",\"unresolved_path_input\":true");
        }
        append("}");
    }
    append(i < argc ? "],\"truncated\":true" : "],\"truncated\":false");
    append(",\"env_presence\":{");
    const char *names[] = {"MULTICA_TOKEN", "MULTICA_TASK_ID", "MULTICA_AGENT_ID",
        "MULTICA_WORKSPACE_ID", "MULTICA_SERVER_URL", "CODEX_HOME", "CLAUDE_CONFIG_DIR", "TMPDIR"};
    for (size_t j = 0; j < sizeof(names)/sizeof(names[0]); j++) {
        if (j) append(",");
        quoted(names[j]); append(presence(env, names[j]) ? ":true" : ":false");
    }
    append("},\"env_path_unresolved\":true}\n");
    (void)write(STDERR_FILENO, output, used);
    return 78;
}
