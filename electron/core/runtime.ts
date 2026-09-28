import { readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { z } from "zod";
import {
	type AiCredentials,
	generateImage,
	synthesizeSpeech,
	type TranscriptSegment,
	TTS_VOICES,
	transcribe,
} from "./ai";
import {
	ELEVEN_VOICE_ID,
	type ElevenVoice,
	elevenMusic,
	elevenSound,
	elevenSpeech,
	elevenVoices,
} from "./elevenlabs";
import { falAudio, falClip, falImage, falSpeech } from "./fal";
import {
	DEFAULT_FAL_VOICE,
	FAL_IMAGE_MODEL,
	FAL_MUSIC_MODEL,
	FAL_SOUND_MAX_SECONDS,
	FAL_SOUND_MODEL,
	FAL_VOICE_MODELS,
	FAL_VOICES,
} from "./falModels";
import { generateClip } from "./higgsfield";
import { chat, type LocalInventory, speakMac, transcribeLocal } from "./local-ai";
import { ffmpeg } from "./media";
import {
	CONNECT_ELEVENLABS,
	CONNECT_FAL,
	CONNECT_HIGGSFIELD,
	CONNECT_OPENAI,
	clipRoute,
	imageRoute,
	type KeysPresent,
	type Route,
	type Service,
	soundRoute,
	voiceRoute,
} from "./routing";
import type { HiggsfieldKey, KeySource } from "./secrets";

export { CONNECT_ELEVENLABS, CONNECT_FAL, CONNECT_HIGGSFIELD, CONNECT_OPENAI };

/** App-wide preferences (not per project). Stored in the app's data folder. */
export const appSettingsSchema = z.object({
	theme: z.enum(["dark", "light", "system"]).default("dark"),
	/** The panels sidebar beside the viewer (the timeline spans the window), or down the full height (beside the timeline too). */
	sidebar: z.enum(["viewer", "full"]).default("viewer"),
	projectsDir: z.string().default(""),
	/** Open the last project on launch instead of the projects overview. */
	reopenLast: z.boolean().default(false),
	/** Look for new versions at launch and every few hours. */
	autoUpdate: z.boolean().default(true),
	/** Standing consent to download future updates and install them when Cue quits. */
	autoInstallUpdates: z.boolean().default(false),
	/** Anonymous usage reporting (electron/core/usage.ts): "ask" shows the one-time question. */
	usage: z.enum(["ask", "on", "off"]).default("ask"),
	ai: z
		.object({
			/** auto: OpenAI, else ElevenLabs (direct, else via fal), else the Mac's voices. */
			tts: z.enum(["auto", "openai", "macos", "elevenlabs"]).default("auto"),
			transcription: z.enum(["openai", "whisper"]).default("openai"),
			text: z.enum(["openai", "ollama", "lmstudio", "none"]).default("openai"),
			/** auto: OpenAI, else GPT Image through fal. */
			image: z.enum(["auto", "openai", "fal", "none"]).default("auto"),
			macVoice: z.string().default("Samantha"),
			macRate: z.number().min(80).max(400).optional(),
			whisperModel: z.string().optional(),
			textModel: z.string().optional(),
		})
		.default({
			tts: "auto",
			transcription: "openai",
			text: "openai",
			image: "auto",
			macVoice: "Samantha",
		}),
	agent: z
		.object({
			enabled: z.boolean().default(true),
			/** Agent edits wait for the user to accept or reject them. */
			review: z.boolean().default(false),
		})
		.default({ enabled: true, review: false }),
	editor: z
		.object({
			snapping: z.boolean().default(true),
			rippleByDefault: z.boolean().default(false),
			autoProxies: z.boolean().default(true),
		})
		.default({ snapping: true, rippleByDefault: false, autoProxies: true }),
});
export type AppSettings = z.infer<typeof appSettingsSchema>;

/** sound: effects and music (ElevenLabs, direct or via fal); video: generated clips (fal or Higgsfield). */
export type Capability = "tts" | "transcription" | "text" | "image" | "sound" | "video";

/** Keys for the services the user connects in Settings → AI (besides OpenAI's), and where each came from. */
export interface Connections {
	fal?: string;
	elevenlabs?: string;
	higgsfield?: HiggsfieldKey;
	sources?: Partial<Record<Service, KeySource>>;
}

export interface ProviderStatus {
	capability: Capability;
	provider: string;
	ready: boolean;
	/** Why it is not ready, in words for the user. */
	problem?: string;
	/** The service to connect to make it ready. */
	connect?: Service;
	model?: string;
}

/** A connected service for the window: never the key, only whether there is one and where it came from. */
export interface ConnectionStatus {
	service: Service;
	connected: boolean;
	source?: KeySource;
}

/** Everything generative goes through this, whichever provider backs it. */
export interface AiRuntime {
	speak(
		text: string,
		options: {
			voice?: string;
			instructions?: string;
			model?: string;
			/** The project's ElevenLabs voice and model, used when ElevenLabs speaks. */
			elevenlabs?: { voice: string; model: string };
			/** The project's voice for ElevenLabs through fal (one of ElevenLabs' default voices, by name). */
			fal?: { voice: string };
		},
	): Promise<{ audio: Buffer; provider: string; model: string; voice: string }>;
	transcribe(
		file: string,
		options: { language?: string; prompt?: string; model?: string },
	): Promise<{ text: string; segments: TranscriptSegment[] }>;
	image(
		prompt: string,
		options: { size: "1536x1024" | "1024x1536" | "1024x1024"; model?: string },
	): Promise<{ png: Buffer; provider: string; model: string }>;
	chat(system: string, prompt: string): Promise<string>;
	/** A sound effect from a description (ElevenLabs direct or via fal, MP3 bytes). */
	sound(
		prompt: string,
		options: { durationSeconds?: number; promptInfluence?: number; loop?: boolean },
	): Promise<Buffer>;
	/** Music from a description (ElevenLabs direct or via fal, MP3 bytes). */
	music(prompt: string, options: { lengthMs: number; instrumental?: boolean }): Promise<Buffer>;
	/** Which service makes sounds and music, for generation metadata. */
	soundProvider(): { provider: string; soundModel: string; musicModel: string };
	/** A video clip (fal, else Higgsfield), downloaded to `file`. */
	clip(
		input: {
			prompt: string;
			image?: string;
			model?: string;
			durationSec?: number;
			negativePrompt?: string;
		},
		file: string,
		onProgress?: (fraction: number) => void,
	): Promise<{ file: string; url: string; model: string; label: string; durationSec: number }>;
	/**
	 * Voices for ElevenLabs speech, optionally searched: the account's own (direct
	 * key), or ElevenLabs' default voices by name (through fal).
	 */
	voices(search?: string): Promise<{ via: "elevenlabs" | "fal"; voices: ElevenVoice[] }>;
	/** The services and whether each is connected (for the window: no keys). */
	connections(): ConnectionStatus[];
	/**
	 * One short description per picture (for searching footage): what is shown,
	 * where, notable objects, text and actions. Uses the text provider's vision
	 * model (OpenAI, or a vision model in Ollama / LM Studio).
	 */
	describeImages(files: string[]): Promise<string[]>;
	status(): ProviderStatus[];
}

/** Any audio as 16-bit WAV at 44.1 kHz, so takes from every provider match. */
async function asWav(audio: Buffer, ext: string): Promise<Buffer> {
	const base = path.join(
		os.tmpdir(),
		`cue-tts-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
	);
	try {
		await writeFile(`${base}.${ext}`, audio);
		await ffmpeg(["-i", `${base}.${ext}`, "-ar", "44100", "-c:a", "pcm_s16le", `${base}.out.wav`]);
		return await readFile(`${base}.out.wav`);
	} finally {
		await rm(`${base}.${ext}`, { force: true });
		await rm(`${base}.out.wav`, { force: true });
	}
}

export function buildRuntime(
	settings: AppSettings,
	creds: AiCredentials | null,
	local: LocalInventory,
	keys: Connections = {},
): AiRuntime {
	const ai = settings.ai;
	const whisperModel = ai.whisperModel ?? local.whisper.models[0]?.path;
	const textModel =
		ai.textModel ??
		(ai.text === "ollama"
			? local.ollama.models[0]
			: ai.text === "lmstudio"
				? local.lmStudio.models[0]
				: "gpt-4.1-mini");

	const present: KeysPresent = {
		openai: !!creds,
		fal: !!keys.fal,
		elevenlabs: !!keys.elevenlabs,
		higgsfield: !!keys.higgsfield,
	};
	const speech = voiceRoute(ai.tts, present, local.macVoices.length > 0);
	const picture = imageRoute(ai.image, present);
	const sounds = soundRoute(present);
	const clips = clipRoute(present);
	const row = <E extends string>(
		capability: Capability,
		route: Route<E>,
		model?: string,
	): ProviderStatus => ({
		capability,
		provider: route.provider,
		ready: route.engine !== null,
		...(route.problem ? { problem: route.problem } : {}),
		...(route.connect ? { connect: route.connect } : {}),
		...(model ? { model } : {}),
	});

	const status = (): ProviderStatus[] => [
		row("tts", speech, speech.engine === "macos" ? ai.macVoice : undefined),
		ai.transcription === "openai"
			? {
					capability: "transcription",
					provider: "OpenAI",
					ready: !!creds,
					problem: creds ? undefined : CONNECT_OPENAI,
					connect: creds ? undefined : ("openai" as const),
				}
			: {
					capability: "transcription",
					provider:
						process.platform === "darwin"
							? "whisper.cpp (on this Mac)"
							: "whisper.cpp (on this computer)",
					ready: !!local.whisper.binary && !!whisperModel,
					model: whisperModel?.split("/").pop(),
					problem: !local.whisper.binary
						? process.platform === "darwin"
							? "Install whisper.cpp (brew install whisper-cpp)"
							: "Install whisper.cpp and put whisper-cli on your PATH"
						: !whisperModel
							? "Download a whisper model"
							: undefined,
				},
		ai.text === "openai"
			? {
					capability: "text",
					provider: "OpenAI",
					ready: !!creds,
					model: textModel,
					problem: creds ? undefined : CONNECT_OPENAI,
					connect: creds ? undefined : ("openai" as const),
				}
			: ai.text === "ollama"
				? {
						capability: "text",
						provider: "Ollama",
						ready: local.ollama.running && !!textModel,
						model: textModel,
						problem: !local.ollama.installed
							? "Install Ollama"
							: !local.ollama.running
								? "Start Ollama"
								: !textModel
									? "Pull a model in Ollama"
									: undefined,
					}
				: ai.text === "lmstudio"
					? {
							capability: "text",
							provider: "LM Studio",
							ready: local.lmStudio.running && !!textModel,
							model: textModel,
							problem: local.lmStudio.running ? undefined : "Start the LM Studio server",
						}
					: { capability: "text", provider: "Off", ready: false, problem: "Text model turned off" },
		row("image", picture),
		row("sound", sounds),
		row("video", clips),
	];

	const need = (capability: Capability) => {
		const s = status().find((x) => x.capability === capability);
		// A missing connection already says where to go.
		if (!s?.ready && s?.connect) throw new Error(`${s.problem}.`);
		if (!s?.ready)
			throw new Error(
				`${capability === "tts" ? "Voice" : capability === "text" ? "Text model" : capability[0].toUpperCase() + capability.slice(1)} is not set up: ${s?.problem ?? "unavailable"}. Open Cue → Settings → AI.`,
			);
	};

	return {
		status,
		async speak(text, options) {
			need("tts");
			if (speech.engine === "macos") {
				const voice =
					options.voice && local.macVoices.some((v) => v.name === options.voice)
						? options.voice
						: ai.macVoice;
				return {
					audio: await speakMac(text, voice, ai.macRate),
					provider: "macos",
					model: "say",
					voice,
				};
			}
			const elevenModel = options.elevenlabs?.model ?? "eleven_v3";
			if (speech.engine === "elevenlabs") {
				// An OpenAI voice name (the project's other voice) is no ElevenLabs voice.
				const asked =
					options.voice &&
					ELEVEN_VOICE_ID.test(options.voice) &&
					!TTS_VOICES.includes(options.voice)
						? options.voice
						: undefined;
				const id = asked ?? options.elevenlabs?.voice;
				if (!id) throw new Error("Choose an ElevenLabs voice (Generate → Voiceover).");
				const spoken = await elevenSpeech(keys.elevenlabs as string, {
					text,
					voice: id,
					model: elevenModel,
				});
				return {
					audio: await asWav(spoken.audio, spoken.format),
					provider: "elevenlabs",
					model: elevenModel,
					voice: id,
				};
			}
			if (speech.engine === "fal") {
				const named = (v?: string) => FAL_VOICES.find((n) => n.toLowerCase() === v?.toLowerCase());
				const name = named(options.voice) ?? named(options.fal?.voice) ?? DEFAULT_FAL_VOICE;
				const model = FAL_VOICE_MODELS[elevenModel] ?? FAL_VOICE_MODELS.eleven_v3;
				const mp3 = await falSpeech(keys.fal as string, model, { text, voice: name });
				return { audio: await asWav(mp3, "mp3"), provider: "fal", model, voice: name };
			}
			const model = options.model ?? "gpt-4o-mini-tts";
			const voice = options.voice ?? "cedar";
			return {
				audio: await synthesizeSpeech(creds as AiCredentials, {
					text,
					model,
					voice,
					instructions: options.instructions,
				}),
				provider: "openai",
				model,
				voice,
			};
		},
		async sound(prompt, options) {
			need("sound");
			if (sounds.engine === "elevenlabs")
				return elevenSound(keys.elevenlabs as string, { text: prompt, ...options });
			return falAudio(keys.fal as string, FAL_SOUND_MODEL, {
				text: prompt,
				...(options.durationSeconds !== undefined
					? {
							duration_seconds: Math.min(
								FAL_SOUND_MAX_SECONDS,
								Math.max(0.5, options.durationSeconds),
							),
						}
					: {}),
				...(options.promptInfluence !== undefined
					? { prompt_influence: options.promptInfluence }
					: {}),
				...(options.loop ? { loop: true } : {}),
			});
		},
		async music(prompt, options) {
			need("sound");
			if (sounds.engine === "elevenlabs") {
				try {
					return await elevenMusic(keys.elevenlabs as string, { prompt, ...options });
				} catch (error) {
					// Music needs a paid ElevenLabs plan; fal's copy of the same model works on any fal key.
					if (!keys.fal || !/\b402\b|paid plan|not available for free/i.test((error as Error).message))
						throw error;
				}
			}
			return falAudio(keys.fal as string, FAL_MUSIC_MODEL, {
				prompt,
				music_length_ms: Math.round(Math.min(600000, Math.max(3000, options.lengthMs))),
				...(options.instrumental ? { force_instrumental: true } : {}),
			});
		},
		soundProvider() {
			return sounds.engine === "fal"
				? { provider: "fal", soundModel: FAL_SOUND_MODEL, musicModel: FAL_MUSIC_MODEL }
				: {
						provider: "elevenlabs",
						soundModel: "eleven_text_to_sound_v2",
						musicModel: "music_v2_5",
					};
		},
		async clip(input, file, onProgress) {
			need("video");
			// A raw Higgsfield path goes to Higgsfield; everything else to fal when it is connected.
			const higgsfield =
				keys.higgsfield && (clips.engine === "higgsfield" || input.model?.startsWith("/"));
			if (higgsfield)
				return generateClip(keys.higgsfield as HiggsfieldKey, input, file, { onProgress });
			if (!keys.fal) throw new Error(`${CONNECT_FAL}.`);
			return falClip(keys.fal, input, file, { onProgress });
		},
		async voices(search) {
			if (keys.elevenlabs)
				return { via: "elevenlabs", voices: await elevenVoices(keys.elevenlabs, { search }) };
			if (keys.fal) {
				const q = search?.trim().toLowerCase();
				return {
					via: "fal",
					voices: FAL_VOICES.filter((n) => !q || n.toLowerCase().includes(q)).map((name) => ({
						id: name,
						name,
						category: "default",
						labels: {},
					})),
				};
			}
			throw new Error(`${CONNECT_FAL} (or ElevenLabs for your own voices).`);
		},
		connections() {
			const sources = keys.sources ?? {};
			return (["fal", "openai", "elevenlabs", "higgsfield"] as const).map((service) => ({
				service,
				connected: present[service],
				...(present[service] ? { source: sources[service] ?? "stored" } : {}),
			}));
		},
		async transcribe(file, options) {
			need("transcription");
			if (ai.transcription === "whisper")
				return transcribeLocal(
					local.whisper.binary as string,
					whisperModel as string,
					file,
					options.language,
				);
			return transcribe(creds as AiCredentials, {
				file,
				model: options.model ?? "whisper-1",
				language: options.language,
				prompt: options.prompt,
			});
		},
		async image(prompt, options) {
			need("image");
			if (picture.engine === "fal") {
				const [width, height] = options.size.split("x").map(Number);
				return {
					png: await falImage(keys.fal as string, FAL_IMAGE_MODEL, { prompt, width, height }),
					provider: "fal",
					model: FAL_IMAGE_MODEL,
				};
			}
			const model = options.model ?? "gpt-image-2.5-flare";
			return {
				png: await generateImage(creds as AiCredentials, { prompt, model, size: options.size }),
				provider: "openai",
				model,
			};
		},
		async describeImages(files) {
			need("text");
			const local = ai.text === "ollama" || ai.text === "lmstudio";
			const baseUrl =
				ai.text === "ollama"
					? "http://127.0.0.1:11434/v1"
					: ai.text === "lmstudio"
						? "http://127.0.0.1:1234/v1"
						: (creds?.baseUrl ?? "https://api.openai.com/v1");
			// A small vision model is plenty for short descriptions.
			const model = local ? (textModel as string) : "gpt-4o-mini";
			const out: string[] = [];
			for (let i = 0; i < files.length; i += 6) {
				const batch = files.slice(i, i + 6);
				const images = await Promise.all(
					batch.map(async (f) => ({
						type: "image_url",
						image_url: {
							url: `data:image/jpeg;base64,${(await readFile(f)).toString("base64")}`,
							detail: "low",
						},
					})),
				);
				const res = await fetch(`${baseUrl}/chat/completions`, {
					method: "POST",
					headers: {
						"content-type": "application/json",
						...(!local && creds?.apiKey ? { authorization: `Bearer ${creds.apiKey}` } : {}),
					},
					body: JSON.stringify({
						model,
						temperature: 0.2,
						messages: [
							{
								role: "user",
								content: [
									{
										type: "text",
										text: `Describe each of these ${batch.length} video frames in one plain sentence (at most 25 words): what is shown, the setting, weather or time of day, notable objects, any readable text, and what is happening. Reply with only a JSON array of ${batch.length} strings, in order.`,
									},
									...images,
								],
							},
						],
					}),
					signal: AbortSignal.timeout(120000),
				});
				if (!res.ok)
					throw new Error(
						`Describing frames failed (${res.status}): ${(await res.text()).slice(0, 200)}`,
					);
				const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
				const text = body.choices?.[0]?.message?.content ?? "[]";
				let list: string[] = [];
				try {
					list = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
				} catch {}
				for (let k = 0; k < batch.length; k++) out.push(String(list[k] ?? ""));
			}
			return out;
		},
		async chat(system, prompt) {
			need("text");
			if (ai.text === "ollama")
				return chat({
					baseUrl: "http://127.0.0.1:11434/v1",
					model: textModel as string,
					system,
					prompt,
				});
			if (ai.text === "lmstudio")
				return chat({
					baseUrl: "http://127.0.0.1:1234/v1",
					model: textModel as string,
					system,
					prompt,
				});
			return chat({
				baseUrl: creds?.baseUrl ?? "https://api.openai.com/v1",
				apiKey: creds?.apiKey,
				model: textModel as string,
				system,
				prompt,
			});
		},
	};
}
