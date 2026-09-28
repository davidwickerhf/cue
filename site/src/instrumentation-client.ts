// Runs in the browser before the site becomes interactive (Next.js instrumentation-client).
// Starts PostHog only when NEXT_PUBLIC_POSTHOG_KEY was set at build time; otherwise
// posthog-js is never downloaded and nothing is sent. See src/lib/analytics.ts and /privacy.
import { POSTHOG_KEY, setPostHog } from "@/lib/analytics";

if (POSTHOG_KEY) {
  import("posthog-js")
    .then(({ default: posthog }) => {
      posthog.init(POSTHOG_KEY, {
        // Through this site (rewrites in next.config.ts) to PostHog's EU cloud.
        api_host: "/ingest",
        ui_host: "https://eu.posthog.com",
        defaults: "2026-08-30",
        // No cookies, localStorage or sessionStorage: PostHog counts visitors with a hash it
        // computes on its servers (daily salt), so no consent banner is needed.
        // Requires "Cookieless server hash mode" in the PostHog project (Settings → Web analytics).
        cookieless_mode: "always",
        // Anonymous only: no person profiles (and the site never calls identify or alias).
        person_profiles: "never",
        // Pageviews on client-side navigation (history changes) and clicks.
        capture_pageview: "history_change",
        autocapture: true,
        disable_session_recording: true,
        disable_surveys: true,
        respect_dnt: true,
      });
      setPostHog(posthog);
    })
    .catch(() => {});
}
