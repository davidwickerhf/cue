"use client";

import { useEffect } from "react";
import { classifyDownload, githubTarget, onPostHog, POSTHOG_KEY, track } from "@/lib/analytics";
import { REPO } from "@/lib/site";

/**
 * Where on the page a link is: the nearest `data-track-location` (a button or area named in
 * the markup), else the nearest section's id, else "page".
 */
function locationOf(el: Element): string {
  const named = el.closest("[data-track-location]")?.getAttribute("data-track-location");
  if (named) return named;
  const section = el.closest("section[id], article[id], header, footer, nav");
  if (!section) return "page";
  return section.id || section.tagName.toLowerCase();
}

/**
 * One listener for every link on the site: downloads (the release files in lib/site.ts,
 * wherever they appear) become download_click and repository links github_click. Copying text
 * from an element marked `data-track-copy` becomes command_copied. Mounted once in the layout;
 * without PostHog it adds no listeners.
 */
export function LinkTracking({ version }: { version: string }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const onClick = (event: MouseEvent) => {
      // Primary and middle clicks (opening in a new tab counts too).
      if (event.button !== 0 && event.button !== 1) return;
      const link = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link) return;
      const href = link.href;
      const page = window.location.pathname;
      const location = locationOf(link);
      const download = classifyDownload(href);
      if (download) {
        track("download_click", { ...download, version, page, location });
        return;
      }
      const target = githubTarget(href, REPO);
      if (target) track("github_click", { target, page, location });
    };
    const onCopy = () => {
      const node = document.getSelection()?.anchorNode;
      const el = node instanceof Element ? node : node?.parentElement;
      const command = el?.closest("[data-track-copy]")?.getAttribute("data-track-copy");
      if (command) track("command_copied", { command, page: window.location.pathname });
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("auxclick", onClick, true);
    document.addEventListener("copy", onCopy, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("auxclick", onClick, true);
      document.removeEventListener("copy", onCopy, true);
    };
  }, [version]);
  return null;
}

/** Sends changelog_viewed once when the changelog opens (with the version linked to, if any). */
export function ChangelogViewed({ latest }: { latest: string }) {
  useEffect(() => {
    if (!POSTHOG_KEY) return;
    const anchor = window.location.hash.replace(/^#/, "") || undefined;
    // posthog-js loads asynchronously; wait for it so the event isn't dropped.
    return onPostHog(() => track("changelog_viewed", { latest_version: latest, ...(anchor ? { anchor } : {}) }));
  }, [latest]);
  return null;
}
