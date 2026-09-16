"""Привязать записи оркестратора к каноническому workspace/project."""
import os
from pathlib import Path
import sys


def guarded_args(args, project_id):
    result = list(args)
    if not any(result[index:index + 2] == ["issue", "create"] for index in range(len(result) - 1)):
        return result
    selected = None
    for index, value in enumerate(result):
        if value == "--project":
            if index + 1 >= len(result):
                raise ValueError("missing issue project value")
            selected = result[index + 1]
        elif value.startswith("--project="):
            selected = value.split("=", 1)[1]
    if selected is None:
        return [*result, "--project", project_id]
    if selected != project_id:
        raise ValueError("issue create targeted a non-canonical project")
    return result


def main():
    binary = os.environ.get("ALTERA_MULTICA_BINARY")
    project_id = os.environ.get("ALTERA_MULTICA_PROJECT_ID")
    if not binary or not Path(binary).is_file() or not project_id:
        print("multica guard is not configured", file=sys.stderr)
        return 2
    try:
        args = guarded_args(sys.argv[1:], project_id)
    except ValueError as error:
        print(str(error), file=sys.stderr)
        return 2
    os.execve(binary, [binary, *args], os.environ)
    return 2


if __name__ == "__main__":
    raise SystemExit(main())
