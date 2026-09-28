import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fake = vi.hoisted(() => {
	const captures: { distinctId?: string; event: string; properties?: Record<string, unknown> }[] =
		[];
	const constructed: { key: string; options: Record<string, unknown> }[] = [];
	const shutdown = vi.fn(async () => {});
	class PostHog {
		constructor(key: string, options: Record<string, unknown>) {
			constructed.push({ key, options });
		}
		capture(message: (typeof captures)[number]) {
			captures.push(message);
		}
		shutdown = shutdown;
	}
	return { PostHog, captures, constructed, shutdown };
});
vi.mock("posthog-node", () => ({ PostHog: fake.PostHog }));

import type { AiRuntime } from "../electron/core/runtime";
import {
	allowedProperties,
	durationBucket,
	providerId,
	USAGE_EVENTS,
	USAGE_HOST,
	Usage,
	type UsageConfig,
	type UsageSetting,
	withUsage,
} from "../electron/core/usage";

let dir: string;
let setting: UsageSetting;

/** A release build: token, packaged, no test or development variables. */
function reporter(overrides: Partial<UsageConfig> = {}) {
	const usage = new Usage();
	usage.configure({
		key: "phc_test",
		dataDir: dir,
		version: "0.3.0",
		packaged: true,
		setting: () => setting,
		env: {},
		...overrides,
	});
	return usage;
}

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), "cue-usage-"));
	setting = "on";
	fake.captures.length = 0;
	fake.constructed.length = 0;
	fake.shutdown.mockClear();
});
afterEach(async () => {
	vi.useRealTimers();
	await rm(dir, { recursive: true, force: true });
});

describe("usage reporting is off unless everything allows it", () => {
	const cases: [string, Partial<UsageConfig>, UsageSetting][] = [
		["the setting is off", {}, "off"],
		["the user hasn't answered yet", {}, "ask"],
		["a development build", { packaged: false }, "on"],
		["a test run", { env: { VITEST: "true" } }, "on"],
		["a development copy (CUE_USER_DATA)", { env: { CUE_USER_DATA: "/tmp/x" } }, "on"],
		["no token in the build", { key: "" }, "on"],
	];
	for (const [name, overrides, value] of cases)
		it(`sends nothing when ${name}`, async () => {
			setting = value;
			const usage = reporter(overrides);
			usage.launch({ os: "darwin", arch: "arm64", locale: "en-GB" });
			usage.track("project_created", {});
			usage.countTool("get_state");
			usage.flushTools();
			await usage.shutdown();
			expect(fake.constructed).toHaveLength(0);
			expect(fake.captures).toHaveLength(0);
		});

	it("the real process environment of a test run disables it", () => {
		const usage = new Usage();
		usage.configure({
			key: "phc_test",
			dataDir: dir,
			version: "0.3.0",
			packaged: true,
			setting: () => "on",
		});
		expect(usage.available()).toBe(false);
	});

	it("sends to the EU host, without GeoIP or person profiles", () => {
		const usage = reporter();
		usage.track("project_created", {});
		expect(fake.constructed).toHaveLength(1);
		expect(fake.constructed[0].options).toMatchObject({
			host: USAGE_HOST,
			disableGeoip: true,
			flushAt: 20,
			flushInterval: 30000,
		});
		expect(USAGE_HOST).toBe("https://eu.i.posthog.com");
		expect(fake.captures[0]).toMatchObject({
			event: "project_created",
			disableGeoip: true,
			properties: { $process_person_profile: false },
		});
	});

	it("turning it off drops what is queued and stops sending", async () => {
		const usage = reporter();
		usage.track("project_created", {});
		usage.countTool("get_state");
		setting = "off";
		usage.settingChanged();
		// The client's own fetch refuses to send once sharing is off.
		const fetchOption = fake.constructed[0].options.fetch as (
			url: string,
			init: unknown,
		) => Promise<{ status: number }>;
		const realFetch = vi.spyOn(globalThis, "fetch");
		await expect(fetchOption(`${USAGE_HOST}/batch/`, { method: "POST" })).resolves.toMatchObject({
			status: 200,
		});
		expect(realFetch).not.toHaveBeenCalled();
		realFetch.mockRestore();
		usage.flushTools();
		usage.track("project_created", {});
		expect(fake.captures.map((c) => c.event)).toEqual(["project_created"]);
	});
});

describe("the property allowlist", () => {
	it("strips every property that isn't allowed", () => {
		expect(
			allowedProperties("export_finished", {
				kind: "video",
				durationBucket: "2-10m",
				success: true,
				out: "/Users/someone/Movies/Secret project.mp4",
				projectName: "Secret project",
			}),
		).toEqual({ kind: "video", durationBucket: "2-10m", success: true });
		expect(allowedProperties("project_created", { name: "Secret", path: "/x" })).toEqual({});
		expect(
			allowedProperties("agent_chat_turn", { harness: "claude", prompt: "cut the boring bits" }),
		).toEqual({ harness: "claude" });
	});

	it("drops events whose values aren't of the allowed kind", () => {
		// Free text never gets through in place of an enum, version or language.
		expect(allowedProperties("export_finished", { kind: "My file.mp4" })).toBeNull();
		expect(
			allowedProperties("app_opened", {
				version: "0.3.0",
				os: "darwin",
				arch: "arm64",
				locale: "en-GB",
			}),
		).toBeNull();
		expect(allowedProperties("update_installed", { from: "/Users/me", to: "0.3.0" })).toBeNull();
		expect(
			allowedProperties("generation_used", { capability: "voice", provider: "sk-abc123" }),
		).toBeNull();
		// Tool counts only for Cue's own tools.
		expect(
			allowedProperties("mcp_request_batch", { tools: { "/Users/me/file": 1 }, total: 1 }),
		).toBeNull();
	});

	it("covers exactly the documented events", () => {
		expect(Object.keys(USAGE_EVENTS).sort()).toEqual(
			[
				"agent_chat_turn",
				"app_opened",
				"export_finished",
				"generation_used",
				"mcp_request_batch",
				"motion_timeline_used",
				"project_created",
				"update_installed",
			].sort(),
		);
	});

	it("never sends a property that isn't allowed, even when a caller passes one", () => {
		const usage = reporter();
		usage.track("export_finished", {
			kind: "gif",
			durationBucket: "under-30s",
			success: false,
			...({ file: "/Users/me/secret.gif" } as object),
		});
		expect(fake.captures[0].properties).toEqual({
			kind: "gif",
			durationBucket: "under-30s",
			success: false,
			$process_person_profile: false,
		});
	});

	it("buckets durations and names providers", () => {
		expect(durationBucket(5000)).toBe("under-30s");
		expect(durationBucket(90000)).toBe("30s-2m");
		expect(durationBucket(5 * 60000)).toBe("2-10m");
		expect(durationBucket(20 * 60000)).toBe("10-30m");
		expect(durationBucket(2 * 3600000)).toBe("over-30m");
		expect(providerId("OpenAI")).toBe("openai");
		expect(providerId("whisper.cpp (on this Mac)")).toBe("whisper");
		expect(providerId("ElevenLabs via fal")).toBe("elevenlabs");
		expect(providerId("fal (Kling, Hailuo)")).toBe("fal");
		expect(providerId("macos")).toBe("macos");
		expect(providerId("Someone's API key")).toBe("other");
	});
});

describe("install id and launch", () => {
	it("is a random id that persists in the data folder", async () => {
		const first = reporter();
		first.track("project_created", {});
		const id = fake.captures[0].distinctId;
		expect(id).toMatch(/^[0-9a-f-]{36}$/);
		const stored = JSON.parse(await readFile(path.join(dir, "usage.json"), "utf8"));
		expect(stored.installId).toBe(id);
		// A later launch uses the same id.
		const second = reporter();
		second.track("project_created", {});
		expect(fake.captures[1].distinctId).toBe(id);
		expect(second.installId()).toBe(id);
	});

	it("is not created while sharing is off", async () => {
		setting = "off";
		reporter().track("project_created", {});
		await expect(readFile(path.join(dir, "usage.json"), "utf8")).rejects.toThrow();
	});

	it("sends app_opened once per launch, with the language only", () => {
		const usage = reporter();
		usage.launch({ os: "darwin", arch: "arm64", locale: "de-AT" });
		usage.settingChanged();
		usage.once("motion_timeline_used", {});
		usage.once("motion_timeline_used", {});
		expect(fake.captures.map((c) => c.event)).toEqual(["app_opened", "motion_timeline_used"]);
		expect(fake.captures[0].properties).toEqual({
			version: "0.3.0",
			os: "darwin",
			arch: "arm64",
			locale: "de",
			$process_person_profile: false,
		});
	});

	it("sends app_opened when sharing is turned on later in the launch", () => {
		setting = "ask";
		const usage = reporter();
		usage.launch({ os: "linux", arch: "x64", locale: "fr" });
		expect(fake.captures).toHaveLength(0);
		setting = "on";
		usage.settingChanged();
		expect(fake.captures.map((c) => c.event)).toEqual(["app_opened"]);
	});

	it("reports an update from the last version launched", async () => {
		await writeFile(path.join(dir, "usage.json"), JSON.stringify({ lastVersion: "0.2.10" }));
		reporter().launch({ os: "win32", arch: "x64", locale: "en" });
		expect(fake.captures[0]).toMatchObject({
			event: "update_installed",
			properties: { from: "0.2.10", to: "0.3.0" },
		});
		// Not again on the next launch of the same version.
		fake.captures.length = 0;
		reporter().launch({ os: "win32", arch: "x64", locale: "en" });
		expect(fake.captures.map((c) => c.event)).toEqual(["app_opened"]);
	});
});

describe("MCP tool counts", () => {
	it("are added up and sent as one batch after the interval", () => {
		vi.useFakeTimers();
		const usage = reporter({ batchMs: 1000 });
		for (const tool of ["get_state", "get_timeline", "get_state", "add_marker", "get_state"])
			usage.countTool(tool);
		usage.countTool("not_a_tool");
		expect(fake.captures).toHaveLength(0);
		vi.advanceTimersByTime(1000);
		expect(fake.captures).toHaveLength(1);
		expect(fake.captures[0]).toMatchObject({
			event: "mcp_request_batch",
			properties: { tools: { get_state: 3, get_timeline: 1, add_marker: 1 }, total: 5 },
		});
		// Nothing more until new calls come in.
		vi.advanceTimersByTime(5000);
		expect(fake.captures).toHaveLength(1);
		usage.countTool("undo");
		vi.advanceTimersByTime(1000);
		expect(fake.captures[1].properties?.tools).toEqual({ undo: 1 });
	});

	it("are sent before quitting", async () => {
		const usage = reporter();
		usage.countTool("export");
		await usage.shutdown();
		expect(fake.captures[0]).toMatchObject({
			event: "mcp_request_batch",
			properties: { tools: { export: 1 }, total: 1 },
		});
		expect(fake.shutdown).toHaveBeenCalled();
	});
});

describe("generation_used", () => {
	it("is recorded after a successful generation, with only capability and provider", async () => {
		const usage = reporter();
		const runtime = {
			status: () => [{ capability: "transcription", provider: "OpenAI", ready: true }],
			speak: async () => ({
				audio: Buffer.alloc(0),
				provider: "elevenlabs",
				model: "m",
				voice: "v",
			}),
			transcribe: async () => ({ text: "secret words", segments: [] }),
			image: async () => {
				throw new Error("no key");
			},
			soundProvider: () => ({ provider: "fal", soundModel: "s", musicModel: "m" }),
		} as unknown as AiRuntime;
		const wrapped = withUsage(runtime, usage);
		await wrapped.speak("Hello there", {});
		await wrapped.transcribe("/Users/me/secret.wav", {});
		await expect(wrapped.image("a prompt", { size: "1024x1024" })).rejects.toThrow("no key");
		expect(fake.captures.map((c) => c.properties)).toEqual([
			{ capability: "voice", provider: "elevenlabs", $process_person_profile: false },
			{ capability: "transcription", provider: "openai", $process_person_profile: false },
		]);
	});
});
