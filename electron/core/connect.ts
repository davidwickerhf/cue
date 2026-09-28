/**
 * "Connect" without typing a key: Cue opens the service's key page, then
 * watches the clipboard (only while that connect is pending) for a new key in
 * that service's format, checks it with a cheap call and hands it back to be
 * stored. Anything else copied is ignored; keys are never logged or shown.
 */

export type ConnectService = "fal" | "openai" | "elevenlabs";

/** Where each service hands out API keys. */
export const KEY_PAGES: Record<ConnectService, string> = {
	fal: "https://fal.ai/dashboard/keys",
	openai: "https://platform.openai.com/api-keys",
	elevenlabs: "https://elevenlabs.io/app/developers/api-keys",
};

/**
 * What each service's keys look like. fal: a key id (UUID) and secret joined by
 * a colon; OpenAI: sk-… (project and service-account keys; admin keys can't
 * call models); ElevenLabs: sk_ and 48 characters (51 in all).
 */
export const KEY_FORMATS: Record<ConnectService, RegExp> = {
	fal: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:[A-Za-z0-9_-]{16,128}$/i,
	openai: /^sk-(?!admin-)(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,300}$/,
	elevenlabs: /^sk_[A-Za-z0-9]{48}$/,
};

/** The key in copied text, if the text is exactly one key of the service's format. */
export function matchKey(service: ConnectService, text: string): string | null {
	const candidate = text.trim();
	return KEY_FORMATS[service].test(candidate) ? candidate : null;
}

/** A provider's message with anything that looks like a key (even masked) taken out. */
export function redactKeys(message: string): string {
	return message.replace(/\b(sk[-_][A-Za-z0-9*_-]{4,}|[0-9a-f-]{36}:\S+)/gi, "…");
}

/** Checks an OpenAI key by listing models (401 when it doesn't work). */
export async function testOpenAI(key: string): Promise<void> {
	const res = await fetch("https://api.openai.com/v1/models", {
		headers: { authorization: `Bearer ${key}` },
		signal: AbortSignal.timeout(20000),
	});
	if (!res.ok) {
		let detail = res.statusText;
		try {
			detail = ((await res.json()) as { error?: { message?: string } }).error?.message ?? detail;
		} catch {}
		throw new Error(`OpenAI ${res.status}: ${detail}`);
	}
}

export type ConnectOutcome =
	| { state: "connected"; key: string }
	| { state: "timeout" }
	| { state: "cancelled" };

export interface ClipboardWatch {
	result: Promise<ConnectOutcome>;
	cancel(): void;
}

/**
 * Watches the clipboard for a key of `service`'s format copied after the watch
 * starts (what was there before is ignored), validates each new candidate once,
 * and resolves on the first that works, on cancel, or after `timeoutMs`.
 * `onRejected` hears about keys the service refused (without the key).
 */
export function watchClipboard(options: {
	service: ConnectService;
	read: () => string | Promise<string>;
	validate: (key: string) => Promise<void>;
	onRejected?: (message: string) => void;
	intervalMs?: number;
	timeoutMs?: number;
	setInterval?: (fn: () => void, ms: number) => unknown;
	clearInterval?: (handle: unknown) => void;
	now?: () => number;
}): ClipboardWatch {
	const every = options.intervalMs ?? 1000;
	const timeout = options.timeoutMs ?? 180000;
	const set = options.setInterval ?? ((fn, ms) => setInterval(fn, ms));
	const clear = options.clearInterval ?? ((h) => clearInterval(h as NodeJS.Timeout));
	const now = options.now ?? Date.now;
	const started = now();
	const read = async () => {
		try {
			return await options.read();
		} catch {
			return "";
		}
	};
	// What was copied before the watch began is never taken for a key.
	let last: string | null = null;
	void read().then((text) => {
		last ??= text;
	});
	let checking = false;
	let done = false;
	let finish: (outcome: ConnectOutcome) => void = () => {};
	const result = new Promise<ConnectOutcome>((resolve) => {
		finish = (outcome) => {
			if (done) return;
			done = true;
			clear(handle);
			resolve(outcome);
		};
	});
	const tick = async () => {
		if (done) return;
		if (now() - started >= timeout) return finish({ state: "timeout" });
		if (checking || last === null) return;
		checking = true;
		const text = await read();
		if (done || text === last) {
			checking = false;
			return;
		}
		last = text;
		const key = matchKey(options.service, text);
		if (!key) {
			checking = false;
			return;
		}
		await options
			.validate(key)
			.then(
				() => finish({ state: "connected", key }),
				(error: Error) => options.onRejected?.(redactKeys(error.message.split(key).join("…"))),
			)
			.finally(() => {
				checking = false;
			});
	};
	const handle = set(() => void tick(), every);
	return { result, cancel: () => finish({ state: "cancelled" }) };
}
