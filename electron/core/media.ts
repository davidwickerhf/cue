import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";

const run = promisify(execFile);

/** Packaged builds keep the ffmpeg binaries outside the asar archive. */
function unpacked(binary: string): string {
	return binary.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

export function ffmpegPath(): string {
	if (process.env.CUE_FFMPEG) return process.env.CUE_FFMPEG;
	// Bundlers may hand the CommonJS export back as { default }.
	const bin = typeof ffmpegStatic === "string" ? ffmpegStatic : (ffmpegStatic as unknown as { default?: string } | null)?.default;
	if (!bin) throw new Error("ffmpeg-static has no binary for this platform.");
	return unpacked(bin);
}

const MAX_BUFFER = 64 * 1024 * 1024;

export async function ffmpeg(args: string[]): Promise<string> {
	const { stderr } = await run(ffmpegPath(), ["-hide_banner", "-y", ...args], { maxBuffer: MAX_BUFFER });
	return stderr;
}

export interface ProbeResult {
	durationMs: number;
	width: number;
	height: number;
	hasAudio: boolean;
}

/** Reads duration, size and streams from ffmpeg's own report (no ffprobe needed). */
export async function probe(file: string): Promise<ProbeResult> {
	let log: string;
	try {
		log = await ffmpeg(["-i", file]);
	} catch (error) {
		// `ffmpeg -i` without an output always exits non-zero; the report is in stderr.
		const stderr = (error as { stderr?: string }).stderr;
		if (typeof stderr !== "string") throw error;
		log = stderr;
	}
	if (/No such file|Invalid data found/.test(log)) throw new Error(`Cannot read media: ${file}`);
	const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
	const video = /Stream #\S+.*Video:.*?, (\d{2,5})x(\d{2,5})/.exec(log);
	return {
		durationMs: duration
			? Math.round(((Number(duration[1]) * 60 + Number(duration[2])) * 60 + Number(duration[3])) * 1000)
			: 0,
		width: video ? Number(video[1]) : 0,
		height: video ? Number(video[2]) : 0,
		hasAudio: /Stream #\S+.*Audio:/.test(log),
	};
}

/** Converts any recording into 48 kHz mono 16-bit WAV. */
export async function toWav(input: string, output: string): Promise<void> {
	await fs.mkdir(path.dirname(output), { recursive: true });
	await ffmpeg(["-i", input, "-vn", "-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", output]);
}

export interface SpeechAnalysis {
	durationMs: number;
	speechStartMs: number;
	speechEndMs: number;
	peakDb: number | null;
}

/** Finds where speech starts and ends, using ffmpeg's silence detector. */
export async function analyseSpeech(file: string, silenceDb: number): Promise<SpeechAnalysis> {
	const { durationMs } = await probe(file);
	const log = await ffmpeg([
		"-i",
		file,
		"-af",
		`silencedetect=noise=${silenceDb}dB:d=0.2,volumedetect`,
		"-f",
		"null",
		"-",
	]);
	const silences: { start: number; end: number }[] = [];
	let open: number | null = null;
	for (const line of log.split("\n")) {
		const start = /silence_start: (-?[\d.]+)/.exec(line);
		const end = /silence_end: ([\d.]+)/.exec(line);
		if (start) open = Math.max(0, Number(start[1]) * 1000);
		if (end) {
			silences.push({ start: open ?? 0, end: Number(end[1]) * 1000 });
			open = null;
		}
	}
	if (open !== null) silences.push({ start: open, end: durationMs });
	const peak = /max_volume: (-?[\d.]+) dB/.exec(log);

	let speechStartMs = 0;
	let speechEndMs = durationMs;
	const leading = silences.find((silence) => silence.start <= 30);
	if (leading) speechStartMs = Math.min(leading.end, durationMs);
	const trailing = silences.find((silence) => silence.end >= durationMs - 30 && silence.start > speechStartMs);
	if (trailing) speechEndMs = trailing.start;
	if (speechEndMs <= speechStartMs) {
		speechStartMs = 0;
		speechEndMs = durationMs;
	}
	return {
		durationMs,
		speechStartMs: Math.round(speechStartMs),
		speechEndMs: Math.round(speechEndMs),
		peakDb: peak ? Number(peak[1]) : null,
	};
}

/** Runs ffmpeg and returns raw stdout bytes. */
async function ffmpegBytes(args: string[]): Promise<Buffer> {
	const { stdout } = await run(ffmpegPath(), ["-hide_banner", "-loglevel", "error", ...args], {
		maxBuffer: 512 * 1024 * 1024,
		encoding: "buffer",
	});
	return stdout as unknown as Buffer;
}

export const PEAKS_PER_SECOND = 50;

/**
 * Loudness envelope for waveforms: the max absolute sample per 20 ms, 0–255.
 * Decoded at 8 kHz mono, which is plenty for drawing.
 */
export async function computePeaks(file: string): Promise<number[]> {
	const pcm = await ffmpegBytes(["-i", file, "-vn", "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]);
	const samplesPerBucket = 8000 / PEAKS_PER_SECOND;
	const samples = pcm.length / 2;
	const peaks: number[] = [];
	for (let start = 0; start < samples; start += samplesPerBucket) {
		let max = 0;
		const end = Math.min(samples, start + samplesPerBucket);
		for (let i = start; i < end; i++) max = Math.max(max, Math.abs(pcm.readInt16LE(i * 2)));
		peaks.push(Math.min(255, Math.round((max / 32768) ** 0.6 * 255)));
	}
	return peaks;
}

/** A strip of small frames for the timeline, one every `intervalMs`. */
export async function extractThumbnails(file: string, outDir: string, durationMs: number): Promise<{ intervalMs: number; count: number }> {
	await fs.mkdir(outDir, { recursive: true });
	const intervalMs = Math.max(1000, Math.ceil(durationMs / 160 / 500) * 500);
	await ffmpeg([
		"-i",
		file,
		"-vf",
		`fps=1000/${intervalMs},scale=-2:96`,
		"-q:v",
		"6",
		path.join(outDir, "%04d.jpg"),
	]);
	const count = (await fs.readdir(outDir)).filter((name) => name.endsWith(".jpg")).length;
	return { intervalMs, count };
}

/** Classifies a file by extension. */
export function kindOf(file: string): "video" | "audio" | "image" | null {
	const ext = path.extname(file).toLowerCase();
	if ([".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"].includes(ext)) return "video";
	if ([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif"].includes(ext)) return "audio";
	if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
	return null;
}
