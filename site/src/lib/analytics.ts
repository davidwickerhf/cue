import type { PostHog } from "posthog-js";

/**
 * Site analytics (PostHog, EU cloud, cookieless). Everything here is a no-op until
 * NEXT_PUBLIC_POSTHOG_KEY is set at build time and posthog-js has loaded
 * (src/instrumentation-client.ts). Without the key, posthog-js is never even downloaded.
 */
export const POSTHOG_KEY = process.env.NEXT_PUBLIC_POSTHOG_KEY ?? "";

export type Platform = "mac-arm" | "mac-intel" | "windows" | "linux-appimage" | "linux-deb";
export type DownloadFormat = "dmg" | "zip" | "exe" | "appimage" | "deb";

/** Every explicit event the site sends, with its properties. Autocaptured pageviews and clicks come on top. */
export interface SiteEvents {
  /** A link to a release file. `location` is the button or section, `page` the path it was on. */
  download_click: { platform: Platform; format: DownloadFormat; version?: string; page: string; location: string };
  /** A link to the GitHub repository (not a download). `target`: repo, releases, issues, source, license or other. */
  github_click: { target: string; page: string; location: string };
  /** The command or config that connects an agent (Claude Code, Codex, ...) to Cue was copied. */
  agent_connect_copied: { client: string; page: string };
  /** An example's full prompt was copied. */
  prompt_copied: { example: string; page: string };
  /** Text inside a marked command box was copied by hand (e.g. the MCP command on a use-case page). */
  command_copied: { command: string; page: string };
  /** The changelog was opened. `anchor` is the version linked to, if any. */
  changelog_viewed: { latest_version: string; anchor?: string };
}
export type SiteEvent = keyof SiteEvents;

let client: PostHog | null = null;
const waiting = new Set<(posthog: PostHog) => void>();

/** Called once posthog-js has been initialised. */
export function setPostHog(posthog: PostHog) {
  client = posthog;
  for (const cb of waiting) cb(posthog);
  waiting.clear();
}

/** The PostHog client, or null when analytics is off (no key) or not loaded yet. */
export function getPostHog(): PostHog | null {
  return client;
}

/** Runs `cb` with the client once it is available. Never runs without a key. Returns an unsubscribe. */
export function onPostHog(cb: (posthog: PostHog) => void): () => void {
  if (client) {
    cb(client);
    return () => {};
  }
  if (!POSTHOG_KEY) return () => {};
  waiting.add(cb);
  return () => waiting.delete(cb);
}

/** Sends one event. Does nothing without PostHog, and never throws. */
export function track<E extends SiteEvent>(event: E, properties: SiteEvents[E]) {
  try {
    client?.capture(event, properties);
  } catch {}
}

/** Which build a release URL points at, from its file name (see DOWNLOADS in lib/site.ts). */
export function classifyDownload(href: string): { platform: Platform; format: DownloadFormat } | null {
  const file = /\/releases\/(?:latest\/download|download\/[^/]+)\/(Cue-[^/?#]+)/.exec(href)?.[1];
  if (!file) return null;
  if (/^Cue-mac-arm64\.(dmg|zip)$/.test(file)) return { platform: "mac-arm", format: file.endsWith(".dmg") ? "dmg" : "zip" };
  if (/^Cue-mac-x64\.(dmg|zip)$/.test(file)) return { platform: "mac-intel", format: file.endsWith(".dmg") ? "dmg" : "zip" };
  if (/^Cue-win-.*\.exe$/.test(file)) return { platform: "windows", format: "exe" };
  if (/\.AppImage$/.test(file)) return { platform: "linux-appimage", format: "appimage" };
  if (/\.deb$/.test(file)) return { platform: "linux-deb", format: "deb" };
  return null;
}

/** What part of the repository a GitHub link opens. */
export function githubTarget(href: string, repo: string): string | null {
  if (href !== repo && !href.startsWith(`${repo}/`) && !href.startsWith(`${repo}#`)) return null;
  const rest = href.slice(repo.length).replace(/^\//, "");
  if (!rest || rest.startsWith("#")) return "repo";
  if (rest.startsWith("releases")) return "releases";
  if (rest.startsWith("issues")) return "issues";
  if (rest.includes("LICENSE")) return "license";
  if (rest.startsWith("tree/") || rest.startsWith("blob/")) return "source";
  return "other";
}
