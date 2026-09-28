import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contract, parseInput } from "../electron/control/contract";
import { resolveClipModel, snapDuration } from "../electron/core/clipModels";
import {
	elevenMusic,
	elevenSound,
	elevenSpeech,
	elevenVoices,
	testElevenLabs,
} from "../electron/core/elevenlabs";
import { generateClip, testHiggsfield, waitForClip } from "../electron/core/higgsfield";
import type { LocalInventory } from "../electron/core/local-ai";
import { aiSchema, emptyProject } from "../electron/core/project";
import { appSettingsSchema, buildRuntime } from "../electron/core/runtime";
import { parseSecrets, serializeSecrets, withSecret } from "../electron/core/secrets";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init: RequestInit };

/** A fake fetch answering each call in turn; records what was asked. */
function fakeFetch(answers: ((call: Call) => Response)[]) {
	const calls: Call[] = [];
	const fn = vi.fn(async (input: string | URL, init: RequestInit = {}) => {
		const call = { url: String(input), init };
		calls.push(call);
		const answer = answers[calls.length - 1];
		if (!answer) throw new Error(`Unexpected call ${call.url}`);
		return answer(call);
	});
	vi.stubGlobal("fetch", fn);
	return calls;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (text: string) => new Response(Buffer.from(text), { status: 200 });
const noSleep = async () => {};

describe("ElevenLabs", () => {
	it("asks for WAV speech with the key header, voice in the path and the model in the body", async () => {
		const calls = fakeFetch([() => bytes("RIFF")]);
		const out = await elevenSpeech("xi-key", {
			text: "Hello there",
			voice: "JBFqnCBsd6RMkjVDRZzb",
			model: "eleven_v3",
		});
		expect(out).toEqual({ audio: Buffer.from("RIFF"), format: "wav" });
		expect(calls[0].url).toBe(
			"https://api.elevenlabs.io/v1/text-to-speech/JBFqnCBsd6RMkjVDRZzb?output_format=wav_44100",
		);
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.headers).toMatchObject({
			"xi-api-key": "xi-key",
			"content-type": "application/json",
		});
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			text: "Hello there",
			model_id: "eleven_v3",
		});
	});

	it("falls back to MP3 when the plan can't have WAV, and reports a bad key in ElevenLabs' words", async () => {
		const calls = fakeFetch([
			() => json({ detail: { status: "output_format_not_allowed", message: "Upgrade" } }, 403),
			() => bytes("ID3"),
		]);
		const out = await elevenSpeech("k", { text: "Hi", voice: "abcdefgh12", model: "eleven_v3" });
		expect(out.format).toBe("mp3");
		expect(calls[1].url).toContain("output_format=mp3_44100_128");

		fakeFetch([() => json({ detail: { message: "Invalid API key" } }, 401)]);
		await expect(
			elevenSpeech("bad", { text: "Hi", voice: "abcdefgh12", model: "eleven_v3" }),
		).rejects.toThrow("ElevenLabs 401: Invalid API key");
	});

	it("lists voices across pages with the page token", async () => {
		const calls = fakeFetch([
			() =>
				json({
					voices: [
						{
							voice_id: "v1aaaaaaaa",
							name: "Aria",
							category: "premade",
							labels: { accent: "american" },
							preview_url: "https://storage.googleapis.com/a.mp3",
						},
					],
					has_more: true,
					next_page_token: "page2",
				}),
			() =>
				json({
					voices: [{ voice_id: "v2bbbbbbbb", name: "Roger" }],
					has_more: false,
					next_page_token: null,
				}),
		]);
		const voices = await elevenVoices("k", { search: "calm" });
		expect(voices).toEqual([
			{
				id: "v1aaaaaaaa",
				name: "Aria",
				category: "premade",
				labels: { accent: "american" },
				previewUrl: "https://storage.googleapis.com/a.mp3",
			},
			{ id: "v2bbbbbbbb", name: "Roger", category: undefined, labels: {}, previewUrl: undefined },
		]);
		const first = new URL(calls[0].url);
		expect(first.origin + first.pathname).toBe("https://api.elevenlabs.io/v2/voices");
		expect(first.searchParams.get("page_size")).toBe("100");
		expect(first.searchParams.get("search")).toBe("calm");
		expect(first.searchParams.has("next_page_token")).toBe(false);
		expect(new URL(calls[1].url).searchParams.get("next_page_token")).toBe("page2");
		expect(calls[0].init.headers).toEqual({ "xi-api-key": "k" });
	});

	it("tests a key with a one-voice page", async () => {
		const calls = fakeFetch([() => json({ voices: [], has_more: false })]);
		await testElevenLabs("k");
		expect(new URL(calls[0].url).searchParams.get("page_size")).toBe("1");
	});

	it("sends sound effect and music requests with their models and clamped lengths", async () => {
		const calls = fakeFetch([() => bytes("sfx"), () => bytes("music")]);
		await elevenSound("k", {
			text: "door slam",
			durationSeconds: 45,
			promptInfluence: 0.6,
			loop: true,
		});
		expect(calls[0].url).toBe("https://api.elevenlabs.io/v1/sound-generation");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			text: "door slam",
			model_id: "eleven_text_to_sound_v2",
			duration_seconds: 30,
			prompt_influence: 0.6,
			loop: true,
		});
		await elevenMusic("k", { prompt: "calm piano", lengthMs: 1000, instrumental: true });
		expect(calls[1].url).toBe("https://api.elevenlabs.io/v1/music");
		expect(JSON.parse(calls[1].init.body as string)).toEqual({
			prompt: "calm piano",
			music_length_ms: 3000,
			model_id: "music_v2_5",
			force_instrumental: true,
		});
		expect(calls[1].init.headers).toMatchObject({ "xi-api-key": "k" });
	});
});

describe("Higgsfield", () => {
	const key = { id: "kid", secret: "ksecret" };
	const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), "cue-hf-"));

	it("submits, polls until completed and downloads the video", async () => {
		const dir = await tmp();
		const calls = fakeFetch([
			() =>
				json({
					status: "queued",
					request_id: "r1",
					status_url: "https://platform.higgsfield.ai/requests/r1/status",
					cancel_url: "https://platform.higgsfield.ai/requests/r1/cancel",
				}),
			() => json({ status: "queued", request_id: "r1" }),
			() => json({ status: "in_progress", request_id: "r1" }),
			() => json({ status: "completed", video: { url: "https://cdn.example/v.mp4" } }),
			() => bytes("MP4DATA"),
		]);
		const progress: number[] = [];
		const out = await generateClip(
			key,
			{ prompt: "A cup of coffee", durationSec: 8, negativePrompt: "blur" },
			path.join(dir, "clip.mp4"),
			{ sleep: noSleep, onProgress: (f) => progress.push(f) },
		);
		expect(calls[0].url).toBe("https://api.higgsfield.ai/kling-video/v2.5-turbo/pro/text-to-video");
		expect(calls[0].init.headers).toMatchObject({ authorization: "Key kid:ksecret" });
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			prompt: "A cup of coffee",
			duration: 10,
			negative_prompt: "blur",
		});
		expect(calls[1].url).toBe("https://platform.higgsfield.ai/requests/r1/status");
		expect(calls[1].init.headers).toEqual({ authorization: "Key kid:ksecret" });
		// The download goes to the CDN without the key.
		expect(calls[4].url).toBe("https://cdn.example/v.mp4");
		expect(calls[4].init.headers).toBeUndefined();
		expect(await fs.readFile(out.file, "utf8")).toBe("MP4DATA");
		expect(out).toMatchObject({
			url: "https://cdn.example/v.mp4",
			model: "/kling-video/v2.5-turbo/pro/text-to-video",
			durationSec: 10,
		});
		expect(progress.at(-1)).toBe(1);
	});

	it("uploads a start picture and passes its public URL", async () => {
		const dir = await tmp();
		const still = path.join(dir, "still.png");
		await fs.writeFile(still, "PNG");
		const calls = fakeFetch([
			() =>
				json({
					upload_url: "https://uploads.example/put?sig=1",
					public_url: "https://files.example/still.png",
					upload_headers: { "Content-Type": "image/png", "x-amz-tagging": "retention=temporary" },
				}),
			() => new Response(null, { status: 200 }),
			() => json({ status: "queued", request_id: "r2" }),
			() => json({ status: "completed", video: { url: "https://cdn.example/w.mp4" } }),
			() => bytes("MP4"),
		]);
		await generateClip(
			key,
			{ prompt: "It starts to rain", image: still, model: "hailuo-2.3", durationSec: 5 },
			path.join(dir, "clip.mp4"),
			{ sleep: noSleep },
		);
		expect(calls[0].url).toBe("https://api.higgsfield.ai/files/generate-upload-url");
		expect(JSON.parse(calls[0].init.body as string)).toEqual({ content_type: "image/png" });
		expect(calls[1].url).toBe("https://uploads.example/put?sig=1");
		expect(calls[1].init.method).toBe("PUT");
		expect(calls[1].init.headers).toMatchObject({ "x-amz-tagging": "retention=temporary" });
		expect(calls[1].init.headers).not.toHaveProperty("authorization");
		expect(Buffer.from(calls[1].init.body as Uint8Array).toString()).toBe("PNG");
		expect(calls[2].url).toBe(
			"https://api.higgsfield.ai/minimax/hailuo-2.3/standard/image-to-video",
		);
		expect(JSON.parse(calls[2].init.body as string)).toEqual({
			prompt: "It starts to rain",
			duration: 6,
			image_url: "https://files.example/still.png",
			prompt_optimizer: true,
		});
		// Without a status_url on Higgsfield's host, Cue asks its own.
		expect(calls[3].url).toBe("https://api.higgsfield.ai/requests/r2/status");
	});

	it("turns failed, flagged and cancelled requests into errors", async () => {
		fakeFetch([() => json({ status: "failed", error: "Model overloaded" })]);
		await expect(
			waitForClip(key, "https://api.higgsfield.ai/s", { sleep: noSleep }),
		).rejects.toThrow("Higgsfield could not make the clip: Model overloaded");
		fakeFetch([() => json({ status: "in_progress" }), () => json({ status: "nsfw" })]);
		await expect(
			waitForClip(key, "https://api.higgsfield.ai/s", { sleep: noSleep }),
		).rejects.toThrow(/content check/);
		fakeFetch([() => json({ status: "canceled" })]);
		await expect(
			waitForClip(key, "https://api.higgsfield.ai/s", { sleep: noSleep }),
		).rejects.toThrow(/cancelled/);
		fakeFetch([() => json({ detail: "Not enough credits" }, 402)]);
		await expect(
			generateClip(key, { prompt: "x y z" }, "/tmp/never.mp4", { sleep: noSleep }),
		).rejects.toThrow("Higgsfield 402: Not enough credits");
	});

	it("gives up after the timeout", async () => {
		let t = 0;
		fakeFetch(Array.from({ length: 5 }, () => () => json({ status: "in_progress" })));
		await expect(
			waitForClip(key, "https://api.higgsfield.ai/s", {
				intervalMs: 4000,
				timeoutMs: 10000,
				now: () => t,
				sleep: async (ms) => {
					t += ms;
				},
			}),
		).rejects.toThrow(/longer than/);
	});

	it("resolves models from the table or a raw path, and snaps lengths", () => {
		expect(resolveClipModel(undefined, true).path).toBe(
			"/kling-video/v2.5-turbo/pro/image-to-video",
		);
		expect(resolveClipModel("/some-model/v1/text-to-video", false).path).toBe(
			"/some-model/v1/text-to-video",
		);
		expect(() => resolveClipModel("kling-2.5-turbo-standard", false)).toThrow(/picture/);
		expect(() => resolveClipModel("nope", false)).toThrow(/Unknown video model/);
		expect(() => resolveClipModel("/../x", false)).toThrow(/model path/);
		expect(snapDuration(7, [6, 10])).toBe(6);
		expect(snapDuration(9, [5, 10])).toBe(10);
		expect(snapDuration(undefined, [5, 10])).toBe(5);
	});

	it("tests a key: refused keys fail, anything else passes", async () => {
		fakeFetch([() => json({ detail: "Invalid credentials" }, 401)]);
		await expect(testHiggsfield(key)).rejects.toThrow("Higgsfield 401: Invalid credentials");
		fakeFetch([() => json({ detail: "Not found" }, 404)]);
		await expect(testHiggsfield(key)).resolves.toBeUndefined();
	});
});

describe("stored keys", () => {
	it("reads files from before ElevenLabs and Higgsfield", () => {
		expect(parseSecrets(JSON.stringify({ openai: "sk-old" }))).toEqual({ openai: "sk-old" });
		expect(parseSecrets("not json")).toEqual({});
	});

	it("sets and removes one provider's key and keeps the others", () => {
		let s = parseSecrets(JSON.stringify({ openai: "sk-1" }));
		s = withSecret(s, "elevenlabs", " xi-1 ");
		s = withSecret(s, "higgsfield", { id: "a", secret: "b" });
		expect(s).toEqual({ openai: "sk-1", elevenlabs: "xi-1", higgsfield: { id: "a", secret: "b" } });
		s = withSecret(s, "openai", null);
		expect(s).toEqual({ elevenlabs: "xi-1", higgsfield: { id: "a", secret: "b" } });
		expect(parseSecrets(serializeSecrets(s) as string)).toEqual(s);
		// A Higgsfield key needs both parts.
		expect(withSecret({}, "higgsfield", { id: "a", secret: "" })).toEqual({});
		expect(serializeSecrets(withSecret(s, "elevenlabs", null))).not.toBeNull();
		expect(serializeSecrets({})).toBeNull();
	});
});

describe("settings", () => {
	const local: LocalInventory = {
		macVoices: [],
		whisper: { binary: null, models: [] },
		ollama: { installed: false, running: false, models: [] },
		lmStudio: { running: false, models: [] },
	};

	it("accepts ElevenLabs as the voice provider", () => {
		expect(appSettingsSchema.parse({ ai: { tts: "elevenlabs" } }).ai.tts).toBe("elevenlabs");
		expect(() => appSettingsSchema.parse({ ai: { tts: "nobody" } })).toThrow();
	});

	it("validates the project's ElevenLabs voice and model", () => {
		const ai = emptyProject("P").ai;
		expect(ai.elevenModel).toBe("eleven_v3");
		expect(aiSchema.partial().parse({ elevenVoice: "JBFqnCBsd6RMkjVDRZzb" })).toBeTruthy();
		expect(() => aiSchema.partial().parse({ elevenVoice: "../x" })).toThrow();
		expect(() => aiSchema.partial().parse({ elevenModel: "gpt-4o-mini-tts" })).toThrow();
		expect(() =>
			parseInput("update_ai", { ai: { elevenModel: "eleven_multilingual_v2" } }),
		).not.toThrow();
	});

	it("reports sound and video as ready only with a key, and says where to connect", async () => {
		const settings = appSettingsSchema.parse({ ai: { tts: "elevenlabs" } });
		const off = buildRuntime(settings, null, local);
		const status = off.status();
		expect(status.find((s) => s.capability === "tts")).toMatchObject({
			provider: "ElevenLabs",
			ready: false,
			problem: "Connect ElevenLabs in Settings → AI",
		});
		expect(status.find((s) => s.capability === "video")?.ready).toBe(false);
		const calls = fakeFetch([]);
		await expect(off.sound("a door", {})).rejects.toThrow("Connect ElevenLabs in Settings → AI.");
		expect(calls).toHaveLength(0);

		const on = buildRuntime(settings, null, local, {
			elevenlabs: "xi",
			higgsfield: { id: "a", secret: "b" },
		});
		expect(
			on
				.status()
				.filter((s) => s.ready)
				.map((s) => s.capability),
		).toEqual(["tts", "sound", "video"]);
	});

	it("offers the new tools to agents", () => {
		for (const tool of ["generate_sound", "generate_clip", "list_voices"])
			expect(Object.keys(contract)).toContain(tool);
		expect(parseInput("generate_music", { prompt: "calm piano", lengthMs: 30000 })).toMatchObject({
			prompt: "calm piano",
			lengthMs: 30000,
		});
		expect(() => parseInput("generate_sound", { prompt: "door", variants: 5 })).toThrow();
	});
});
