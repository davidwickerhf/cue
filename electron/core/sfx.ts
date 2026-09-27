import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ffmpeg } from "./media";
import { licenceLabel, type MusicLicence, type MusicTrack, toTrack } from "./music";

/**
 * Sound effects beyond the library: openly licensed ones found through Openverse
 * (Freesound and others), and original ones synthesised here. Every generated sound
 * is a new variant (its pitches, lengths, envelope and space come from a seed), so an
 * edit with forty cuts doesn't play the same whoosh forty times, and its character
 * follows the material: soft paper, bright UI, dark cinema, heavy trailer, digital.
 */

const OPENVERSE = "https://api.openverse.org/v1/audio/";
const USER_AGENT = "Cue video editor (https://cue.wicker.life)";
export const SFX_LICENCES: readonly MusicLicence[] = ["cc0", "pdm", "by", "by-sa"];

export function sfxSearchUrl(opts: {
	query: string;
	limit?: number;
	licences?: readonly MusicLicence[];
}): string {
	const u = new URL(OPENVERSE);
	u.searchParams.set("q", opts.query);
	u.searchParams.set("category", "sound_effect");
	u.searchParams.set("license", (opts.licences ?? SFX_LICENCES).join(","));
	u.searchParams.set("page_size", String(Math.min(40, Math.max(4, (opts.limit ?? 8) * 3))));
	return u.toString();
}

/** Openly licensed sound effects for a query, shortest usable first. */
export async function searchSfx(opts: {
	query: string;
	maxSeconds?: number;
	limit?: number;
	licences?: readonly MusicLicence[];
}): Promise<MusicTrack[]> {
	let res: Response | null = null;
	for (let attempt = 0; attempt < 3; attempt++) {
		res = await fetch(sfxSearchUrl(opts), { headers: { "User-Agent": USER_AGENT } });
		if (res.status !== 429 && res.status !== 401) break;
		await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
	}
	if (!res?.ok)
		throw new Error(
			`Sound effect search failed (${res?.status}). Try again in a minute, or use generate_sfx.`,
		);
	const body = (await res.json()) as { results?: Parameters<typeof toTrack>[0][] };
	const max = (opts.maxSeconds ?? 12) * 1000;
	return (body.results ?? [])
		.map(toTrack)
		.filter((t) => t.audioUrl && (!t.durationMs || t.durationMs <= max))
		.sort((a, b) => (a.durationMs || max) - (b.durationMs || max))
		.slice(0, opts.limit ?? 8);
}

/** Downloads a found sound into the project's sfx folder (converted to WAV for exact timing). */
export async function downloadSfx(t: MusicTrack, projectDir: string): Promise<string> {
	const dir = path.join(projectDir, "sfx");
	await fs.mkdir(dir, { recursive: true });
	const base = `${slug(t.title) || "sound"}-${t.id.slice(0, 8)}`;
	const raw = path.join(dir, `${base}.download`);
	const res = await fetch(t.audioUrl, { headers: { "User-Agent": USER_AGENT } });
	if (!res.ok || !res.body) throw new Error(`Could not download "${t.title}" (${res.status}).`);
	await pipeline(Readable.fromWeb(res.body as never), createWriteStream(raw));
	const out = path.join(dir, `${base}.wav`);
	await ffmpeg(["-i", raw, "-ar", "48000", "-ac", "2", out]);
	await fs.rm(raw, { force: true });
	return out;
}

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "")
		.slice(0, 40);

// ---------------------------------------------------------------------------
// Synthesis
// ---------------------------------------------------------------------------

export const SFX_KINDS = [
	"whoosh",
	"swish",
	"riser",
	"downlifter",
	"impact",
	"sub-drop",
	"hit",
	"pop",
	"click",
	"glitch",
	"shimmer",
	"beep",
	"thump",
] as const;
export type SfxKind = (typeof SFX_KINDS)[number];
export const SFX_CHARACTERS = ["soft", "bright", "dark", "heavy", "digital", "organic"] as const;
export type SfxCharacter = (typeof SFX_CHARACTERS)[number];

/** A small seeded random generator, so a seed always gives the same variant. */
export function rng(seed: number) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Default lengths (ms) per kind; the variant moves them ±15 %. */
const LENGTH: Record<SfxKind, number> = {
	whoosh: 900,
	swish: 320,
	riser: 2400,
	downlifter: 1800,
	impact: 1600,
	"sub-drop": 1400,
	hit: 450,
	pop: 180,
	click: 60,
	glitch: 500,
	shimmer: 1600,
	beep: 260,
	thump: 380,
};

const n = (v: number) => v.toFixed(4);

/**
 * The ffmpeg inputs and filter graph for one variant. Returned separately so tests can
 * check a recipe without running it. Every recipe ends in [out], stereo, 48 kHz.
 */
export function sfxRecipe(
	kind: SfxKind,
	opts: { character?: SfxCharacter; durationMs?: number; seed: number },
): { durationMs: number; inputs: string[]; graph: string; about: string } {
	const r = rng(opts.seed);
	const vary = (v: number, amount = 0.15) => v * (1 - amount + 2 * amount * r());
	const d = (opts.durationMs ?? vary(LENGTH[kind])) / 1000;
	const D = n(d);
	const ch = opts.character ?? "organic";
	let inputs: string[] = [];
	let graph = "";
	let about = "";
	const noise = (color: string, seed: number) => [
		"-f",
		"lavfi",
		"-i",
		`anoisesrc=d=${D}:c=${color}:a=0.8:r=48000:s=${seed}`,
	];
	const sine = (expr: string) => ["-f", "lavfi", "-i", `aevalsrc='${expr}':d=${D}:s=48000`];
	const seedN = Math.floor(r() * 1e6);
	switch (kind) {
		case "whoosh":
		case "swish": {
			// Filtered noise in three bands whose loudest moments pass by one after another
			// (a sweep), panned across the stereo field.
			const peak = vary(kind === "swish" ? 0.35 : 0.55, 0.2);
			const up = r() > 0.35;
			const [a, b, c] = up ? [peak - 0.12, peak, peak + 0.1] : [peak + 0.1, peak, peak - 0.12];
			const env = (p: number, w: number) => `exp(-pow((t/${D}-${n(p)})/${n(w)},2))`;
			const w = kind === "swish" ? 0.14 : vary(0.2, 0.25);
			inputs = noise(r() > 0.5 ? "pink" : "white", seedN);
			graph =
				`[0]asplit=3[n1][n2][n3];` +
				`[n1]lowpass=f=${Math.round(vary(500))},volume='${env(a, w)}':eval=frame[l];` +
				`[n2]bandpass=f=${Math.round(vary(1400))}:width_type=o:w=1.5,volume='${env(b, w)}':eval=frame[m];` +
				`[n3]highpass=f=${Math.round(vary(3200))},volume='0.7*${env(c, w)}':eval=frame[h];` +
				`[l][m][h]amix=inputs=3:normalize=0,apulsator=hz=${n(vary(kind === "swish" ? 3 : 1.2))}:amount=0.6,aformat=channel_layouts=stereo[s]`;
			about = `${kind} (${up ? "rising" : "falling"} sweep, peak at ${Math.round(peak * 100)}%)`;
			break;
		}
		case "riser":
		case "downlifter": {
			// A sine that glides up exponentially over rising noise; the downlifter is the same, reversed.
			const f0 = vary(120);
			const k = vary(14, 0.3);
			const phase = `2*PI*${n(f0)}*${n(d)}/log(${n(k)})*(pow(${n(k)},t/${D})-1)`;
			const env = `pow(t/${D},1.6)`;
			inputs = [
				...sine(`0.35*${env}*(sin(${phase})+0.3*sin(2*${phase}))`),
				...noise("white", seedN),
			];
			graph =
				`[1]highpass=f=${Math.round(vary(1800))},volume='0.45*pow(t/${D},2.2)':eval=frame[nz];` +
				`[0][nz]amix=inputs=2:normalize=0,aphaser=speed=${n(vary(0.8))},aformat=channel_layouts=stereo` +
				(kind === "downlifter" ? ",areverse" : "") +
				"[s]";
			about = `${kind} (${Math.round(f0)} Hz × ${k.toFixed(1)})`;
			break;
		}
		case "impact":
		case "sub-drop":
		case "thump":
		case "hit": {
			// A pitch-dropping sine (the body) with a noise transient (the crack), and space for impacts.
			const top = vary(kind === "hit" ? 180 : kind === "thump" ? 120 : 90);
			const bottom = vary(kind === "sub-drop" ? 32 : 45);
			const fall = vary(kind === "sub-drop" ? 2.5 : 18, 0.3);
			const decay = vary(kind === "sub-drop" ? 2.2 : kind === "impact" ? 3.2 : 9, 0.25);
			const f = `(${n(bottom)}+(${n(top - bottom)})*exp(-${n(fall)}*t))`;
			const phase = `2*PI*(${n(bottom)}*t+${n(top - bottom)}/${n(fall)}*(1-exp(-${n(fall)}*t)))`;
			inputs = [...sine(`0.9*exp(-${n(decay)}*t)*sin(${phase})`), ...noise("pink", seedN)];
			void f;
			const crack = kind === "sub-drop" ? 0 : kind === "hit" ? 0.8 : 0.5;
			graph =
				`[1]lowpass=f=${Math.round(vary(kind === "hit" ? 5000 : 2200))},volume='${crack}*exp(-${n(vary(40))}*t)':eval=frame[cr];` +
				`[0][cr]amix=inputs=2:normalize=0` +
				(kind === "impact"
					? `,aecho=0.7:0.5:${Math.round(vary(60))}|${Math.round(vary(140))}:0.35|0.2`
					: "") +
				",aformat=channel_layouts=stereo[s]";
			about = `${kind} (${Math.round(top)} → ${Math.round(bottom)} Hz)`;
			break;
		}
		case "pop": {
			const f0 = vary(700, 0.25);
			const phase = `2*PI*(${n(f0 * 0.5)}*t+${n(f0 * 0.5)}/30*(1-exp(-30*t)))`;
			inputs = sine(`0.8*exp(-${n(vary(28))}*t)*sin(${phase})`);
			graph = "[0]aformat=channel_layouts=stereo[s]";
			about = `pop (${Math.round(f0)} Hz)`;
			break;
		}
		case "click": {
			inputs = noise("white", seedN);
			graph = `[0]highpass=f=${Math.round(vary(2500))},volume='exp(-${n(vary(180))}*t)':eval=frame,aformat=channel_layouts=stereo[s]`;
			about = "click";
			break;
		}
		case "beep": {
			const f1 = vary(880, 0.3);
			const f2 = f1 * (r() > 0.5 ? 1.5 : 1.25);
			const half = n(d / 2);
			inputs = sine(
				`0.45*(if(lt(t,${half}),sin(2*PI*${n(f1)}*t),sin(2*PI*${n(f2)}*t)))*min(1,t*200)*min(1,(${D}-t)*60)`,
			);
			graph = "[0]aformat=channel_layouts=stereo[s]";
			about = `beep (${Math.round(f1)} → ${Math.round(f2)} Hz)`;
			break;
		}
		case "glitch": {
			// Square blips at random pitches, chopped and bit-crushed.
			const step = vary(0.045, 0.3);
			const pitches = Array.from({ length: 6 }, () => Math.round(200 + r() * 1800));
			const pick = pitches.map((p, i) => `eq(mod(floor(t/${n(step)}),6),${i})*${p}`).join("+");
			inputs = sine(`0.5*sgn(sin(2*PI*(${pick})*t))*gt(sin(2*PI*t/${n(step * 2.3)}),-0.2)`);
			graph = `[0]acrusher=bits=${Math.round(vary(6, 0.3))}:mode=log:aa=0.5,aformat=channel_layouts=stereo[s]`;
			about = "glitch";
			break;
		}
		case "shimmer": {
			const base = vary(1200, 0.3);
			const partials = [1, 1.5, 2, 2.67, 3]
				.map((m, i) => `${n(0.16 / (i + 1))}*sin(2*PI*${n(base * m * (1 + (r() - 0.5) * 0.01))}*t)`)
				.join("+");
			inputs = sine(`(${partials})*min(1,t*30)*exp(-${n(vary(2.2))}*t)`);
			graph = `[0]aecho=0.8:0.6:${Math.round(vary(90))}|${Math.round(vary(170))}:0.4|0.25,aformat=channel_layouts=stereo[s]`;
			about = `shimmer (${Math.round(base)} Hz)`;
			break;
		}
	}
	// Character: the same sound made softer, brighter, darker, heavier or digital.
	const colour: Record<SfxCharacter, string> = {
		organic: "anull",
		soft: "lowpass=f=5000,volume=0.7",
		bright: "highpass=f=220,treble=g=5:f=6000",
		dark: "lowpass=f=2200,bass=g=3",
		heavy: "bass=g=7:f=90,aecho=0.6:0.4:90:0.25",
		digital: "acrusher=bits=9:mode=log:aa=0.6,highpass=f=120",
	};
	const fade = Math.min(0.02, d / 8);
	graph +=
		`;[s]${colour[ch]},afade=t=in:d=0.003,afade=t=out:st=${n(Math.max(0, d - fade))}:d=${n(fade)},` +
		"alimiter=limit=0.89:attack=1:release=40:level=disabled,atrim=0:" +
		D +
		"[out]";
	return { durationMs: Math.round(d * 1000), inputs, graph, about: `${about}, ${ch}` };
}

/** Synthesises one variant to `file` (WAV). */
export async function generateSfx(
	kind: SfxKind,
	opts: { character?: SfxCharacter; durationMs?: number; seed?: number },
	file: string,
): Promise<{ file: string; durationMs: number; about: string; seed: number }> {
	const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
	const recipe = sfxRecipe(kind, { ...opts, seed });
	await fs.mkdir(path.dirname(file), { recursive: true });
	await ffmpeg([
		...recipe.inputs,
		"-filter_complex",
		recipe.graph,
		"-map",
		"[out]",
		"-ar",
		"48000",
		"-c:a",
		"pcm_s16le",
		file,
	]);
	return { file, durationMs: recipe.durationMs, about: recipe.about, seed };
}

export { licenceLabel };
