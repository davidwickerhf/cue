import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KEY_FORMATS, matchKey, redactKeys, watchClipboard } from "../electron/core/connect";
import { falClip, falRun, falUpload, testFal } from "../electron/core/fal";
import type { LocalInventory } from "../electron/core/local-ai";
import { clipRoute, imageRoute, soundRoute, voiceRoute } from "../electron/core/routing";
import { appSettingsSchema, buildRuntime } from "../electron/core/runtime";
import { withEnvironment } from "../electron/core/secrets";

afterEach(() => vi.unstubAllGlobals());

type Call = { url: string; init: RequestInit };

function fakeFetch(answers: ((call: Call) => Response)[]) {
	const calls: Call[] = [];
	vi.stubGlobal(
		"fetch",
		vi.fn(async (input: string | URL, init: RequestInit = {}) => {
			const call = { url: String(input), init };
			calls.push(call);
			const answer = answers[calls.length - 1];
			if (!answer) throw new Error(`Unexpected call ${call.url}`);
			return answer(call);
		}),
	);
	return calls;
}

const json = (body: unknown, status = 200) =>
	new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const bytes = (text: string) => new Response(Buffer.from(text), { status: 200 });
const noSleep = async () => {};
const FAL_KEY = "0b1c2d3e-4f50-6172-8394-a5b6c7d8e9f0:0123456789abcdef0123456789abcdef";

const queued = (app: string, id: string) =>
	json({
		request_id: id,
		status_url: `https://queue.fal.run/${app}/requests/${id}/status`,
		response_url: `https://queue.fal.run/${app}/requests/${id}`,
		cancel_url: `https://queue.fal.run/${app}/requests/${id}/cancel`,
		queue_position: 0,
	});

describe("fal queue", () => {
	it("submits, polls the returned status URL and fetches the result from the response URL", async () => {
		const calls = fakeFetch([
			() => queued("fal-ai/elevenlabs", "r1"),
			() => json({ status: "IN_QUEUE", queue_position: 1 }),
			() => json({ status: "IN_PROGRESS" }),
			() => json({ status: "COMPLETED" }),
			() => json({ audio: { url: "https://v3.fal.media/files/x/out.mp3" } }),
		]);
		const states: string[] = [];
		const out = await falRun<{ audio: { url: string } }>(
			FAL_KEY,
			"fal-ai/elevenlabs/sound-effects/v2",
			{ text: "door slam" },
			{ sleep: noSleep, onStatus: (s) => states.push(s) },
		);
		expect(out.audio.url).toBe("https://v3.fal.media/files/x/out.mp3");
		expect(calls[0].url).toBe("https://queue.fal.run/fal-ai/elevenlabs/sound-effects/v2");
		expect(calls[0].init.method).toBe("POST");
		expect(calls[0].init.headers).toMatchObject({
			authorization: `Key ${FAL_KEY}`,
			"content-type": "application/json",
		});
		expect(JSON.parse(calls[0].init.body as string)).toEqual({ text: "door slam" });
		expect(calls[1].url).toBe("https://queue.fal.run/fal-ai/elevenlabs/requests/r1/status");
		expect(calls[1].init.headers).toEqual({ authorization: `Key ${FAL_KEY}` });
		expect(calls[4].url).toBe("https://queue.fal.run/fal-ai/elevenlabs/requests/r1");
		expect(states).toEqual(["IN_QUEUE", "IN_PROGRESS", "COMPLETED"]);
	});

	it("never sends the key to a queue URL on another host", async () => {
		const calls = fakeFetch([
			() =>
				json({
					request_id: "r2",
					status_url: "https://evil.example/status",
					response_url: "https://evil.example/response",
				}),
			() => json({ status: "COMPLETED" }),
			() => json({ ok: true }),
		]);
		await falRun(
			FAL_KEY,
			"fal-ai/kling-video/v2.5-turbo/pro/text-to-video",
			{},
			{ sleep: noSleep },
		);
		expect(calls[1].url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/r2/status");
		expect(calls[2].url).toBe("https://queue.fal.run/fal-ai/kling-video/requests/r2");
	});

	it("reports failures in fal's words", async () => {
		fakeFetch([() => json({ detail: "Insufficient balance" }, 403)]);
		await expect(falRun(FAL_KEY, "fal-ai/x/y", {}, { sleep: noSleep })).rejects.toThrow(
			"fal 403: Insufficient balance",
		);
		fakeFetch([
			() => queued("fal-ai/x", "r3"),
			() => json({ status: "COMPLETED", error: "Content policy violation", error_type: "x" }),
		]);
		await expect(falRun(FAL_KEY, "fal-ai/x/y", {}, { sleep: noSleep })).rejects.toThrow(
			"fal could not finish it: Content policy violation",
		);
		fakeFetch([
			() => queued("fal-ai/x", "r4"),
			() => json({ status: "COMPLETED" }),
			() => json({ detail: [{ msg: "image_url: not a picture" }] }, 422),
		]);
		await expect(falRun(FAL_KEY, "fal-ai/x/y", {}, { sleep: noSleep })).rejects.toThrow(
			"fal 422: image_url: not a picture",
		);
	});

	it("gives up after the timeout", async () => {
		let t = 0;
		fakeFetch([
			() => queued("fal-ai/x", "r5"),
			...Array.from({ length: 6 }, () => () => json({ status: "IN_PROGRESS" })),
		]);
		await expect(
			falRun(
				FAL_KEY,
				"fal-ai/x/y",
				{},
				{
					intervalMs: 3000,
					timeoutMs: 7000,
					now: () => t,
					sleep: async (ms) => {
						t += ms;
					},
				},
			),
		).rejects.toThrow(/longer than/);
	});

	it("uploads a file to fal's CDN: initiate with the key, PUT the bytes without it", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-fal-"));
		const file = path.join(dir, "still.jpg");
		await fs.writeFile(file, "JPEG");
		const calls = fakeFetch([
			() =>
				json({
					upload_url: "https://upload.fal.media/put?sig=1",
					file_url: "https://v3b.fal.media/files/b/1/still.jpg",
				}),
			() => new Response(null, { status: 200 }),
		]);
		expect(await falUpload(FAL_KEY, file)).toBe("https://v3b.fal.media/files/b/1/still.jpg");
		expect(calls[0].url).toBe(
			"https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3",
		);
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			content_type: "image/jpeg",
			file_name: "still.jpg",
		});
		expect(calls[0].init.headers).toMatchObject({ authorization: `Key ${FAL_KEY}` });
		expect(calls[1].init.method).toBe("PUT");
		expect(calls[1].init.headers).toEqual({ "content-type": "image/jpeg" });
	});

	it("makes a clip: upload, submit with a string duration, poll, download", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-fal-"));
		const still = path.join(dir, "still.png");
		await fs.writeFile(still, "PNG");
		const calls = fakeFetch([
			() =>
				json({ upload_url: "https://upload.fal.media/p", file_url: "https://v3b.fal.media/s.png" }),
			() => new Response(null, { status: 200 }),
			() => queued("fal-ai/minimax", "c1"),
			() => json({ status: "COMPLETED" }),
			() => json({ video: { url: "https://v3.fal.media/files/v.mp4" } }),
			() => bytes("MP4"),
		]);
		const out = await falClip(
			FAL_KEY,
			{ prompt: "Rain starts", image: still, model: "hailuo-2.3", durationSec: 9 },
			path.join(dir, "clip.mp4"),
			{ sleep: noSleep },
		);
		expect(calls[2].url).toBe(
			"https://queue.fal.run/fal-ai/minimax/hailuo-2.3/standard/image-to-video",
		);
		expect(JSON.parse(calls[2].init.body as string)).toEqual({
			prompt: "Rain starts",
			duration: "10",
			image_url: "https://v3b.fal.media/s.png",
			prompt_optimizer: true,
		});
		expect(await fs.readFile(out.file, "utf8")).toBe("MP4");
		expect(out).toMatchObject({ durationSec: 10, label: "Hailuo 2.3 Standard" });
	});

	it("tests a key against fal's model list", async () => {
		const calls = fakeFetch([
			() => json({ error: { type: "authorization_error", message: "Invalid API key" } }, 401),
		]);
		await expect(testFal("bad")).rejects.toThrow("fal 401: Invalid API key");
		expect(calls[0].url).toBe("https://api.fal.ai/v1/models?limit=1");
	});
});

describe("routing", () => {
	const none = { openai: false, fal: false, elevenlabs: false, higgsfield: false };

	it("prefers a direct key for the service, else fal", () => {
		expect(voiceRoute("auto", { ...none, openai: true, fal: true }, false).engine).toBe("openai");
		expect(voiceRoute("auto", { ...none, fal: true }, true).engine).toBe("fal");
		expect(voiceRoute("elevenlabs", { ...none, elevenlabs: true, fal: true }, false).engine).toBe(
			"elevenlabs",
		);
		expect(voiceRoute("elevenlabs", { ...none, fal: true }, false).provider).toBe(
			"ElevenLabs via fal",
		);
		expect(voiceRoute("openai", { ...none, fal: true }, false)).toMatchObject({
			engine: null,
			connect: "openai",
		});
		expect(voiceRoute("auto", none, true).engine).toBe("macos");
		expect(voiceRoute("auto", none, false)).toMatchObject({ engine: null, connect: "fal" });

		expect(imageRoute("auto", { ...none, openai: true, fal: true }).engine).toBe("openai");
		expect(imageRoute("auto", { ...none, fal: true }).engine).toBe("fal");
		expect(imageRoute("openai", { ...none, fal: true }).engine).toBeNull();

		expect(soundRoute({ ...none, elevenlabs: true, fal: true }).engine).toBe("elevenlabs");
		expect(soundRoute({ ...none, fal: true }).engine).toBe("fal");
		expect(clipRoute({ ...none, fal: true, higgsfield: true }).engine).toBe("fal");
		expect(clipRoute({ ...none, higgsfield: true }).engine).toBe("higgsfield");
		expect(clipRoute(none).connect).toBe("fal");
	});

	it("sends sound effects through fal when only fal is connected, clamped to its 22 s", async () => {
		const local: LocalInventory = {
			macVoices: [],
			whisper: { binary: null, models: [] },
			ollama: { installed: false, running: false, models: [] },
			lmStudio: { running: false, models: [] },
		};
		const runtime = buildRuntime(appSettingsSchema.parse({}), null, local, { fal: FAL_KEY });
		const calls = fakeFetch([
			() => queued("fal-ai/elevenlabs", "s1"),
			() => json({ status: "COMPLETED" }),
			() => json({ audio: { url: "https://v3.fal.media/files/s.mp3" } }),
			() => bytes("ID3"),
		]);
		expect(await runtime.sound("thunder", { durationSeconds: 28 })).toEqual(Buffer.from("ID3"));
		expect(JSON.parse(calls[0].init.body as string)).toEqual({
			text: "thunder",
			duration_seconds: 22,
		});
		expect(runtime.soundProvider().provider).toBe("fal");
		expect(runtime.status().find((s) => s.capability === "image")?.provider).toBe(
			"GPT Image 2 via fal",
		);
		const voices = await runtime.voices("geo");
		expect(voices).toMatchObject({ via: "fal", voices: [{ id: "George", name: "George" }] });
		expect(runtime.connections().find((c) => c.service === "fal")).toEqual({
			service: "fal",
			connected: true,
			source: "stored",
		});
	});
});

describe("keys from the environment", () => {
	it("uses them only for services with no stored key, and says where each came from", () => {
		const { keys, sources } = withEnvironment(
			{ openai: "sk-stored" },
			{ OPENAI_API_KEY: "sk-env", FAL_KEY: " fal-env ", XI_API_KEY: "xi-env" },
		);
		expect(keys).toEqual({ openai: "sk-stored", fal: "fal-env", elevenlabs: "xi-env" });
		expect(sources).toEqual({ openai: "stored", fal: "environment", elevenlabs: "environment" });
		expect(withEnvironment({}, { ELEVENLABS_API_KEY: "a", XI_API_KEY: "b" }).keys.elevenlabs).toBe(
			"a",
		);
		expect(withEnvironment({}, {}).sources).toEqual({});
	});
});

describe("clipboard connect", () => {
	const eleven = `sk_${"a1".repeat(24)}`;

	it("recognises each service's key format and nothing else", () => {
		expect(matchKey("fal", ` ${FAL_KEY}\n`)).toBe(FAL_KEY);
		expect(matchKey("fal", "hello world")).toBeNull();
		expect(matchKey("openai", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789")).not.toBeNull();
		expect(matchKey("openai", "sk-admin-abcdefghijklmnopqrstuvwxyz0123")).toBeNull();
		expect(matchKey("openai", FAL_KEY)).toBeNull();
		expect(matchKey("elevenlabs", eleven)).toBe(eleven);
		expect(matchKey("elevenlabs", `${eleven}x`)).toBeNull();
		expect(matchKey("elevenlabs", "sk-proj-abcdefghijklmnopqrstuvwxyz0123456789")).toBeNull();
		expect(KEY_FORMATS.fal.test(`my key is ${FAL_KEY}`)).toBe(false);
		expect(redactKeys("Incorrect API key provided: sk-proj-****abcd.")).toBe(
			"Incorrect API key provided: ….",
		);
	});

	/** A clipboard and a clock driven by hand. */
	function harness(initial: string) {
		let clip = initial;
		let t = 0;
		let tick: (() => void) | null = null;
		let cleared = false;
		return {
			copy: (text: string) => {
				clip = text;
			},
			advance: async (ms: number) => {
				t += ms;
				tick?.();
				// Let the async read and validation settle.
				for (let i = 0; i < 5; i++) await Promise.resolve();
			},
			options: {
				read: async () => clip,
				setInterval: (fn: () => void) => {
					tick = fn;
					return 1;
				},
				clearInterval: () => {
					cleared = true;
				},
				now: () => t,
			},
			get cleared() {
				return cleared;
			},
		};
	}

	it("ignores what was copied before and anything not a key; validates, then connects", async () => {
		const h = harness(FAL_KEY);
		const validate = vi.fn(async (key: string) => {
			if (key.endsWith("dead")) throw new Error(`Invalid key ${key}`);
		});
		const rejected: string[] = [];
		const watch = watchClipboard({
			service: "fal",
			validate,
			onRejected: (m) => rejected.push(m),
			...h.options,
		});
		await h.advance(1000);
		expect(validate).not.toHaveBeenCalled();
		h.copy("some notes about the edit");
		await h.advance(1000);
		expect(validate).not.toHaveBeenCalled();
		const refused = `${FAL_KEY.slice(0, -4)}dead`;
		h.copy(refused);
		await h.advance(1000);
		expect(validate).toHaveBeenCalledTimes(1);
		expect(rejected).toHaveLength(1);
		expect(rejected[0]).not.toContain(refused);
		// The same text isn't checked twice.
		await h.advance(1000);
		expect(validate).toHaveBeenCalledTimes(1);
		const good = FAL_KEY.replace("0b1c", "9b1c");
		h.copy(good);
		await h.advance(1000);
		expect(await watch.result).toEqual({ state: "connected", key: good });
		expect(h.cleared).toBe(true);
	});

	it("stops on timeout and on cancel", async () => {
		const h = harness("");
		const timed = watchClipboard({
			service: "openai",
			validate: async () => {},
			timeoutMs: 3000,
			...h.options,
		});
		await h.advance(1000);
		await h.advance(3000);
		expect(await timed.result).toEqual({ state: "timeout" });
		expect(h.cleared).toBe(true);

		const h2 = harness("");
		const validate = vi.fn(async () => {});
		const cancelled = watchClipboard({ service: "elevenlabs", validate, ...h2.options });
		await h2.advance(1000);
		cancelled.cancel();
		h2.copy(eleven);
		await h2.advance(1000);
		expect(await cancelled.result).toEqual({ state: "cancelled" });
		expect(validate).not.toHaveBeenCalled();
		expect(h2.cleared).toBe(true);
	});
});

describe("keys pasted by hand", () => {
	it("finds the key in what was pasted, ignoring invisible characters and labels", async () => {
		const { findKey } = await import("../electron/core/connect");
		const key = `sk_${"a1".repeat(24)}`;
		expect(findKey("elevenlabs", `  ${key}\n`)).toEqual({ key });
		expect(findKey("elevenlabs", `​${key}﻿`)).toEqual({ key });
		expect(findKey("elevenlabs", `API key: "${key}"`)).toEqual({ key });
		const long = findKey("elevenlabs", `${key}x`);
		expect(long.key).toBeNull();
		expect(long.key === null && long.reason).toMatch(/51 characters.*52/);
		expect(findKey("elevenlabs", "sk_abc").key).toBeNull();
	});
});

describe("Higgsfield keys", () => {
	it("takes the key ID and secret from how they're pasted", async () => {
		const { findKey, higgsfieldPair } = await import("../electron/core/connect");
		const id = "hf_key_1234abcd";
		const secret = "s3cretValue_5678efgh";
		expect(higgsfieldPair(`${id}:${secret}`)).toBe(`${id}:${secret}`);
		expect(higgsfieldPair(`${id}\n${secret}`)).toBe(`${id}:${secret}`);
		expect(higgsfieldPair(`Key ID: ${id}\nSecret: ${secret}`)).toBe(`${id}:${secret}`);
		expect(higgsfieldPair(`API key secret: "${secret}"  API key ID: ${id}`)).toBe(
			`${id}:${secret}`,
		);
		expect(findKey("higgsfield", id).key).toBeNull();
	});

	it("collects the two values copied one after the other, in either order", async () => {
		const { watchClipboard } = await import("../electron/core/connect");
		const id = "hf_key_1234abcd";
		const secret = "s3cretValue_5678efgh";
		let clip = "something from before";
		let tick: () => void = () => {};
		const progress: string[] = [];
		const watch = watchClipboard({
			service: "higgsfield",
			read: () => clip,
			// Only id:secret in that order works.
			validate: async (key) => {
				if (key !== `${id}:${secret}`) throw new Error("401 Invalid credentials");
			},
			onProgress: (m) => progress.push(m),
			setInterval: (fn) => {
				tick = fn;
				return 1;
			},
			clearInterval: () => {},
		});
		const step = async () => {
			tick();
			await new Promise((r) => setTimeout(r, 0));
		};
		await step();
		clip = secret; // the secret first
		await step();
		expect(progress).toHaveLength(1);
		clip = id;
		await step();
		await expect(watch.result).resolves.toEqual({ state: "connected", key: `${id}:${secret}` });
	});
});
