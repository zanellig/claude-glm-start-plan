"""Stage an already-built, lockfile-installed ZCode CLI without re-resolving packages.

Usage: python3 scripts/stage-zcode-runtime.py SOURCE_CHECKOUT NEW_RUNTIME_DIRECTORY
The destination must not exist. No package-manager or package lifecycle code runs.
"""

import json
import os
import pathlib
import shutil
import sys

root, output = (pathlib.Path(value).expanduser().resolve() for value in sys.argv[1:3])
if output.exists():
    raise SystemExit("Destination already exists; choose a new staging directory.")
output.mkdir(parents=True)
seen = set()
missing = []


def locate(name, start):
    directory = start
    while directory == root or root in directory.parents:
        candidate = directory / "node_modules" / name
        if (candidate / "package.json").is_file():
            return candidate
        directory = directory.parent
    return None


def copy_package(path):
    key = str(path.relative_to(root))
    if key in seen:
        return
    seen.add(key)
    real = path.resolve()
    if real != root and root not in real.parents:
        raise RuntimeError("Dependency resolves outside the source checkout")
    package = json.loads((path / "package.json").read_text())
    destination = output / path.relative_to(root)
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        path, destination, ignore=shutil.ignore_patterns("node_modules", "*.map")
    )
    for optional, dependencies in (
        (False, package.get("dependencies", {})),
        (True, package.get("optionalDependencies", {})),
    ):
        for name in dependencies:
            if name.startswith("@zcode/"):
                continue
            found = locate(name, real)
            if found is None:
                if not optional:
                    missing.append((key, name))
            else:
                copy_package(found)


cli = root / "apps/zcode-cli/packages/cli/dist"
tui = root / "apps/zcode-cli/packages/tui"
cli_output = output / cli.relative_to(root)
cli_output.parent.mkdir(parents=True, exist_ok=True)
shutil.copytree(cli, cli_output, ignore=shutil.ignore_patterns("*.map"))
tui_output = output / tui.relative_to(root)
tui_output.mkdir(parents=True)
shutil.copy2(tui / "package.json", tui_output / "package.json")
shutil.copytree(
    tui / "dist", tui_output / "dist", ignore=shutil.ignore_patterns("*.map")
)
manifest = json.loads((tui / "package.json").read_text())
for name in list(manifest["dependencies"]) + ["playwright-core", "koffi"]:
    if name.startswith("@zcode/"):
        continue
    found = locate(
        name, tui if name not in ("playwright-core", "koffi") else cli.parent
    )
    if found is None:
        missing.append(("entrypoint", name))
    else:
        copy_package(found)
link = output / "node_modules/@zcode/tui"
link.parent.mkdir(parents=True, exist_ok=True)
link.symlink_to(os.path.relpath(tui_output, link.parent), target_is_directory=True)
shutil.copy2(root / "LICENSE", output / "LICENSE")
print(f"Staged {len(seen)} packages; missing required dependencies: {missing}")
if missing:
    raise SystemExit(1)
