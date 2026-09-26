import type { Asset, MediaClip, Transform } from "./types";

/**
 * Screen layouts for several pictures at once: side by side, stacked, a grid,
 * or picture in picture. Each picture fills its area (centre-cropped), the way
 * split screens are usually made.
 */
export const LAYOUTS = {
	full: { label: "Full frame", slots: 1 },
	"side-by-side": { label: "Side by side", slots: 2 },
	"top-bottom": { label: "Top and bottom", slots: 2 },
	thirds: { label: "Three across", slots: 3 },
	grid: { label: "Grid of four", slots: 4 },
	"pip-br": { label: "Picture in picture, bottom right", slots: 2 },
	"pip-bl": { label: "Picture in picture, bottom left", slots: 2 },
	"pip-tr": { label: "Picture in picture, top right", slots: 2 },
	"pip-tl": { label: "Picture in picture, top left", slots: 2 },
} as const;
export type LayoutKind = keyof typeof LAYOUTS;

/** An area of the frame, as shares: left, top, width, height. */
type Area = [number, number, number, number];

function areas(layout: LayoutKind): Area[] {
	switch (layout) {
		case "side-by-side":
			return [
				[0, 0, 0.5, 1],
				[0.5, 0, 0.5, 1],
			];
		case "top-bottom":
			return [
				[0, 0, 1, 0.5],
				[0, 0.5, 1, 0.5],
			];
		case "thirds":
			return [0, 1, 2].map((i) => [i / 3, 0, 1 / 3, 1] as Area);
		case "grid":
			return [
				[0, 0, 0.5, 0.5],
				[0.5, 0, 0.5, 0.5],
				[0, 0.5, 0.5, 0.5],
				[0.5, 0.5, 0.5, 0.5],
			];
		default:
			return [[0, 0, 1, 1]];
	}
}

/** Size and margin of the small picture, as shares of the frame's width. */
const PIP_SIZE = 0.3;
const PIP_MARGIN = 0.035;

/**
 * Transforms that put each clip in its place, in the order given (for picture
 * in picture: the first fills the frame, the second is the small one).
 */
export function layoutTransforms(
	layout: LayoutKind,
	clips: { clip: MediaClip; asset: Asset | undefined }[],
	canvas: { width: number; height: number },
): { id: string; transform: Partial<Transform> }[] {
	const W = canvas.width;
	const H = canvas.height;
	const none = { left: 0, top: 0, right: 0, bottom: 0 };
	const fill = (clip: MediaClip, asset: Asset | undefined, [l, t, w, h]: Area) => {
		const ar = asset?.width && asset.height ? asset.width / asset.height : W / H;
		// The picture's size at scale 1 (fitted into the frame), in frame pixels.
		const fit = Math.min(W / ar, H);
		const fw = fit * ar;
		const fh = fit;
		const scale = Math.max((w * W) / fw, (h * H) / fh);
		// Crop what spills over the area, evenly on both sides.
		const cropX = Math.min(0.45, Math.max(0, (1 - (w * W) / (fw * scale)) / 2));
		const cropY = Math.min(0.45, Math.max(0, (1 - (h * H) / (fh * scale)) / 2));
		return {
			id: clip.id,
			transform: {
				scale: Math.round(scale * 1000) / 1000,
				x: l + w / 2,
				y: t + h / 2,
				crop: { left: cropX, right: cropX, top: cropY, bottom: cropY },
			},
		};
	};
	if (layout.startsWith("pip")) {
		const [bg, small] = clips.length > 1 ? clips : [undefined, clips[0]];
		const out: { id: string; transform: Partial<Transform> }[] = [];
		if (bg) out.push(fill(bg.clip, bg.asset, [0, 0, 1, 1]));
		if (small) {
			const ar =
				small.asset?.width && small.asset.height ? small.asset.width / small.asset.height : W / H;
			const fit = Math.min(W / ar, H);
			const w = PIP_SIZE;
			const scale = (w * W) / (fit * ar);
			const hShare = (fit * scale) / H;
			const mx = PIP_MARGIN;
			const my = (PIP_MARGIN * W) / H;
			const right = layout.endsWith("r");
			const bottom = layout.includes("-b");
			out.push({
				id: small.clip.id,
				transform: {
					scale: Math.round(scale * 1000) / 1000,
					x: right ? 1 - mx - w / 2 : mx + w / 2,
					y: bottom ? 1 - my - hShare / 2 : my + hShare / 2,
					crop: none,
				},
			});
		}
		return out;
	}
	return areas(layout)
		.slice(0, clips.length)
		.map((area, i) => fill(clips[i].clip, clips[i].asset, area));
}
