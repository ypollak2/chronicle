"""Tests for the Chronicle Python wrapper."""
import os
import subprocess
import sys
from unittest.mock import patch
import pytest


def test_node_available_when_node_on_path():
    """Node must be detectable via shutil.which."""
    import shutil
    assert shutil.which("node") is not None, "Node not found — required for Chronicle"


def test_node_version_is_20_plus():
    """Node version must be >= 20."""
    result = subprocess.run(["node", "--version"], capture_output=True, text=True)
    assert result.returncode == 0
    version_str = result.stdout.strip().lstrip("v")
    major = int(version_str.split(".")[0])
    assert major >= 20, f"Node {version_str} < 20"


def test_main_exits_nonzero_without_node():
    """main() exits with code 1 when Node is not available."""
    with patch("chronicle._cli._node_available", return_value=False):
        with pytest.raises(SystemExit) as exc:
            from chronicle._cli import main
            main()
        assert exc.value.code == 1


def test_chronicle_command_uses_bundled_cli_when_present(tmp_path):
    """_chronicle_command() uses the bundled cli.js when it exists."""
    fake_cli = tmp_path / "cli.js"
    fake_cli.write_text("// fake")
    with patch("chronicle._cli._BUNDLED_CLI", str(fake_cli)):
        from chronicle._cli import _chronicle_command
        cmd = _chronicle_command()
        assert cmd == ["node", str(fake_cli)]


def test_chronicle_command_raises_when_no_bundle(tmp_path):
    """_chronicle_command() raises RuntimeError when bundled CLI is missing."""
    missing = str(tmp_path / "nonexistent.js")
    missing_src = str(tmp_path / "also_missing.ts")
    with patch("chronicle._cli._BUNDLED_CLI", missing):
        # Also patch the src fallback path check
        import chronicle._cli as mod
        orig = mod.os.path.exists
        with patch.object(mod.os.path, "exists", side_effect=lambda p: False):
            with pytest.raises(RuntimeError, match="Re-install"):
                mod._chronicle_command()


def test_package_version_defined():
    """Package version must be defined."""
    import chronicle
    assert hasattr(chronicle, "__version__")
    assert isinstance(chronicle.__version__, str)
    assert len(chronicle.__version__) > 0
