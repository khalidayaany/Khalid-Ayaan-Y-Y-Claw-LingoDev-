# KHALIDAYAAN Y CLI Skills

This folder is the workspace-facing skills layer for `Khalid AI CLI`.

## What it does

- Keeps core skill-pack metadata for the CLI.
- Allows adding workspace custom skills under `Cli-Skills/custom/*.json`.
- Works with runtime auto-routing in `src/Cli-Components/Cli-Skills/`.
- Stores synced skill catalogs in `Cli-Skills/catalog-cache/`.
- Keeps installed external skills under `Cli-Skills/installed/skills`.
- Keeps agent mount folders under `Cli-Skills/installed/agent-mounts/*` (legacy root `.goose/.windsurf/...` mounts are migrated here).
- Maintains compatibility links via `.agents/skills` and `skills` to the canonical installed path.

## Runtime behavior

- Auto skill selection runs before every normal chat request.
- Selected skills are injected into the model prompt (all provider routes).
- Live activity shows skill traces, e.g. `[SKILL] selected=...`.
- Installed external skills are auto-relocated into `Cli-Skills/installed/skills` during CLI install flows.

## Core packs

- `skill-packs/agent-skills.json`: curated `Agent Skills` pack (React/Next/Web design/deploy).
- `skill-packs/openclaw-sources.json`: upstream sync sources for the Awesome OpenClaw catalog.
- `skill-packs/firecrawl-premium.json`: advanced Firecrawl-focused scraping/crawling/research presets.
- `skill-packs/premium-ai-suite.json`: premium UI/UX + Gemini + Google Stitch + Claude frontend skill presets.

## Synced catalogs

- `catalog-cache/awesome-openclaw-cache.json`: raw synced Awesome/OpenClaw catalog.
- `catalog-cache/all-cli-skills.json`: merged runtime catalog used by the CLI.

## Custom skills format

Each JSON file in `Cli-Skills/custom/` can contain one object or an array:

```json
{
  "id": "my-skill-id",
  "name": "My Skill",
  "description": "When this skill should be used.",
  "category": "custom",
  "triggers": ["keyword-a", "keyword-b"],
  "tags": ["tag-a", "tag-b"],
  "priority": 3,
  "installHint": "optional install command"
}
```
