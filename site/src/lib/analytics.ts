/**
 * Site analytics: Umami, cookieless and self-hosted at analytics.wicker.life, loaded by a script
 * tag in app/layout.tsx and limited to cue.wicker.life by its data-domains attribute. Events go to
 * it under kebab-case names (download_click becomes download-click).
 */

export type Platform = "mac-arm" | "mac-intel" | "windows" | "linux-appimage" | "linux-deb";
export type DownloadFormat = "dmg" | "zip" | "exe" | "appimage" | "deb";

/** Every explicit event the site sends, with its properties. Umami counts pageviews on top. */
export interface SiteEvents {
  /** A link to a release file. `location` is the button or section, `page` the path it was on. */
  download_click: { platform: Platform; format: DownloadFormat; version?: string; page: string; location: string };
  /** A link to the GitHub repository (not a download). `target`: repo, releases, issues, source, license or other. */
  github_click: { target: string; page: string; location: string };
  /** A link into the docs from a page outside them. `target` is the docs path opened. */
  docs_click: { target: string; page: string; location: string };
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

type UmamiProps = Record<string, string | number | boolean | undefined>;
declare global {
  interface Window {
    umami?: { track: (event: string, props?: UmamiProps) => void };
  }
}

/** Events sent before the deferred Umami script has run. Flushed once it has, dropped after ~10 s. */
const umamiQueue: [string, UmamiProps][] = [];
let umamiTimer: ReturnType<typeof setInterval> | null = null;

function flushUmami(): boolean {
  const umami = typeof window === "undefined" ? undefined : window.umami;
  if (!umami) return false;
  for (const [name, props] of umamiQueue.splice(0)) {
    try {
      umami.track(name, props);
    } catch {}
  }
  return true;
}

function sendToUmami(event: string, properties: UmamiProps) {
  if (typeof window === "undefined") return;
  umamiQueue.push([event.replace(/_/g, "-"), properties]);
  if (flushUmami() || umamiTimer) return;
  let tries = 0;
  umamiTimer = setInterval(() => {
    if (flushUmami() || ++tries >= 20) {
      if (umamiTimer) clearInterval(umamiTimer);
      umamiTimer = null;
      umamiQueue.length = 0;
    }
  }, 500);
}

/** Sends one event to Umami. Never throws. */
export function track<E extends SiteEvent>(event: E, properties: SiteEvents[E]) {
  try {
    sendToUmami(event, properties as UmamiProps);
  } catch {}
}

/** The docs path a link opens, when it is a same-site link into /docs. */
export function docsTarget(link: HTMLAnchorElement): string | null {
  if (link.origin !== window.location.origin) return null;
  return link.pathname === "/docs" || link.pathname.startsWith("/docs/") ? link.pathname : null;
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
