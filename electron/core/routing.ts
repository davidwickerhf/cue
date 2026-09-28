/**
 * Which service does each kind of generation, from the keys the user has
 * connected. A direct key for a service wins (OpenAI for OpenAI voices and
 * images, ElevenLabs for the user's own voices and music); otherwise fal, one
 * key for all of it.
 */

export type Service = "openai" | "fal" | "elevenlabs" | "higgsfield";

export interface KeysPresent {
	openai: boolean;
	fal: boolean;
	elevenlabs: boolean;
	higgsfield: boolean;
}

export interface Route<E extends string> {
	/** What does the work, or null when nothing connected can. */
	engine: E | null;
	/** For the user: e.g. "ElevenLabs via fal". */
	provider: string;
	/** Why it can't run, and which service to connect for it. */
	problem?: string;
	connect?: Service;
}

export const CONNECT_FAL = "Connect fal in Settings → AI";
export const CONNECT_OPENAI = "Connect OpenAI in Settings → AI";
export const CONNECT_ELEVENLABS = "Connect ElevenLabs in Settings → AI";
export const CONNECT_HIGGSFIELD = "Connect Higgsfield in Settings → AI";

export type VoiceChoice = "auto" | "openai" | "elevenlabs" | "macos";
export type VoiceEngine = "openai" | "elevenlabs" | "fal" | "macos";

/** Voices: auto takes OpenAI, then direct ElevenLabs, then ElevenLabs via fal, then the Mac's voices. */
export function voiceRoute(
	choice: VoiceChoice,
	keys: KeysPresent,
	macVoices: boolean,
): Route<VoiceEngine> {
	const openai: Route<VoiceEngine> = { engine: "openai", provider: "OpenAI" };
	const eleven: Route<VoiceEngine> = keys.elevenlabs
		? { engine: "elevenlabs", provider: "ElevenLabs" }
		: keys.fal
			? { engine: "fal", provider: "ElevenLabs via fal" }
			: {
					engine: null,
					provider: "ElevenLabs",
					problem: CONNECT_FAL,
					connect: "fal",
				};
	const mac: Route<VoiceEngine> = macVoices
		? { engine: "macos", provider: "macOS voices" }
		: {
				engine: null,
				provider: "macOS voices",
				problem:
					process.platform === "darwin"
						? "No system voices found"
						: "macOS voices are only available on a Mac; choose another provider",
			};
	switch (choice) {
		case "openai":
			return keys.openai
				? openai
				: { engine: null, provider: "OpenAI", problem: CONNECT_OPENAI, connect: "openai" };
		case "elevenlabs":
			return eleven;
		case "macos":
			return mac;
		default:
			if (keys.openai) return openai;
			if (keys.elevenlabs || keys.fal) return eleven;
			if (macVoices) return mac;
			return { engine: null, provider: "Automatic", problem: CONNECT_FAL, connect: "fal" };
	}
}

export type ImageChoice = "auto" | "openai" | "fal" | "none";

/** Images: OpenAI with its own key, else GPT Image 2 through fal. */
export function imageRoute(choice: ImageChoice, keys: KeysPresent): Route<"openai" | "fal"> {
	const openai: Route<"openai" | "fal"> = keys.openai
		? { engine: "openai", provider: "OpenAI" }
		: { engine: null, provider: "OpenAI", problem: CONNECT_OPENAI, connect: "openai" };
	const fal: Route<"openai" | "fal"> = keys.fal
		? { engine: "fal", provider: "GPT Image 2 via fal" }
		: { engine: null, provider: "fal", problem: CONNECT_FAL, connect: "fal" };
	switch (choice) {
		case "openai":
			return openai;
		case "fal":
			return fal;
		case "none":
			return { engine: null, provider: "Off", problem: "Images turned off" };
		default:
			if (keys.openai) return openai;
			if (keys.fal) return fal;
			return { engine: null, provider: "Automatic", problem: CONNECT_FAL, connect: "fal" };
	}
}

/** Sound effects and music: a direct ElevenLabs key, else ElevenLabs through fal. */
export function soundRoute(keys: KeysPresent): Route<"elevenlabs" | "fal"> {
	if (keys.elevenlabs) return { engine: "elevenlabs", provider: "ElevenLabs" };
	if (keys.fal) return { engine: "fal", provider: "ElevenLabs via fal" };
	return { engine: null, provider: "ElevenLabs", problem: CONNECT_FAL, connect: "fal" };
}

/** Video clips: fal (Kling, Hailuo), else a Higgsfield key. */
export function clipRoute(keys: KeysPresent): Route<"fal" | "higgsfield"> {
	if (keys.fal) return { engine: "fal", provider: "fal (Kling, Hailuo)" };
	if (keys.higgsfield) return { engine: "higgsfield", provider: "Higgsfield" };
	return { engine: null, provider: "fal", problem: CONNECT_FAL, connect: "fal" };
}
