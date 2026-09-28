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
import { generateClip } from "./higgsfield";
import { chat, type LocalInventory, speakMac, transcribeLocal } from "./local-ai";
import { ffmpeg } from "./media";
import type { HiggsfieldKey } from "./secrets";

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
	ai: z
		.object({
			tts: z.enum(["openai", "macos", "elevenlabs"]).default("openai"),
			transcription: z.enum(["openai", "whisper"]).default("openai"),
			text: z.enum(["openai", "ollama", "lmstudio", "none"]).default("openai"),
			image: z.enum(["openai", "none"]).default("openai"),
			macVoice: z.string().default("Samantha"),
			macRate: z.number().min(80).max(400).optional(),
			whisperModel: z.string().optional(),
			textModel: z.string().optional(),
		})
		.default({
			tts: "openai",
			transcription: "openai",
			text: "openai",
			image: "openai",
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

/** sound: effects and music (ElevenLabs); video: generated clips (Higgsfield). */
export type Capability = "tts" | "transcription" | "text" | "image" | "sound" | "video";

/** Keys for the optional providers the user connects in Settings → AI. */
export interface Connections {
	elevenlabs?: string;
	higgsfield?: HiggsfieldKey;
}

export const CONNECT_ELEVENLABS = "Connect ElevenLabs in Settings → AI";
export const CONNECT_HIGGSFIELD = "Connect Higgsfield in Settings → AI";

export interface ProviderStatus {
	capability: Capability;
	provider: string;
	ready: boolean;
	/** Why it is not ready, in words for the user. */
	problem?: string;
	model?: string;
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
		},
	): Promise<{ audio: Buffer; provider: string; model: string; voice: string }>;
	transcribe(
		file: string,
		options: { language?: string; prompt?: string; model?: string },
	): Promise<{ text: string; segments: TranscriptSegment[] }>;
	image(
		prompt: string,
		options: { size: "1536x1024" | "1024x1536" | "1024x1024"; model?: string },
	): Promise<Buffer>;
	chat(system: string, prompt: string): Promise<string>;
	/** A sound effect from a description (ElevenLabs, MP3 bytes). */
	sound(
		prompt: string,
		options: { durationSeconds?: number; promptInfluence?: number; loop?: boolean },
	): Promise<Buffer>;
	/** Music from a description (ElevenLabs, MP3 bytes). */
	music(prompt: string, options: { lengthMs: number; instrumental?: boolean }): Promise<Buffer>;
	/** A video clip (Higgsfield), downloaded to `file`. */
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
	/** The ElevenLabs voices the key can use, optionally searched. */
	voices(search?: string): Promise<ElevenVoice[]>;
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

	const status = (): ProviderStatus[] => [
		ai.tts === "elevenlabs"
			? {
					capability: "tts",
					provider: "ElevenLabs",
					ready: !!keys.elevenlabs,
					problem: keys.elevenlabs ? undefined : CONNECT_ELEVENLABS,
				}
			: ai.tts === "openai"
				? {
						capability: "tts",
						provider: "OpenAI",
						ready: !!creds,
						problem: creds ? undefined : "Add an OpenAI API key",
					}
				: {
						capability: "tts",
						provider: "macOS voices",
						ready: local.macVoices.length > 0,
						model: ai.macVoice,
						problem: local.macVoices.length
							? undefined
							: process.platform === "darwin"
								? "No system voices found"
								: "macOS voices are only available on a Mac; choose OpenAI",
					},
		ai.transcription === "openai"
			? {
					capability: "transcription",
					provider: "OpenAI",
					ready: !!creds,
					problem: creds ? undefined : "Add an OpenAI API key",
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
					problem: creds ? undefined : "Add an OpenAI API key",
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
		ai.image === "openai"
			? {
					capability: "image",
					provider: "OpenAI",
					ready: !!creds,
					problem: creds ? undefined : "Add an OpenAI API key",
				}
			: { capability: "image", provider: "Off", ready: false, problem: "Images turned off" },
		{
			capability: "sound",
			provider: "ElevenLabs",
			ready: !!keys.elevenlabs,
			problem: keys.elevenlabs ? undefined : CONNECT_ELEVENLABS,
		},
		{
			capability: "video",
			provider: "Higgsfield",
			ready: !!keys.higgsfield,
			problem: keys.higgsfield ? undefined : CONNECT_HIGGSFIELD,
		},
	];

	const need = (capability: Capability) => {
		const s = status().find((x) => x.capability === capability);
		// The optional providers' problem already says where to go.
		if (!s?.ready && (capability === "sound" || capability === "video"))
			throw new Error(`${s?.problem ?? "Not connected"}.`);
		if (!s?.ready)
			throw new Error(
				`${capability === "tts" ? "Voice" : capability === "text" ? "Text model" : capability[0].toUpperCase() + capability.slice(1)} is not set up: ${s?.problem ?? "unavailable"}. Open Cue → Settings → AI.`,
			);
	};

	return {
		status,
		async speak(text, options) {
			need("tts");
			if (ai.tts === "macos") {
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
			if (ai.tts === "elevenlabs") {
				// An OpenAI voice name (the project's other voice) is no ElevenLabs voice.
				const asked =
					options.voice &&
					ELEVEN_VOICE_ID.test(options.voice) &&
					!TTS_VOICES.includes(options.voice)
						? options.voice
						: undefined;
				const voice = asked ?? options.elevenlabs?.voice;
				const model = options.elevenlabs?.model;
				if (!voice || !model) throw new Error("Choose an ElevenLabs voice (Generate → Voiceover).");
				const spoken = await elevenSpeech(keys.elevenlabs as string, {
					text,
					voice,
					model,
				});
				return {
					audio: await asWav(spoken.audio, spoken.format),
					provider: "elevenlabs",
					model,
					voice,
				};
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
			return elevenSound(keys.elevenlabs as string, { text: prompt, ...options });
		},
		async music(prompt, options) {
			need("sound");
			return elevenMusic(keys.elevenlabs as string, { prompt, ...options });
		},
		async clip(input, file, onProgress) {
			need("video");
			return generateClip(keys.higgsfield as HiggsfieldKey, input, file, { onProgress });
		},
		async voices(search) {
			if (!keys.elevenlabs) throw new Error(`${CONNECT_ELEVENLABS}.`);
			return elevenVoices(keys.elevenlabs, { search });
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
			return generateImage(creds as AiCredentials, {
				prompt,
				model: options.model ?? "gpt-image-2.5-flare",
				size: options.size,
			});
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
