/**
 * Video models, in one table (shared with the window's Video clip tool), with
 * where each runs: fal.ai (the default, one key for everything) or Higgsfield.
 * Add a row to offer another model; a raw model id or path also works.
 */

export type ClipService = "fal" | "higgsfield";

export interface ClipRoutes {
	/** Model id (fal) or path (Higgsfield) for a start picture, and for text alone (absent: not offered). */
	imageToVideo?: string;
	textToVideo?: string;
}

export interface ClipModel {
	id: string;
	label: string;
	fal?: ClipRoutes;
	higgsfield?: ClipRoutes;
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
		fal: {
			imageToVideo: "fal-ai/kling-video/v2.5-turbo/pro/image-to-video",
			textToVideo: "fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
		},
		higgsfield: {
			imageToVideo: "/kling-video/v2.5-turbo/pro/image-to-video",
			textToVideo: "/kling-video/v2.5-turbo/pro/text-to-video",
		},
		durations: [5, 10],
		negativePrompt: true,
	},
	{
		id: "kling-2.5-turbo-standard",
		label: "Kling 2.5 Turbo Standard",
		fal: { imageToVideo: "fal-ai/kling-video/v2.5-turbo/standard/image-to-video" },
		higgsfield: { imageToVideo: "/kling-video/v2.5-turbo/standard/image-to-video" },
		durations: [5, 10],
		negativePrompt: true,
	},
	{
		id: "hailuo-2.3",
		label: "Hailuo 2.3 Standard",
		fal: {
			imageToVideo: "fal-ai/minimax/hailuo-2.3/standard/image-to-video",
			textToVideo: "fal-ai/minimax/hailuo-2.3/standard/text-to-video",
		},
		higgsfield: {
			imageToVideo: "/minimax/hailuo-2.3/standard/image-to-video",
			textToVideo: "/minimax/hailuo-2.3/standard/text-to-video",
		},
		durations: [6, 10],
		extra: { prompt_optimizer: true },
	},
];
export const DEFAULT_CLIP_MODEL = CLIP_MODELS[0].id;

const HIGGSFIELD_PATH = /^\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;
const FAL_ID = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)+$/i;

export interface ResolvedClipModel {
	service: ClipService;
	/** fal model id or Higgsfield path. */
	path: string;
	label: string;
	durations: number[];
	negativePrompt: boolean;
	extra?: Record<string, unknown>;
}

/**
 * The service, model path and allowed lengths for a model id from the table (on
 * the preferred service, else the other one connected), a raw Higgsfield path
 * ("/kling-video/…") or a raw fal model id ("fal-ai/…").
 */
export function resolveClipModel(
	model: string | undefined,
	withImage: boolean,
	connected: { fal: boolean; higgsfield: boolean } = { fal: true, higgsfield: false },
): ResolvedClipModel {
	const id = model?.trim() || DEFAULT_CLIP_MODEL;
	if (id.startsWith("/")) {
		if (!HIGGSFIELD_PATH.test(id)) throw new Error(`Not a Higgsfield model path: ${id}`);
		return raw("higgsfield", id);
	}
	const found = CLIP_MODELS.find((m) => m.id === id);
	if (!found) {
		if (FAL_ID.test(id) && !id.includes("..")) return raw("fal", id);
		throw new Error(
			`Unknown video model "${id}". Use one of ${CLIP_MODELS.map((m) => m.id).join(", ")}, a fal model id such as fal-ai/kling-video/v2.5-turbo/pro/image-to-video, or a Higgsfield path.`,
		);
	}
	const services: ClipService[] =
		!connected.fal && connected.higgsfield ? ["higgsfield", "fal"] : ["fal", "higgsfield"];
	for (const service of services) {
		const route = found[service]?.[withImage ? "imageToVideo" : "textToVideo"];
		if (route)
			return {
				service,
				path: route,
				label: found.label,
				durations: found.durations,
				negativePrompt: !!found.negativePrompt,
				extra: found.extra,
			};
	}
	throw new Error(
		withImage
			? `${found.label} needs no picture; leave the image out.`
			: `${found.label} starts from a picture: pass an image.`,
	);
}

function raw(service: ClipService, path: string): ResolvedClipModel {
	return {
		service,
		path,
		label: path.replace(/^\//, ""),
		durations: [5, 10],
		negativePrompt: true,
	};
}

/** The nearest length the model makes. */
export function snapDuration(seconds: number | undefined, allowed: number[]): number {
	if (seconds === undefined) return allowed[0];
	return allowed.reduce((best, d) => (Math.abs(d - seconds) < Math.abs(best - seconds) ? d : best));
}
