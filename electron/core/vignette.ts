import type { Effects } from "./types";

/**
 * Vignette maths shared by the preview (browser) and the exporter (an ffmpeg
 * mask), so both darken the same pixels. No Node imports here.
 *
 * The darkening rises in a straight line from `start` to `end` along a distance
 * that is 0 at the centre and 1 in the corners. Without midpoint, roundness and
 * feather (or at their defaults) this is the original vignette exactly: an
 * ellipse with the frame's proportions, starting at 70 − 45 × amount percent.
 */

export const VIGNETTE_DEFAULTS = { midpoint: 0.5, roundness: 0, feather: 0.5 };

type VignetteEffects = Pick<
	Effects,
	"vignette" | "vignetteMidpoint" | "vignetteRoundness" | "vignetteFeather"
>;

/** Whether only the amount is set, so the vignette looks as it always has. */
export function isClassicVignette(e: VignetteEffects): boolean {
	return (
		(e.vignetteMidpoint ?? VIGNETTE_DEFAULTS.midpoint) === VIGNETTE_DEFAULTS.midpoint &&
		(e.vignetteRoundness ?? VIGNETTE_DEFAULTS.roundness) === VIGNETTE_DEFAULTS.roundness &&
		(e.vignetteFeather ?? VIGNETTE_DEFAULTS.feather) === VIGNETTE_DEFAULTS.feather
	);
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Where the darkening starts and ends (as a distance), and how dark the corners get. */
export function vignetteRamp(e: VignetteEffects): { start: number; end: number; dark: number } {
	const amount = e.vignette;
	const midpoint = e.vignetteMidpoint ?? VIGNETTE_DEFAULTS.midpoint;
	const feather = e.vignetteFeather ?? VIGNETTE_DEFAULTS.feather;
	// Midpoint moves where it starts by up to 0.4 either way.
	const inner = Math.min(
		0.98,
		Math.max(0, Math.round(70 - amount * 45) / 100 + (midpoint - 0.5) * 0.8),
	);
	// Feather widens or narrows the ramp around its middle; 0 is a hard edge.
	const spread = (1 - inner) * (0.5 - feather);
	return { start: round4(inner + spread), end: round4(1 - spread), dark: 0.35 + amount * 0.55 };
}

/**
 * The shape of the distance for a frame `width` × `height`: the vertical
 * radius (the horizontal one is width / 2), the exponent of the norm and the
 * distance of a corner before scaling it to 1. Roundness above 0 makes the
 * ellipse a circle, below 0 squares it towards the frame's rectangle.
 */
function vignetteMetric(roundness: number, width: number, height: number) {
	const t = Math.max(0, roundness);
	const ry = height / 2 + (width / 2 - height / 2) * t;
	const p = 2 / (1 + Math.min(0, roundness) * 0.95);
	const corner = (1 + (height / 2 / ry) ** p) ** (1 / p);
	return { ry, p, corner };
}

/** How dark (0–1) the vignette makes the point `x`, `y` of a `width` × `height` picture. */
export function vignetteAlpha(
	e: VignetteEffects,
	x: number,
	y: number,
	width: number,
	height: number,
): number {
	const { start, end, dark } = vignetteRamp(e);
	const { ry, p, corner } = vignetteMetric(e.vignetteRoundness ?? 0, width, height);
	const u = Math.abs((x - width / 2) / (width / 2));
	const v = Math.abs((y - height / 2) / ry);
	const d = (u ** p + v ** p) ** (1 / p) / corner;
	return dark * Math.min(1, Math.max(0, (d - start) / Math.max(0.002, end - start)));
}

/** The vignette's alpha (0–255) as an ffmpeg geq expression over X, Y, W and H. */
export function vignetteGeq(e: VignetteEffects, width: number, height: number): string {
	const { start, end, dark } = vignetteRamp(e);
	const roundness = e.vignetteRoundness ?? 0;
	let d = "sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))/sqrt(2)";
	if (roundness !== 0) {
		const { ry, p, corner } = vignetteMetric(roundness, width, height);
		const n = (v: number) => v.toFixed(6);
		d =
			`pow(pow(abs((X-W/2)/(W/2)),${n(p)})+pow(abs((Y-H/2)/${n(ry)}),${n(p)}),${n(1 / p)})` +
			`/${n(corner)}`;
	}
	return `255*${dark.toFixed(4)}*clip((${d}-${start})/${Math.max(0.002, end - start).toFixed(4)},0,1)`;
}
