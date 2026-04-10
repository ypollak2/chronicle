"""Tests for the Chronicle Python wrapper."""
import subprocess
import sys
from unittest.mock import patch, MagicMock
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


def test_main_exits_nonzero_without_node(monkeypatch):
    """main() exits with code 1 when Node is not available."""
    from chronicle._cli import _node_available
    with patch("chronicle._cli._node_available", return_value=False):
        with pytest.raises(SystemExit) as exc:
            from chronicle._cli import main
            main()
        assert exc.value.code == 1


def test_chronicle_binary_prefers_node_global():
    """_chronicle_binary returns a list starting with a string."""
    from chronicle._cli import _chronicle_binary
    cmd = _chronicle_binary()
    assert isinstance(cmd, list)
    assert len(cmd) >= 1
    assert isinstance(cmd[0], str)


def test_chronicle_binary_fallback_is_npx():
    """Falls back to npx when no global Node binary found."""
    import shutil
    with patch("shutil.which", return_value=None):
        from importlib import reload
        import chronicle._cli as cli_module
        # Simulate npm not found → must fall back to npx
        with patch("subprocess.check_output", side_effect=Exception("no npm")):
            cmd = cli_module._chronicle_binary()
            assert cmd[0] in ("npx", "chronicle"), f"Unexpected fallback: {cmd}"


def test_package_version_defined():
    """Package version must be defined."""
    import chronicle
    assert hasattr(chronicle, "__version__")
    assert chronicle.__version__ == "0.1.0"
