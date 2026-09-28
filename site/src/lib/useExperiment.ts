"use client";

import { useEffect, useState } from "react";
import { onPostHog } from "@/lib/analytics";

/**
 * The variant of a PostHog experiment (a multivariate feature flag) for this visitor.
 *
 * - Returns `fallback` (the control) on the server, on the first render, while flags load, when
 *   they take longer than `timeoutMs`, and whenever PostHog isn't configured. Control therefore
 *   renders exactly like the page without the experiment: no layout shift for it.
 * - Once flags arrive (in time), reads the flag with `getFeatureFlag`, which also sends the
 *   `$feature_flag_called` exposure event PostHog experiments count. Exposure is recorded only
 *   when the variant is actually shown, so a late answer after the timeout records nothing.
 * - A value that is not in `variants` (a flag that was changed or stopped) falls back too.
 *
 * Example:
 *   const cta = useExperiment("download-cta-copy", ["control", "free-forever"] as const, { fallback: "control" });
 */
export function useExperiment<V extends string>(
  flagKey: string,
  variants: readonly V[],
  { fallback, timeoutMs = 1500 }: { fallback: V; timeoutMs?: number },
): V {
  const [variant, setVariant] = useState<V>(fallback);
  // Compared by value so an inline array doesn't re-run the effect every render.
  const variantList = variants.join("\u0000");
  useEffect(() => {
    let settled = false;
    let stopFlags: (() => void) | undefined;
    const timer = setTimeout(() => {
      settled = true;
      stopFlags?.();
    }, timeoutMs);
    const stopWaiting = onPostHog((posthog) => {
      if (settled) return;
      stopFlags = posthog.onFeatureFlags(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        stopFlags?.();
        const value = posthog.getFeatureFlag(flagKey);
        const allowed = variantList.split("\u0000") as V[];
        if (typeof value === "string" && allowed.includes(value as V)) setVariant(value as V);
      });
    });
    return () => {
      settled = true;
      clearTimeout(timer);
      stopWaiting();
      stopFlags?.();
    };
  }, [flagKey, variantList, timeoutMs]);
  return variant;
}
