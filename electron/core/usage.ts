import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PostHog, type PostHogOptions } from "posthog-node";
import { z } from "zod";
import { contract, type MethodName } from "../control/contract";
import type { AiRuntime, Capability } from "./runtime";

/**
 * Opt-in anonymous usage reporting (PostHog, EU cloud).
 *
 * Nothing is sent unless every one of these holds: the build has a project token
 * (CUE_POSTHOG_KEY, injected by the release build), it is a packaged build, it isn't a test
 * run (VITEST) or a development copy (CUE_USER_DATA), and the user chose "on" (Settings →
 * General → Share anonymous usage, or the one-time dialog). Events carry only the properties
 * in USAGE_EVENTS below, checked on every call: never names, paths, project content, prompts
 * or keys. What is sent is listed for users on the site's /privacy page; keep the two in step.
 */

export type UsageSetting = "ask" | "on" | "off";

/** The project token, fixed at build time (vite.config.ts); empty in development and forks. */
export const BUILD_POSTHOG_KEY: string = process.env.CUE_POSTHOG_KEY ?? "";
export const USAGE_HOST = "https://eu.i.posthog.com";
/** MCP tool counts are added up and sent at most this often. */
export const MCP_BATCH_MS = 5 * 60 * 1000;

const version = z
	.string()
	.max(40)
	.regex(/^\d+\.\d+\.\d+[\w.+-]*$/);
const harness = z.enum(["claude", "codex", "gemini"]);
export const GENERATION_CAPABILITIES = [
	"voice",
	"sound",
	"music",
	"clip",
	"image",
	"transcription",
] as const;
export type GenerationCapability = (typeof GENERATION_CAPABILITIES)[number];
export const GENERATION_PROVIDERS = [
	"openai",
	"elevenlabs",
	"fal",
	"higgsfield",
	"macos",
	"whisper",
	"ollama",
	"lmstudio",
	"cue",
	"other",
] as const;
export type GenerationProvider = (typeof GENERATION_PROVIDERS)[number];
export const DURATION_BUCKETS = ["under-30s", "30s-2m", "2-10m", "10-30m", "over-30m"] as const;
const toolNames = Object.keys(contract) as [MethodName, ...MethodName[]];

/**
 * The allowlist: every event and exactly the properties it may carry. Anything else is
 * stripped; an event whose properties don't match is dropped.
 */
export const USAGE_EVENTS = {
	/** Once per launch (or when usage sharing is turned on during a launch). */
	app_opened: z.object({
		version,
		os: z.enum(["darwin", "win32", "linux"]),
		arch: z.enum(["arm64", "x64", "ia32", "arm"]),
		/** The interface language only ("en"), never the region. */
		locale: z.string().regex(/^[a-z]{2,3}$/),
	}),
	project_created: z.object({}),
	export_finished: z.object({
		kind: contract.export.input.kind,
		/** How long the exported part of the timeline is. */
		durationBucket: z.enum(DURATION_BUCKETS),
		success: z.boolean(),
	}),
	/** A message sent to an agent in Cue's agent panel. */
	agent_chat_turn: z.object({ harness }),
	/** MCP tool calls by agents, counted per tool and sent at most every MCP_BATCH_MS. */
	mcp_request_batch: z.object({
		tools: z.partialRecord(z.enum(toolNames), z.number().int().positive()),
		total: z.number().int().positive(),
	}),
	generation_used: z.object({
		capability: z.enum(GENERATION_CAPABILITIES),
		provider: z.enum(GENERATION_PROVIDERS),
	}),
	/** Once per launch. */
	motion_timeline_used: z.object({}),
	update_installed: z.object({ from: version, to: version }),
} as const;
export type UsageEvent = keyof typeof USAGE_EVENTS;
export type UsageProps<E extends UsageEvent> = z.input<(typeof USAGE_EVENTS)[E]>;

/** Events the window may report itself (everything else is recorded in the main process). */
export const WINDOW_EVENTS: readonly UsageEvent[] = ["motion_timeline_used"];

/** Only the allowed properties of an event, or null when they don't fit the allowlist. */
export function allowedProperties<E extends UsageEvent>(
	event: E,
	props: unknown,
): Record<string, unknown> | null {
	const schema = USAGE_EVENTS[event] as z.ZodType | undefined;
	if (!schema) return null;
	const parsed = schema.safeParse(props ?? {});
	return parsed.success ? (parsed.data as Record<string, unknown>) : null;
}

export function durationBucket(ms: number): (typeof DURATION_BUCKETS)[number] {
	const s = ms / 1000;
	return s < 30
		? "under-30s"
		: s < 120
			? "30s-2m"
			: s < 600
				? "2-10m"
				: s < 1800
					? "10-30m"
					: "over-30m";
}

/** A provider name as the runtime reports it ("OpenAI", "whisper.cpp (on this Mac)"), as one of the allowed values. */
export function providerId(name: string | undefined): GenerationProvider {
	const n = (name ?? "").toLowerCase();
	// Most specific first: "whisper.cpp (on this Mac)" is whisper, not macOS.
	const order: [GenerationProvider, RegExp][] = [
		["whisper", /whisper/],
		["elevenlabs", /elevenlabs/],
		["higgsfield", /higgsfield/],
		["ollama", /ollama/],
		["lmstudio", /lm ?studio/],
		["openai", /openai/],
		["fal", /\bfal\b/],
		["macos", /^macos$|\bsay\b/],
		["cue", /^cue$/],
	];
	return order.find(([, re]) => re.test(n))?.[0] ?? "other";
}

/** The interface language of a locale ("en-GB" → "en"). */
export function language(locale: string): string {
	return (/^[a-z]{2,3}/i.exec(locale)?.[0] ?? "").toLowerCase();
}

export interface UsageConfig {
	/** Project token; empty disables everything. */
	key: string;
	/** Where usage.json (install id, last version) lives. */
	dataDir: string;
	version: string;
	/** A packaged build (development builds never send). */
	packaged: boolean;
	setting: () => UsageSetting;
	env?: Record<string, string | undefined>;
	/** For tests: the timer used for MCP batches. */
	batchMs?: number;
}

interface UsageFile {
	installId?: string;
	lastVersion?: string;
}

/** A response for requests made after sharing was turned off: accepted and dropped. */
const DROPPED = {
	status: 200,
	text: async () => "",
	json: async () => ({}),
};

export class Usage {
	private config: UsageConfig | null = null;
	private client: PostHog | null = null;
	private toolCounts = new Map<MethodName, number>();
	private batchTimer: NodeJS.Timeout | null = null;
	private sentOnce = new Set<UsageEvent>();
	private launchInfo: UsageProps<"app_opened"> | null = null;
	private id: string | null = null;

	configure(config: UsageConfig) {
		this.config = config;
		this.id = null;
	}

	/** Whether this build could report at all (token, packaged, not a test or development copy). */
	available(): boolean {
		const c = this.config;
		if (!c?.key || !c.packaged) return false;
		const env = c.env ?? process.env;
		// CUE_DISABLE_USAGE: a switch for automation that runs packaged builds.
		return !env.VITEST && !env.CUE_USER_DATA && !env.CUE_DISABLE_USAGE;
	}

	/** Whether events are sent right now. */
	enabled(): boolean {
		return this.available() && this.config?.setting() === "on";
	}

	private file(): string {
		return path.join((this.config as UsageConfig).dataDir, "usage.json");
	}

	private read(): UsageFile {
		try {
			return JSON.parse(readFileSync(this.file(), "utf8")) as UsageFile;
		} catch {
			return {};
		}
	}

	private write(data: UsageFile) {
		try {
			mkdirSync(path.dirname(this.file()), { recursive: true });
			writeFileSync(this.file(), JSON.stringify(data, null, 2));
		} catch {}
	}

	/** The random id of this installation, made the first time it is needed and kept in usage.json. */
	installId(): string {
		if (this.id) return this.id;
		const data = this.read();
		if (data.installId && /^[\w-]{8,64}$/.test(data.installId)) this.id = data.installId;
		else {
			this.id = randomUUID();
			this.write({ ...data, installId: this.id });
		}
		return this.id;
	}

	private posthog(): PostHog | null {
		if (!this.enabled()) return null;
		if (!this.client) {
			const options: PostHogOptions = {
				host: USAGE_HOST,
				flushAt: 20,
				flushInterval: 30000,
				disableGeoip: true,
				enableExceptionAutocapture: false,
				// Queued events are dropped, not sent, once sharing is turned off.
				fetch: (url, init) =>
					this.enabled() ? (fetch(url, init as RequestInit) as never) : Promise.resolve(DROPPED),
			};
			this.client = new PostHog((this.config as UsageConfig).key, options);
		}
		return this.client;
	}

	/** Records one event, if usage sharing is on. Never throws. */
	track<E extends UsageEvent>(event: E, props: UsageProps<E>) {
		try {
			const client = this.posthog();
			if (!client) return;
			const properties = allowedProperties(event, props);
			if (!properties) return;
			client.capture({
				distinctId: this.installId(),
				event,
				properties: { ...properties, $process_person_profile: false },
				disableGeoip: true,
			});
		} catch {}
	}

	/** Records an event at most once per launch. */
	once<E extends UsageEvent>(event: E, props: UsageProps<E>) {
		if (this.sentOnce.has(event) || !this.enabled()) return;
		this.sentOnce.add(event);
		this.track(event, props);
	}

	/**
	 * At launch: app_opened, and update_installed when the version changed since the last
	 * launch. The last version is only kept by builds that could report.
	 */
	launch(info: { os: string; arch: string; locale: string }) {
		const c = this.config;
		if (!c || !this.available()) return;
		this.launchInfo = {
			version: c.version,
			os: info.os as UsageProps<"app_opened">["os"],
			arch: info.arch as UsageProps<"app_opened">["arch"],
			locale: language(info.locale),
		};
		const data = this.read();
		if (data.lastVersion !== c.version) {
			if (data.lastVersion)
				this.track("update_installed", { from: data.lastVersion, to: c.version });
			this.write({ ...data, lastVersion: c.version });
		}
		if (this.launchInfo) this.once("app_opened", this.launchInfo);
	}

	/** An MCP tool call by an agent; sent later, added up with the others. */
	countTool(method: string) {
		if (!this.enabled() || !(method in contract)) return;
		const name = method as MethodName;
		this.toolCounts.set(name, (this.toolCounts.get(name) ?? 0) + 1);
		if (!this.batchTimer) {
			this.batchTimer = setTimeout(() => this.flushTools(), this.config?.batchMs ?? MCP_BATCH_MS);
			this.batchTimer.unref?.();
		}
	}

	/** Sends the MCP tool counts gathered so far as one mcp_request_batch. */
	flushTools() {
		if (this.batchTimer) clearTimeout(this.batchTimer);
		this.batchTimer = null;
		if (!this.toolCounts.size) return;
		const tools = Object.fromEntries(this.toolCounts);
		const total = [...this.toolCounts.values()].reduce((a, b) => a + b, 0);
		this.toolCounts.clear();
		this.track("mcp_request_batch", { tools, total });
	}

	/** Call after the setting changes: turning it on sends app_opened; off drops everything queued. */
	settingChanged() {
		if (this.enabled()) {
			if (this.launchInfo) this.once("app_opened", this.launchInfo);
			return;
		}
		this.toolCounts.clear();
		if (this.batchTimer) clearTimeout(this.batchTimer);
		this.batchTimer = null;
		const client = this.client;
		this.client = null;
		// Its fetch now drops whatever is still queued.
		void client?.shutdown(1000).catch(() => {});
	}

	/** Before quitting: sends what is queued (briefly). */
	async shutdown() {
		this.flushTools();
		const client = this.client;
		this.client = null;
		if (client) await client.shutdown(3000).catch(() => {});
	}
}

/** The app's one usage reporter (configured in main.ts). */
export const usage = new Usage();

/**
 * The AI runtime, recording generation_used (what was made and by which service) after each
 * successful generation. Only the capability and the provider's name are recorded.
 */
export function withUsage(runtime: AiRuntime, reporter: Usage = usage): AiRuntime {
	const statusProvider = (capability: Capability) =>
		runtime.status().find((s) => s.capability === capability)?.provider;
	const used = <T>(
		capability: GenerationCapability,
		work: Promise<T>,
		provider: (result: T) => string | undefined,
	) =>
		work.then((result) => {
			try {
				reporter.track("generation_used", { capability, provider: providerId(provider(result)) });
			} catch {}
			return result;
		});
	return {
		...runtime,
		speak: (text, options) => used("voice", runtime.speak(text, options), (r) => r.provider),
		image: (prompt, options) => used("image", runtime.image(prompt, options), (r) => r.provider),
		sound: (prompt, options) =>
			used("sound", runtime.sound(prompt, options), () => runtime.soundProvider().provider),
		music: (prompt, options) =>
			used("music", runtime.music(prompt, options), () => runtime.soundProvider().provider),
		clip: (input, file, onProgress) =>
			used("clip", runtime.clip(input, file, onProgress), () => statusProvider("video")),
		transcribe: (file, options) =>
			used("transcription", runtime.transcribe(file, options), () =>
				statusProvider("transcription"),
			),
	};
}
