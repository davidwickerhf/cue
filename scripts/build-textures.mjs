#!/usr/bin/env node
/**
 * Builds Cue's texture library: CC0 paper scans from ambientCG, resized and
 * colour-matched, plus original procedural overlays (film dust, a light leak,
 * a halftone screen and a vignette) and 640×360 posters for every texture.
 *
 *   node scripts/build-textures.mjs
 *
 * Needs ffmpeg (on PATH, or FFMPEG=/path/to/ffmpeg) and unzip. Downloads are
 * cached in the ignored .cache/textures folder. Writes resources/assets/textures,
 * resources/assets/posters and the website's copies in site/public/assets.
 * Licences and sources are recorded in resources/assets/catalog.json.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, ".cache/textures");
const OUT = path.join(ROOT, "resources/assets/textures");
const POSTERS = path.join(ROOT, "resources/assets/posters");
const SITE = path.join(ROOT, "site/public/assets");
const FFMPEG = process.env.FFMPEG || "ffmpeg";
const W = 1920;
const H = 1080;

for (const dir of [CACHE, OUT, POSTERS, SITE]) fs.mkdirSync(dir, { recursive: true });

const ffmpeg = (...args) =>
	execFileSync(FFMPEG, ["-hide_banner", "-loglevel", "error", "-y", ...args], {
		stdio: "inherit",
	});

/** An ambientCG material's 2K colour map (CC0 1.0), downloaded once. */
function ambientColorMap(id) {
	const zip = path.join(CACHE, `${id}.zip`);
	const folder = path.join(CACHE, id);
	const color = path.join(folder, `${id}_2K-JPG_Color.jpg`);
	if (fs.existsSync(color)) return color;
	execFileSync("curl", ["-sSfL", "-o", zip, `https://ambientcg.com/get?file=${id}_2K-JPG.zip`]);
	execFileSync("unzip", ["-o", "-q", zip, "-d", folder]);
	return color;
}

/**
 * A lutrgb filter that moves the scan's mean colour to `target` and scales the
 * fibre detail around it by `detail`, so each paper reads as its intended stock.
 */
function recolor(mean, target, detail) {
	const ch = ["r", "g", "b"].map(
		(c, i) => `${c}='clip(${target[i]}+(val-${mean[i]})*${detail},0,255)'`,
	);
	return `lutrgb=${ch.join(":")}`;
}

const fill = `scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H}`;

// --- CC0 paper and card (ambientCG) --------------------------------------------

const PAPERS = [
	{
		file: "paper-off-white.jpg",
		source: "Paper001",
		vf: recolor([244, 243, 242], [242, 237, 228], 1.8),
	},
	{
		file: "paper-crumpled.jpg",
		source: "Paper003",
		vf: recolor([223, 223, 223], [236, 232, 224], 2.2),
	},
	{ file: "paper-kraft.jpg", source: "Paper006", vf: "null" },
	{ file: "cardboard-ribbed.jpg", source: "Paper004", vf: "null" },
	{
		file: "paper-newsprint.jpg",
		source: "Paper002",
		vf: recolor([195, 185, 179], [222, 216, 204], 1.3),
	},
	{
		file: "paper-construction-yellow.jpg",
		source: "Paper001",
		vf: recolor([244, 243, 242], [242, 196, 52], 3.2),
	},
];
for (const paper of PAPERS) {
	ffmpeg(
		"-i",
		ambientColorMap(paper.source),
		"-vf",
		`${fill},${paper.vf},format=yuvj444p`,
		"-q:v",
		"3",
		path.join(OUT, paper.file),
	);
}

// --- Original procedural overlays -----------------------------------------------

// Film dust and scratches on black, for screen blend: specks and fibres that change
// every frame, a hair now and then, and the odd vertical scratch that lingers for a
// few frames. Drawn here with a seeded random sequence (so it rebuilds identically)
// at half size and enlarged by ffmpeg. 24 fps; every frame is independent, so it loops.
function mulberry32(seed) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}
function dustFrames(w, h, count, seed) {
	const rand = mulberry32(seed);
	const frames = [];
	let scratch = null;
	const dot = (px, x, y, r, value) => {
		for (let yy = Math.floor(y - r - 1); yy <= y + r + 1; yy++)
			for (let xx = Math.floor(x - r - 1); xx <= x + r + 1; xx++) {
				if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
				const k = Math.min(1, Math.max(0, r + 0.5 - Math.hypot(xx - x, yy - y)));
				const i = yy * w + xx;
				px[i] = Math.max(px[i], Math.round(value * k));
			}
	};
	for (let f = 0; f < count; f++) {
		const px = new Uint8Array(w * h);
		// Specks: mostly tiny, a few larger clumps.
		const specks = 14 + Math.floor(rand() * 22);
		for (let i = 0; i < specks; i++) {
			const x = rand() * w;
			const y = rand() * h;
			const r = 0.5 + rand() ** 4 * 3.5;
			const value = 150 + rand() * 105;
			dot(px, x, y, r, value);
			if (r > 1.6)
				for (let j = 0; j < 3; j++)
					dot(px, x + (rand() - 0.5) * r * 2, y + (rand() - 0.5) * r * 2, r * 0.6, value);
		}
		// Fibres and hairs: short or long curling strokes.
		if (rand() < 0.35) {
			let x = rand() * w;
			let y = rand() * h;
			let angle = rand() * Math.PI * 2;
			const length = 12 + rand() ** 2 * 140;
			const value = 140 + rand() * 90;
			for (let s = 0; s < length; s += 0.5) {
				angle += (rand() - 0.5) * 0.25;
				x += Math.cos(angle) * 0.5;
				y += Math.sin(angle) * 0.5;
				dot(px, x, y, 0.45, value);
			}
		}
		// Scratches: a thin vertical line that stays for a few frames, drifting a little.
		if (!scratch && rand() < 0.1)
			scratch = { x: rand() * w, frames: 3 + Math.floor(rand() * 8), value: 90 + rand() * 110 };
		if (scratch) {
			scratch.x += (rand() - 0.5) * 1.5;
			for (let y = 0; y < h; y++) {
				const fade = 0.55 + 0.45 * Math.sin(y / 23 + f);
				dot(px, scratch.x + Math.sin(y / 90) * 0.8, y, 0.35, scratch.value * fade);
			}
			if (--scratch.frames <= 0) scratch = null;
		}
		frames.push(px);
	}
	return Buffer.concat(frames);
}
const dustSeconds = 6;
execFileSync(
	FFMPEG,
	[
		"-hide_banner",
		"-loglevel",
		"error",
		"-y",
		"-f",
		"rawvideo",
		"-pix_fmt",
		"gray",
		"-s",
		"960x540",
		"-r",
		"24",
		"-i",
		"-",
		"-vf",
		`scale=${W}:${H}:flags=bicubic,format=yuv420p`,
		"-c:v",
		"libx264",
		"-preset",
		"slow",
		"-crf",
		"26",
		"-movflags",
		"+faststart",
		path.join(OUT, "film-dust.mp4"),
	],
	{ input: dustFrames(960, 540, dustSeconds * 24, 1939), maxBuffer: 1 << 30 },
);

// Light leak for screen blend: warm glows (orange, magenta, gold) drifting on black.
// Drawn small and enlarged (it is all soft); every motion is periodic in the clip
// length, so the end meets the start.
const leakSeconds = 8;
const P = leakSeconds;
const blob = (cx, cy, s) =>
	`exp(-((X/W-(${cx}))*(X/W-(${cx}))*1.8+(Y/H-(${cy}))*(Y/H-(${cy})))/(${s}))`;
const b1 = blob(`0.18+0.22*sin(2*PI*T/${P})`, `0.35+0.2*cos(2*PI*T/${P})`, 0.05);
const b2 = blob(`0.85-0.2*sin(2*PI*T/${P}+1.3)`, `0.7+0.18*sin(4*PI*T/${P})`, 0.07);
const b3 = blob(`0.5+0.35*cos(2*PI*T/${P}+0.6)`, `0.15+0.1*sin(2*PI*T/${P}+2)`, 0.035);
const breathe = `(0.85+0.15*sin(4*PI*T/${P}+0.4))`;
ffmpeg(
	"-f",
	"lavfi",
	"-i",
	`color=c=black:s=384x216:r=24:d=${leakSeconds}`,
	"-vf",
	[
		`geq=r='255*min(1,${breathe}*(1.0*${b1}+1.0*${b2}+1.0*${b3}))'`,
		`:g='255*min(1,${breathe}*(0.48*${b1}+0.24*${b2}+0.82*${b3}))'`,
		`:b='255*min(1,${breathe}*(0.10*${b1}+0.43*${b2}+0.48*${b3}))',`,
		`scale=${W}:${H}:flags=bicubic,gblur=sigma=6,format=yuv420p`,
	].join(""),
	"-c:v",
	"libx264",
	"-preset",
	"slow",
	"-crf",
	"24",
	"-movflags",
	"+faststart",
	path.join(OUT, "light-leak.mp4"),
);

// Halftone screen: black dots on a 45° grid (pitch ≈ 0.6 % of the width), growing
// from the top left to the bottom right, on transparency. Multiply or normal at 20–50 %.
const pitch = 12;
const u = "((X+Y)*0.70711)";
const v = "((X-Y)*0.70711)";
const du = `(${u}-${pitch}*floor(${u}/${pitch}+0.5))`;
const dv = `(${v}-${pitch}*floor(${v}/${pitch}+0.5))`;
const radius = `(${pitch}*(0.12+0.22*(X/W*0.6+Y/H*0.4)))`;
ffmpeg(
	"-f",
	"lavfi",
	"-i",
	`color=c=black:s=${W}x${H}:d=1,format=rgba`,
	"-frames:v",
	"1",
	"-vf",
	`geq=r=0:g=0:b=0:a='255*clip(${radius}-hypot(${du},${dv})+0.5,0,1)'`,
	path.join(OUT, "halftone-screen.png"),
);

// Vignette: black edges fading to a clear centre, on transparency.
ffmpeg(
	"-f",
	"lavfi",
	"-i",
	`color=c=black:s=${W}x${H}:d=1,format=rgba`,
	"-frames:v",
	"1",
	"-vf",
	"geq=r=0:g=0:b=0:a='255*pow(clip((hypot((X/W-0.5)*1.2,(Y/H-0.5))-0.3)/0.5,0,1),1.8)*0.85'",
	path.join(OUT, "vignette.png"),
);

// --- Posters ---------------------------------------------------------------------

const poster = (id, args) => {
	const target = path.join(POSTERS, `${id}.jpg`);
	ffmpeg(...args, "-frames:v", "1", "-q:v", "4", target);
	fs.copyFileSync(target, path.join(SITE, `${id}.jpg`));
};
const small = "scale=640:360:flags=lanczos";
for (const paper of PAPERS)
	poster(path.parse(paper.file).name, ["-i", path.join(OUT, paper.file), "-vf", small]);
// The screen-blend loops are shown over dimmed paper, as they would sit over a picture.
for (const [id, at] of [
	["film-dust", "1"],
	["light-leak", "2"],
])
	poster(id, [
		"-i",
		path.join(OUT, "paper-newsprint.jpg"),
		"-ss",
		at,
		"-i",
		path.join(OUT, `${id}.mp4`),
		"-filter_complex",
		`[0]format=gbrp,lutrgb=r=val*0.42:g=val*0.42:b=val*0.42[bg];[1]format=gbrp[fg];[bg][fg]blend=all_mode=screen,${small}`,
	]);
// The transparent overlays are shown over the off-white paper they are made for.
for (const id of ["halftone-screen", "vignette"])
	poster(id, [
		"-i",
		path.join(OUT, "paper-off-white.jpg"),
		"-i",
		path.join(OUT, `${id}.png`),
		"-filter_complex",
		`[1]colorchannelmixer=aa=0.6[o];[0][o]overlay=format=auto,${small}`,
	]);

for (const file of fs.readdirSync(OUT).sort()) {
	const size = fs.statSync(path.join(OUT, file)).size;
	console.log(`${file.padEnd(34)} ${(size / 1024).toFixed(0).padStart(6)} KB`);
}
