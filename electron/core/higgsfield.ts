import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { resolveClipModel, snapDuration } from "./clipModels";
import type { HiggsfieldKey } from "./secrets";

/**
 * Higgsfield, connected with the user's own key: short video clips from a
 * description and, optionally, a still to start from. A request is queued,
 * polled until it finishes, and its video downloaded straight away (the
 * provider only keeps it for a few days).
 */

export const HIGGSFIELD_BASE = "https://api.higgsfield.ai";

const auth = (key: HiggsfieldKey) => ({ authorization: `Key ${key.id}:${key.secret}` });

/** The provider's own message (FastAPI style detail, or a message field). */
export async function higgsfieldFailure(res: Response): Promise<Error> {
	let detail = res.statusText;
	try {
		const body = (await res.json()) as {
			detail?: string | { msg?: string }[];
			message?: string;
			error?: string;
		};
		if (typeof body.detail === "string") detail = body.detail;
		else if (Array.isArray(body.detail))
			detail = body.detail.map((d) => d.msg).join("; ") || detail;
		else detail = body.message ?? body.error ?? detail;
	} catch {}
	return new Error(`Higgsfield ${res.status}: ${detail}`);
}

const IMAGE_TYPES: Record<string, string> = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
};

/** Uploads a picture for a request to start from; returns the URL to pass as image_url. */
export async function uploadImage(key: HiggsfieldKey, file: string): Promise<string> {
	const type = IMAGE_TYPES[path.extname(file).toLowerCase()];
	if (!type) throw new Error("The start picture must be a PNG, JPEG or WebP image.");
	const bytes = await fs.readFile(file);
	const res = await fetch(`${HIGGSFIELD_BASE}/files/generate-upload-url`, {
		method: "POST",
		headers: { ...auth(key), "content-type": "application/json" },
		body: JSON.stringify({ content_type: type }),
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw await higgsfieldFailure(res);
	const slot = (await res.json()) as {
		upload_url: string;
		public_url: string;
		upload_headers?: Record<string, string>;
	};
	// The upload goes to storage, which is signed by the URL: no Higgsfield key on it.
	const put = await fetch(slot.upload_url, {
		method: "PUT",
		// The URL is signed for exactly these headers: one Content-Type, never doubled by a case clash.
		headers: Object.fromEntries(
			Object.entries({ "content-type": type, ...(slot.upload_headers ?? {}) }).map(([k, v]) => [
				k.toLowerCase(),
				v,
			]),
		),
		body: new Uint8Array(bytes),
		signal: AbortSignal.timeout(120000),
	});
	if (!put.ok) throw new Error(`Uploading the start picture failed (${put.status}).`);
	return slot.public_url;
}

export type ClipState = "queued" | "in_progress" | "completed" | "failed" | "nsfw" | "canceled";

interface StatusBody {
	status: ClipState;
	request_id?: string;
	status_url?: string;
	video?: { url?: string };
	images?: { url?: string }[];
	error?: string;
	message?: string;
	detail?: string;
}

/** Queues a request on a model path; returns its id and where to ask how it is going. */
export async function submitClip(
	key: HiggsfieldKey,
	modelPath: string,
	body: Record<string, unknown>,
): Promise<{ requestId: string; statusUrl: string }> {
	const res = await fetch(`${HIGGSFIELD_BASE}${modelPath}`, {
		method: "POST",
		headers: { ...auth(key), "content-type": "application/json" },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(60000),
	});
	if (!res.ok) throw await higgsfieldFailure(res);
	const queued = (await res.json()) as StatusBody;
	if (!queued.request_id) throw new Error("Higgsfield did not return a request id.");
	return { requestId: queued.request_id, statusUrl: statusUrl(queued) };
}

/** The status URL, only ever on Higgsfield's own host (the key goes with it). */
function statusUrl(body: StatusBody): string {
	try {
		const url = new URL(body.status_url ?? "");
		if (url.protocol === "https:" && /(^|\.)higgsfield\.ai$/.test(url.hostname))
			return url.toString();
	} catch {}
	return `${HIGGSFIELD_BASE}/requests/${encodeURIComponent(body.request_id ?? "")}/status`;
}

/**
 * Polls a request every few seconds until it finishes; returns the video's URL.
 * Failed, flagged and cancelled requests become errors with the provider's words.
 */
export async function waitForClip(
	key: HiggsfieldKey,
	url: string,
	options: {
		intervalMs?: number;
		timeoutMs?: number;
		onStatus?: (state: ClipState, elapsedMs: number) => void;
		sleep?: (ms: number) => Promise<void>;
		now?: () => number;
	} = {},
): Promise<string> {
	const interval = options.intervalMs ?? 4000;
	const timeout = options.timeoutMs ?? 600000;
	const sleep = options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
	const now = options.now ?? Date.now;
	const started = now();
	let dropped = 0;
	for (;;) {
		let res: Response;
		try {
			res = await fetch(url, { headers: auth(key), signal: AbortSignal.timeout(30000) });
			dropped = 0;
		} catch (error) {
			// A dropped connection while the clip renders: ask again, unless it keeps failing.
			if (++dropped > 5) throw error;
			await sleep(Math.min(15000, 2000 * dropped));
			continue;
		}
		if (res.status >= 500 && ++dropped <= 5) {
			await sleep(Math.min(15000, 2000 * dropped));
			continue;
		}
		if (!res.ok) throw await higgsfieldFailure(res);
		const body = (await res.json()) as StatusBody;
		options.onStatus?.(body.status, now() - started);
		const why = body.error ?? body.message ?? body.detail;
		switch (body.status) {
			case "completed": {
				const video = body.video?.url ?? body.images?.[0]?.url;
				if (!video) throw new Error("Higgsfield finished but returned no video.");
				return video;
			}
			case "failed":
				throw new Error(`Higgsfield could not make the clip${why ? `: ${why}` : "."}`);
			case "nsfw":
				throw new Error(
					"Higgsfield refused the clip: its content check flagged the prompt or picture. Describe it differently.",
				);
			case "canceled":
				throw new Error("The clip was cancelled on Higgsfield.");
		}
		if (now() - started + interval > timeout)
			throw new Error(
				`Higgsfield took longer than ${Math.round(timeout / 60000)} minutes; the clip may still appear in your Higgsfield account.`,
			);
		await sleep(interval);
	}
}

/** Saves the finished video to a file. */
export async function downloadClip(url: string, file: string): Promise<string> {
	await fs.mkdir(path.dirname(file), { recursive: true });
	for (let attempt = 1; ; attempt++) {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
			if (!res.ok || !res.body) throw new Error(`Could not download the clip (${res.status}).`);
			await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
			return file;
		} catch (error) {
			if (attempt >= 3) throw error;
			await new Promise((r) => setTimeout(r, 3000 * attempt));
		}
	}
}

/** The whole round: upload the picture (if any), queue, poll, download. */
export async function generateClip(
	key: HiggsfieldKey,
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
	const model = resolveClipModel(input.model, !!input.image, { fal: false, higgsfield: true });
	if (model.service !== "higgsfield")
		throw new Error(`${model.label} runs on fal, not Higgsfield: connect fal in Settings → AI.`);
	const duration = snapDuration(input.durationSec, model.durations);
	const progress = options.onProgress ?? (() => {});
	progress(0.02);
	const imageUrl = input.image ? await uploadImage(key, input.image) : undefined;
	const { statusUrl: url } = await submitClip(key, model.path, {
		prompt: input.prompt,
		duration,
		...(imageUrl ? { image_url: imageUrl } : {}),
		...(input.negativePrompt && model.negativePrompt
			? { negative_prompt: input.negativePrompt }
			: {}),
		...model.extra,
	});
	progress(0.08);
	const videoUrl = await waitForClip(key, url, {
		intervalMs: options.intervalMs,
		timeoutMs: options.timeoutMs,
		sleep: options.sleep,
		// Clips usually take one to three minutes; creep towards 90 % meanwhile.
		onStatus: (state, elapsed) =>
			progress(state === "queued" ? 0.1 : Math.min(0.9, 0.15 + (elapsed / 150000) * 0.75)),
	});
	await downloadClip(videoUrl, file);
	progress(1);
	return { file, url: videoUrl, model: model.path, label: model.label, durationSec: duration };
}

/**
 * A cheap check of a key: asks for a request that doesn't exist. A refused key
 * answers 401/403; a working one gets "not found".
 */
export async function testHiggsfield(key: HiggsfieldKey): Promise<void> {
	const res = await fetch(
		`${HIGGSFIELD_BASE}/requests/00000000-0000-0000-0000-000000000000/status`,
		{ headers: auth(key), signal: AbortSignal.timeout(20000) },
	);
	if (res.status === 401 || res.status === 403) throw await higgsfieldFailure(res);
}
