/**
 * Higgsfield's video models, in one table (shared with the window's Video clip
 * tool). Add a row to offer another model; a raw model path also works.
 */

export interface ClipModel {
	id: string;
	label: string;
	/** Model paths for a start picture and for text alone (absent: that way isn't offered). */
	imageToVideo?: string;
	textToVideo?: string;
	/** Clip lengths the model makes, in seconds. */
	durations: number[];
	/** Whether it takes a negative_prompt (what to keep out of the clip). */
	negativePrompt?: boolean;
	/** Extra fields the model takes. */
	extra?: Record<string, unknown>;
}

export const CLIP_MODELS: ClipModel[] = [
	{
		id: "kling-2.5-turbo-pro",
		label: "Kling 2.5 Turbo Pro",
		imageToVideo: "/kling-video/v2.5-turbo/pro/image-to-video",
		textToVideo: "/kling-video/v2.5-turbo/pro/text-to-video",
		durations: [5, 10],
		negativePrompt: true,
	},
	{
		id: "kling-2.5-turbo-standard",
		label: "Kling 2.5 Turbo Standard",
		imageToVideo: "/kling-video/v2.5-turbo/standard/image-to-video",
		durations: [5, 10],
		negativePrompt: true,
	},
	{
		id: "hailuo-2.3",
		label: "Hailuo 2.3 Standard",
		imageToVideo: "/minimax/hailuo-2.3/standard/image-to-video",
		textToVideo: "/minimax/hailuo-2.3/standard/text-to-video",
		durations: [6, 10],
		extra: { prompt_optimizer: true },
	},
];
export const DEFAULT_CLIP_MODEL = CLIP_MODELS[0].id;

const MODEL_PATH = /^\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;

/** The model path and allowed lengths for a model id (or a raw path) and whether there's a start picture. */
export function resolveClipModel(
	model: string | undefined,
	withImage: boolean,
): {
	path: string;
	label: string;
	durations: number[];
	negativePrompt: boolean;
	extra?: Record<string, unknown>;
} {
	const id = model?.trim() || DEFAULT_CLIP_MODEL;
	if (id.startsWith("/")) {
		if (!MODEL_PATH.test(id)) throw new Error(`Not a Higgsfield model path: ${id}`);
		return { path: id, label: id.slice(1), durations: [5, 10], negativePrompt: true };
	}
	const found = CLIP_MODELS.find((m) => m.id === id);
	if (!found)
		throw new Error(
			`Unknown video model "${id}". Use one of ${CLIP_MODELS.map((m) => m.id).join(", ")}, or a Higgsfield model path such as /kling-video/v2.5-turbo/pro/image-to-video.`,
		);
	const route = withImage ? found.imageToVideo : found.textToVideo;
	if (!route)
		throw new Error(
			withImage
				? `${found.label} needs no picture; leave the image out.`
				: `${found.label} starts from a picture: pass an image.`,
		);
	return {
		path: route,
		label: found.label,
		durations: found.durations,
		negativePrompt: !!found.negativePrompt,
		extra: found.extra,
	};
}

/** The nearest length the model makes. */
export function snapDuration(seconds: number | undefined, allowed: number[]): number {
	if (seconds === undefined) return allowed[0];
	return allowed.reduce((best, d) => (Math.abs(d - seconds) < Math.abs(best - seconds) ? d : best));
}
