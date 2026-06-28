#define _GNU_SOURCE
#include <dlfcn.h>
#include <linux/netlink.h>
#include <string.h>
#include <sys/socket.h>

typedef int (*bind_fn)(int, const struct sockaddr *, socklen_t);

int bind(int fd, const struct sockaddr *address, socklen_t length) {
    static bind_fn real_bind;
    if (!real_bind) real_bind = dlsym(RTLD_NEXT, "bind");
    if (address && address->sa_family == AF_NETLINK && length >= sizeof(struct sockaddr_nl)) {
        struct sockaddr_nl copy;
        memcpy(&copy, address, sizeof(copy));
        // ponytail: gVisor rejects Chromium's route multicast subscription; initial netlink enumeration still works.
        if (copy.nl_groups == 0x113) {
            copy.nl_groups = 0;
            return real_bind(fd, (const struct sockaddr *)&copy, length);
        }
    }
    return real_bind(fd, address, length);
}
