import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PostHog (EU cloud) through this site's own origin, so analytics requests are first-party
  // (see src/instrumentation-client.ts). The specific asset routes must come before the catch-all.
  async rewrites() {
    return [
      { source: "/ingest/static/:path*", destination: "https://eu-assets.i.posthog.com/static/:path*" },
      { source: "/ingest/array/:path*", destination: "https://eu-assets.i.posthog.com/array/:path*" },
      { source: "/ingest/:path*", destination: "https://eu.i.posthog.com/:path*" },
    ];
  },
  // PostHog's API paths end in a slash (/e/, /flags/); a redirect would drop the request body.
  skipTrailingSlashRedirect: true,
};

export default nextConfig;
