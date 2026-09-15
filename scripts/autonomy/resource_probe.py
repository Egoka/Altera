"""Read-only logical file sizes; no content reads, symlink traversal or deletion."""
import datetime as dt
import os
import stat
import time


def measure_resources(roots, *, max_entries=250_000, timeout_seconds=10):
    deadline = time.monotonic() + timeout_seconds
    seen, errors = set(), set()
    total = files = inspected = 0
    stopped = False
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW

    def budget():
        nonlocal stopped
        if not stopped:
            if time.monotonic() >= deadline:
                errors.add("deadline"); stopped = True
            elif inspected >= max_entries:
                errors.add("entry_limit"); stopped = True
        return not stopped

    def scan(fd, depth=0):
        nonlocal total, files, inspected
        inode = os.fstat(fd)
        key = (inode.st_dev, inode.st_ino)
        if key in seen:
            return
        seen.add(key)
        if depth > 128:
            errors.add("depth_limit"); return
        with os.scandir(fd) as entries:
            for entry in entries:
                if not budget():
                    break
                inspected += 1
                try:
                    info = entry.stat(follow_symlinks=False)
                    if stat.S_ISDIR(info.st_mode):
                        child = os.open(entry.name, flags, dir_fd=fd)
                        try:
                            scan(child, depth + 1)
                        finally:
                            os.close(child)
                    elif stat.S_ISREG(info.st_mode) and (info.st_dev, info.st_ino) not in seen:
                        seen.add((info.st_dev, info.st_ino))
                        total += info.st_size; files += 1
                except OSError:
                    errors.add("metadata_unavailable")

    for root in roots:
        if not budget():
            break
        try:
            fd = os.open(root, flags)
            try:
                inspected += 1
                scan(fd)
            finally:
                os.close(fd)
        except OSError:
            errors.add("root_unavailable")
    if not inspected and not errors:
        errors.add("no_roots")
    return {
        "status": ("partial" if inspected else "unknown") if errors else "ok",
        "logical_bytes": None if errors else total,
        "measured_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "reclaimed_bytes": None, "files": files, "errors": sorted(errors),
    }
