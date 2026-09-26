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
	{ kind: "paper-tear", label: "Paper tear" },
	{ kind: "signal-glitch", label: "No signal" },
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

/** The procedural edge is shared by the preview and FFmpeg export. */
export function transitionEdge(
	kind: "paper-tear" | "signal-glitch",
	progress: number,
	row: number,
	tick = 0,
): number {
	const p = Math.max(0, Math.min(1, progress));
	if (kind === "paper-tear")
		return p + 0.015 * Math.sin(row * 37.7) + 0.009 * Math.sin(row * 100.5 + 1.2);
	const band = Math.floor(row * 16);
	return p + 0.13 * Math.sin(band * 13.2 + tick * 2.3);
}

/** A ragged reveal edge, bounded by the clip's own crop. */
export function transitionClipPath(
	kind: "paper-tear" | "signal-glitch",
	progress: number,
	crop: { left: number; top: number; right: number; bottom: number },
	tick = 0,
): string {
	const top = crop.top;
	const bottom = 1 - crop.bottom;
	const edge = (row: number) =>
		Math.max(crop.left, Math.min(1 - crop.right, transitionEdge(kind, progress, row, tick)));
	const rows = kind === "paper-tear" ? 48 : 32;
	const points = [`${crop.left * 100}% ${top * 100}%`];
	for (let i = 0; i <= rows; i++) {
		const row = top + ((bottom - top) * i) / rows;
		points.push(`${(edge(row) * 100).toFixed(2)}% ${(row * 100).toFixed(2)}%`);
	}
	points.push(`${crop.left * 100}% ${bottom * 100}%`);
	return `polygon(${points.join(",")})`;
}
