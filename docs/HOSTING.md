# Hosting: cue.wicker.life

Last verified: 2026-10-26

This repo is a monorepo. **Only the website in [`site/`](../site) is hosted.** It runs on the owner's Hetzner server `wicker-01`, managed by Coolify. Everything else is shipped to users, not hosted:

- the Electron desktop app (`src/`, `electron/`, `native/`), released as GitHub Releases by `.github/workflows/release.yml` (see [RELEASING.md](RELEASING.md));
- the MCP server (`mcp/`), bundled into the app by `npm run build:mcp`.

The central source of truth for the whole system is the private repo [davidwickerhf/wicker-infra](https://github.com/davidwickerhf/wicker-infra). If this file and wicker-infra disagree, check the code and Coolify, then fix whichever is wrong.

## Overview

| | |
|---|---|
| Coolify app | `cue-site`, uuid `r9lijg0hnxurzdxknanw4swp` |
| Coolify project | Personal |
| Build pack | Nixpacks, base directory `/`, with custom commands: install `cd site && npm ci`, build `cd site && npm run build`, start `cd site && npm start` |
| Node version | `NIXPACKS_NODE_VERSION` (build-time env in Coolify) |
| Port | 3000 (`next start`) |
| Deploy branch | `main` (auto-deploy through the Coolify GitHub App) |
| Services | one container: Next.js 16 (App Router) server, mostly static pages plus `GET /api/downloads` |
| Domains | https://cue.wicker.life, https://cue.c.wicker.life (preview/debug hostname) |
| Umami website id | `28e87729-30be-499a-bf63-07835c1ffaed` |

## Deploy and rollback

- **Merging to `main` deploys the site to production**, including merges that only touch the desktop app (Coolify rebuilds on every push to `main`; a rebuild with no site changes is harmless). Open PRs as drafts unless the owner asked you to ship.
- Manual deploy (no new commit): `scripts/capi.sh POST "/deploy?uuid=r9lijg0hnxurzdxknanw4swp" '{}'` from wicker-infra. Restart: `scripts/capi.sh POST /applications/r9lijg0hnxurzdxknanw4swp/restart '{}'`.
- **Roll back:** Coolify → cue-site → Deployments → redeploy an earlier successful deployment, or `git revert` on `main`.
- Desktop releases are separate: tag-driven GitHub Actions, not Coolify.

See [runbooks/deploy.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/runbooks/deploy.md).

## Database

n/a. The site has no database.

## Storage

n/a. Site images and videos are committed under `site/public/` (about 55 MB) and served by Next.js. Release binaries are GitHub Release assets. No `S3_*` vars.

## Auth

n/a. The site has no accounts.

## Mail

n/a. The site sends no email.

## Background jobs and crons

n/a. No Coolify scheduled tasks and no worker. `/api/downloads` caches the GitHub API response for an hour (`next.revalidate`).

## Analytics

Umami, self-hosted and cookieless. `site/src/app/layout.tsx` loads `https://analytics.wicker.life/wa.js` with `data-website-id="28e87729-30be-499a-bf63-07835c1ffaed"`, `data-domains="cue.wicker.life"` and `data-do-not-track="true"`.

Events (`site/src/lib/analytics.ts`, sent via `track()`; Umami receives them kebab-cased, so `download_click` arrives as `download-click`):
- `download_click` `{platform, format, version, page, location}`
- `github_click` `{target, page, location}`
- `docs_click` `{target, page, location}`
- `agent_connect_copied` `{client, page}`
- `prompt_copied` `{example, page}`
- `command_copied` `{command, page}`
- `changelog_viewed` `{latest_version, anchor}`

The site's PostHog integration is already removed. The **desktop app** still sends opt-in usage events to PostHog EU (`electron/core/usage.ts`, key `CUE_POSTHOG_KEY` injected at release build time); that is not part of the hosted site. Keep `/privacy` in step with both.

## Environment variables

Names only. List keys without values: `scripts/capi.sh GET /applications/r9lijg0hnxurzdxknanw4swp/envs | jq -r '.[].key' | sort -u`.

**Site (Coolify)**
| Name | Required | Notes |
|---|---|---|
| `NIXPACKS_NODE_VERSION` | required (build) | Node major for the Nixpacks build |
| `GITHUB_TOKEN` | optional | raises the GitHub API rate limit for `/api/downloads`; not set in production |

The site has no `.env.example` and reads no other env vars.

**Desktop release builds (GitHub Actions secrets, not Coolify):** see `.github/workflows/release.yml` and [RELEASING.md](RELEASING.md) (Apple and Windows signing secrets, `GITHUB_TOKEN`, and the repository variable `CUE_POSTHOG_KEY`).

## External services

- GitHub API (release download counts) and GitHub Releases (downloads, desktop updater).
- Umami at analytics.wicker.life (self-hosted).
- Desktop app only: PostHog EU (opt-in usage reporting).

No Vercel, Neon, Clerk, Liveblocks or Vercel Blob.

## Credentials

Locations only, never values; see [wicker-infra/docs/credentials.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/credentials.md).
- Site runtime config: Coolify env vars on app `r9lijg0hnxurzdxknanw4swp` (no secrets today).
- Desktop release secrets: GitHub Actions secrets and variables on davidwickerhf/cue (listed in docs/RELEASING.md).
- Umami admin: Keychain `Umami analytics.wicker.life`.

## Gotchas

- Coolify builds from the repo root with `cd site && …` commands, so the root `package.json` (Electron app) is not installed for the site. Don't add root-level build steps the site depends on.
- Behind Traefik, `request.url` shows `0.0.0.0:3000`. Use `https://cue.wicker.life` or the `Host` / `x-forwarded-proto` headers for absolute URLs.
- `site/AGENTS.md` carries Next.js 16 rules (`next dev` re-adds them); read them before editing the site.

## Related wicker-infra docs

- [apps.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/apps.md), [coolify.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/coolify.md), [observability.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/observability.md), [third-party.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/third-party.md), [credentials.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/credentials.md), [gotchas.md](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/gotchas.md)
- Runbooks: [deploy](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/runbooks/deploy.md), [outage](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/runbooks/outage.md), [dns-change](https://github.com/davidwickerhf/wicker-infra/blob/main/docs/runbooks/dns-change.md)
