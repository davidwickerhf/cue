import type { Transition } from "./types";

/**
 * Transitions into a clip from the one before it on the same track. All but
 * "dip" overlap the two clips: the incoming clip is drawn on top and enters
 * over the outgoing one (its sound crossfades). Shared by the editor, the
 * preview and the exporter. No Node imports here.
 */
export const TRANSITIONS = [
	{ kind: "crossfade", label: "Crossfade" },
	{ kind: "dip", label: "Dip to black" },
	{ kind: "wipe-left", label: "Wipe left" },
	{ kind: "wipe-right", label: "Wipe right" },
	{ kind: "slide-left", label: "Slide in from right" },
	{ kind: "slide-right", label: "Slide in from left" },
	{ kind: "zoom", label: "Zoom in" },
	{ kind: "blur", label: "Blur" },
] as const;

export type TransitionKind = (typeof TRANSITIONS)[number]["kind"];
export const TRANSITION_KINDS = TRANSITIONS.map((t) => t.kind) as [
	TransitionKind,
	...TransitionKind[],
];

export const transitionLabel = (kind: string) =>
	TRANSITIONS.find((t) => t.kind === kind)?.label ?? kind;

/** The clips overlap for the length of the transition (everything but a dip). */
export const overlaps = (t: Transition | undefined) => !!t && t.kind !== "dip";

/** The incoming picture fades in as it enters. */
export const fadesIn = (t: Transition | undefined) =>
	!!t && (t.kind === "crossfade" || t.kind === "zoom" || t.kind === "blur");

/** How much the incoming clip has entered at clip-local `ms`, eased, 0–1. */
export function entered(t: Transition | undefined, ms: number): number {
	if (!t || !overlaps(t) || ms >= t.durationMs) return 1;
	const p = Math.max(0, ms / Math.max(1, t.durationMs));
	return p * p * (3 - 2 * p);
}

/** Zoom transition: the picture starts this much larger and settles to its size. */
export const ZOOM_FROM = 0.18;
/** Blur transition: the strongest blur, in pixels of a 1080-line picture. */
export const BLUR_FROM = 28;
