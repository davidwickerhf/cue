/**
 * ElevenLabs, connected with the user's own key: voices for takes, sound
 * effects and music from a description. Every call returns plain audio bytes;
 * the caller converts and files them like the other providers' output.
 */

export const ELEVENLABS_BASE = "https://api.elevenlabs.io";

/** Speech models, most expressive first. */
export const ELEVEN_MODELS = [
	{ id: "eleven_v3", label: "v3 (most expressive, audio tags)" },
	{ id: "eleven_multilingual_v2", label: "Multilingual v2 (stable, long-form)" },
	{ id: "eleven_flash_v2_5", label: "Flash v2.5 (fast)" },
] as const;
export const DEFAULT_ELEVEN_MODEL = "eleven_v3";
/** "George", one of ElevenLabs' default voices, until the project picks one. */
export const DEFAULT_ELEVEN_VOICE = "JBFqnCBsd6RMkjVDRZzb";
export const ELEVEN_SOUND_MODEL = "eleven_text_to_sound_v2";
export const ELEVEN_MUSIC_MODEL = "music_v2_5";

/** Voice ids are short alphanumeric strings; model ids are lower-case words joined by underscores. */
export const ELEVEN_VOICE_ID = /^[A-Za-z0-9]{8,64}$/;
export const ELEVEN_MODEL_ID = /^eleven_[a-z0-9_]+$/;

export interface ElevenVoice {
	id: string;
	name: string;
	category?: string;
	labels: Record<string, string>;
	previewUrl?: string;
}

export interface VoiceSettings {
	stability?: number;
	similarity_boost?: number;
	style?: number;
	speed?: number;
	use_speaker_boost?: boolean;
}

const headers = (key: string, json = true) => ({
	"xi-api-key": key,
	...(json ? { "content-type": "application/json" } : {}),
});

/** The provider's own message: ElevenLabs puts it in detail (a string, an object or a list). */
export async function elevenFailure(res: Response): Promise<Error> {
	let detail = res.statusText;
	try {
		const body = (await res.json()) as {
			detail?: string | { message?: string; status?: string } | { msg?: string }[];
		};
		const d = body.detail;
		if (typeof d === "string") detail = d;
		else if (Array.isArray(d)) detail = d.map((x) => x.msg).join("; ") || detail;
		else if (d?.message) detail = d.message;
	} catch {}
	return new Error(`ElevenLabs ${res.status}: ${detail}`);
}

async function audio(res: Response): Promise<Buffer> {
	if (!res.ok) throw await elevenFailure(res);
	return Buffer.from(await res.arrayBuffer());
}

/**
 * Speech for one line. Asks for WAV at 44.1 kHz; plans without it (WAV and PCM
 * need a higher tier) get MP3 instead, which the caller converts like any take.
 */
export async function elevenSpeech(
	key: string,
	input: { text: string; voice: string; model: string; settings?: VoiceSettings },
): Promise<{ audio: Buffer; format: "wav" | "mp3" }> {
	const call = (format: string) =>
		fetch(
			`${ELEVENLABS_BASE}/v1/text-to-speech/${encodeURIComponent(input.voice)}?output_format=${format}`,
			{
				method: "POST",
				headers: headers(key),
				body: JSON.stringify({
					text: input.text,
					model_id: input.model,
					...(input.settings ? { voice_settings: input.settings } : {}),
				}),
				signal: AbortSignal.timeout(180000),
			},
		);
	const res = await call("wav_44100");
	if (res.ok) return { audio: Buffer.from(await res.arrayBuffer()), format: "wav" };
	// 401 is a bad key and 404 an unknown voice: only a refused format is worth a second try.
	if (res.status === 401 || res.status === 404 || res.status >= 500) throw await elevenFailure(res);
	return { audio: await audio(await call("mp3_44100_128")), format: "mp3" };
}

/** One page of the account's voices (its own, and the defaults), optionally searched. */
export async function elevenVoicePage(
	key: string,
	options: { search?: string; pageSize?: number; pageToken?: string } = {},
): Promise<{ voices: ElevenVoice[]; nextPageToken?: string }> {
	const url = new URL(`${ELEVENLABS_BASE}/v2/voices`);
	url.searchParams.set("page_size", String(options.pageSize ?? 100));
	if (options.search?.trim()) url.searchParams.set("search", options.search.trim());
	if (options.pageToken) url.searchParams.set("next_page_token", options.pageToken);
	const res = await fetch(url, {
		headers: headers(key, false),
		signal: AbortSignal.timeout(30000),
	});
	if (!res.ok) throw await elevenFailure(res);
	const body = (await res.json()) as {
		voices?: {
			voice_id: string;
			name: string;
			category?: string;
			labels?: Record<string, string>;
			preview_url?: string;
		}[];
		has_more?: boolean;
		next_page_token?: string | null;
	};
	return {
		voices: (body.voices ?? []).map((v) => ({
			id: v.voice_id,
			name: v.name,
			category: v.category,
			labels: v.labels ?? {},
			previewUrl: v.preview_url,
		})),
		nextPageToken: body.has_more && body.next_page_token ? body.next_page_token : undefined,
	};
}

/** Voices across pages, up to `max`. */
export async function elevenVoices(
	key: string,
	options: { search?: string; max?: number } = {},
): Promise<ElevenVoice[]> {
	const max = options.max ?? 300;
	const out: ElevenVoice[] = [];
	let pageToken: string | undefined;
	do {
		const page = await elevenVoicePage(key, {
			search: options.search,
			pageSize: Math.min(100, max - out.length),
			pageToken,
		});
		out.push(...page.voices);
		pageToken = page.nextPageToken;
	} while (pageToken && out.length < max);
	return out.slice(0, max);
}

/** A sound effect from a description (MP3). */
export async function elevenSound(
	key: string,
	input: { text: string; durationSeconds?: number; promptInfluence?: number; loop?: boolean },
): Promise<Buffer> {
	return audio(
		await fetch(`${ELEVENLABS_BASE}/v1/sound-generation`, {
			method: "POST",
			headers: headers(key),
			body: JSON.stringify({
				text: input.text,
				model_id: ELEVEN_SOUND_MODEL,
				...(input.durationSeconds !== undefined
					? { duration_seconds: Math.min(30, Math.max(0.5, input.durationSeconds)) }
					: {}),
				...(input.promptInfluence !== undefined
					? { prompt_influence: Math.min(1, Math.max(0, input.promptInfluence)) }
					: {}),
				...(input.loop ? { loop: true } : {}),
			}),
			signal: AbortSignal.timeout(180000),
		}),
	);
}

/** A piece of music from a description (MP3), lengthMs long (3 s to 10 min). */
/** A part of a composed piece: its name, length and how it should sound. */
export interface MusicSection {
	name: string;
	durationMs: number;
	styles: string[];
	avoid?: string[];
}

export async function elevenMusic(
	key: string,
	input: {
		prompt: string;
		lengthMs: number;
		instrumental?: boolean;
		/** Composed section by section: the prompt is the whole piece's style, each section its own. */
		sections?: MusicSection[];
	},
): Promise<Buffer> {
	return audio(
		await fetch(`${ELEVENLABS_BASE}/v1/music`, {
			method: "POST",
			headers: headers(key),
			body: JSON.stringify(
				input.sections?.length
					? {
							// music_v2 and later take the plan as chunks, each with the whole piece's style too.
							composition_plan: {
								chunks: input.sections.map((s) => ({
									text: input.instrumental ? "(instrumental)" : s.name,
									duration_ms: Math.round(Math.min(120000, Math.max(3000, s.durationMs))),
									positive_styles: [input.prompt, ...s.styles],
									negative_styles: [
										...(s.avoid ?? []),
										...(input.instrumental ? ["vocals", "singing"] : []),
									],
								})),
							},
							model_id: ELEVEN_MUSIC_MODEL,
						}
					: {
							prompt: input.prompt,
							music_length_ms: Math.round(Math.min(600000, Math.max(3000, input.lengthMs))),
							model_id: ELEVEN_MUSIC_MODEL,
							...(input.instrumental ? { force_instrumental: true } : {}),
						},
			),
			// A long piece takes minutes to compose.
			signal: AbortSignal.timeout(600000),
		}),
	);
}

/** A cheap call that only succeeds with a working key. */
export async function testElevenLabs(key: string): Promise<void> {
	await elevenVoicePage(key, { pageSize: 1 });
}
