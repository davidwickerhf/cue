import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { ffmpeg, ffmpegPath, probe } from "./media";

/**
 * Measuring a reference video, so an agent asked to "make it look like this"
 * works from numbers instead of guesses: where the cuts are and how the pace
 * changes, how bright and colourful it is (and how much is black and white),
 * its dominant colours, how loud it is, and a contact sheet with one frame per
 * shot to look at.
 */

export interface ReferenceReport {
	file: string;
	durationMs: number;
	width: number;
	height: number;
	cuts: number[];
	shots: {
		count: number;
		medianMs: number;
		meanMs: number;
		shortestMs: number;
		longestMs: number;
		cutsPerMinute: number;
		/** Cuts in each 10-second stretch, to see where the edit speeds up or breathes. */
		cutsPer10s: number[];
	};
	look: {
		/** 0–255 average luma. */
		brightness: number;
		/** 0–~180 average chroma (signalstats SATAVG); under ~8 reads as black and white. */
		saturation: number;
		/** Share of the running time that is (nearly) black and white. */
		monochromeShare: number;
		/** Most frequent colours, most common first, with their share of the picture. */
		palette: { hex: string; share: number }[];
	};
	audio: { integratedLufs: number | null; rangeLu: number | null } | null;
	/** One frame from the middle of each shot (up to 30), tiled 6 across, with times. */
	png: string;
	sheetTimesMs: number[];
}

/** Scene-change score above which a frame is a cut (ffmpeg's scene detection, 0–1). */
const CUT_SCORE = 0.3;

export async function analyzeReference(file: string, cacheDir: string): Promise<ReferenceReport> {
	const info = await probe(file);
	const durationMs = info.durationMs;
	const key = createHash("sha1").update(`${file}|${durationMs}`).digest("hex").slice(0, 12);
	const dir = path.join(cacheDir, "reference", key);
	await fs.mkdir(dir, { recursive: true });

	// Cuts: scene changes on a small copy of the picture.
	const cutLog = await ffmpeg([
		"-i",
		file,
		"-an",
		"-vf",
		`scale=160:-2,select='gt(scene,${CUT_SCORE})',showinfo`,
		"-f",
		"null",
		"-",
	]);
	const cuts = [...cutLog.matchAll(/pts_time:([\d.]+)/g)]
		.map((m) => Math.round(Number(m[1]) * 1000))
		// Flashes and fast pans can score twice in a row: one cut per 200 ms at most.
		.filter((t, i, all) => i === 0 || t - all[i - 1] > 200);
	const bounds = [0, ...cuts, durationMs];
	const lengths = bounds
		.slice(1)
		.map((t, i) => t - bounds[i])
		.filter((l) => l > 0);
	const sorted = [...lengths].sort((a, b) => a - b);
	const buckets = Array.from({ length: Math.max(1, Math.ceil(durationMs / 10000)) }, () => 0);
	for (const c of cuts) buckets[Math.min(buckets.length - 1, Math.floor(c / 10000))]++;

	// Look: brightness and colourfulness once a second.
	const statsLog = await ffmpeg([
		"-i",
		file,
		"-an",
		"-vf",
		"fps=1,scale=160:-2,signalstats,metadata=print",
		"-f",
		"null",
		"-",
	]);
	const series = (name: string) =>
		[...statsLog.matchAll(new RegExp(`lavfi\\.signalstats\\.${name}=([\\d.]+)`, "g"))].map((m) =>
			Number(m[1]),
		);
	const luma = series("YAVG");
	const chroma = series("SATAVG");
	const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

	// Palette: small frames, colours counted in coarse bins, each bin's average colour.
	const samples = Math.min(60, Math.max(6, Math.round(durationMs / 2000)));
	const raw = await ffmpegRaw([
		"-i",
		file,
		"-an",
		"-vf",
		`fps=${(samples / Math.max(1, durationMs / 1000)).toFixed(4)},scale=48:27`,
		"-f",
		"rawvideo",
		"-pix_fmt",
		"rgb24",
		"-",
	]);
	const bins = new Map<number, { n: number; r: number; g: number; b: number }>();
	for (let i = 0; i + 2 < raw.length; i += 3) {
		const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]];
		const k = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
		const bin = bins.get(k) ?? { n: 0, r: 0, g: 0, b: 0 };
		bin.n++;
		bin.r += r;
		bin.g += g;
		bin.b += b;
		bins.set(k, bin);
	}
	const pixels = raw.length / 3;
	const hex = (v: number) => Math.round(v).toString(16).padStart(2, "0");
	const palette = [...bins.values()]
		.sort((a, b) => b.n - a.n)
		.slice(0, 8)
		.map((bin) => ({
			hex: `#${hex(bin.r / bin.n)}${hex(bin.g / bin.n)}${hex(bin.b / bin.n)}`,
			share: Math.round((bin.n / pixels) * 1000) / 1000,
		}));

	// Loudness of the whole soundtrack.
	let audio: ReferenceReport["audio"] = null;
	if (info.hasAudio) {
		const log = await ffmpeg(["-i", file, "-vn", "-af", "ebur128", "-f", "null", "-"]).catch(
			() => "",
		);
		const summary = log.slice(log.lastIndexOf("Summary:"));
		const num = (re: RegExp) => {
			const m = summary.match(re);
			return m ? Number(m[1]) : null;
		};
		audio = { integratedLufs: num(/I:\s+(-?[\d.]+) LUFS/), rangeLu: num(/LRA:\s+([\d.]+) LU/) };
	}

	// Contact sheet: the middle of each shot (evenly chosen when there are many).
	const middles = lengths.map((l, i) => Math.round(bounds[i] + l / 2));
	const pick =
		middles.length <= 30
			? middles
			: Array.from({ length: 30 }, (_, i) => middles[Math.floor((i * middles.length) / 30)]);
	const frames: string[] = [];
	for (const [i, t] of pick.entries()) {
		const out = path.join(dir, `f${String(i).padStart(3, "0")}.jpg`);
		await ffmpeg([
			"-ss",
			(t / 1000).toFixed(3),
			"-i",
			file,
			"-frames:v",
			"1",
			"-vf",
			"scale=320:-2",
			out,
		]);
		frames.push(out);
	}
	const png = path.join(dir, "sheet.png");
	const columns = Math.min(6, frames.length);
	await ffmpeg([
		"-framerate",
		"1",
		"-i",
		path.join(dir, "f%03d.jpg"),
		"-vf",
		`tile=${columns}x${Math.ceil(frames.length / columns)}:padding=4:color=black`,
		"-frames:v",
		"1",
		png,
	]);

	return {
		file,
		durationMs,
		width: info.width,
		height: info.height,
		cuts,
		shots: {
			count: lengths.length,
			medianMs: sorted[Math.floor(sorted.length / 2)] ?? durationMs,
			meanMs: Math.round(mean(lengths)),
			shortestMs: sorted[0] ?? durationMs,
			longestMs: sorted.at(-1) ?? durationMs,
			cutsPerMinute: Math.round((cuts.length / Math.max(0.001, durationMs / 60000)) * 10) / 10,
			cutsPer10s: buckets,
		},
		look: {
			brightness: Math.round(mean(luma)),
			saturation: Math.round(mean(chroma) * 10) / 10,
			monochromeShare: chroma.length
				? Math.round((chroma.filter((c) => c < 8).length / chroma.length) * 100) / 100
				: 0,
			palette,
		},
		audio,
		png,
		sheetTimesMs: pick,
	};
}

/** ffmpeg writing raw bytes to stdout. */
function ffmpegRaw(args: string[]): Promise<Buffer> {
	return new Promise((resolve, reject) => {
		execFile(
			ffmpegPath(),
			["-hide_banner", "-loglevel", "error", ...args],
			{ encoding: "buffer", maxBuffer: 256 * 1024 * 1024 },
			(error, stdout) => (error ? reject(error) : resolve(stdout)),
		);
	});
}
