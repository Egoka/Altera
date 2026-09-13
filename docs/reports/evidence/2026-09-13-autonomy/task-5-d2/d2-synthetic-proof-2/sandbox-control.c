
#include <arpa/inet.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
int main(int argc, char **argv) {
    int fd, wrote, read_file, connected, forked;
    pid_t pid;
    struct sockaddr_in address = {0};
    if (argc != 4) return 2;
    fd = open(argv[1], O_CREAT | O_WRONLY | O_EXCL, 0600);
    wrote = fd >= 0;
    if (fd >= 0) { wrote = write(fd, "fixture", 7) == 7; close(fd); }
    fd = open(argv[2], O_RDONLY);
    read_file = fd >= 0;
    if (fd >= 0) close(fd);
    pid = fork();
    if (pid == 0) _exit(0);
    forked = pid > 0;
    if (pid > 0) waitpid(pid, NULL, 0);
    fd = socket(AF_INET, SOCK_STREAM, 0);
    address.sin_family = AF_INET;
    address.sin_port = htons((unsigned short)atoi(argv[3]));
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    connected = fd >= 0 && connect(fd, (struct sockaddr *)&address, sizeof(address)) == 0;
    if (fd >= 0) close(fd);
    printf("{\"write\":%d,\"read\":%d,\"fork\":%d,\"connect\":%d}\n", wrote, read_file, forked, connected);
    return 0;
}
