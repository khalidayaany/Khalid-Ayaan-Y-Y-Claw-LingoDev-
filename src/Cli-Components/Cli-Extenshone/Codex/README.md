# Codex OAuth (CLI-based)

This extension integrates **Codex** authentication via the installed `codex` CLI.

## Auth Flow

1. Run `/model` in this CLI.
2. Select `Codex`.
3. Select `Codex Auth`.
4. Complete `codex login` in browser/terminal.

## Notes

- Auth is read from `~/.codex/auth.json`.
- Model list is read from `~/.codex/models_cache.json`.
- Message requests are executed using `codex exec`.
