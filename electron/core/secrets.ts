/**
 * The keys the user has connected, as kept (encrypted by the OS) in the app's
 * secrets file. Older versions stored only `{ openai }`; those files still read.
 * Keys stay in the main process: the window only learns whether each is connected.
 */
export interface Secrets {
	openai?: string;
	/** One key for voice, sound, music, video and images through fal.ai. */
	fal?: string;
	elevenlabs?: string;
	/** Higgsfield keys come in two parts. */
	higgsfield?: HiggsfieldKey;
}

export interface HiggsfieldKey {
	id: string;
	secret: string;
}

export type SecretProvider = keyof Secrets;

const text = (value: unknown) =>
	typeof value === "string" && value.trim() ? value.trim() : undefined;

/** The decrypted file's JSON as secrets; anything unexpected is dropped. */
export function parseSecrets(json: string): Secrets {
	let raw: Record<string, unknown>;
	try {
		raw = JSON.parse(json) as Record<string, unknown>;
	} catch {
		return {};
	}
	if (!raw || typeof raw !== "object") return {};
	const out: Secrets = {};
	const openai = text(raw.openai);
	if (openai) out.openai = openai;
	const fal = text(raw.fal);
	if (fal) out.fal = fal;
	const elevenlabs = text(raw.elevenlabs);
	if (elevenlabs) out.elevenlabs = elevenlabs;
	const hf = raw.higgsfield as Record<string, unknown> | undefined;
	const id = text(hf?.id);
	const secret = text(hf?.secret);
	if (id && secret) out.higgsfield = { id, secret };
	return out;
}

/** The secrets as JSON for the file, or null when there are none left (the file is removed). */
export function serializeSecrets(secrets: Secrets): string | null {
	const clean = parseSecrets(JSON.stringify(secrets));
	return Object.keys(clean).length ? JSON.stringify(clean) : null;
}

/** Secrets with one provider's key set, or removed with null. */
export function withSecret<P extends SecretProvider>(
	secrets: Secrets,
	provider: P,
	value: Secrets[P] | null,
): Secrets {
	const next = { ...secrets };
	if (value === null || value === undefined) delete next[provider];
	else next[provider] = value;
	return parseSecrets(JSON.stringify(next));
}

/** Where a connected key came from: saved in Cue, or the environment Cue was started in. */
export type KeySource = "stored" | "environment";

/**
 * Keys from the environment (as for OPENAI_API_KEY before), used when none is
 * stored for that service. Returns the keys and where each came from.
 */
export function withEnvironment(
	stored: Secrets,
	env: Record<string, string | undefined>,
): { keys: Secrets; sources: Partial<Record<SecretProvider, KeySource>> } {
	const keys: Secrets = { ...stored };
	const sources: Partial<Record<SecretProvider, KeySource>> = {};
	const fromEnv: [Exclude<SecretProvider, "higgsfield">, string | undefined][] = [
		["openai", env.OPENAI_API_KEY],
		["fal", env.FAL_KEY],
		["elevenlabs", env.ELEVENLABS_API_KEY ?? env.XI_API_KEY],
	];
	for (const [provider, value] of fromEnv) {
		if (keys[provider]) sources[provider] = "stored";
		else if (value?.trim()) {
			keys[provider] = value.trim();
			sources[provider] = "environment";
		}
	}
	if (keys.higgsfield) sources.higgsfield = "stored";
	return { keys, sources };
}
