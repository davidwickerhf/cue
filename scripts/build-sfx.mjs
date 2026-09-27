#!/usr/bin/env node
/**
 * Builds Cue's sound effects library: CC0 sounds from Kenney's packs (trimmed and
 * loudness-matched) and original sounds synthesised here (whooshes, a riser, a
 * camera shutter, typewriter keys, a pop, a chime and room tone), plus a
 * waveform poster for each.
 *
 *   node scripts/build-sfx.mjs
 *
 * Needs ffmpeg (on PATH, or FFMPEG=/path/to/ffmpeg), curl and unzip. Kenney packs
 * are cached in the ignored .cache/sfx folder. Writes resources/assets/sounds,
 * resources/assets/posters and the website's copies in site/public/assets.
 * Loudness: one-shot hits peak at about -16 LUFS momentary (≈ -18 LUFS short-term
 * in context), true peak at most -1 dBFS; room tone sits at -40 LUFS integrated,
 * low enough to fill silence without being noticed.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache/sfx");
const OUT = path.join(ROOT, "resources/assets/sounds");
const POSTERS = path.join(ROOT, "resources/assets/posters");
const SITE = path.join(ROOT, "site/public/assets");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const RATE = 48000;
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "cue-sfx-"));

for (const dir of [CACHE, OUT, POSTERS, SITE]) fs.mkdirSync(dir, { recursive: true });

const run = (args, options = {}) =>
	execFileSync(FFMPEG, ["-hide_banner", "-nostats", "-y", ...args], {
		stdio: ["pipe", "pipe", "pipe"],
		maxBuffer: 1 << 28,
		...options,
	});

// --- Kenney packs (CC0 1.0) ----------------------------------------------------------

const PACKS = {
	"rpg-audio":
		"https://kenney.nl/media/pages/assets/rpg-audio/8e99002d76-1677590336/kenney_rpg-audio.zip",
	"impact-sounds":
		"https://kenney.nl/media/pages/assets/impact-sounds/87b4ddecda-1677589768/kenney_impact-sounds.zip",
	"interface-sounds":
		"https://kenney.nl/media/pages/assets/interface-sounds/fa43c1dd4d-1677589452/kenney_interface-sounds.zip",
};
function kenney(pack, name) {
	const folder = path.join(CACHE, `kenney_${pack}`);
	if (!fs.existsSync(folder)) {
		const zip = `${folder}.zip`;
		execFileSync("curl", ["-sSfL", "-o", zip, PACKS[pack]]);
		execFileSync("unzip", ["-o", "-q", zip, "-d", folder]);
	}
	const found = execFileSync("find", [folder, "-name", `${name}.ogg`])
		.toString()
		.trim()
		.split("\n")[0];
	if (!found) throw new Error(`${name} is not in ${pack}`);
	return found;
}

// --- Synthesis ---------------------------------------------------------------------

function mulberry32(seed) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** A state-variable filter whose cutoff and resonance can change every sample. */
function svf() {
	let low = 0;
	let band = 0;
	return (input, cutoff, q) => {
		const f = 2 * Math.sin((Math.PI * Math.min(cutoff, RATE / 6)) / RATE);
		low += f * band;
		const high = input - low - band / q;
		band += f * high;
		return { low, band, high };
	};
}

const smooth = (t) => t * t * (3 - 2 * t);
const buffer = (seconds, channels = 1) =>
	Array.from({ length: channels }, () => new Float32Array(Math.round(seconds * RATE)));

/** A whoosh: band-passed noise sweeping up and back down, swelling to a peak, panning across. */
function whoosh({ seconds, peakAt, from, top, to, q, seed, sub = 0, pan = 0.7 }) {
	const rand = mulberry32(seed);
	const [l, r] = buffer(seconds, 2);
	const filterA = svf();
	const filterB = svf();
	let pink = 0;
	for (let i = 0; i < l.length; i++) {
		const t = i / l.length;
		const rise = t < peakAt ? t / peakAt : 1 - (t - peakAt) / (1 - peakAt);
		const envelope = t < peakAt ? smooth(rise) ** 1.6 : smooth(Math.max(0, rise)) ** 2.4;
		const cutoff =
			t < peakAt
				? from * (top / from) ** smooth(t / peakAt)
				: top * (to / top) ** smooth((t - peakAt) / (1 - peakAt));
		const white = rand() * 2 - 1;
		pink = 0.97 * pink + 0.03 * white;
		const noise = white * 0.6 + pink * 4;
		const a = filterA(noise, cutoff, q).band;
		const b = filterB(a, cutoff * 1.4, q * 0.8).band;
		const tone = sub * Math.sin(2 * Math.PI * (40 + 30 * envelope) * (i / RATE)) * envelope;
		const value = (a * 0.5 + b * 0.5) * envelope + tone;
		const p = pan * (t * 2 - 1);
		l[i] = value * Math.sqrt(0.5 * (1 - p));
		r[i] = value * Math.sqrt(0.5 * (1 + p));
	}
	return [l, r];
}

/** A riser: noise and a gliding tone that swell and brighten toward the end. */
function riser({ seconds, seed }) {
	const rand = mulberry32(seed);
	const [l, r] = buffer(seconds, 2);
	const filter = svf();
	let phaseA = 0;
	let phaseB = 0;
	for (let i = 0; i < l.length; i++) {
		const t = i / l.length;
		const swell = t ** 2.2 * (t > 0.97 ? (1 - t) / 0.03 : 1);
		const cutoff = 250 * (7000 / 250) ** (t ** 1.5);
		const noise = filter(rand() * 2 - 1, cutoff, 2.5).band;
		const freq = 180 * 4 ** (t ** 1.4) * (1 + 0.01 * Math.sin(2 * Math.PI * 6 * (i / RATE)));
		phaseA += (2 * Math.PI * freq) / RATE;
		phaseB += (2 * Math.PI * freq * 1.006) / RATE;
		const tone = 0.22 * (Math.sin(phaseA) + 0.4 * Math.sin(2 * phaseA)) * swell;
		const toneB = 0.22 * (Math.sin(phaseB) + 0.4 * Math.sin(2 * phaseB)) * swell;
		l[i] = noise * swell * 0.8 + tone;
		r[i] = noise * swell * 0.8 + toneB;
	}
	return [l, r];
}

/** Adds a decaying click into `out` at `at` seconds: a noise tick, a metal ping and a body thump. */
function click(
	out,
	at,
	{
		rand,
		tick = 1,
		tickDecay = 0.004,
		ping = 0,
		pingHz = 3200,
		pingDecay = 0.012,
		body = 0,
		bodyHz = 180,
		bodyDecay = 0.03,
		hp = 1500,
	},
) {
	const start = Math.round(at * RATE);
	const filter = svf();
	const length = Math.round(0.25 * RATE);
	for (let n = 0; n < length && start + n < out.length; n++) {
		const s = n / RATE;
		const noise = filter(rand() * 2 - 1, hp, 0.7).high * tick * Math.exp(-s / tickDecay);
		const metal = ping * Math.sin(2 * Math.PI * pingHz * s) * Math.exp(-s / pingDecay);
		const thump = body * Math.sin(2 * Math.PI * bodyHz * s) * Math.exp(-s / bodyDecay);
		out[start + n] += noise + metal + thump;
	}
}

function shutter({ seed }) {
	const rand = mulberry32(seed);
	const [out] = buffer(0.32);
	// Mirror up: a sharp click, a short mechanical whirr, then the shutter closing.
	click(out, 0.004, {
		rand,
		tick: 1,
		tickDecay: 0.003,
		ping: 0.35,
		pingHz: 4100,
		pingDecay: 0.006,
		body: 0.45,
		bodyHz: 240,
		bodyDecay: 0.018,
		hp: 2500,
	});
	const whirr = svf();
	for (let n = Math.round(0.012 * RATE); n < Math.round(0.1 * RATE); n++) {
		const s = n / RATE;
		out[n] +=
			whirr(rand() * 2 - 1, 1800, 3).band *
			0.18 *
			Math.sin((Math.PI * (s - 0.012)) / 0.088) *
			(1 + 0.5 * Math.sin(2 * Math.PI * 320 * s));
	}
	click(out, 0.1, {
		rand,
		tick: 0.8,
		tickDecay: 0.004,
		ping: 0.25,
		pingHz: 3300,
		pingDecay: 0.008,
		body: 0.6,
		bodyHz: 160,
		bodyDecay: 0.025,
		hp: 1800,
	});
	return [out];
}

function typewriterKey(out, at, rand, strength = 1) {
	const pitch = 0.9 + rand() * 0.2;
	click(out, at, {
		rand,
		tick: 0.9 * strength,
		tickDecay: 0.003,
		ping: 0.16 * strength,
		pingHz: 2300 * pitch,
		pingDecay: 0.01,
		body: 0.5 * strength,
		bodyHz: 150 * pitch,
		bodyDecay: 0.022,
		hp: 1200,
	});
	// The typebar lands on the platen a few milliseconds later.
	click(out, at + 0.011 + rand() * 0.004, {
		rand,
		tick: 0.55 * strength,
		tickDecay: 0.002,
		body: 0.25 * strength,
		bodyHz: 320 * pitch,
		bodyDecay: 0.012,
		hp: 2400,
	});
}

function typewriter({ keys, seed }) {
	const rand = mulberry32(seed);
	const [out] = buffer(keys === 1 ? 0.14 : 0.2 + keys * 0.105);
	let at = 0.004;
	for (let k = 0; k < keys; k++) {
		typewriterKey(out, at, rand, 0.75 + rand() * 0.3);
		at += 0.07 + rand() * 0.07 + (rand() < 0.15 ? 0.08 : 0);
	}
	return [out];
}

/** A soft pop: a sine that drops in pitch with a tiny click at the front. */
function pop({ seed }) {
	const rand = mulberry32(seed);
	const [out] = buffer(0.16);
	let phase = 0;
	for (let n = 0; n < out.length; n++) {
		const s = n / RATE;
		phase += (2 * Math.PI * (320 + 900 * Math.exp(-s / 0.012))) / RATE;
		out[n] = Math.sin(phase) * Math.exp(-s / 0.035) * Math.min(1, s / 0.0015);
	}
	click(out, 0, { rand, tick: 0.25, tickDecay: 0.0015, hp: 3000 });
	return [out];
}

/** A soft title chime: two bell tones (a fifth apart), slightly detuned left and right. */
function chime({ seed }) {
	mulberry32(seed);
	const [l, r] = buffer(2.8, 2);
	const bell = (at, hz, gain) => {
		const partials = [
			[1, 1, 1.6],
			[2.0, 0.35, 0.9],
			[2.76, 0.22, 0.6],
			[5.4, 0.08, 0.25],
		];
		for (let n = Math.round(at * RATE); n < l.length; n++) {
			const s = n / RATE - at;
			let a = 0;
			let b = 0;
			for (const [ratio, amp, decay] of partials) {
				const e = amp * Math.exp(-s / decay) * Math.min(1, s / 0.004);
				a += e * Math.sin(2 * Math.PI * hz * ratio * s);
				b += e * Math.sin(2 * Math.PI * (hz * ratio + 0.5) * s);
			}
			l[n] += a * gain;
			r[n] += b * gain;
		}
	};
	bell(0.005, 659.25, 0.8);
	bell(0.11, 987.77, 0.6);
	return [l, r];
}

/** Room tone: soft, dark air (brown and pink noise, low-passed), looping without a seam. */
function roomTone({ seconds, seed }) {
	const rand = mulberry32(seed);
	const fade = 1.5;
	const total = seconds + fade;
	const [l, r] = buffer(total, 2);
	for (const channel of [l, r]) {
		const filter = svf();
		let brown = 0;
		let pink = 0;
		for (let n = 0; n < channel.length; n++) {
			const white = rand() * 2 - 1;
			brown = Math.max(-1, Math.min(1, brown * 0.998 + white * 0.03));
			pink = 0.95 * pink + 0.05 * white;
			channel[n] = filter(brown * 1.5 + pink * 0.6 + white * 0.02, 900, 0.6).low;
		}
	}
	// Crossfade the extra tail into the head so the end runs into the start.
	const head = Math.round(fade * RATE);
	const length = Math.round(seconds * RATE);
	const out = [new Float32Array(length), new Float32Array(length)];
	for (const c of [0, 1]) {
		const src = [l, r][c];
		for (let n = 0; n < length; n++) {
			if (n < head) {
				const k = n / head;
				out[c][n] = src[n] * Math.sqrt(k) + src[length + n] * Math.sqrt(1 - k);
			} else out[c][n] = src[n];
		}
	}
	return out;
}

/** Writes synthesised channels as a float WAV for the finishing pass. */
function writeRaw(channels, file) {
	const frames = channels[0].length;
	const data = Buffer.alloc(frames * channels.length * 4);
	for (let n = 0; n < frames; n++)
		for (let c = 0; c < channels.length; c++)
			data.writeFloatLE(channels[c][n], (n * channels.length + c) * 4);
	run(
		[
			"-f",
			"f32le",
			"-ar",
			String(RATE),
			"-ac",
			String(channels.length),
			"-i",
			"-",
			"-c:a",
			"pcm_f32le",
			file,
		],
		{
			input: data,
		},
	);
}

// --- Finishing ---------------------------------------------------------------------

/** Loudest momentary loudness (LUFS), integrated loudness and true peak (dBFS) of a file. */
function stats(file) {
	const out = execFileSync(
		"sh",
		[
			"-c",
			`"${FFMPEG}" -hide_banner -nostats -v verbose -i "${file}" -af "apad=pad_dur=0.5,ebur128=peak=true:framelog=verbose" -f null - 2>&1`,
		],
		{ encoding: "utf8", maxBuffer: 1 << 26 },
	);
	const momentary = [...out.matchAll(/M:\s*(-?[\d.]+|-inf)/g)]
		.map((m) => Number(m[1]))
		.filter((v) => Number.isFinite(v));
	const summary = out.slice(out.lastIndexOf("Summary:"));
	const integrated = Number(/I:\s*(-?[\d.]+) LUFS/.exec(summary)?.[1] ?? Number.NaN);
	const peak = Number(/Peak:\s*(-?[\d.]+) dBFS/.exec(summary)?.[1] ?? 0);
	return { maxMomentary: Math.max(...momentary), integrated, peak };
}

/**
 * Trims leading silence, sets the loudness (momentary max or integrated), keeps the
 * true peak under -1 dBFS, and writes 48 kHz 16-bit WAV (or AAC for long beds).
 */
function finish(
	input,
	id,
	{ target, mode = "momentary", trim = true, format = "wav", mono = false, fadeOutMs = 0 },
) {
	const trimmed = path.join(TMP, `${id}.trim.wav`);
	const filters = [
		...(trim ? ["silenceremove=start_periods=1:start_threshold=-55dB:start_silence=0.002"] : []),
		`aresample=${RATE}`,
		...(mono ? ["pan=mono|c0=0.5*c0+0.5*c1"] : []),
	];
	run(["-i", input, "-af", filters.join(","), "-c:a", "pcm_f32le", trimmed]);
	const measured = stats(trimmed);
	const level = mode === "integrated" ? measured.integrated : measured.maxMomentary;
	// Sharp transients hit the peak ceiling before they sound as loud as the rest: let a
	// limiter take up to 6 dB off their peaks rather than leave them quiet.
	const gain = Math.min(target - level, -1 - measured.peak + 6);
	const limit =
		gain > -1 - measured.peak
			? ["alimiter=limit=0.79:attack=0.5:release=40:level=false:latency=true"]
			: [];
	const duration = Number(
		execFileSync("ffprobe", [
			"-v",
			"error",
			"-show_entries",
			"format=duration",
			"-of",
			"csv=p=0",
			trimmed,
		]).toString(),
	);
	const tail = fadeOutMs
		? [
				`afade=t=out:st=${Math.max(0, duration - fadeOutMs / 1000).toFixed(3)}:d=${(fadeOutMs / 1000).toFixed(3)}`,
			]
		: [];
	const file = `${id}.${format}`;
	run([
		"-i",
		trimmed,
		"-af",
		[`volume=${gain.toFixed(2)}dB`, ...limit, ...tail].join(","),
		...(format === "wav" ? ["-c:a", "pcm_s16le"] : ["-c:a", "aac", "-b:a", "96k"]),
		"-map_metadata",
		"-1",
		path.join(OUT, file),
	]);
	const final = stats(path.join(OUT, file));
	console.log(
		`${file.padEnd(28)} ${(duration * 1000).toFixed(0).padStart(6)} ms  M max ${final.maxMomentary.toFixed(1)}  I ${final.integrated.toFixed(1)}  peak ${final.peak.toFixed(1)}  ${(fs.statSync(path.join(OUT, file)).size / 1024).toFixed(0)} KB`,
	);
	// Poster: the waveform on a dark card.
	const poster = path.join(POSTERS, `${id}.jpg`);
	run([
		"-i",
		path.join(OUT, file),
		"-filter_complex",
		"aformat=channel_layouts=mono,showwavespic=s=560x200:colors=0xf2c434:scale=sqrt,pad=640:360:40:80:color=black,format=yuv420p",
		"-frames:v",
		"1",
		"-q:v",
		"4",
		poster,
	]);
	fs.copyFileSync(poster, path.join(SITE, `${id}.jpg`));
}

// --- The library ---------------------------------------------------------------------

const HIT = -16;

const synth = (id, channels, options) => {
	const raw = path.join(TMP, `${id}.raw.wav`);
	writeRaw(channels, raw);
	finish(raw, id, { target: HIT, ...options });
};

// Kenney (CC0 1.0)
finish(kenney("rpg-audio", "bookPlace1"), "sfx-paper-slap", { target: HIT, mono: true });
finish(kenney("rpg-audio", "bookPlace2"), "sfx-paper-slap-soft", { target: HIT - 3, mono: true });
finish(kenney("rpg-audio", "bookFlip1"), "sfx-paper-rustle", { target: HIT - 2, mono: true });
finish(kenney("rpg-audio", "bookFlip3"), "sfx-paper-flick", { target: HIT - 2, mono: true });
finish(kenney("impact-sounds", "impactSoft_heavy_000"), "sfx-impact-thud", {
	target: HIT,
	mono: true,
});
finish(kenney("impact-sounds", "impactPunch_heavy_000"), "sfx-impact-hit", {
	target: HIT,
	mono: true,
});
finish(kenney("interface-sounds", "tick_002"), "sfx-tick", { target: HIT - 4, mono: true });

// Original (synthesised here)
synth(
	"sfx-whoosh-soft",
	whoosh({ seconds: 0.75, peakAt: 0.55, from: 250, top: 2200, to: 500, q: 1.1, seed: 11 }),
);
synth(
	"sfx-whoosh-fast",
	whoosh({
		seconds: 0.45,
		peakAt: 0.5,
		from: 600,
		top: 5200,
		to: 1400,
		q: 1.4,
		seed: 23,
		pan: 0.9,
	}),
);
synth(
	"sfx-whoosh-deep",
	whoosh({
		seconds: 1.15,
		peakAt: 0.6,
		from: 120,
		top: 1100,
		to: 220,
		q: 0.9,
		seed: 37,
		sub: 0.35,
		pan: 0.5,
	}),
);
synth("sfx-riser", riser({ seconds: 1.6, seed: 5 }), { target: HIT + 1, trim: false });
synth("sfx-camera-shutter", shutter({ seed: 3 }));
synth("sfx-typewriter-key", typewriter({ keys: 1, seed: 17 }), { target: HIT - 3 });
synth("sfx-typewriter-burst", typewriter({ keys: 12, seed: 29 }), { target: HIT - 2 });
synth("sfx-pop", pop({ seed: 41 }), { target: HIT - 2 });
synth("sfx-chime", chime({ seed: 1 }), { target: HIT - 2, fadeOutMs: 400 });
synth("sfx-room-tone", roomTone({ seconds: 10, seed: 9 }), {
	target: -40,
	mode: "integrated",
	trim: false,
	format: "m4a",
});

fs.rmSync(TMP, { recursive: true, force: true });
