/**
 * Egress trap for the no-telemetry fork's release gate.
 *
 * Interposes connect() and getaddrinfo() via LD_PRELOAD: loopback and
 * local IPC pass through, every other destination is logged to
 * EGRESS_TRAP_LOG and refused. Telemetry is designed to fail silently, so
 * the runner asserts on the trap log instead of on scenario success alone:
 * a clean run leaves a TRAP_ACTIVE marker and zero EGRESS_ATTEMPT lines.
 *
 * Linux-only: macOS silences DYLD_INSERT_LIBRARIES interposition for the
 * Node runtime, so a macOS run would prove nothing. The gate runs on the
 * release workflow's Linux runners and refuses to run anywhere else.
 *
 * Build: cc -shared -fPIC -o trap.so trap.c -ldl   (Linux)
 */

#if defined(__linux__)
#define _GNU_SOURCE
#elif defined(__APPLE__)
#define _DARWIN_C_SOURCE
#endif
#define _POSIX_C_SOURCE 200809L

#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netdb.h>
#include <netinet/in.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>
#include <unistd.h>

static const char *marker(void) {
  static char line[128];
  snprintf(line, sizeof(line), "TRAP_ACTIVE pid=%d\n", (int)getpid());
  return line;
}

static FILE *trapLog(void) {
  const char *path = getenv("EGRESS_TRAP_LOG");
  if (path == NULL || path[0] == '\0') return stderr;
  FILE *file = fopen(path, "a");
  return file == NULL ? stderr : file;
}

static void trapNote(const char *line) {
  /* Cap the log: a retry loop must not fill the disk before the run ends. */
  static volatile int lines = 0;
  if (__sync_fetch_and_add(&lines, 1) >= 4096) return;
  FILE *file = trapLog();
  fputs(line, file);
  if (file != stderr) fclose(file);
}

__attribute__((constructor)) static void trapInit(void) {
  trapNote(marker());
}

static int isLoopbackName(const char *node) {
  if (node == NULL) return 1;
  if (strcmp(node, "localhost") == 0 || strcmp(node, "localhost.localdomain") == 0
    || strcmp(node, "ip6-localhost") == 0 || strcmp(node, "ip6-loopback") == 0) return 1;
  struct in_addr v4;
  if (inet_pton(AF_INET, node, &v4) == 1) return (ntohl(v4.s_addr) >> 24) == 127;
  struct in6_addr v6;
  if (inet_pton(AF_INET6, node, &v6) == 1) {
    static const struct in6_addr loopback = IN6ADDR_LOOPBACK_INIT;
    return memcmp(&v6, &loopback, sizeof(v6)) == 0;
  }
  return 0;
}

/** Whether an IPv6 address is ::1 without relying on IN6_IS_ADDR_LOOPBACK. */
static int isLoopback6(const struct in6_addr *addr) {
  static const struct in6_addr loopback = IN6ADDR_LOOPBACK_INIT;
  return memcmp(addr, &loopback, sizeof(*addr)) == 0;
}

int connect(int sockfd, const struct sockaddr *addr, socklen_t addrlen) {
  static int (*realConnect)(int, const struct sockaddr *, socklen_t) = NULL;
  if (realConnect == NULL) realConnect = dlsym(RTLD_NEXT, "connect");
  if (addr != NULL && addrlen >= (socklen_t)sizeof(sa_family_t)) {
    char line[256];
    if (addr->sa_family == AF_INET && addrlen >= (socklen_t)sizeof(struct sockaddr_in)) {
      const struct sockaddr_in *in = (const struct sockaddr_in *)addr;
      if ((ntohl(in->sin_addr.s_addr) >> 24) != 127) {
        char ip[INET_ADDRSTRLEN];
        inet_ntop(AF_INET, &in->sin_addr, ip, sizeof(ip));
        snprintf(line, sizeof(line), "EGRESS_ATTEMPT connect %s:%d\n", ip, (int)ntohs(in->sin_port));
        trapNote(line);
        errno = ECONNREFUSED;
        return -1;
      }
    } else if (addr->sa_family == AF_INET6 && addrlen >= (socklen_t)sizeof(struct sockaddr_in6)) {
      const struct sockaddr_in6 *in6 = (const struct sockaddr_in6 *)addr;
      if (!isLoopback6(&in6->sin6_addr)) {
        char ip[INET6_ADDRSTRLEN];
        inet_ntop(AF_INET6, &in6->sin6_addr, ip, sizeof(ip));
        snprintf(line, sizeof(line), "EGRESS_ATTEMPT connect [%s]:%d\n", ip, (int)ntohs(in6->sin6_port));
        trapNote(line);
        errno = ECONNREFUSED;
        return -1;
      }
    }
  }
  return realConnect(sockfd, addr, addrlen);
}

int getaddrinfo(const char *node, const char *service,
  const struct addrinfo *hints, struct addrinfo **res) {
  static int (*realGetaddrinfo)(const char *, const char *, const struct addrinfo *, struct addrinfo **) = NULL;
  if (realGetaddrinfo == NULL) realGetaddrinfo = dlsym(RTLD_NEXT, "getaddrinfo");
  if (!isLoopbackName(node)) {
    char line[320];
    snprintf(line, sizeof(line), "EGRESS_ATTEMPT getaddrinfo %s:%s\n",
      node == NULL ? "<null>" : node, service == NULL ? "<null>" : service);
    trapNote(line);
    return EAI_NONAME;
  }
  return realGetaddrinfo(node, service, hints, res);
}
