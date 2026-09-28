import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveClipModel, snapDuration } from "./clipModels";

/**
 * fal.ai, connected with one key: ElevenLabs voices, sound effects and music,
 * Kling and Hailuo video, and GPT Image, all through fal's queue. A request is
 * submitted, polled until it completes, and its result fetched; files it makes
 * are on fal's CDN and are downloaded straight away.
 */

export const FAL_QUEUE = "https://queue.fal.run";
export const FAL_REST = "https://rest.fal.ai";
export const FAL_API = "https://api.fal.ai";

const auth = (key: string) => ({ authorization: `Key ${key}` });

/** fal's own message: detail (a string or a list), or error.message. */
export async function falFailure(res: Response): Promise<Error> {
	let detail = res.statusText;
	try {
		const body = (await res.json()) as {
			detail?: string | { msg?: string }[];
			error?: string | { message?: string };
			message?: string;
		};
		if (typeof body.detail === "string") detail = body.detail;
		else if (Array.isArray(body.detail))
			detail = body.detail.map((d) => d.msg).join("; ") || detail;
		else if (typeof body.error === "string") detail = body.error;
		else detail = body.error?.message ?? body.message ?? detail;
	} catch {}
	return new Error(`fal ${res.status}: ${detail}`);
}

const TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

/** Uploads a local file to fal's CDN; returns the URL to pass as a model input. */
export async function falUpload(key: string, file: string): Promise<string> {
	const type = TYPES[path.extname(file).toLowerCase()] ?? "application/octet-stream";
	const bytes = await fs.readFile(file);
	const res = await fetch(`${FAL_REST}/storage/upload/initiate?storage_type=fal-cdn-v3`, {
		method: "POST",
		headers: { ...auth(key), "content-type": "application/json" },
		body: JSON.stringify({ content_type: type, file_name: path.basename(file) }),
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw await falFailure(res);
	const slot = (await res.json()) as { upload_url: string; file_url: string };
	// The upload URL is signed: no fal key on it.
	const put = await fetch(slot.upload_url, {
		method: "PUT",
		headers: { "content-type": type },
		body: new Uint8Array(bytes),
		signal: AbortSignal.timeout(120000),
	});
	if (!put.ok) throw new Error(`Uploading ${path.basename(file)} to fal failed (${put.status}).`);
	return slot.file_url;
}

export type FalState = "IN_QUEUE" | "IN_PROGRESS" | "COMPLETED";

interface QueueBody {
	status?: FalState;
	request_id?: string;
	status_url?: string;
	response_url?: string;
	queue_position?: number;
	error?: string;
	error_type?: string;
}

/** A queue URL fal returned, only if it is on fal's own queue host (the key goes with it). */
function queueUrl(url: string | undefined, fallback: string): string {
	try {
		const u = new URL(url ?? "");
		if (u.protocol === "https:" && /(^|\.)fal\.run$/.test(u.hostname)) return u.toString();
	} catch {}
	return fallback;
}

/** Submits a request to a model's queue; returns where to ask how it is going and for its result. */
export async function falSubmit(
	key: string,
	model: string,
	input: Record<string, unknown>,
): Promise<{ requestId: string; statusUrl: string; responseUrl: string }> {
	const res = await fetch(`${FAL_QUEUE}/${model}`, {
		method: "POST",
		headers: { ...auth(key), "content-type": "application/json" },
		body: JSON.stringify(input),
		signal: AbortSignal.timeout(60000),
	});
	if (!res.ok) throw await falFailure(res);
	const body = (await res.json()) as QueueBody;
	if (!body.request_id) throw new Error("fal did not return a request id.");
	// Requests live under the app (owner/name), not the full model path.
	const app = `${FAL_QUEUE}/${model.split("/").slice(0, 2).join("/")}/requests/${encodeURIComponent(body.request_id)}`;
	return {
		requestId: body.request_id,
		statusUrl: queueUrl(body.status_url, `${app}/status`),
		responseUrl: queueUrl(body.response_url, app),
	};
}

/** Polls a request every few seconds until it completes; a failed request becomes an error. */
export async function falWait(
	key: string,
	statusUrl: string,
	options: {
		intervalMs?: number;
		timeoutMs?: number;
		onStatus?: (state: FalState, elapsedMs: number) => void;
		sleep?: (ms: number) => Promise<void>;
		now?: () => number;
	} = {},
): Promise<void> {
	const interval = options.intervalMs ?? 3000;
	const timeout = options.timeoutMs ?? 600000;
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = options.now ?? Date.now;
	const started = now();
	for (;;) {
		const res = await fetch(statusUrl, { headers: auth(key), signal: AbortSignal.timeout(30000) });
		if (!res.ok) throw await falFailure(res);
		const body = (await res.json()) as QueueBody;
		if (body.status) options.onStatus?.(body.status, now() - started);
		if (body.status === "COMPLETED") {
			if (body.error) throw new Error(`fal could not finish it: ${body.error}`);
			return;
		}
		if (now() - started + interval > timeout)
			throw new Error(
				`fal took longer than ${Math.round(timeout / 60000)} minutes; the result may still appear in your fal dashboard.`,
			);
		await sleep(interval);
	}
}

/** The finished request's output (model-specific JSON). */
export async function falResult<T>(key: string, responseUrl: string): Promise<T> {
	const res = await fetch(responseUrl, { headers: auth(key), signal: AbortSignal.timeout(60000) });
	if (!res.ok) throw await falFailure(res);
	return (await res.json()) as T;
}

/** Submit, wait, fetch the result. */
export async function falRun<T>(
	key: string,
	model: string,
	input: Record<string, unknown>,
	options: Parameters<typeof falWait>[2] = {},
): Promise<T> {
	const { statusUrl, responseUrl } = await falSubmit(key, model, input);
	await falWait(key, statusUrl, options);
	return falResult<T>(key, responseUrl);
}

/** A file fal made, as bytes (CDN URLs are public: no key). */
export async function falFetchFile(url: string): Promise<Buffer> {
	const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
	if (!res.ok) throw new Error(`Could not download the result from fal (${res.status}).`);
	return Buffer.from(await res.arrayBuffer());
}

type FalFile = { url?: string };

/** ElevenLabs speech through fal (MP3 bytes). The voice is one of ElevenLabs' defaults, by name. */
export async function falSpeech(
	key: string,
	model: string,
	input: { text: string; voice: string },
	options: Parameters<typeof falWait>[2] = {},
): Promise<Buffer> {
	const out = await falRun<{ audio?: FalFile }>(
		key,
		model,
		{ text: input.text, voice: input.voice },
		options,
	);
	if (!out.audio?.url) throw new Error("fal returned no audio.");
	return falFetchFile(out.audio.url);
}

/** Any audio model through fal that answers { audio: { url } } (sound effects, music). */
export async function falAudio(
	key: string,
	model: string,
	input: Record<string, unknown>,
	options: Parameters<typeof falWait>[2] = {},
): Promise<Buffer> {
	const out = await falRun<{ audio?: FalFile }>(key, model, input, options);
	if (!out.audio?.url) throw new Error("fal returned no audio.");
	return falFetchFile(out.audio.url);
}

/** A still through fal (PNG bytes) at an exact size. */
export async function falImage(
	key: string,
	model: string,
	input: { prompt: string; width: number; height: number },
	options: Parameters<typeof falWait>[2] = {},
): Promise<Buffer> {
	const out = await falRun<{ images?: FalFile[] }>(
		key,
		model,
		{
			prompt: input.prompt,
			image_size: { width: input.width, height: input.height },
			num_images: 1,
			output_format: "png",
		},
		options,
	);
	const url = out.images?.[0]?.url;
	if (!url) throw new Error("fal returned no image.");
	return falFetchFile(url);
}

/** A video clip through fal: upload the start picture (if any), run the model, download the MP4. */
export async function falClip(
	key: string,
	input: {
		prompt: string;
		image?: string;
		model?: string;
		durationSec?: number;
		negativePrompt?: string;
	},
	file: string,
	options: {
		onProgress?: (fraction: number) => void;
		intervalMs?: number;
		timeoutMs?: number;
		sleep?: (ms: number) => Promise<void>;
	} = {},
): Promise<{ file: string; url: string; model: string; label: string; durationSec: number }> {
	const model = resolveClipModel(input.model, !!input.image, { fal: true, higgsfield: false });
	if (model.service !== "fal") throw new Error(`${model.label} runs on Higgsfield, not fal.`);
	const duration = snapDuration(input.durationSec, model.durations);
	const progress = options.onProgress ?? (() => {});
	progress(0.02);
	const imageUrl = input.image ? await falUpload(key, input.image) : undefined;
	const out = await falRun<{ video?: FalFile }>(
		key,
		model.path,
		{
			prompt: input.prompt,
			// fal takes the length as a string ("5", "10").
			duration: String(duration),
			...(imageUrl ? { image_url: imageUrl } : {}),
			...(input.negativePrompt && model.negativePrompt
				? { negative_prompt: input.negativePrompt }
				: {}),
			...model.extra,
		},
		{
			intervalMs: options.intervalMs ?? 4000,
			timeoutMs: options.timeoutMs,
			sleep: options.sleep,
			// Clips usually take one to three minutes; creep towards 90 % meanwhile.
			onStatus: (state, elapsed) =>
				progress(state === "IN_QUEUE" ? 0.1 : Math.min(0.9, 0.15 + (elapsed / 150000) * 0.75)),
		},
	);
	const url = out.video?.url;
	if (!url) throw new Error("fal finished but returned no video.");
	const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
	if (!res.ok || !res.body) throw new Error(`Could not download the clip (${res.status}).`);
	await fs.mkdir(path.dirname(file), { recursive: true });
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
	progress(1);
	return { file, url, model: model.path, label: model.label, durationSec: duration };
}

/** A cheap call that only succeeds with a working key (fal's model list answers 401 otherwise). */
export async function testFal(key: string): Promise<void> {
	const res = await fetch(`${FAL_API}/v1/models?limit=1`, {
		headers: auth(key),
		signal: AbortSignal.timeout(20000),
	});
	if (!res.ok) throw await falFailure(res);
}
