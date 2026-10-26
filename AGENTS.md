# Agent notes for Cue

Cue is a monorepo: the Electron desktop app (`src/`, `electron/`, `native/`), its MCP server (`mcp/`) and the website (`site/`, Next.js). Only the website is hosted; the app ships through GitHub Releases ([docs/RELEASING.md](docs/RELEASING.md)). Before editing `site/`, read `site/AGENTS.md`.

## Hosting & infrastructure

The website (cue.wicker.life) runs on the owner's Hetzner server (`wicker-01`) under Coolify. Read [docs/HOSTING.md](docs/HOSTING.md) before touching its deploy, env vars or analytics. The system-wide source of truth is the private repo [davidwickerhf/wicker-infra](https://github.com/davidwickerhf/wicker-infra) (start with its `AGENTS.md`).

- **Merging to `main` deploys the site to production** (Coolify auto-deploy). Treat a merge as a deploy; open PRs as drafts unless asked to ship.
- **Never print, log or commit secret values.** Docs may name env vars, Keychain entries and file paths, never values.
- **No AI attribution** in commits, PR bodies or code comments (no "Generated with …", no `Co-Authored-By` for an AI).
- **Branch names describe the change** (`feature/…`, `fix/…`, `docs/…`, `chore/…`, …). Never put tool or agent names (`t3code`, `claude`, `codex`) in a branch name.
- **Browsers: headless only** (Playwright/Puppeteer). Close the browser in `finally` and stop every dev server you start.
- **Never touch MaastrichtU-BISS services** (the `citations` / `citations-api` Vercel projects and their `citations.`, `api.`, `test-api.wicker.life` records).
