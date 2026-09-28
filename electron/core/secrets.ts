/**
 * The keys the user has connected, as kept (encrypted by the OS) in the app's
 * secrets file. Older versions stored only `{ openai }`; those files still read.
 * Keys stay in the main process: the window only learns whether each is connected.
 */
export interface Secrets {
	openai?: string;
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
