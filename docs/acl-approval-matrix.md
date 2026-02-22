# ACL And Approval Matrix

| Action Type | Default | Requires Phrase |
|---|---|---|
| Download (`curl`, `wget`, `git clone`) | Blocked until confirm | `allow download` |
| Install (`npm/pnpm/bun/pip/apt install`) | Blocked until confirm | `allow install` |
| Deploy (`deploy`, `vercel`, `wrangler deploy`) | Blocked until confirm | `allow deploy` |
| Workspace write (strict mode) | Blocked | `allow workspace write` (if enabled in policy) |
| Harmful commands (`rm -rf /`, `mkfs`, `dd` wipe, `curl|bash`) | Always blocked | N/A |

## Policy Modes
- `strict`: read-only workspace, all risky actions require confirmation.
- `balanced`: confirmations on download/install/deploy.
- `relaxed`: faster execution, deploy still requires confirmation.

## CLI
- View: `/policy`
- Set mode: `/policy strict|balanced|relaxed`
- Toggle engine: `/policy on|off`
- Per-target confirmation: `/policy confirm <download|install|deploy|workspace-write> <on|off>`

