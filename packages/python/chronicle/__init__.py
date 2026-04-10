"""
Chronicle — AI-native development memory.

This package is a thin wrapper around the Node.js chronicle-dev CLI.
For the full API, use the CLI directly or via subprocess.

Example:
    import subprocess
    result = subprocess.run(["chronicle", "inject"], capture_output=True, text=True)
    context = result.stdout
"""
__version__ = "0.5.0"
