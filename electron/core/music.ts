import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ffmpeg } from "./media";

/**
 * Music for an edit: found (openly licensed tracks through Openverse, with their credit)
 * or made (an original bed composed here from a mood, royalty-free by construction).
 */

// ---------------------------------------------------------------------------
// Finding music
// ---------------------------------------------------------------------------

/** Licences a track may have to be used in any video, commercial ones too (no NC, no ND). */
export const MUSIC_LICENCES = ["cc0", "pdm", "by", "by-sa"] as const;
export type MusicLicence = (typeof MUSIC_LICENCES)[number];

export interface MusicTrack {
	/** Openverse id, used by import_music. */
	id: string;
	title: string;
	creator: string;
	/** e.g. "CC BY 3.0". */
	licence: string;
	licenceUrl: string;
	/** The track's page (where the licence is stated). */
	sourceUrl: string;
	/** Direct link to the audio. */
	audioUrl: string;
	durationMs: number;
	provider: string;
	tags: string[];
	/** The line to put in the credits. */
	credit: string;
}

const OPENVERSE = "https://api.openverse.org/v1/audio/";
const USER_AGENT = "Cue video editor (https://cue.wicker.life)";

export function licenceLabel(code: string, version?: string): string {
	const c = code.toLowerCase();
	if (c === "cc0") return "CC0 1.0";
	if (c === "pdm") return "Public Domain Mark";
	return `CC ${c.toUpperCase()}${version ? ` ${version}` : ""}`;
}

export function creditLine(t: {
	title: string;
	creator: string;
	licence: string;
	sourceUrl: string;
}) {
	return `"${t.title}" by ${t.creator || "unknown"} (${t.licence}), ${t.sourceUrl}`;
}

export function musicSearchUrl(opts: {
	query: string;
	licences?: readonly MusicLicence[];
	minSeconds?: number;
	maxSeconds?: number;
	limit?: number;
}): string {
	const u = new URL(OPENVERSE);
	u.searchParams.set("q", opts.query);
	u.searchParams.set("category", "music");
	u.searchParams.set("license", (opts.licences ?? MUSIC_LICENCES).join(","));
	u.searchParams.set("page_size", String(Math.min(40, Math.max(1, (opts.limit ?? 10) * 2))));
	return u.toString();
}

interface OpenverseResult {
	id: string;
	title: string;
	creator?: string;
	license: string;
	license_version?: string;
	license_url?: string;
	foreign_landing_url?: string;
	url: string;
	duration?: number | null;
	provider?: string;
	source?: string;
	tags?: { name: string }[];
}

export function toTrack(r: OpenverseResult): MusicTrack {
	const licence = licenceLabel(r.license, r.license_version);
	const t = {
		id: r.id,
		title: r.title || "Untitled",
		creator: r.creator ?? "",
		licence,
		licenceUrl: r.license_url ?? "",
		sourceUrl: r.foreign_landing_url ?? r.url,
		audioUrl: r.url,
		durationMs: r.duration ?? 0,
		provider: r.source ?? r.provider ?? "",
		tags: (r.tags ?? []).map((t) => t.name).slice(0, 8),
	};
	return { ...t, credit: creditLine(t) };
}

/** Openly licensed music matching a query (mood, genre, instrument), longest-fitting first. */
export async function searchMusic(opts: {
	query: string;
	licences?: readonly MusicLicence[];
	minSeconds?: number;
	maxSeconds?: number;
	limit?: number;
}): Promise<MusicTrack[]> {
	const res = await fetch(musicSearchUrl(opts), { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok)
		throw new Error(`Music search failed (${res.status}). Try again, or use generate_music.`);
	const body = (await res.json()) as { results?: OpenverseResult[] };
	const min = (opts.minSeconds ?? 0) * 1000;
	const max = (opts.maxSeconds ?? Number.POSITIVE_INFINITY) * 1000;
	return (body.results ?? [])
		.map(toTrack)
		.filter((t) => t.audioUrl && (!t.durationMs || (t.durationMs >= min && t.durationMs <= max)))
		.slice(0, opts.limit ?? 10);
}

/** Downloads a found track into the project's music folder. */
export async function downloadMusic(track: MusicTrack, projectDir: string): Promise<string> {
	const dir = path.join(projectDir, "music");
	await fs.mkdir(dir, { recursive: true });
	const name =
		`${slugify(track.title)}-${slugify(track.creator)}`.slice(0, 60) || `track-${track.id}`;
	const file = path.join(dir, `${name}.mp3`);
	const res = await fetch(track.audioUrl, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok || !res.body) throw new Error(`Could not download "${track.title}" (${res.status}).`);
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(file));
	return file;
}

const slugify = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "");

// ---------------------------------------------------------------------------
// Making music
// ---------------------------------------------------------------------------

export const MUSIC_MOODS = [
	"calm",
	"lofi",
	"ambient",
	"tension",
	"uplifting",
	"documentary",
] as const;
export type MusicMood = (typeof MUSIC_MOODS)[number];

interface Recipe {
	bpm: number;
	/** Chords as semitones above the key's root. */
	progression: number[][];
	pad: number;
	/** Arpeggio notes per beat (0 = none), level and octave above the root. */
	arp: { perBeat: number; level: number; octave: number };
	bass: number;
	kick: number;
	hat: number;
	vinyl: number;
	/** Low-pass cut-off: lower is darker. */
	brightness: number;
	/** Reverb tail. */
	space: number;
	about: string;
}

/** What each mood is made of. Levels are relative; the result is normalised. */
export const RECIPES: Record<MusicMood, Recipe> = {
	calm: {
		bpm: 72,
		progression: [
			[0, 4, 7, 11],
			[7, 11, 14],
			[9, 12, 16],
			[5, 9, 12, 16],
		],
		pad: 0.7,
		arp: { perBeat: 2, level: 0.55, octave: 1 },
		bass: 0.45,
		kick: 0,
		hat: 0,
		vinyl: 0,
		brightness: 3600,
		space: 0.35,
		about:
			"soft piano-like arpeggios over a warm pad (I–V–vi–IV): explainers, tutorials, study and assignment videos",
	},
	lofi: {
		bpm: 80,
		progression: [
			[2, 5, 9, 12],
			[7, 11, 14, 17],
			[0, 4, 7, 11],
			[9, 12, 16, 19],
		],
		pad: 0.6,
		arp: { perBeat: 1, level: 0.45, octave: 1 },
		bass: 0.6,
		kick: 0.7,
		hat: 0.35,
		vinyl: 0.5,
		brightness: 2300,
		space: 0.3,
		about:
			"jazzy seventh chords, a soft beat and vinyl crackle: vlogs, study, product walkthroughs",
	},
	ambient: {
		bpm: 60,
		progression: [
			[0, 7, 14],
			[5, 12, 19],
			[-3, 4, 12],
			[5, 9, 16],
		],
		pad: 1,
		arp: { perBeat: 0.5, level: 0.3, octave: 2 },
		bass: 0.25,
		kick: 0,
		hat: 0,
		vinyl: 0,
		brightness: 2600,
		space: 0.55,
		about: "slow open chords and a sparse bell: backgrounds, nature, reflective moments",
	},
	tension: {
		bpm: 90,
		progression: [
			[0, 3, 7],
			[-4, 0, 3],
			[5, 8, 12],
			[7, 11, 14],
		],
		pad: 0.6,
		arp: { perBeat: 2, level: 0.25, octave: 0 },
		bass: 0.8,
		kick: 0.5,
		hat: 0,
		vinyl: 0,
		brightness: 1500,
		space: 0.3,
		about: "a dark minor pulse: investigations, true crime, a problem being set up",
	},
	uplifting: {
		bpm: 104,
		progression: [
			[0, 4, 7],
			[9, 12, 16],
			[5, 9, 12],
			[7, 11, 14],
		],
		pad: 0.55,
		arp: { perBeat: 4, level: 0.5, octave: 1 },
		bass: 0.6,
		kick: 0.6,
		hat: 0.45,
		vinyl: 0,
		brightness: 5200,
		space: 0.25,
		about: "bright major arpeggios with a light beat: launches, results, happy endings",
	},
	documentary: {
		bpm: 60,
		progression: [
			[0, 7, 12, 15],
			[-4, 3, 8, 12],
			[-2, 5, 10, 14],
			[0, 7, 12, 15],
		],
		pad: 1,
		arp: { perBeat: 0, level: 0, octave: 0 },
		bass: 0.5,
		kick: 0,
		hat: 0,
		vinyl: 0,
		brightness: 1900,
		space: 0.5,
		about: "a dark, slowly breathing minor drone: history, archive, serious narration",
	},
};

const KEYS: Record<string, number> = {
	C: 130.81,
	"C#": 138.59,
	D: 146.83,
	"D#": 155.56,
	E: 164.81,
	F: 174.61,
	"F#": 185.0,
	G: 196.0,
	"G#": 207.65,
	A: 110.0,
	"A#": 116.54,
	B: 123.47,
};
export const MUSIC_KEYS = Object.keys(KEYS);

const hz = (root: number, semis: number) => root * 2 ** (semis / 12);
const f = (n: number) => n.toFixed(4);

/** Picks a value per chord index with nested ifs (an ffmpeg expression). */
function perChord(chord: string, values: string[]): string {
	return values.reduceRight(
		(rest, v, i) => (i === values.length - 1 ? v : `if(eq(${chord},${i}),${v},${rest})`),
		"",
	);
}

/** The ffmpeg aevalsrc expression for one channel of a recipe. */
export function musicExpression(r: Recipe, root: number, detune = 0): string {
	const beat = 60 / r.bpm;
	const bar = beat * 4;
	const n = r.progression.length;
	const chord = `mod(floor(t/${f(bar)}),${n})`;
	const inBar = `mod(t,${f(bar)})`;
	// Chord changes dip the pad for a moment instead of clicking.
	const swell = `min(1,${inBar}/0.35)*min(1,(${f(bar)}-${inBar})/0.35)`;
	const parts: string[] = [];
	if (r.pad > 0) {
		const voices = Math.max(...r.progression.map((c) => c.length));
		for (let j = 0; j < voices; j++) {
			const freq = perChord(
				chord,
				r.progression.map((c) => f(hz(root, c[j % c.length]) * (1 + detune))),
			);
			parts.push(
				`${f(r.pad * 0.09)}*sin(2*PI*${freq}*t)*(0.65+0.35*sin(2*PI*${f(0.07 + j * 0.013)}*t+${j}))*${swell}`,
			);
		}
	}
	if (r.arp.perBeat > 0 && r.arp.level > 0) {
		const step = beat / r.arp.perBeat;
		const k = `floor(t/${f(step)})`;
		const since = `mod(t,${f(step)})`;
		const note = (c: number[]) => {
			const up = [...c, ...c.map((s) => s + 12)];
			const pattern = [0, 1, 2, 3, 2, 1].map((i) => up[i % up.length]);
			return pattern.reduceRight(
				(rest, s, i) =>
					i === pattern.length - 1
						? f(hz(root, s + 12 * r.arp.octave))
						: `if(eq(mod(${k},${pattern.length}),${i}),${f(hz(root, s + 12 * r.arp.octave))},${rest})`,
				"",
			);
		};
		const freq = perChord(chord, r.progression.map(note));
		const decay = Math.max(3, 9 * r.arp.perBeat * (r.bpm / 90));
		parts.push(
			`${f(r.arp.level * 0.16)}*(sin(2*PI*${freq}*t)+0.35*sin(4*PI*${freq}*t)*exp(-${f(decay)}*${since}))*exp(-${f(decay * 0.55)}*${since})`,
		);
	}
	if (r.bass > 0) {
		const freq = perChord(
			chord,
			r.progression.map((c) => f(hz(root, c[0]) / 2)),
		);
		const since = `mod(t,${f(beat * 2)})`;
		parts.push(`${f(r.bass * 0.2)}*sin(2*PI*${freq}*t)*exp(-2.2*${since})*min(1,${since}/0.01)`);
	}
	if (r.kick > 0) {
		const tau = `mod(t,${f(beat * 2)})`;
		parts.push(`${f(r.kick * 0.45)}*sin(2*PI*(46+70*exp(-28*${tau}))*${tau})*exp(-9*${tau})`);
	}
	if (r.hat > 0) {
		const tau = `mod(t+${f(beat / 2)},${f(beat)})`;
		parts.push(`${f(r.hat * 0.05)}*(random(0)*2-1)*exp(-70*${tau})`);
	}
	if (r.vinyl > 0) parts.push(`${f(r.vinyl * 0.006)}*(random(1)*2-1)`);
	return parts.join("+") || "0";
}

/**
 * Composes an original music bed: a mood's chords, pad, arpeggio, bass and beat,
 * with reverb, a low-pass for its colour, fades and loudness at -20 LUFS (a bed to
 * duck under a voice). The same mood, key and tempo always make the same music.
 */
export async function generateMusic(
	opts: { mood: MusicMood; durationMs: number; key?: string; bpm?: number },
	out: string,
): Promise<{ mood: MusicMood; key: string; bpm: number; about: string }> {
	const base = RECIPES[opts.mood];
	const recipe = { ...base, bpm: opts.bpm ?? base.bpm };
	const key =
		opts.key && KEYS[opts.key]
			? opts.key
			: opts.mood === "tension" || opts.mood === "documentary"
				? "D"
				: "C";
	const root = KEYS[key];
	const seconds = Math.max(2, opts.durationMs / 1000);
	const fadeOut = Math.min(4, seconds / 4);
	const echo = recipe.space;
	await fs.mkdir(path.dirname(out), { recursive: true });
	await ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`aevalsrc='${musicExpression(recipe, root)}|${musicExpression(recipe, root, 0.0025)}':s=48000:d=${seconds.toFixed(3)}`,
		"-af",
		[
			`lowpass=f=${recipe.brightness}`,
			`aecho=0.8:${f(0.55 + echo * 0.3)}:${Math.round(180 + echo * 400)}|${Math.round(260 + echo * 600)}:${f(echo * 0.6)}|${f(echo * 0.45)}`,
			`afade=t=in:d=${Math.min(2.5, seconds / 4).toFixed(2)}`,
			`afade=t=out:st=${(seconds - fadeOut).toFixed(2)}:d=${fadeOut.toFixed(2)}`,
			"loudnorm=I=-20:TP=-2:LRA=7",
			"aresample=48000",
		].join(","),
		// The reverb's tail runs past the source; the bed is exactly as long as asked.
		"-t",
		seconds.toFixed(3),
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		out,
	]);
	return { mood: opts.mood, key, bpm: recipe.bpm, about: recipe.about };
}
