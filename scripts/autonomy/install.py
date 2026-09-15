"""Установка проверенной версии вне удаляемого worktree; секреты не копируются."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys


def install(repo, config_path):
    repo = Path(repo).resolve()
    common = subprocess.check_output(["git", "rev-parse", "--path-format=absolute", "--git-common-dir"], cwd=repo, text=True).strip()
    root = Path(common) / "autonomy-runtime"
    source = Path(__file__).resolve().parent
    files = sorted(p for p in source.iterdir() if p.suffix in (".py", ".mjs") and not p.name.startswith("test_") and ".test." not in p.name)
    docs = source.parent.parent / "docs" / "multica"
    policies = sorted([docs / name for name in ("autonomy-controller.md", "autonomy-cleanup.md", "daily-audit.md")] + list((docs / "autonomy").glob("*-prompt.md")) + [docs / "autonomy" / "claude-settings.json"])
    digest = hashlib.sha256(b"".join(p.name.encode() + p.read_bytes() for p in files + policies)).hexdigest()[:16]
    release = root / "releases" / digest
    release.mkdir(parents=True, exist_ok=True)
    for file in files:
        shutil.copy2(file, release / file.name)
    (release / "contracts").mkdir(exist_ok=True)
    for file in policies:
        shutil.copy2(file, release / "contracts" / file.name)
    config = json.loads(Path(config_path).read_text())
    state = Path(config["state_dir"])
    state.mkdir(parents=True, exist_ok=True)
    installed_config = state / "config.json"
    if installed_config.exists():
        # Read/merge only public settings; preserve IDs recorded after setup.
        current = json.loads(installed_config.read_text())
        config.update(current)
    config["instructions_version"] = digest
    config["daily_instructions_version"] = digest
    installed_config.write_text(json.dumps(config, indent=2) + "\n")
    installed_config.chmod(0o600)
    candidate = root / "next"
    if candidate.is_symlink():
        candidate.unlink()
    candidate.symlink_to(release, target_is_directory=True)
    os.replace(candidate, root / "current")
    for name, module in (("controller-runtime", "runtime_bridge.py"), ("daily-runtime", "daily_runtime.py")):
        wrapper = root / name
        wrapper.write_text("#!" + sys.executable + "\nimport os, sys\nos.environ['ALTERA_AUTONOMY_CONFIG'] = " + repr(str(installed_config)) + "\nos.execv(sys.executable, [sys.executable, " + repr(str(root / "current" / module)) + ", *sys.argv[1:]])\n")
        wrapper.chmod(0o755)
    return {"release": digest, "executable": str(root / "controller-runtime"), "daily_executable": str(root / "daily-runtime"), "config": str(installed_config)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", required=True)
    parser.add_argument("--config", required=True)
    args = parser.parse_args()
    print(json.dumps(install(args.repo, args.config)))
