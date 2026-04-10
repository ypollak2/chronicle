"""
Subprocess wrapper — delegates all work to the Node binary (chronicle-dev).
Requires Node ≥ 20 on PATH. The Node package is the source of truth.
"""
import shutil
import subprocess
import sys


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


def _chronicle_binary() -> list[str]:
    """Return the command list that invokes the Node chronicle CLI.

    Never calls 'chronicle' directly — that would call this Python wrapper
    recursively. Always delegates to the Node package via npm/npx.
    """
    # If the user has `npm install -g chronicle-dev`, the Node binary lands
    # at a path like /usr/local/bin/chronicle — but so does this Python script.
    # We disambiguate by checking for the npm global bin explicitly.
    npm = shutil.which("npm")
    if npm:
        try:
            prefix = subprocess.check_output(
                [npm, "root", "-g"], text=True, stderr=subprocess.DEVNULL
            ).strip()
            # npm global bin is one level up from global node_modules
            import os
            global_bin = os.path.join(os.path.dirname(prefix), "bin", "chronicle")
            # Only use it if it's a Node script (not this Python script)
            if os.path.exists(global_bin):
                with open(global_bin) as f:
                    first_line = f.readline()
                if "node" in first_line and "python" not in first_line:
                    return [global_bin]
        except Exception:
            pass

    # Fallback: npx installs on-demand from npm registry
    return ["npx", "--yes", "chronicle-dev"]


def main() -> None:
    if not _node_available():
        print(
            "Chronicle requires Node.js ≥ 20.\n"
            "Install it from https://nodejs.org or via `brew install node`.",
            file=sys.stderr,
        )
        sys.exit(1)

    cmd = _chronicle_binary() + sys.argv[1:]
    result = subprocess.run(cmd)
    sys.exit(result.returncode)
