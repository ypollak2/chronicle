# Chronicle × Claude Code Setup

Add to your project's `.claude/mcp.json`:

```json
{
  "servers": {
    "chronicle": {
      "command": "chronicle",
      "args": ["mcp"]
    }
  }
}
```

Add to `.claude/settings.json` hooks:

```json
{
  "hooks": {
    "SessionStart": "chronicle inject --format=markdown 2>/dev/null || true",
    "Stop": "chronicle capture --from-commit HEAD 2>/dev/null || true"
  }
}
```

Chronicle tools available to Claude Code:
- `chronicle_get_context` — auto-called on session start
- `chronicle_log_decision` — call when making architectural choices
- `chronicle_log_rejection` — call when abandoning an approach
- `chronicle_get_risks` — call before touching high-blast-radius files
- `chronicle_save_session` — auto-called on session end
