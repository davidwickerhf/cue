# cue.wicker.life

The Cue website: Next.js (App Router), deployed on Vercel.

```bash
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

## Analytics (Umami, self-hosted, cookieless)

Umami runs on the Hetzner server (Germany) at `analytics.wicker.life`. `src/app/layout.tsx` loads its
script with `data-domains="cue.wicker.life"` (nothing is counted on localhost or previews) and
`data-do-not-track="true"`. It sets no cookies and stores nothing in the browser, so no consent banner.

- **Events** (`src/lib/analytics.ts`, sent with `track()`, which queues until the deferred Umami
  script has run and does nothing without it). Umami receives them under kebab-case names
  (`download_click` becomes `download-click`):
  - `download_click` `{platform, format, version, page, location}`: every link to a release file,
    wherever it is, found by one click listener (`src/components/Analytics.tsx`). `location` is the
    nearest `data-track-location` (for example `home-hero`, `download-page-mac`, `footer`) or section id.
  - `github_click` `{target, page, location}`: links to the repository (`repo`, `releases`, `issues`,
    `source`, `license`, `other`).
  - `docs_click` `{target, page, location}`: links into the docs from outside them.
  - `agent_connect_copied` `{client, page}`, `prompt_copied` `{example, page}`: the copy buttons.
  - `command_copied` `{command, page}`: text copied by hand from an element with `data-track-copy`.
  - `changelog_viewed` `{latest_version, anchor}`.
- The site used PostHog (EU cloud) until October 2026; its history lives in that PostHog project.
  The desktop app's opt-in usage reporting still goes to PostHog (`electron/core/usage.ts`).
- What the site and the app measure is described for visitors on `/privacy`. Keep it in step.

## Download counts

`GET /api/downloads` returns the GitHub release download counts per platform as JSON, rebuilt at
most once an hour: `installs` (dmg, exe, AppImage, deb) and `zips` (the Mac zips, which are mostly
the updater), in total and per release. The updater downloads the Windows installer and the AppImage
itself, so those "installs" include updates. Set `GITHUB_TOKEN` to raise GitHub's rate limit (optional).

```bash
curl -s https://cue.wicker.life/api/downloads | jq .totals
```
