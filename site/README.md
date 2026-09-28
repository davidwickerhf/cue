# cue.wicker.life

The Cue website: Next.js (App Router), deployed on Vercel.

```bash
npm run dev     # http://localhost:3000
npm run build
npm run lint
```

## Analytics (PostHog, EU, cookieless)

Set `NEXT_PUBLIC_POSTHOG_KEY` (the PostHog project token, `phc_…`) in the Vercel project. Without it
nothing loads and nothing is sent: `posthog-js` is only downloaded when the key was set at build time.

- **Setup**: `src/instrumentation-client.ts` starts PostHog before the site is interactive, with
  `cookieless_mode: "always"` (no cookies, no local or session storage, so no consent banner),
  `person_profiles: "never"`, pageviews on navigation, autocaptured clicks, no session replay or
  surveys, and Do Not Track respected. The site never calls `identify` or `alias`.
- **Proxy**: requests go to `/ingest/*` on this site and `next.config.ts` rewrites them to PostHog's
  EU cloud (`eu.i.posthog.com`, assets from `eu-assets.i.posthog.com`), so they are first-party.
- **PostHog project settings**: EU region; Settings → Web analytics → enable **Cookieless server
  hash mode** (without it PostHog drops every cookieless event); add `https://cue.wicker.life` to the
  authorized URLs.
- **Events** (`src/lib/analytics.ts`, sent with `track()`, which does nothing without PostHog):
  - `download_click` `{platform, format, version, page, location}`: every link to a release file,
    wherever it is, found by one click listener (`src/components/Analytics.tsx`). `location` is the
    nearest `data-track-location` (for example `home-hero`, `download-page-mac`, `footer`) or section id.
  - `github_click` `{target, page, location}`: links to the repository (`repo`, `releases`, `issues`,
    `source`, `license`, `other`).
  - `agent_connect_copied` `{client, page}`, `prompt_copied` `{example, page}`: the copy buttons.
  - `command_copied` `{command, page}`: text copied by hand from an element with `data-track-copy`.
  - `changelog_viewed` `{latest_version, anchor}`.
- What the site and the app measure is described for visitors on `/privacy`. Keep it in step.

## Download counts

`GET /api/downloads` returns the GitHub release download counts per platform as JSON, rebuilt at
most once an hour: `installs` (dmg, exe, AppImage, deb) and `zips` (the Mac zips, which are mostly
the updater), in total and per release. The updater downloads the Windows installer and the AppImage
itself, so those "installs" include updates. Set `GITHUB_TOKEN` to raise GitHub's rate limit (optional).

```bash
curl -s https://cue.wicker.life/api/downloads | jq .totals
```

## A/B tests (PostHog experiments)

`useExperiment(flagKey, variants, { fallback, timeoutMs })` in `src/lib/useExperiment.ts` returns
the visitor's variant. It returns `fallback` (the control) on the server, on the first render, while
flags load, after `timeoutMs` (default 1.5 s) and whenever PostHog isn't configured, so the control
renders exactly like the page without an experiment and never shifts. When the flag arrives in time it
reads it with `getFeatureFlag`, which sends the `$feature_flag_called` exposure event experiments
count; a variant it doesn't know falls back to the control.

1. In PostHog: Experiments → New experiment. Pick a feature flag key (e.g. `download-cta-copy`),
   keep the `control` variant and add others (e.g. `free-forever`). Choose the goal metric, for
   example the `download_click` event.
2. In a client component:

   ```tsx
   "use client";
   import { useExperiment } from "@/lib/useExperiment";

   export function DownloadHeadline() {
     const variant = useExperiment("download-cta-copy", ["control", "free-forever"] as const, { fallback: "control" });
     return <h2>{variant === "free-forever" ? "Free forever. Download Cue" : "Download Cue"}</h2>;
   }
   ```

3. Launch the experiment in PostHog, and remove the losing branch from the code when it ends.

Keep variants the same size as the control (same number of lines, same elements) so a late switch
doesn't move the page.

**Cookieless mode and assignment.** With `cookieless_mode: "always"` posthog-js stores no id: it
sends the placeholder distinct id `$posthog_cookieless`, and PostHog's servers replace it (for
events and, in the `/flags` service, for flag evaluation) with a hash of the project, the day's salt,
the visitor's IP address, user agent and the site's host. So a visitor keeps the same variant for the
rest of the day on the same network and browser, but can be re-assigned on another day, after
changing network, or in another browser, and visitors sharing an IP address and browser version
count as one. Flag values are also not cached between page loads, which is why the hook falls back
after a short timeout. Treat results as per visitor-day; prefer goals measured within the same visit
(such as a download click) over ones that happen days later.
