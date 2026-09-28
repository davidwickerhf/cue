/**
 * The fal.ai models Cue routes through with one fal key, in one table so it is
 * easy to extend (shared with the window). Video models are in clipModels.ts.
 */

/** ElevenLabs speech on fal, by the ElevenLabs model the project chose. */
export const FAL_VOICE_MODELS: Record<string, string> = {
	eleven_v3: "fal-ai/elevenlabs/tts/eleven-v3",
	eleven_multilingual_v2: "fal-ai/elevenlabs/tts/multilingual-v2",
	// fal offers Turbo v2.5 as its fast ElevenLabs voice.
	eleven_flash_v2_5: "fal-ai/elevenlabs/tts/turbo-v2.5",
};

/** Sound effects (0.5–22 s on fal), music (3 s–10 min) and images. */
export const FAL_SOUND_MODEL = "fal-ai/elevenlabs/sound-effects/v2";
export const FAL_SOUND_MAX_SECONDS = 22;
export const FAL_MUSIC_MODEL = "fal-ai/elevenlabs/music";
export const FAL_IMAGE_MODEL = "openai/gpt-image-2";

/**
 * ElevenLabs' default voices, which fal chooses by name (a user's own and
 * cloned voices need a direct ElevenLabs connection).
 */
export const FAL_VOICES = [
	"Rachel",
	"Aria",
	"Roger",
	"Sarah",
	"Laura",
	"Charlie",
	"George",
	"Callum",
	"River",
	"Liam",
	"Charlotte",
	"Alice",
	"Matilda",
	"Will",
	"Jessica",
	"Eric",
	"Chris",
	"Brian",
	"Daniel",
	"Lily",
	"Bill",
] as const;
export const DEFAULT_FAL_VOICE = "George";
