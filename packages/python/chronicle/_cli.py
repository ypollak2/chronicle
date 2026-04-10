"""
Subprocess wrapper — delegates all work to the bundled Node CLI (cli.js).
The built JS is shipped inside this Python package; only Node ≥ 20 is required.
No npm installation needed.
"""
import os
import shutil
import subprocess
import sys

# Bundled JS lives next to this file in _dist/cli.js (added at build time)
_DIST_DIR = os.path.join(os.path.dirname(__file__), '_dist')
_BUNDLED_CLI = os.path.join(_DIST_DIR, 'cli.js')


def _node_available() -> bool:
    node = shutil.which("node")
    if not node:
        return False
    try:
        out = subprocess.check_output(["node", "--version"], text=True).strip()
        major = int(out.lstrip("v").split(".")[0])
        return major >= 20
    except Exception:
        return False


def _chronicle_command() -> list[str]:
    """Return the command that invokes the Chronicle CLI."""
    if os.path.exists(_BUNDLED_CLI):
        return ["node", _BUNDLED_CLI]
    # Development fallback: run from source via tsx
    src = os.path.join(os.path.dirname(__file__), '..', '..', 'cli', 'src', 'cli.ts')
    if os.path.exists(src):
        return ["npx", "tsx", src]
    raise RuntimeError(
        "Chronicle CLI not found. Re-install the package: pip install --force-reinstall chronicle-dev"
    )


def main() -> None:
    if not _node_available():
        print(
            "Chronicle requires Node.js ≥ 20.\n"
            "Install it from https://nodejs.org or via `brew install node`.",
            file=sys.stderr,
        )
        sys.exit(1)

    try:
        cmd = _chronicle_command() + sys.argv[1:]
    except RuntimeError as e:
        print(str(e), file=sys.stderr)
        sys.exit(1)

    result = subprocess.run(cmd)
    sys.exit(result.returncode)
