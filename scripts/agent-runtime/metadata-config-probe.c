/* D1 читает только pinned daemon temp JSON; не исполняет CLI, stdin или команды. */
#include <fcntl.h>
#include <limits.h>
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <unistd.h>
#include "d1-build.h"

#define LIMIT 65536
#define TOKENS 4096
#define DEPTH 16
static unsigned char input[LIMIT + 1], strings[LIMIT + 1];
static size_t length, cursor, used;
struct token { char kind; int next, count; size_t start, size; };
static struct token tokens[TOKENS];
static int count;

static bool ws(unsigned char c) { return c == ' ' || c == '\t' || c == '\r' || c == '\n'; }
static void space(void) { while (cursor < length && ws(input[cursor])) cursor++; }
static int hex(unsigned char c) {
    if (c >= '0' && c <= '9') return c - '0';
    if (c >= 'a' && c <= 'f') return c - 'a' + 10;
    if (c >= 'A' && c <= 'F') return c - 'A' + 10;
    return -1;
}
static bool unit(uint32_t *value) {
    *value = 0;
    if (length - cursor < 4) return false;
    for (int i = 0; i < 4; i++) {
        int digit = hex(input[cursor++]);
        if (digit < 0) return false;
        *value = (*value << 4) | (uint32_t)digit;
    }
    return true;
}
static void encode(uint32_t code) {
    if (code < 0x80) strings[used++] = (unsigned char)code;
    else if (code < 0x800) {
        strings[used++] = 0xc0 | (code >> 6); strings[used++] = 0x80 | (code & 63);
    } else if (code < 0x10000) {
        strings[used++] = 0xe0 | (code >> 12); strings[used++] = 0x80 | ((code >> 6) & 63);
        strings[used++] = 0x80 | (code & 63);
    } else {
        strings[used++] = 0xf0 | (code >> 18); strings[used++] = 0x80 | ((code >> 12) & 63);
        strings[used++] = 0x80 | ((code >> 6) & 63); strings[used++] = 0x80 | (code & 63);
    }
}
static bool utf8(void) {
    for (size_t i = 0; i < length;) {
        uint32_t c = input[i++], minimum;
        unsigned more;
        if (c < 0x80) continue;
        if (c >= 0xc2 && c <= 0xdf) { more = 1; minimum = 0x80; c &= 31; }
        else if (c >= 0xe0 && c <= 0xef) { more = 2; minimum = 0x800; c &= 15; }
        else if (c >= 0xf0 && c <= 0xf4) { more = 3; minimum = 0x10000; c &= 7; }
        else return false;
        if (length - i < more) return false;
        while (more--) {
            if ((input[i] & 0xc0) != 0x80) return false;
            c = (c << 6) | (input[i++] & 63);
        }
        if (c < minimum || c > 0x10ffff || (c >= 0xd800 && c <= 0xdfff)) return false;
    }
    return true;
}
static bool string(int id) {
    tokens[id].kind = 's'; tokens[id].start = used;
    cursor++;
    while (cursor < length) {
        unsigned char c = input[cursor++];
        if (c == '"') { tokens[id].size = used - tokens[id].start; return true; }
        if (c < 0x20) return false;
        if (c != '\\') { strings[used++] = c; continue; }
        if (cursor == length) return false;
        c = input[cursor++];
        if (c == 'u') {
            uint32_t code, low;
            if (!unit(&code)) return false;
            if (code >= 0xd800 && code <= 0xdbff) {
                if (length - cursor < 6 || input[cursor++] != '\\' || input[cursor++] != 'u' ||
                    !unit(&low) || low < 0xdc00 || low > 0xdfff) return false;
                code = 0x10000 + ((code - 0xd800) << 10) + low - 0xdc00;
            } else if (code >= 0xdc00 && code <= 0xdfff) return false;
            encode(code);
        } else {
            switch (c) {
                case '"': case '\\': case '/': strings[used++] = c; break;
                case 'b': strings[used++] = '\b'; break;
                case 'f': strings[used++] = '\f'; break;
                case 'n': strings[used++] = '\n'; break;
                case 'r': strings[used++] = '\r'; break;
                case 't': strings[used++] = '\t'; break;
                default: return false;
            }
        }
    }
    return false;
}
static bool equal(int id, const char *value) {
    return id >= 0 && tokens[id].kind == 's' && tokens[id].size == strlen(value) &&
           memcmp(strings + tokens[id].start, value, tokens[id].size) == 0;
}
static bool same(int a, int b) {
    return tokens[a].size == tokens[b].size &&
           memcmp(strings + tokens[a].start, strings + tokens[b].start, tokens[a].size) == 0;
}
static bool digit(unsigned char c) { return c >= '0' && c <= '9'; }
static bool number(void) {
    if (input[cursor] == '-') cursor++;
    if (cursor == length) return false;
    if (input[cursor] == '0') cursor++;
    else {
        if (input[cursor] < '1' || input[cursor] > '9') return false;
        while (cursor < length && digit(input[cursor])) cursor++;
    }
    if (cursor < length && input[cursor] == '.') {
        cursor++;
        if (cursor == length || !digit(input[cursor])) return false;
        while (cursor < length && digit(input[cursor])) cursor++;
    }
    if (cursor < length && (input[cursor] == 'e' || input[cursor] == 'E')) {
        cursor++;
        if (cursor < length && (input[cursor] == '+' || input[cursor] == '-')) cursor++;
        if (cursor == length || !digit(input[cursor])) return false;
        while (cursor < length && digit(input[cursor])) cursor++;
    }
    return true;
}
static int parse(int depth) {
    space();
    if (cursor == length || count == TOKENS || depth > DEPTH) return -1;
    int id = count++;
    unsigned char c = input[cursor];
    if (c == '"') { if (!string(id)) return -1; }
    else if (c == '{' || c == '[') {
        tokens[id].kind = (char)c; cursor++; space();
        unsigned char end = c == '{' ? '}' : ']';
        if (cursor < length && input[cursor] == end) cursor++;
        else for (;;) {
            if (c == '{') {
                if (cursor == length || input[cursor] != '"') return -1;
                int key = parse(depth + 1);
                if (key < 0) return -1;
                for (int old = id + 1; old < key; old = tokens[old + 1].next)
                    if (same(old, key)) return -1;
                space(); if (cursor == length || input[cursor++] != ':') return -1;
            }
            if (parse(depth + 1) < 0) return -1;
            tokens[id].count++; space();
            if (cursor == length) return -1;
            if (input[cursor] == end) { cursor++; break; }
            if (input[cursor++] != ',') return -1;
            space();
        }
    } else {
        tokens[id].kind = 'v';
        const char *literal = c == 't' ? "true" : c == 'f' ? "false" : c == 'n' ? "null" : NULL;
        if (literal) {
            size_t n = strlen(literal);
            if (length - cursor < n || memcmp(input + cursor, literal, n)) return -1;
            cursor += n;
        } else if (!number()) return -1;
    }
    tokens[id].next = count;
    return id;
}
static int field(int id, const char *name) {
    if (id < 0 || tokens[id].kind != '{') return -1;
    for (int key = id + 1; key < tokens[id].next; key = tokens[key + 1].next)
        if (equal(key, name)) return key + 1;
    return -1;
}
static bool arguments(int id, const char *a, const char *b, const char *c) {
    if (id < 0 || tokens[id].kind != '[' || tokens[id].count != (c ? 3 : b ? 2 : 1)) return false;
    int p = id + 1;
    if (!equal(p, a)) return false;
    p = tokens[p].next;
    if (b && !equal(p, b)) return false;
    if (b) p = tokens[p].next;
    return !c || equal(p, c);
}

struct descriptor {
    const char *name, *transport, *endpoint, *command, *args;
    int unknown_fields, known_secret_fields, unknown_secret_fields;
    bool headers_present, env_present, secret_types_match, exact;
};
static struct descriptor servers[8];
static int server_count, unknown_servers;
static bool mapping;
static void describe(int key, int value) {
    const char *name = equal(key, "context7") ? "context7" : equal(key, "playwright") ? "playwright" : equal(key, "trace") ? "trace" : NULL;
    if (!name) { unknown_servers++; mapping = false; return; }
    struct descriptor *d = &servers[server_count++];
    d->name = name; d->transport = "unknown"; d->endpoint = "unknown";
    d->command = "unknown"; d->args = "unknown"; d->secret_types_match = true;
    bool http = strcmp(name, "context7") == 0;
    if (tokens[value].kind != '{') { mapping = false; return; }
    int type = field(value, "type"), url = field(value, "url"), cmd = field(value, "command"), args = field(value, "args");
    if (equal(type, "http")) d->transport = "http";
    if (equal(type, "stdio") || (type < 0 && cmd >= 0)) d->transport = "stdio";
    if (http) {
        if (equal(url, "https://mcp.context7.com/mcp")) d->endpoint = "context7_public_mcp";
        if (equal(url, "https://mcp.context7.com/mcp/oauth")) d->endpoint = "context7_public_oauth";
        d->exact = strcmp(d->transport, "http") == 0 && strcmp(d->endpoint, "unknown") != 0;
    } else {
        if (!strcmp(name, "playwright")) {
            if (equal(cmd, "npx")) d->command = "npx_name";
            if (equal(cmd, "/usr/local/bin/npx")) d->command = "npx_usr_local";
            if (equal(cmd, "/opt/homebrew/bin/npx")) d->command = "npx_homebrew";
            if (equal(cmd, "/Users/egorbondarenko/.nvm/versions/node/v24.12.0/bin/npx")) d->command = "npx_pinned_node";
            if (arguments(args, "-y", "@playwright/mcp", NULL)) d->args = "playwright_unversioned";
            if (arguments(args, "-y", "@playwright/mcp@latest", NULL)) d->args = "playwright_latest";
            if (arguments(args, "-y", "@playwright/mcp", "--headless")) d->args = "playwright_unversioned_headless";
            if (arguments(args, "-y", "@playwright/mcp@latest", "--headless")) d->args = "playwright_latest_headless";
        } else {
            if (equal(cmd, "/Users/egorbondarenko/.trace/bin/trace")) d->command = "trace_host_name";
            if (equal(cmd, "/Users/egorbondarenko/.trace/bin/trace-mcp")) d->command = "trace_host_mcp_name";
            if (arguments(args, "serve", NULL, NULL)) d->args = "trace_serve";
            if (arguments(args, "serve", "--preset", "review")) d->args = "trace_review";
        }
        d->exact = !strcmp(d->transport, "stdio") && strcmp(d->command, "unknown") && strcmp(d->args, "unknown");
    }
    for (int k = value + 1; k < tokens[value].next; k = tokens[k + 1].next) {
        if (equal(k, "headers")) {
            d->headers_present = true;
            if (!http) d->unknown_fields++;
            if (tokens[k + 1].kind != '{') d->secret_types_match = false;
            else for (int h = k + 2; h < tokens[k + 1].next; h = tokens[h + 1].next) {
                if (equal(h, "Authorization") || equal(h, "CONTEXT7_API_KEY")) d->known_secret_fields++;
                else d->unknown_secret_fields++;
                if (tokens[h + 1].kind != 's') d->secret_types_match = false;
            }
        } else if (equal(k, "env")) { d->env_present = true; d->unknown_fields++; }
        else if (!(equal(k, "type") || (http ? equal(k, "url") : (equal(k, "command") || equal(k, "args"))))) d->unknown_fields++;
    }
    d->exact = d->exact && !d->unknown_fields && !d->unknown_secret_fields && d->secret_types_match;
    mapping = mapping && d->exact;
}
static bool json(void) {
    if (!utf8() || parse(0) != 0) return false;
    space();
    if (cursor != length || tokens[0].kind != '{') return false;
    int mcp = field(0, "mcpServers");
    mapping = mcp >= 0 && tokens[mcp].kind == '{' && tokens[mcp].count > 0 && tokens[mcp].count <= 8 && tokens[0].count == 1;
    if (mcp >= 0 && tokens[mcp].kind == '{' && tokens[mcp].count <= 8)
        for (int k = mcp + 1; k < tokens[mcp].next; k = tokens[k + 1].next) describe(k, k + 1);
    return true;
}

static bool private_dir(const struct stat *s) {
    return S_ISDIR(s->st_mode) && s->st_uid == D1_UID && (s->st_mode & 07777) == 0700;
}
static bool unchanged(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
           a->st_mode == b->st_mode && a->st_uid == b->st_uid && a->st_nlink == b->st_nlink &&
           a->st_mtimespec.tv_sec == b->st_mtimespec.tv_sec && a->st_mtimespec.tv_nsec == b->st_mtimespec.tv_nsec &&
           a->st_ctimespec.tv_sec == b->st_ctimespec.tv_sec && a->st_ctimespec.tv_nsec == b->st_ctimespec.tv_nsec;
}
static int root_fd(void) {
    char path[PATH_MAX];
    if (strlen(D1_ROOT) >= sizeof(path)) return -1;
    strcpy(path, D1_ROOT);
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0) return -1;
    char *part = path + 1;
    while (*part) {
        char *end = strchr(part, '/');
        if (end) *end = 0;
        int next = openat(fd, part, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(fd); if (next < 0) return -1; fd = next;
        if (!end) break;
        part = end + 1;
    }
    return fd;
}
static const char *read_config(const char *path) {
    if (getuid() != D1_UID || geteuid() != D1_UID) return "owner_mismatch";
    size_t n = strlen(D1_ROOT);
    if (strncmp(path, D1_ROOT, n) || path[n] != '/') {
        n = strlen(D1_ALIAS);
        if (!n || strncmp(path, D1_ALIAS, n) || path[n] != '/') return "path_rejected";
    }
    const char *child = path + n + 1;
    const char *end = strchr(child, '/');
    if (!end || strcmp(end, "/mcp-config.json") || end - child <= 12 || end - child > 128 || strncmp(child, "multica-mcp-", 12)) return "path_rejected";
    for (const char *p = child + 12; p < end; p++)
        if (!((*p >= 'a' && *p <= 'z') || (*p >= 'A' && *p <= 'Z') || digit((unsigned char)*p))) return "path_rejected";
    char name[129]; memcpy(name, child, (size_t)(end - child)); name[end - child] = 0;
    int root = root_fd(), dir = -1, file = -1, again = -1;
    struct stat rs, ds, before, after, check;
    const char *status = "file_rejected";
    if (root < 0) goto done;
    if (fstat(root, &rs) || !private_dir(&rs)) goto done;
    dir = openat(root, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (dir < 0 || fstat(dir, &ds) || !private_dir(&ds) || ds.st_dev != rs.st_dev) goto done;
    file = openat(dir, "mcp-config.json", O_RDONLY | O_NOFOLLOW | O_NONBLOCK | O_CLOEXEC);
    if (file < 0 || fstat(file, &before) || !S_ISREG(before.st_mode) || before.st_uid != D1_UID ||
        (before.st_mode & 07777) != 0600 || before.st_nlink != 1 || before.st_size < 1 ||
        before.st_size > LIMIT || before.st_dev != ds.st_dev) goto done;
    while (length <= LIMIT) {
        ssize_t got = read(file, input + length, LIMIT + 1 - length);
        if (got < 0) goto done;
        if (!got) break;
        length += (size_t)got;
    }
    if (length > LIMIT || length != (size_t)before.st_size || fstat(file, &after) || !unchanged(&before, &after)) { status = "file_changed"; goto done; }
    if (fstatat(dir, "mcp-config.json", &check, AT_SYMLINK_NOFOLLOW) || !unchanged(&before, &check) ||
        fstatat(root, name, &check, AT_SYMLINK_NOFOLLOW) || !unchanged(&ds, &check)) { status = "file_changed"; goto done; }
    again = root_fd();
    if (again < 0 || fstat(again, &check) || !unchanged(&rs, &check)) { status = "file_changed"; goto done; }
    status = json() ? "ok" : "invalid_json";
 done:
    if (file >= 0) close(file);
    if (dir >= 0) close(dir);
    if (root >= 0) close(root);
    if (again >= 0) close(again);
    return status;
}
static const char *boolean(bool value) { return value ? "true" : "false"; }
int main(int argc, char **argv) {
    struct rlimit no_core = {0, 0};
    if (setrlimit(RLIMIT_CORE, &no_core)) return 78;
    if (argc == 2 && (!strcmp(argv[1], "--version") || !strcmp(argv[1], "--help"))) {
        fputs("altera-metadata-config-probe 1.0.0 (metadata only; not Claude)\n", stderr);
        return 0;
    }
    const char *path = NULL;
    bool duplicate = false;
    for (int i = 1; i < argc; i++) {
        const char *candidate = NULL;
        if (!strcmp(argv[i], "--mcp-config")) {
            if (i + 1 < argc) candidate = argv[++i]; else duplicate = true;
        } else if (!strncmp(argv[i], "--mcp-config=", 13)) candidate = argv[i] + 13;
        if (candidate) { if (path) duplicate = true; path = candidate; }
    }
    const char *status = !path || duplicate ? "argv_rejected" : read_config(path);
    fprintf(stderr, "ALTERA_METADATA_CONFIG_ONLY_V1 {\"schema_version\":1,\"source_sha256\":\"%s\",\"build_sha256\":\"%s\",\"argc\":%d,\"read_status\":\"%s\",\"path_class\":\"%s\",\"mapping_candidate\":\"%s\",\"task_acceptance\":\"not_checked\",\"unknown_servers\":%d,\"servers\":[", D1_SOURCE_SHA, D1_BUILD_SHA, argc, status, !strcmp(status, "ok") ? "daemon_private_temp" : "unresolved", mapping && !strcmp(status, "ok") ? "exact" : "unresolved", unknown_servers);
    for (int i = 0; i < server_count; i++) {
        const struct descriptor *d = &servers[i];
        fprintf(stderr, "%s{\"name\":\"%s\",\"transport\":\"%s\",\"endpoint\":\"%s\",\"command\":\"%s\",\"args\":\"%s\",\"endpoint_match\":%s,\"command_match\":%s,\"args_match\":%s,\"headers_present\":%s,\"env_present\":%s,\"known_secret_fields\":%d,\"unknown_secret_fields\":%d,\"secret_types_match\":%s,\"unknown_fields\":%d}", i ? "," : "", d->name, d->transport, d->endpoint, d->command, d->args, boolean(strcmp(d->endpoint, "unknown") != 0), boolean(strcmp(d->command, "unknown") != 0), boolean(strcmp(d->args, "unknown") != 0), boolean(d->headers_present), boolean(d->env_present), d->known_secret_fields, d->unknown_secret_fields, boolean(d->secret_types_match), d->unknown_fields);
    }
    fprintf(stderr, "],\"known_flags\":%s}\n", path ? "[\"--mcp-config\"]" : "[]");
    /* Буферы могут содержать opaque секреты; не сохранять их после descriptor. */
    for (size_t i = 0; i < sizeof(input); i++) ((volatile unsigned char *)input)[i] = 0;
    for (size_t i = 0; i < sizeof(strings); i++) ((volatile unsigned char *)strings)[i] = 0;
    return 78;
}
