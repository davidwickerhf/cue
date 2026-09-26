import fs from "node:fs/promises";
import path from "node:path";

/**
 * Generative tools. OpenAI is the first provider; each function returns plain
 * data so a different provider can be slotted in behind the same calls.
 */
export interface AiCredentials {
	apiKey: string;
	baseUrl?: string;
}

const base = (creds: AiCredentials) => creds.baseUrl ?? "https://api.openai.com/v1";

async function failure(res: Response): Promise<Error> {
	let detail = res.statusText;
	try {
		const body = (await res.json()) as { error?: { message?: string } };
		detail = body.error?.message ?? detail;
	} catch {}
	return new Error(`OpenAI ${res.status}: ${detail}`);
}

export const TTS_VOICES = [
	"alloy",
	"ash",
	"ballad",
	"cedar",
	"coral",
	"echo",
	"fable",
	"marin",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
];

/** Speech for one line of text, as WAV bytes. */
export async function synthesizeSpeech(
	creds: AiCredentials,
	input: { text: string; model: string; voice: string; instructions?: string },
): Promise<Buffer> {
	const res = await fetch(`${base(creds)}/audio/speech`, {
		method: "POST",
		headers: { authorization: `Bearer ${creds.apiKey}`, "content-type": "application/json" },
		body: JSON.stringify({
			model: input.model,
			voice: input.voice,
			input: input.text,
			response_format: "wav",
			...(input.instructions ? { instructions: input.instructions } : {}),
		}),
		signal: AbortSignal.timeout(120000),
	});
	if (!res.ok) throw await failure(res);
	return Buffer.from(await res.arrayBuffer());
}

export interface TranscriptSegment {
	startMs: number;
	endMs: number;
	text: string;
	words?: { startMs: number; endMs: number; word: string }[];
}

/** Timestamped transcript. Uses a model that returns segments (whisper-1 by default). */
export async function transcribe(
	creds: AiCredentials,
	input: { file: string; model: string; language?: string; prompt?: string },
): Promise<{ text: string; segments: TranscriptSegment[] }> {
	const model = input.model.startsWith("gpt-4o") ? "whisper-1" : input.model;
	const form = new FormData();
	form.append("file", new Blob([await fs.readFile(input.file)]), path.basename(input.file));
	form.append("model", model);
	form.append("response_format", "verbose_json");
	form.append("timestamp_granularities[]", "segment");
	form.append("timestamp_granularities[]", "word");
	if (input.language) form.append("language", input.language);
	if (input.prompt) form.append("prompt", input.prompt);
	const res = await fetch(`${base(creds)}/audio/transcriptions`, {
		method: "POST",
		headers: { authorization: `Bearer ${creds.apiKey}` },
		body: form,
		signal: AbortSignal.timeout(300000),
	});
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as {
		text: string;
		segments?: { start: number; end: number; text: string }[];
		words?: { start: number; end: number; word: string }[];
	};
	const words = (body.words ?? []).map((w) => ({
		startMs: Math.round(w.start * 1000),
		endMs: Math.round(w.end * 1000),
		word: w.word,
	}));
	const segments = (body.segments ?? []).map((s) => {
		const startMs = Math.round(s.start * 1000);
		const endMs = Math.round(s.end * 1000);
		return {
			startMs,
			endMs,
			text: s.text.trim(),
			words: words.filter((w) => w.startMs >= startMs - 50 && w.endMs <= endMs + 50),
		};
	});
	return { text: body.text, segments };
}

/** A generated still image as PNG bytes. */
export async function generateImage(
	creds: AiCredentials,
	input: { prompt: string; model: string; size: "1536x1024" | "1024x1536" | "1024x1024" },
): Promise<Buffer> {
	const res = await fetch(`${base(creds)}/images/generations`, {
		method: "POST",
		headers: { authorization: `Bearer ${creds.apiKey}`, "content-type": "application/json" },
		body: JSON.stringify({ model: input.model, prompt: input.prompt, size: input.size, n: 1 }),
		signal: AbortSignal.timeout(240000),
	});
	if (!res.ok) throw await failure(res);
	const body = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
	const item = body.data[0];
	if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
	if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
	throw new Error("The image service returned no image.");
}

/**
 * Splits transcript words into caption-sized chunks: at most `maxChars`
 * characters, breaking early at sentence ends and long pauses.
 */
/** A caption's worth of speech, with its words (absolute times). */
export interface CaptionChunk {
	startMs: number;
	endMs: number;
	text: string;
	words: { text: string; startMs: number; endMs: number }[];
}

export function chunkCaptions(
	segments: TranscriptSegment[],
	maxChars = 42,
): CaptionChunk[] {
	const chunks: CaptionChunk[] = [];
	for (const segment of segments) {
		const words = segment.words?.length
			? segment.words
			: [{ startMs: segment.startMs, endMs: segment.endMs, word: segment.text }];
		let current: typeof words = [];
		const flush = () => {
			if (current.length === 0) return;
			// Punctuation that came as its own word joins the word before it.
			const said: CaptionChunk["words"] = [];
			for (const w of current) {
				const text = w.word.trim();
				const last = said.at(-1);
				if (last && /^[,.!?;:]+$/.test(text)) {
					last.text += text;
					last.endMs = w.endMs;
				} else if (text) said.push({ text, startMs: w.startMs, endMs: w.endMs });
			}
			chunks.push({
				startMs: current[0].startMs,
				endMs: current.at(-1)?.endMs ?? current[0].endMs,
				text: said.map((w) => w.text).join(" "),
				words: said,
			});
			current = [];
		};
		for (const word of words) {
			const text = [...current, word].map((w) => w.word.trim()).join(" ");
			const gap = current.length ? word.startMs - (current.at(-1)?.endMs ?? word.startMs) : 0;
			if (current.length && (text.length > maxChars || gap > 600)) flush();
			current.push(word);
			if (
				/[.!?]$/.test(word.word.trim()) &&
				current.map((w) => w.word).join(" ").length > maxChars * 0.5
			)
				flush();
		}
		flush();
	}
	return chunks;
}
