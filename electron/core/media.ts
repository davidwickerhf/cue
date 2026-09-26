import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import ffmpegStatic from "ffmpeg-static";
import type { MediaInfo } from "./types";

const run = promisify(execFile);

/** Packaged builds keep the ffmpeg binaries outside the asar archive. */
function unpacked(binary: string): string {
	return binary.replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);
}

export function ffmpegPath(): string {
	if (process.env.CUE_FFMPEG) return process.env.CUE_FFMPEG;
	// Bundlers may hand the CommonJS export back as { default }.
	const bin =
		typeof ffmpegStatic === "string"
			? ffmpegStatic
			: (ffmpegStatic as unknown as { default?: string } | null)?.default;
	if (!bin) throw new Error("ffmpeg-static has no binary for this platform.");
	return unpacked(bin);
}

const MAX_BUFFER = 64 * 1024 * 1024;

export async function ffmpeg(args: string[]): Promise<string> {
	const { stderr } = await run(ffmpegPath(), ["-hide_banner", "-y", ...args], {
		maxBuffer: MAX_BUFFER,
	});
	return stderr;
}

export interface ProbeResult {
	durationMs: number;
	width: number;
	height: number;
	hasAudio: boolean;
	info: MediaInfo;
}

/** ffmpeg's report on a file: `ffmpeg -i` with no output always exits non-zero, the report is in stderr. */
async function report(file: string): Promise<string> {
	try {
		return await ffmpeg(["-i", file]);
	} catch (error) {
		const stderr = (error as { stderr?: string }).stderr;
		if (typeof stderr !== "string") throw error;
		return stderr;
	}
}

/** Reads duration, size, streams and technical details from ffmpeg's own report (no ffprobe needed). */
export async function probe(file: string): Promise<ProbeResult> {
	const log = await report(file);
	if (/No such file|Invalid data found/.test(log)) throw new Error(`Cannot read media: ${file}`);
	const duration = /Duration: (\d+):(\d+):([\d.]+)/.exec(log);
	const video = /Stream #\S+.*Video:.*?, (\d{2,5})x(\d{2,5})/.exec(log);
	return {
		durationMs: duration
			? Math.round(
					((Number(duration[1]) * 60 + Number(duration[2])) * 60 + Number(duration[3])) * 1000,
				)
			: 0,
		width: video ? Number(video[1]) : 0,
		height: video ? Number(video[2]) : 0,
		hasAudio: /Stream #\S+.*Audio:/.test(log),
		info: parseMediaInfo(log),
	};
}

/** Splits on commas outside brackets: "yuv420p(tv, bt709, progressive)" stays one part. */
function topLevelParts(text: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of text) {
		if (ch === "(" || ch === "[") depth++;
		if (ch === ")" || ch === "]") depth = Math.max(0, depth - 1);
		if (ch === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
		} else current += ch;
	}
	if (current.trim()) parts.push(current.trim());
	return parts;
}

const LAYOUT_CHANNELS: Record<string, number> = {
	mono: 1,
	stereo: 2,
	"2.1": 3,
	"3.0": 3,
	quad: 4,
	"4.0": 4,
	"5.0": 5,
	"5.1": 6,
	"6.1": 7,
	"7.1": 8,
};

/**
 * Technical details from the text `ffmpeg -i` prints: container, codecs,
 * frame rate, bitrate, audio layout and the recording date. Only the first
 * input's first picture and sound streams count (cover art is skipped).
 */
export function parseMediaInfo(log: string, now = new Date()): MediaInfo {
	const info: MediaInfo = { probedAt: now.toISOString() };
	const input = /^Input #0, ([^,\s]+)/m.exec(log);
	if (input) info.format = input[1];
	const bitrate = /Duration: .*?bitrate: (\d+) kb\/s/.exec(log);
	if (bitrate) info.bitrateKbps = Number(bitrate[1]);
	// Apple's creation date carries the local time zone; the generic tag is UTC.
	const created =
		/com\.apple\.quicktime\.creationdate\s*: (\S+)/.exec(log) ??
		/creation_time\s*: (\S+)/.exec(log);
	if (created && !Number.isNaN(Date.parse(created[1]))) info.creationTime = created[1];
	const rotation =
		/displaymatrix: rotation of (-?[\d.]+) degrees/.exec(log) ?? /\brotate\s*: (-?\d+)/.exec(log);
	if (rotation) {
		// ffmpeg reports the display matrix counter-clockwise; players think clockwise.
		const clockwise =
			((((rotation[0].startsWith("displaymatrix") ? -1 : 1) * Number(rotation[1])) % 360) + 360) %
			360;
		if (clockwise) info.rotation = Math.round(clockwise);
	}

	const streams = log.split("\n").filter((line) => /^\s*Stream #0:/.test(line));
	const videoLine = streams.find((l) => /Video: /.test(l) && !/attached pic/.test(l));
	if (videoLine) {
		const parts = topLevelParts(videoLine.slice(videoLine.indexOf("Video: ") + 7));
		const [codec = ""] = parts;
		info.videoCodec = codec.split(/[\s(]/)[0];
		// The first bracket is the profile unless it is the fourcc ("avc1 / 0x…").
		const profile = /\(([^)]+)\)/.exec(codec);
		if (profile && !profile[1].includes("/")) info.videoProfile = profile[1];
		const pix = parts[1] && /^([a-z0-9_]+)(?:\(|$)/.exec(parts[1]);
		if (pix && !/^\d+x\d+/.test(parts[1])) info.pixelFormat = pix[1];
		const fps = /([\d.]+)(k?) fps/.exec(videoLine) ?? /([\d.]+)(k?) tbr/.exec(videoLine);
		// Still images report ffmpeg's default 25 fps; it means nothing for them.
		const still =
			/^(png|mjpeg|webp|gif|bmp|tiff)$/.test(info.videoCodec) &&
			/_pipe$|^image2$/.test(info.format ?? "");
		if (fps && !still) info.fps = Number(fps[1]) * (fps[2] ? 1000 : 1);
	}
	const audioLine = streams.find((l) => /Audio: /.test(l));
	if (audioLine) {
		const parts = topLevelParts(audioLine.slice(audioLine.indexOf("Audio: ") + 7));
		info.audioCodec = (parts[0] ?? "").split(/[\s(]/)[0];
		const rate = parts.find((p) => /^\d+ Hz$/.test(p));
		if (rate) info.sampleRate = Number.parseInt(rate, 10);
		const layout = rate ? parts[parts.indexOf(rate) + 1] : undefined;
		if (layout) {
			const counted = /^(\d+) channels/.exec(layout);
			const name = layout.replace(/\(.*$/, "");
			const channels = counted ? Number(counted[1]) : LAYOUT_CHANNELS[name];
			if (channels) info.audioChannels = channels;
			if (!counted) info.channelLayout = layout;
		}
	}
	return info;
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
	const trailing = silences.find(
		(silence) => silence.end >= durationMs - 30 && silence.start > speechStartMs,
	);
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
export async function extractThumbnails(
	file: string,
	outDir: string,
	durationMs: number,
): Promise<{ intervalMs: number; count: number }> {
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
	if ([".wav", ".mp3", ".m4a", ".aac", ".flac", ".ogg", ".opus", ".aiff", ".aif"].includes(ext))
		return "audio";
	if ([".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext)) return "image";
	return null;
}

/** Silent stretches inside [fromMs, fromMs + durationMs) of a file, in file time. */
export async function detectSilences(
	file: string,
	options: { thresholdDb: number; minSilenceMs: number; fromMs?: number; durationMs?: number },
): Promise<{ startMs: number; endMs: number }[]> {
	const from = options.fromMs ?? 0;
	const range =
		options.durationMs !== undefined ? ["-t", (options.durationMs / 1000).toFixed(3)] : [];
	const log = await ffmpeg([
		"-ss",
		(from / 1000).toFixed(3),
		...range,
		"-i",
		file,
		"-vn",
		"-af",
		`silencedetect=noise=${options.thresholdDb}dB:d=${(options.minSilenceMs / 1000).toFixed(3)}`,
		"-f",
		"null",
		"-",
	]);
	const out: { startMs: number; endMs: number }[] = [];
	let open: number | null = null;
	for (const line of log.split("\n")) {
		const start = /silence_start: (-?[\d.]+)/.exec(line);
		const end = /silence_end: ([\d.]+)/.exec(line);
		if (start) open = Math.max(0, Number(start[1]) * 1000);
		if (end && open !== null) {
			out.push({ startMs: from + open, endMs: from + Number(end[1]) * 1000 });
			open = null;
		}
	}
	if (open !== null && options.durationMs !== undefined)
		out.push({ startMs: from + open, endMs: from + options.durationMs });
	return out;
}

/** atempo only accepts 0.5–2 per stage, so chain it. */
export function atempoChain(speed: number): string {
	const parts: string[] = [];
	let rest = speed;
	while (rest > 2) {
		parts.push("atempo=2");
		rest /= 2;
	}
	while (rest < 0.5) {
		parts.push("atempo=0.5");
		rest /= 0.5;
	}
	parts.push(`atempo=${rest.toFixed(4)}`);
	return parts.join(",");
}

/**
 * Small playback copy of a video: 540p with a keyframe every half second, so
 * the editor can seek and scrub instantly. Uses the GPU encoder on macOS.
 */
export async function makeVideoProxy(input: string, output: string): Promise<void> {
	await fs.mkdir(path.dirname(output), { recursive: true });
	const tmp = `${output}.part.mp4`;
	const encoder =
		process.platform === "darwin"
			? ["-c:v", "h264_videotoolbox", "-b:v", "2500k", "-realtime", "1"]
			: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "28", "-tune", "fastdecode"];
	await ffmpeg([
		"-i",
		input,
		"-an",
		"-vf",
		"scale=-2:540:flags=bilinear",
		...encoder,
		"-g",
		"15",
		"-pix_fmt",
		"yuv420p",
		"-movflags",
		"+faststart",
		tmp,
	]);
	await fs.rename(tmp, output);
}

/**
 * Audio for playback: extracted from videos (so the editor never downloads a
 * whole movie to decode its sound) and, for sped-up clips, time-stretched with
 * pitch preserved, exactly as the export does it.
 */
export async function makeAudioProxy(input: string, output: string, speed: number): Promise<void> {
	await fs.mkdir(path.dirname(output), { recursive: true });
	const tmp = `${output}.part.m4a`;
	const filters = speed === 1 ? [] : ["-af", atempoChain(speed)];
	await ffmpeg([
		"-i",
		input,
		"-vn",
		...filters,
		"-ac",
		"2",
		"-ar",
		"48000",
		"-c:a",
		"aac",
		"-b:a",
		"192k",
		tmp,
	]);
	await fs.rename(tmp, output);
}
