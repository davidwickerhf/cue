/**
 * "Connect" without typing a key: Cue opens the service's key page, then
 * watches the clipboard (only while that connect is pending) for a new key in
 * that service's format, checks it with a cheap call and hands it back to be
 * stored. Anything else copied is ignored; keys are never logged or shown.
 */

export type ConnectService = "fal" | "openai" | "elevenlabs" | "higgsfield";

/** Where each service hands out API keys. */
export const KEY_PAGES: Record<ConnectService, string> = {
	fal: "https://fal.ai/dashboard/keys",
	openai: "https://platform.openai.com/api-keys",
	elevenlabs: "https://elevenlabs.io/app/developers/api-keys",
	higgsfield: "https://console.higgsfield.ai",
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
	// A key id and its secret, held together as id:secret (the console shows them apart).
	higgsfield: /^[A-Za-z0-9_.-]{8,128}:[A-Za-z0-9_.-]{8,256}$/,
};

/** One value copied on its own: a Higgsfield key id or secret. */
const TOKEN = /^[A-Za-z0-9_.-]{8,256}$/;

/**
 * A Higgsfield key id and secret in pasted text, as id:secret: "id:secret", the two
 * on separate lines or with a space, or with their labels ("Key ID: …", "Secret: …").
 */
export function higgsfieldPair(text: string): string | null {
	const clean = text.replace(INVISIBLE, "").trim();
	const labelled = (label: RegExp) =>
		new RegExp(`(?:${label.source})\\s*[:=]?\\s*["'\u201C]?([A-Za-z0-9_.-]{8,256})`, "i").exec(
			clean,
		)?.[1];
	const id = labelled(/key[\s_-]*id|api[\s_-]*key(?![\s_-]*secret)/);
	const secret = labelled(/(?:api[\s_-]*)?(?:key[\s_-]*)?secret/);
	if (id && secret && id !== secret) return `${id}:${secret}`;
	const parts = clean.split(/[\s:]+/).filter(Boolean);
	return parts.length === 2 && parts.every((p) => TOKEN.test(p)) && parts[0] !== parts[1]
		? `${parts[0]}:${parts[1]}`
		: null;
}

/** The key in copied text, if the text is exactly one key of the service's format. */
export function matchKey(service: ConnectService, text: string): string | null {
	const candidate = text.trim();
	return KEY_FORMATS[service].test(candidate) ? candidate : null;
}

/** Characters that ride along when copying from a web page and break a key (zero-width, BOM, soft hyphen). */
const INVISIBLE = /[\u00AD\u200B-\u200D\u2060\uFEFF]/g;

/**
 * The key in text typed or pasted by hand: the one key-shaped run in it (so a
 * label, quotes or a stray character around it don't matter). Null when there
 * is none, with a plain reason for the user.
 */
export function findKey(
	service: ConnectService,
	text: string,
): { key: string } | { key: null; reason: string } {
	const clean = text.replace(INVISIBLE, "").trim();
	if (service === "higgsfield") {
		const pair = higgsfieldPair(clean);
		return pair ? { key: pair } : { key: null, reason: HINTS.higgsfield(clean) };
	}
	const exact = matchKey(service, clean);
	if (exact) return { key: exact };
	const inner = new RegExp(
		KEY_FORMATS[service].source.replace(/^\^/, "").replace(/\$$/, ""),
		KEY_FORMATS[service].flags.replace("g", "") + "g",
	);
	const found = [...new Set(clean.match(inner) ?? [])];
	// Exactly one candidate that isn't part of a longer run of key characters.
	const whole = found.filter(
		(k) => !new RegExp(`[A-Za-z0-9_-]${escape(k)}|${escape(k)}[A-Za-z0-9_-]`).test(clean),
	);
	if (whole.length === 1) return { key: whole[0] };
	const compact = clean.replace(/\s+/g, "");
	return { key: null, reason: HINTS[service](compact) };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const HINTS: Record<ConnectService, (text: string) => string> = {
	elevenlabs: (t) =>
		`That isn't an ElevenLabs key: they start with sk_ and have 51 characters (letters and digits), and this has ${t.length}${t.startsWith("sk_") ? "" : " and doesn't start with sk_"}. Copy it again from ElevenLabs → Developers → API keys (it's shown in full only when created).`,
	openai: (t) =>
		`That isn't an OpenAI API key: they start with sk- (sk-proj-… for project keys)${t.startsWith("sk-") ? ", and this one has characters a key can't have" : ""}.`,
	higgsfield: () =>
		"Paste both parts of the Higgsfield key: the key ID and the secret (as id:secret, or one per line). Both are in the Higgsfield console under API keys.",
	fal: () =>
		"That isn't a fal key: it's two parts joined by a colon, an id like 1a2b3c4d-… and the secret. Copy the whole key from fal's dashboard.",
};

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
	/** Progress worth showing (Higgsfield: the first of the two values was picked up). */
	onProgress?: (message: string) => void;
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
	let held: string | null = null;
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
		let candidates: string[] = [];
		const key =
			options.service === "higgsfield" ? higgsfieldPair(text) : matchKey(options.service, text);
		if (key) candidates = [key];
		else if (options.service === "higgsfield") {
			// The console shows the id and the secret apart: the first copy is held, the second completes it.
			const token = text.replace(INVISIBLE, "").trim();
			if (!TOKEN.test(token)) {
				checking = false;
				return;
			}
			if (held === null || held === token) {
				held = token;
				options.onProgress?.(
					"Got the first part. Now copy the other one (the key ID or the secret).",
				);
				checking = false;
				return;
			}
			candidates = [`${held}:${token}`, `${token}:${held}`];
			held = token;
		} else {
			checking = false;
			return;
		}
		let failure = "";
		for (const candidate of candidates) {
			try {
				await options.validate(candidate);
				checking = false;
				return finish({ state: "connected", key: candidate });
			} catch (error) {
				failure = (error as Error).message;
				for (const part of candidate.split(":")) failure = failure.split(part).join("…");
			}
		}
		options.onRejected?.(redactKeys(failure));
		checking = false;
	};
	const handle = set(() => void tick(), every);
	return { result, cancel: () => finish({ state: "cancelled" }) };
}
