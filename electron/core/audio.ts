/**
 * Per-track EQ and compressor, shared by the preview (Web Audio) and the
 * export (ffmpeg) so both hear the same thing.
 */
import type { ProjectData, Track, TrackCompressor, TrackEq } from "./types";

/** Three bands: a low shelf, a peaking mid and a high shelf. Gains are in dB. */
export const EQ_BANDS = {
	low: { type: "lowshelf", frequency: 120 },
	mid: { type: "peaking", frequency: 1200, q: 0.9 },
	high: { type: "highshelf", frequency: 8000 },
} as const;

/** Shelves with a Q of 1/√2 match Web Audio's fixed shelf slope. */
const SHELF_Q = Math.SQRT1_2.toFixed(3);
export const EQ_LIMIT_DB = 12;
export const COMPRESSOR_ATTACK_MS = 10;
export const COMPRESSOR_RELEASE_MS = 150;
/** A soft knee in dB, the same in the preview and the export. */
export const COMPRESSOR_KNEE_DB = 3;

export const FLAT_EQ: TrackEq = { low: 0, mid: 0, high: 0 };

export interface AudioPreset {
	name: string;
	eq: TrackEq;
	compressor: TrackCompressor;
}

export const AUDIO_PRESETS: AudioPreset[] = [
	{ name: "Voice", eq: { low: -3, mid: 2, high: 3 }, compressor: { amount: 0.5 } },
	{ name: "Music bed", eq: { low: 0, mid: -2, high: 0 }, compressor: { amount: 0.3 } },
];

export function audioPreset(name: string): AudioPreset | undefined {
	return AUDIO_PRESETS.find((p) => p.name.toLowerCase() === name.toLowerCase());
}

/**
 * One knob to compressor settings. More amount means a lower threshold and a
 * higher ratio; the makeup gain gives back half of what a loud (-10 dBFS)
 * signal loses, so turning the knob doesn't make the track much quieter.
 */
export function compressorSettings(amount: number) {
	const a = Math.max(0, Math.min(1, amount));
	const thresholdDb = -12 - 18 * a;
	const ratio = 1.5 + 4.5 * a;
	const reference = -10;
	const reductionDb = Math.max(0, reference - thresholdDb) * (1 - 1 / ratio);
	return {
		active: a > 0.001,
		thresholdDb,
		ratio,
		makeupDb: reductionDb / 2,
		attackMs: COMPRESSOR_ATTACK_MS,
		releaseMs: COMPRESSOR_RELEASE_MS,
	};
}

/** True when a track's EQ or compressor changes its sound. */
export function hasTrackProcessing(track: Pick<Track, "eq" | "compressor">): boolean {
	const eq = track.eq;
	return (
		!!(eq && (eq.low || eq.mid || eq.high)) ||
		compressorSettings(track.compressor?.amount ?? 0).active
	);
}

/** ffmpeg filters for a track's EQ and compressor (empty when it is flat). */
export function trackAudioFilters(track: Pick<Track, "eq" | "compressor">): string[] {
	const eq = track.eq ?? FLAT_EQ;
	const filters: string[] = [];
	if (eq.low)
		filters.push(`bass=g=${eq.low.toFixed(2)}:f=${EQ_BANDS.low.frequency}:t=q:w=${SHELF_Q}`);
	if (eq.mid)
		filters.push(
			`equalizer=f=${EQ_BANDS.mid.frequency}:t=q:w=${EQ_BANDS.mid.q}:g=${eq.mid.toFixed(2)}`,
		);
	if (eq.high)
		filters.push(`treble=g=${eq.high.toFixed(2)}:f=${EQ_BANDS.high.frequency}:t=q:w=${SHELF_Q}`);
	const c = compressorSettings(track.compressor?.amount ?? 0);
	if (c.active) {
		// acompressor takes linear levels; its knee is a ratio too.
		const lin = (db: number) => 10 ** (db / 20);
		filters.push(
			`acompressor=threshold=${lin(c.thresholdDb).toFixed(5)}:ratio=${c.ratio.toFixed(3)}` +
				`:attack=${c.attackMs}:release=${c.releaseMs}:knee=${lin(COMPRESSOR_KNEE_DB).toFixed(3)}` +
				`:makeup=${lin(c.makeupDb).toFixed(4)}`,
		);
	}
	return filters;
}

/** Auto-mix targets in LUFS (integrated): dialogue, and music 8 dB under it. */
export const AUTO_MIX_TARGETS = { dialogue: -16, music: -24 } as const;

export type MixRole = "dialogue" | "music";

/**
 * Whether a track carries speech or a bed (music, ambience, effects), from its
 * name, the voiceover flag and transcripts. Camera sound counts as speech.
 */
export function mixRole(data: ProjectData, track: Track): MixRole {
	if (track.voiceover) return "dialogue";
	if (/music|song|score|\bbed\b|bgm|background|ambien|sfx|effects|atmos/i.test(track.name))
		return "music";
	if (/voice|dialog|\bvo\b|narrat|speech|interview|host|talk|\bmic\b/i.test(track.name))
		return "dialogue";
	const spoken = data.clips.some(
		(c) =>
			c.type === "media" &&
			c.trackId === track.id &&
			!!data.assets.find((a) => a.id === c.assetId)?.transcript?.words.length,
	);
	return spoken || track.kind === "video" ? "dialogue" : "music";
}
