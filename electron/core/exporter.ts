import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { keyframeExpr, seedOf, steppedExpr, wiggleExpr, zoomExprs } from "./anim";
import { trackAudioFilters } from "./audio";
import { toSrt, toVtt } from "./captions";
import { denoiseChain } from "./denoise";
import { ffmpeg, ffmpegWithProgress } from "./media";
import { resolveInProject } from "./paths";
import {
	clipEnd,
	deriveLines,
	projectDuration,
	sourceSpan,
	stemName,
	trackAudible,
	voiceoverTrack,
} from "./project";
import { BLUR_FROM, overlaps, ZOOM_FROM } from "./transitions";
import type {
	Asset,
	Clip,
	ColorGrade,
	Effects,
	Mask,
	MediaClip,
	ProjectData,
	TextClip,
	Track,
} from "./types";

/** A text clip rendered by the editor window: one still, or a frame sequence for animated text. */
export type TextRender =
	| { kind: "still"; file: string }
	| { kind: "sequence"; pattern: string; fps: number };

/**
 * Rasterises text clips and motion graphics (done by the editor window, so they
 * look identical to the preview). Motion graphics are drawn at `sizes[clip.id]`,
 * one frame per output frame from the clip's start.
 */
export type Rasteriser = (
	clips: (TextClip | MediaClip)[],
	canvas?: { width: number; height: number },
	sizes?: Record<string, { width: number; height: number }>,
	/** Called as clips are drawn: how many of them are done. */
	onProgress?: (done: number, total: number) => void,
	/** The project the clips come from (another one when a project is placed as media). */
	source?: { dir: string; assets: Asset[] },
) => Promise<Record<string, TextRender>>;

export interface ExportContext {
	dir: string;
	data: ProjectData;
	renderText?: Rasteriser;
	onProgress?: (fraction: number) => void;
	/** Export only this part of the timeline (e.g. between the in and out points). */
	range?: { startMs: number; endMs: number };
}

export interface ExportReport {
	kind:
		| "stems"
		| "voiceover"
		| "audio"
		| "video"
		| "gif"
		| "captions"
		| "otio"
		| "fcpxml"
		| "mlt"
		| "edl";
	outputs: string[];
	missing: string[];
	durationMs: number;
}

const s = (msValue: number) => (msValue / 1000).toFixed(3);
const fileName = (data: ProjectData, pattern: string) =>
	pattern.replaceAll("{name}", data.name.replace(/[^\w.-]+/g, "-"));

function assetOf(data: ProjectData, id: string): Asset {
	const found = data.assets.find((a) => a.id === id);
	if (!found) throw new Error(`Missing media ${id}.`);
	return found;
}

function trackOf(data: ProjectData, id: string): Track {
	const found = data.tracks.find((t) => t.id === id);
	if (!found) throw new Error(`Missing track ${id}.`);
	return found;
}

/** atempo only accepts 0.5–2, so chain it for other speeds. */
function tempo(speed: number): string {
	if (speed === 1) return "";
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
	return `,${parts.join(",")}`;
}

interface AudioSource {
	clip: MediaClip;
	file: string;
	/** The clip's own level; the track's fader is applied to the track's submix. */
	gain: number;
	track: Track;
	/** Fade-out including any crossfade into the next clip on the track. */
	fadeOutMs: number;
}

/** How long a clip's sound should fade out: its own fade, or the crossfade overlap with the next clip. */
function effectiveFadeOut(data: ProjectData, clip: MediaClip): number {
	const next = data.clips.find(
		(x) =>
			x.type === "media" &&
			x.id !== clip.id &&
			x.trackId === clip.trackId &&
			overlaps(x.transitionIn) &&
			x.startMs < clipEnd(clip) &&
			x.startMs > clip.startMs,
	);
	return Math.max(clip.fadeOutMs, next ? clipEnd(clip) - next.startMs : 0);
}

/** Audio clips that are heard: unmuted tracks, clips with audio, optional track filter. */
function audibleClips(ctx: ExportContext, onlyTracks?: Set<string>): AudioSource[] {
	const { data } = ctx;
	return data.clips
		.filter((c): c is MediaClip => c.type === "media")
		.filter((c) => !onlyTracks || onlyTracks.has(c.trackId))
		.flatMap((c) => {
			const t = trackOf(data, c.trackId);
			const a = assetOf(data, c.assetId);
			if (
				c.disabled ||
				// A nested sequence with nothing in it has no render.
				(a.sequenceId && !a.path) ||
				// Solo is for the full mix; a voiceover-only export ignores it.
				(onlyTracks ? t.muted : !trackAudible(data, t)) ||
				t.hidden ||
				!a.hasAudio ||
				a.kind === "image" ||
				c.volume === 0 ||
				t.volume === 0
			)
				return [];
			return [
				{
					clip: c,
					file: resolveInProject(ctx.dir, a.path),
					gain: c.volume,
					track: t,
					fadeOutMs: effectiveFadeOut(data, c),
				},
			];
		});
}

/** Constant-power-ish balance: the far side is turned down, the near side kept. */
function panFilter(pan: number): string {
	const left = Math.min(1, 1 - pan).toFixed(3);
	const right = Math.min(1, 1 + pan).toFixed(3);
	return `pan=stereo|c0=${left}*c0|c1=${right}*c1`;
}

/** Filter chain for one audio clip, delayed to its timeline position. */
function audioChain(input: string, src: AudioSource, label: string): string {
	const { clip } = src;
	// Overlapping transitions crossfade the sound, even when the picture doesn't fade.
	const fadeIn = Math.max(
		clip.fadeInMs,
		overlaps(clip.transitionIn) ? (clip.transitionIn?.durationMs ?? 0) : 0,
	);
	const fades = [
		fadeIn > 0 ? `afade=t=in:st=0:d=${s(fadeIn)}` : "",
		src.fadeOutMs > 0
			? `afade=t=out:st=${s(clip.durationMs - src.fadeOutMs)}:d=${s(src.fadeOutMs)}`
			: "",
	].filter(Boolean);
	const keyed = clip.keyframes?.volume?.length;
	const volume = keyed
		? `volume='${src.gain.toFixed(4)}*(${keyframeExpr(clip.keyframes?.volume, 1, "t")})':eval=frame`
		: `volume=${src.gain.toFixed(3)}`;
	return (
		`${input}atrim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))},asetpts=PTS-STARTPTS${tempo(clip.speed)}` +
		`,aresample=48000,aformat=channel_layouts=stereo${denoiseChain(clip.denoise)},${volume}` +
		(fades.length ? `,${fades.join(",")}` : "") +
		`,adelay=${Math.round(clip.startMs)}:all=1[${label}]`
	);
}

/**
 * Mixes audio sources into [label]. Each track's clips are summed first, then
 * the track's EQ, compressor, fader and pan are applied to that submix (like a
 * mixing desk). Tracks marked `duck` are compressed by the voiceover
 * (sidechain), so music dips while someone is speaking.
 */
function mixGraph(
	sources: AudioSource[],
	firstInput: number,
	lengthMs: number,
	normalize: boolean,
	label: string,
): string[] {
	const chains = sources.map((src, i) =>
		audioChain(`[${firstInput + i}:a]`, src, `a${firstInput + i}`),
	);
	const tracks = [...new Map(sources.map((src) => [src.track.id, src.track])).values()];
	const submix = new Map<string, string>();
	tracks.forEach((track, k) => {
		const clips = sources
			.map((src, i) => (src.track.id === track.id ? `[a${firstInput + i}]` : ""))
			.filter(Boolean);
		const pan = track.pan ?? 0;
		const filters = [
			clips.length > 1 ? `amix=inputs=${clips.length}:normalize=0` : "",
			...trackAudioFilters(track),
			track.volume !== 1 ? `volume=${track.volume.toFixed(4)}` : "",
			pan ? panFilter(pan) : "",
		].filter(Boolean);
		const out = `trk${firstInput}_${k}`;
		chains.push(`${clips.join("")}${filters.length ? filters.join(",") : "anull"}[${out}]`);
		submix.set(track.id, `[${out}]`);
	});
	const pad = `apad,atrim=0:${s(lengthMs)}`;
	const post = normalize ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ",alimiter=limit=0.97";
	const labels = (list: Track[]) => list.map((t) => submix.get(t.id)).join("");
	const ducked = tracks.filter((t) => t.duck && !t.voiceover);
	const voice = tracks.filter((t) => t.voiceover);
	if (ducked.length && voice.length) {
		const rest = tracks.filter((t) => !ducked.includes(t) && !voice.includes(t));
		chains.push(
			`${labels(voice)}amix=inputs=${voice.length}:normalize=0,${pad},asplit=2[vo_mix][vo_key]`,
		);
		chains.push(`${labels(ducked)}amix=inputs=${ducked.length}:normalize=0,${pad}[duck_in]`);
		chains.push(
			"[duck_in][vo_key]sidechaincompress=threshold=0.03:ratio=6:attack=30:release=450:makeup=1[ducked]",
		);
		const parts = ["[vo_mix]", "[ducked]", ...(rest.length ? [labels(rest)] : [])];
		const count = 2 + rest.length;
		chains.push(`${parts.join("")}amix=inputs=${count}:normalize=0,${pad}${post}[${label}]`);
	} else {
		chains.push(
			`${labels(tracks)}amix=inputs=${tracks.length}:normalize=0,${pad}${post}[${label}]`,
		);
	}
	return chains;
}

/** Output options that keep only the chosen range (frames before it are decoded and dropped). */
function rangeArgs(range: ExportContext["range"], lengthMs: number): string[] {
	if (!range) return ["-t", s(lengthMs)];
	const start = Math.max(0, range.startMs);
	const end = Math.min(lengthMs, range.endMs);
	if (end - start < 40) throw new Error("The in and out points are too close together.");
	return ["-ss", s(start), "-t", s(end - start)];
}

async function mixAudio(
	sources: AudioSource[],
	out: string,
	lengthMs: number,
	normalize: boolean,
	range?: ExportContext["range"],
) {
	if (sources.length === 0) throw new Error("Nothing is audible: no unmuted audio clips.");
	await fs.mkdir(path.dirname(out), { recursive: true });
	const inputs = sources.flatMap((src) => ["-i", src.file]);
	const chains = mixGraph(sources, 0, lengthMs, normalize, "out");
	await ffmpeg([
		...inputs,
		"-filter_complex",
		chains.join(";"),
		"-map",
		"[out]",
		"-ac",
		"2",
		"-ar",
		"48000",
		...audioCodec(out),
		...rangeArgs(range, lengthMs),
		out,
	]);
}

/** Encoder for an audio file, chosen by its extension (WAV unless it says otherwise). */
function audioCodec(file: string): string[] {
	const ext = path.extname(file).toLowerCase();
	if (ext === ".mp3") return ["-c:a", "libmp3lame", "-b:a", "256k"];
	if (ext === ".m4a" || ext === ".aac") return ["-c:a", "aac", "-b:a", "256k"];
	if (ext === ".flac") return ["-c:a", "flac"];
	return ["-c:a", "pcm_s16le"];
}

/**
 * An animated GIF: the video is rendered first, then reduced to 15 fps, at most
 * 720 px wide, with one palette made for the whole clip (so colours stay clean).
 */
export async function exportGif(ctx: ExportContext, out: string): Promise<ExportReport> {
	const tmp = path.join(
		os.tmpdir(),
		`cue-gif-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.mp4`,
	);
	try {
		const video = await exportVideo(
			{
				...ctx,
				data: {
					...ctx.data,
					export: { ...ctx.data.export, codec: "h264", videoQuality: "high", hardware: false },
				},
			},
			tmp,
		);
		if (video.durationMs > 60000)
			throw new Error("A GIF is for short clips: mark in and out points around at most a minute.");
		await fs.mkdir(path.dirname(out), { recursive: true });
		await ffmpeg([
			"-i",
			tmp,
			"-filter_complex",
			"fps=15,scale='min(720,iw)':-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a",
			"-loop",
			"0",
			out,
		]);
		return { kind: "gif", outputs: [out], missing: [], durationMs: video.durationMs };
	} finally {
		await fs.rm(tmp, { force: true });
	}
}

/**
 * One trimmed WAV per script line (exactly the clip on the voiceover track,
 * including any trims made in the editor) plus durations.json in seconds.
 */
export async function exportStems(ctx: ExportContext, outDir?: string): Promise<ExportReport> {
	const target = outDir ?? resolveInProject(ctx.dir, ctx.data.export.stemsDir);
	await fs.mkdir(target, { recursive: true });
	const outputs: string[] = [];
	const missing: string[] = [];
	const durations: Record<string, number> = {};
	for (const line of deriveLines(ctx.data)) {
		const clip = ctx.data.clips.find((c): c is MediaClip => c.id === line.clipId);
		if (!clip) {
			missing.push(line.id);
			continue;
		}
		const a = assetOf(ctx.data, clip.assetId);
		const out = path.join(target, stemName(ctx.data.export.stemPattern, line.id, line.index));
		const clean = denoiseChain(clip.denoise);
		// The line sounds as it does in the mix: with its track's EQ and compressor.
		const processing = trackAudioFilters(trackOf(ctx.data, clip.trackId))
			.map((f) => `,${f}`)
			.join("");
		await ffmpeg([
			"-ss",
			s(clip.inMs),
			"-t",
			s(sourceSpan(clip)),
			"-i",
			resolveInProject(ctx.dir, a.path),
			"-af",
			`volume=${clip.volume.toFixed(3)}${tempo(clip.speed)}${clean}${processing}${ctx.data.export.normalize ? ",loudnorm=I=-18:TP=-2:LRA=11" : ""}`,
			"-ac",
			"1",
			"-ar",
			"48000",
			"-c:a",
			"pcm_s16le",
			out,
		]);
		outputs.push(out);
		durations[line.id] = Number((clip.durationMs / 1000).toFixed(3));
		ctx.onProgress?.(outputs.length / Math.max(1, ctx.data.lines.length));
	}
	const manifest = path.join(target, "durations.json");
	await fs.writeFile(manifest, `${JSON.stringify(durations, null, 2)}\n`);
	outputs.push(manifest);
	return { kind: "stems", outputs, missing, durationMs: 0 };
}

/** The voiceover track as one WAV, the length of the project. */
export async function exportVoiceover(ctx: ExportContext, outFile?: string): Promise<ExportReport> {
	const track = voiceoverTrack(ctx.data);
	if (!track) throw new Error("There is no voiceover track.");
	const out = outFile ?? resolveInProject(ctx.dir, ctx.data.export.voiceoverFile);
	const lengthMs = projectDuration(ctx.data);
	await mixAudio(audibleClips(ctx, new Set([track.id])), out, lengthMs, ctx.data.export.normalize);
	const missing = deriveLines(ctx.data)
		.filter((l) => !l.clipId)
		.map((l) => l.id);
	return { kind: "voiceover", outputs: [out], missing, durationMs: lengthMs };
}

export interface Loudness {
	/** Integrated loudness in LUFS; null when nothing was heard. */
	integratedLufs: number | null;
	/** Highest true peak in dBTP. */
	truePeakDb: number | null;
}

/**
 * Measures the mix (EBU R128) without writing a file: every audible track, or
 * only `onlyTracks`. With `preFader` the tracks' faders are left at unity, which
 * is what the auto-mix needs to work out new fader levels.
 */
export async function measureLoudness(
	ctx: ExportContext,
	options: { onlyTracks?: Set<string>; preFader?: boolean; normalize?: boolean } = {},
): Promise<Loudness> {
	const data = options.preFader
		? { ...ctx.data, tracks: ctx.data.tracks.map((t) => ({ ...t, volume: 1 })) }
		: ctx.data;
	const sources = audibleClips({ ...ctx, data }, options.onlyTracks);
	if (sources.length === 0) return { integratedLufs: null, truePeakDb: null };
	const lengthMs = projectDuration(data);
	const chains = mixGraph(sources, 0, lengthMs, options.normalize ?? data.export.normalize, "mix");
	chains.push("[mix]ebur128=framelog=verbose:peak=true[out]");
	const log = await ffmpeg([
		...sources.flatMap((src) => ["-i", src.file]),
		"-filter_complex",
		chains.join(";"),
		"-map",
		"[out]",
		...rangeArgs(ctx.range, lengthMs),
		"-f",
		"null",
		"-",
	]);
	// The summary comes last: "I: -16.2 LUFS" and "Peak: -1.3 dBFS".
	const summary = log.slice(log.lastIndexOf("Summary:"));
	const integrated = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
	const peak = Number(/Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(summary)?.[1]);
	return {
		// ebur128 reports -70 (its gate) for silence.
		integratedLufs: Number.isFinite(integrated) && integrated > -69.9 ? integrated : null,
		truePeakDb: Number.isFinite(peak) ? peak : null,
	};
}

/** Every audible track mixed down (with ducking). */
export async function exportAudioMix(ctx: ExportContext, outFile: string): Promise<ExportReport> {
	const lengthMs = projectDuration(ctx.data);
	await mixAudio(audibleClips(ctx), outFile, lengthMs, ctx.data.export.normalize, ctx.range);
	return { kind: "audio", outputs: [outFile], missing: [], durationMs: lengthMs };
}

/** Caption clips (the Captions track, or every text clip made from speech) as SRT and VTT. */
export async function exportCaptions(ctx: ExportContext, outFile?: string): Promise<ExportReport> {
	const { data } = ctx;
	const captionTrack = data.tracks.find(
		(t) => t.kind === "text" && /caption|subtitle/i.test(t.name),
	);
	const clips = data.clips.filter(
		(c): c is TextClip =>
			c.type === "text" &&
			!c.disabled &&
			(c.source?.kind === "caption" || c.trackId === captionTrack?.id),
	);
	if (clips.length === 0)
		throw new Error(
			"There are no captions. Add them with Generate → Captions, or put text clips on a track named Captions.",
		);
	const srt = outFile ?? resolveInProject(ctx.dir, fileName(data, data.export.captionsFile));
	const vtt = srt.replace(/\.srt$/i, "") + ".vtt";
	await fs.mkdir(path.dirname(srt), { recursive: true });
	await fs.writeFile(srt, toSrt(clips));
	await fs.writeFile(vtt, toVtt(clips));
	return { kind: "captions", outputs: [srt, vtt], missing: [], durationMs: 0 };
}

function encoder(data: ProjectData): string[] {
	const { codec, hardware, videoQuality } = data.export;
	const mac = process.platform === "darwin";
	if (codec === "prores")
		return [
			"-c:v",
			"prores_ks",
			"-profile:v",
			videoQuality === "draft" ? "0" : videoQuality === "standard" ? "2" : "3",
			"-pix_fmt",
			"yuv422p10le",
		];
	if (hardware && mac) {
		const name = codec === "hevc" ? "hevc_videotoolbox" : "h264_videotoolbox";
		// Constant quality (Apple Silicon) rather than a fixed bitrate: about the quality of
		// x264 at the same setting, at a fraction of the size, and HEVC smaller than H.264.
		const quality = { draft: "55", standard: "70", high: "82" }[videoQuality];
		return [
			"-c:v",
			name,
			"-q:v",
			quality,
			"-pix_fmt",
			"yuv420p",
			...(codec === "hevc" ? ["-tag:v", "hvc1"] : []),
		];
	}
	const crf = { draft: "28", standard: "20", high: "16" }[videoQuality];
	const preset = { draft: "veryfast", standard: "medium", high: "slow" }[videoQuality];
	return codec === "hevc"
		? [
				"-c:v",
				"libx265",
				"-preset",
				preset,
				"-crf",
				String(Number(crf) + 4),
				"-tag:v",
				"hvc1",
				"-pix_fmt",
				"yuv420p",
			]
		: ["-c:v", "libx264", "-preset", preset, "-crf", crf, "-pix_fmt", "yuv420p"];
}

/**
 * The pixel size to draw a motion graphic at: as large as it appears on the
 * output frame at its biggest (scale and zooms), never smaller than the file's
 * own size, and at most 4096 on a side.
 */
export function motionRenderSize(
	a: Asset,
	clip: MediaClip,
	W: number,
	H: number,
): { width: number; height: number } {
	const aw = a.width || W;
	const ah = a.height || H;
	const fit = Math.min(W / aw, H / ah);
	const scales = [clip.transform.scale, ...(clip.keyframes?.scale ?? []).map((k) => k.value)];
	const zoom = Math.max(1, ...(clip.zooms ?? []).map((z) => z.scale));
	const k = Math.min(Math.max(1, fit * Math.max(...scales) * zoom), 4096 / Math.max(aw, ah));
	const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
	return { width: even(aw * k), height: even(ah * k) };
}

/** Composites every visible video, image and text clip and mixes the audio. */
export async function exportVideo(ctx: ExportContext, outFile?: string): Promise<ExportReport> {
	const { data } = ctx;
	const { width: W, height: H, fps, background } = data.canvas;
	const lengthMs = projectDuration(data);
	if (lengthMs <= 0) throw new Error("The timeline is empty.");
	let out = outFile ?? resolveInProject(ctx.dir, fileName(data, data.export.videoFile));
	if (data.export.codec === "prores") out = out.replace(/\.mp4$/i, ".mov");
	await fs.mkdir(path.dirname(out), { recursive: true });

	// Tracks are listed top to bottom in the editor; draw the bottom ones first.
	const visualTracks = [...data.tracks]
		.reverse()
		.filter((t) => (t.kind === "video" || t.kind === "text") && !t.hidden);
	const layers: Clip[] = visualTracks.flatMap((t) =>
		data.clips
			.filter(
				(c) =>
					c.trackId === t.id &&
					!c.disabled &&
					// A nested sequence with nothing in it has no render: it shows nothing.
					!(
						c.type === "media" &&
						(() => {
							const a = assetOf(data, c.assetId);
							return a.sequenceId && !a.path;
						})()
					),
			)
			.sort((a, b) => a.startMs - b.startMs),
	);
	const textClips = layers.filter(
		(c): c is TextClip =>
			c.type === "text" &&
			(c.text.trim().length > 0 || !!c.shape || !!c.infographic || !!c.dataCallout),
	);
	// Motion graphics are drawn by the window too, at the size they appear (vector art stays sharp).
	const motionClips = layers.filter(
		(c): c is MediaClip => c.type === "media" && assetOf(data, c.assetId).kind === "lottie",
	);
	const motionSizes = Object.fromEntries(
		motionClips.map((c) => [c.id, motionRenderSize(assetOf(data, c.assetId), c, W, H)]),
	);
	const drawn = [...textClips, ...motionClips];
	const rendered = drawn.length
		? await (ctx.renderText?.(
				drawn,
				{ width: W, height: H },
				motionSizes,
				// Drawing text and graphics is the first half of the work; encoding the second.
				(done, total) => ctx.onProgress?.((done / total) * 0.5),
				{ dir: ctx.dir, assets: data.assets },
			) ?? Promise.reject(new Error("Open the Cue window to render text and graphics.")))
		: {};

	const inputs: string[] = [];
	const chains: string[] = [
		`color=c=${background}:s=${W}x${H}:r=${fps}:d=${s(lengthMs)},format=yuva420p[base]`,
	];
	let current = "base";
	let n = 0;
	// Labels for adjustment layers have their own counter: `n` must stay equal to the input count.
	let adjustments = 0;
	const addInput = (args: string[]) => {
		inputs.push(...args);
		return n++;
	};
	/** A looped vignette mask at a picture's size, as an input stream label. */
	const vignetteInput = async (amount: number | undefined, w: number, h: number, ms: number) => {
		if (!amount || amount <= 0) return undefined;
		const file = await vignetteMask(amount, w, h);
		const index = addInput(["-loop", "1", "-framerate", String(fps), "-t", s(ms), "-i", file]);
		return `${index}:v`;
	};

	for (const clip of layers) {
		const start = s(clip.startMs);
		const end = s(clipEnd(clip));
		const label = `v${n}`;
		if (clip.type === "text") {
			const render = rendered[clip.id];
			if (!render) continue;
			const index =
				render.kind === "still"
					? addInput([
							"-loop",
							"1",
							"-framerate",
							String(fps),
							"-t",
							s(clip.durationMs),
							"-i",
							render.file,
						])
					: addInput(["-framerate", String(render.fps), "-i", render.pattern]);
			chains.push(`[${index}:v]format=rgba,fps=${fps},setpts=PTS-STARTPTS+${start}/TB[${label}]`);
			chains.push(
				`[${current}][${label}]overlay=x=0:y=0:enable='between(t,${start},${end})':eof_action=pass[o${index}]`,
			);
			current = `o${index}`;
			continue;
		}
		const a = assetOf(data, clip.assetId);
		if (a.kind === "adjustment") {
			// An adjustment layer grades everything composited so far, for as long as it lasts.
			const filters = [
				...gradeFilters(clip.color),
				...effectFilters(clip.effects, H).filter((f) => !f.startsWith("glow:")),
			];
			if (!filters.length) continue;
			const out = `adj${adjustments++}`;
			if (clip.mask) {
				// Masked: grade a copy, keep only the masked part of it and lay it over the
				// original, so only that area changes (blur and redact boxes).
				const maskFile = await maskImage(ctx.dir, clip.mask, W, H);
				const m = addInput([
					"-loop",
					"1",
					"-framerate",
					String(fps),
					"-t",
					s(lengthMs + 1000),
					"-i",
					maskFile,
				]);
				chains.push(`[${current}]split[${out}a][${out}b]`);
				const vin = await vignetteInput(clip.effects?.vignette, W, H, lengthMs + 1000);
				chains.push(`[${out}b]null${filterPiece(filters, out, "", vin)},format=yuva420p[${out}g]`);
				chains.push(`[${m}:v]format=gray,scale=${W}:${H}[${out}m]`);
				chains.push(`[${out}g][${out}m]alphamerge[${out}k]`);
				chains.push(
					`[${out}a][${out}k]overlay=x=0:y=0:enable='between(t,${start},${end})':eof_action=pass,format=yuva420p[${out}]`,
				);
			} else {
				const vin = await vignetteInput(clip.effects?.vignette, W, H, lengthMs + 1000);
				const timed = filterPiece(filters, out, `:enable='between(t,${start},${end})'`, vin);
				chains.push(`[${current}]null${timed},format=yuva420p[${out}]`);
			}
			current = out;
			continue;
		}
		const file = resolveInProject(ctx.dir, a.path);
		const t = clip.transform;
		const c = t.crop;
		const motion = a.kind === "lottie" ? rendered[clip.id] : undefined;
		if (a.kind === "lottie" && !motion) continue;
		const sw = a.kind === "lottie" ? motionSizes[clip.id].width : a.width || W;
		const sh = a.kind === "lottie" ? motionSizes[clip.id].height : a.height || H;
		const fitBase = Math.min(W / sw, H / sh);
		const cropW = 1 - c.left - c.right;
		const cropH = 1 - c.top - c.bottom;
		// Keyframes are stored in clip-local ms; keyframeExpr takes a variable in local seconds (`t` here).
		const kf = clip.keyframes ?? {};
		// The transition into this clip, as expressions of local seconds (same easing as the preview).
		const tr =
			clip.transitionIn && clip.transitionIn.kind !== "dip" ? clip.transitionIn : undefined;
		const enteredAt = (T: string) => {
			const p = `clip((${T})/${s(tr?.durationMs ?? 1)},0,1)`;
			return `(${p})*(${p})*(3-2*(${p}))`;
		};
		const zoomIn = (T: string) =>
			tr?.kind === "zoom" ? `*(1+${ZOOM_FROM}*(1-${enteredAt(T)}))` : "";
		const animatedScale = !!kf.scale?.length || tr?.kind === "zoom";
		// Keyframes and wiggle may move in whole steps ("on twos"); `t` here is clip-local.
		const stepT = steppedExpr("t", clip.stepFps);
		const S = `${kf.scale?.length ? keyframeExpr(kf.scale, t.scale, stepT) : String(t.scale)}${zoomIn("t")}`;
		const seed = seedOf(clip.id);
		const rotating = !!(t.rotation || kf.rotation?.length || clip.wiggle?.rotation);
		// Zooms: zoompan keeps the frame size fixed (a scale that changes size per frame
		// would leave crop working on the old size, pinning every zoom to the top left).
		// The focus is centred where it can be, without showing past the picture's edge.
		const zoom = zoomExprs(clip.zooms, "it");
		const zoomChain = zoom
			? `,zoompan=z='${zoom.scale}':x='max(0,min(iw-iw/zoom,${zoom.x}*iw-iw/zoom/2))':y='max(0,min(ih-ih/zoom,${zoom.y}*ih-ih/zoom/2))':d=1:s=${sw}x${sh}:fps=${fps}`
			: "";
		const colorChain =
			gradeFilters(clip.color)
				.map((f) => `,${f}`)
				.join("") +
			effectChain(
				clip.effects,
				sh,
				label,
				await vignetteInput(clip.effects?.vignette, sw, sh, clip.durationMs + 1000),
			) +
			// Blur transition: a blurred copy dissolves into the sharp picture.
			(tr?.kind === "blur"
				? `,split[tbA${label}][tbB${label}];[tbB${label}]gblur=sigma=${((BLUR_FROM * sh) / 1080).toFixed(2)}:enable='lt(t,${s(tr.durationMs)})'[tbC${label}];` +
					`[tbC${label}][tbA${label}]blend=all_expr='A*(1-${enteredAt("T")})+B*${enteredAt("T")}':enable='lt(t,${s(tr.durationMs)})'`
				: "");
		// Chroma key removes the screen colour before anything is composited.
		const keyChain = clip.key
			? `,format=yuva420p,chromakey=color=0x${clip.key.color.slice(1)}:similarity=${clip.key.similarity.toFixed(3)}:blend=${clip.key.blend.toFixed(3)}`
			: "";
		const crop =
			c.left || c.top || c.right || c.bottom
				? `,crop=w=iw*${cropW.toFixed(4)}:h=ih*${cropH.toFixed(4)}:x=iw*${c.left.toFixed(4)}:y=ih*${c.top.toFixed(4)}`
				: "";
		const baseW = sw * cropW * fitBase;
		const baseH = sh * cropH * fitBase;
		// Turning: the picture is turned at its own size inside a square that fits any angle
		// (a filter can't follow a picture whose size changes), then that square is scaled.
		const side = Math.hypot(sw * cropW, sh * cropH);
		const turn = rotating
			? `,format=rgba,pad=w=${Math.ceil(side / 2) * 2}:h=${Math.ceil(side / 2) * 2}:x=(ow-iw)/2:y=(oh-ih)/2:color=black@0,rotate=a='(${keyframeExpr(kf.rotation, t.rotation ?? 0, stepT)}+${wiggleExpr(clip.wiggle, seed, stepT).rotation})*PI/180':c=none`
			: "";
		const boxW = rotating ? side * fitBase : baseW;
		const boxH = rotating ? side * fitBase : baseH;
		// A picture whose size changes each frame is padded to a fixed box (its largest size,
		// centred): overlay keeps the first frame's size, so without it the scale never moved.
		const peak =
			Math.max(t.scale, ...(kf.scale ?? []).map((k) => k.value)) *
			(tr?.kind === "zoom" ? 1 + ZOOM_FROM : 1) *
			// Bezier eases can overshoot their keyframes.
			((kf.scale ?? []).some((k) => k.ease === "bezier") ? 1.5 : 1);
		const padW = Math.max(2, Math.ceil((boxW * peak) / 2) * 2 + 2);
		const padH = Math.max(2, Math.ceil((boxH * peak) / 2) * 2 + 2);
		const size =
			turn +
			(animatedScale
				? `,scale=w='max(2,trunc(min(${padW},${boxW.toFixed(2)}*(${S}))/2)*2)':h='max(2,trunc(min(${padH},${boxH.toFixed(2)}*(${S}))/2)*2)':eval=frame,format=rgba,pad=w=${padW}:h=${padH}:x='(ow-iw)/2':y='(oh-ih)/2':color=black@0:eval=frame`
				: `,scale=${Math.max(2, Math.round((boxW * t.scale) / 2) * 2)}:${Math.max(2, Math.round((boxH * t.scale) / 2) * 2)}`);
		const opacity =
			(kf.opacity?.length
				? // Opacity keyframes: the alpha follows the curve (T is clip-local seconds here).
					`,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*clip(${keyframeExpr(kf.opacity, t.opacity, steppedExpr("T", clip.stepFps))},0,1)'`
				: t.opacity < 1
					? `,colorchannelmixer=aa=${t.opacity.toFixed(3)}`
					: "") +
			// Wipes: the alpha is cut off beyond a moving edge while the transition runs.
			(tr?.kind === "wipe-left" || tr?.kind === "wipe-right"
				? `,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='alpha(X,Y)*${tr.kind === "wipe-left" ? `gte(X,W*(1-${enteredAt("T")}))` : `lte(X,W*${enteredAt("T")})`}':enable='lt(t,${s(tr.durationMs)})'`
				: "") +
			(tr?.kind === "paper-tear"
				? (() => {
						const edge = `W*(${enteredAt("T")}+0.015*sin(Y/H*37.7)+0.009*sin(Y/H*100.5+1.2))`;
						const fringe = `between(X,${edge}-8,${edge})`;
						return `,geq=r='if(${fringe},235,r(X,Y))':g='if(${fringe},226,g(X,Y))':b='if(${fringe},206,b(X,Y))':a='alpha(X,Y)*lte(X,${edge})':enable='lt(t,${s(tr.durationMs)})'`;
					})()
				: "") +
			(tr?.kind === "signal-glitch"
				? (() => {
						const edge = `W*(${enteredAt("T")}+0.13*sin(floor(Y/H*16)*13.2+floor(T*24)*2.3))`;
						const scan = `if(lt(mod(Y,4),1),0.7,1)`;
						return `,geq=r='r(min(W-1,X+7),Y)*${scan}':g='g(X,Y)*${scan}':b='b(max(0,X-7),Y)*${scan}':a='alpha(X,Y)*lte(X,${edge})':enable='lt(t,${s(tr.durationMs)})'`;
					})()
				: "") +
			(tr?.kind === "ink-blot"
				? (() => {
						const dist = `sqrt((X/W-0.5)*(X/W-0.5)+(Y/H-0.5)*(Y/H-0.5))`;
						const edge = `${enteredAt("T")}*0.82+0.02*sin(X/W*35)+0.015*sin(Y/H*51)`;
						const rim = `between(${dist},${edge}-0.012,${edge})`;
						return `,geq=r='if(${rim},18,r(X,Y))':g='if(${rim},28,g(X,Y))':b='if(${rim},23,b(X,Y))':a='alpha(X,Y)*lte(${dist},${edge})':enable='lt(t,${s(tr.durationMs)})'`;
					})()
				: "");
		const fades = [
			clip.fadeInMs > 0 ? `fade=t=in:st=0:d=${s(clip.fadeInMs)}:alpha=1` : "",
			clip.fadeOutMs > 0
				? `fade=t=out:st=${s(clip.durationMs - clip.fadeOutMs)}:d=${s(clip.fadeOutMs)}:alpha=1`
				: "",
		].filter(Boolean);
		let index: number;
		let source: string;
		if (a.kind === "image") {
			index = addInput([
				"-loop",
				"1",
				"-framerate",
				String(fps),
				"-t",
				s(clip.durationMs),
				"-i",
				file,
			]);
			source = `[${index}:v]fps=${fps},setpts=PTS-STARTPTS`;
		} else if (a.kind === "lottie" && motion?.kind === "still") {
			// A graphic that doesn't change over the clip: one picture, held.
			index = addInput([
				"-loop",
				"1",
				"-framerate",
				String(fps),
				"-t",
				s(clip.durationMs),
				"-i",
				motion.file,
			]);
			source = `[${index}:v]format=rgba,fps=${fps},setpts=PTS-STARTPTS`;
		} else if (a.kind === "lottie" && motion?.kind === "sequence") {
			// Already one frame per output frame from the clip's start, speed and looping applied.
			index = addInput(["-framerate", String(motion.fps), "-i", motion.pattern]);
			source = `[${index}:v]format=rgba,setpts=PTS-STARTPTS,fps=${fps}`;
		} else if (a.kind === "video") {
			index = addInput(["-i", file]);
			const steady = clip.effects?.stabilize
				? `,vidstabtransform=input='${(await shakeAnalysis(ctx.dir, file, clip)).replace(/'/g, "\\'")}':smoothing=20:zoom=4`
				: "";
			source = `[${index}:v]trim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))}${steady},setpts=(PTS-STARTPTS)/${clip.speed},fps=${fps}`;
		} else continue;
		// Rounded corners: an alpha mask the size of the cropped picture, multiplied into its alpha.
		let rounded = "";
		if (clip.frame?.radius) {
			const cw = Math.max(2, Math.round((sw * cropW) / 2) * 2);
			const ch = Math.max(2, Math.round((sh * cropH) / 2) * 2);
			const radius = clip.frame.radius / (fitBase * Math.max(0.01, t.scale));
			const m = addInput([
				"-loop",
				"1",
				"-framerate",
				String(fps),
				"-t",
				s(clip.durationMs + 1000),
				"-i",
				await roundedMask(ctx.dir, cw, ch, radius),
			]);
			chains.push(`[${m}:v]format=gray,scale=${cw}:${ch}[fm${label}]`);
			rounded =
				`,scale=${cw}:${ch},format=rgba,split[fa${label}][fb${label}];[fb${label}]alphaextract[fx${label}];` +
				`[fx${label}][fm${label}]blend=all_mode=multiply:shortest=1[fy${label}];[fa${label}][fy${label}]alphamerge`;
		}
		const finish = `${crop}${rounded}${size},format=rgba${opacity}${fades.length ? `,${fades.join(",")}` : ""},setpts=PTS+${start}/TB[${label}]`;
		if (clip.mask) {
			// The mask is drawn once at the picture's size and becomes its alpha, before cropping and scaling.
			// With a chroma key too, the key's alpha and the mask are multiplied so both apply.
			const maskFile = await maskImage(ctx.dir, clip.mask, sw, sh);
			const m = addInput([
				"-loop",
				"1",
				"-framerate",
				String(fps),
				"-t",
				s(clip.durationMs + 1000),
				"-i",
				maskFile,
			]);
			chains.push(`${source}${zoomChain}${colorChain}${keyChain},format=yuva420p[pre${label}]`);
			chains.push(`[${m}:v]format=gray,scale=${sw}:${sh}[mask${label}]`);
			if (clip.key) {
				chains.push(`[pre${label}]split[pic${label}][alp${label}]`);
				chains.push(`[alp${label}]alphaextract[ka${label}]`);
				chains.push(`[ka${label}][mask${label}]blend=all_mode=multiply[ma${label}]`);
				chains.push(`[pic${label}][ma${label}]alphamerge${finish}`);
			} else chains.push(`[pre${label}][mask${label}]alphamerge${finish}`);
		} else {
			chains.push(`${source}${zoomChain}${colorChain}${keyChain}${finish}`);
		}
		// Position: centre of the (uncropped) picture, shifted so the visible crop stays where it was.
		const local = steppedExpr(`(t-${start})`, clip.stepFps);
		const wig = wiggleExpr(clip.wiggle, seed, local);
		const slide =
			tr?.kind === "slide-left"
				? `+(1-${enteredAt(local)})`
				: tr?.kind === "slide-right"
					? `-(1-${enteredAt(local)})`
					: "";
		const X = `${kf.x?.length ? keyframeExpr(kf.x, t.x, local) : String(t.x)}${slide}`;
		const Y = kf.y?.length ? keyframeExpr(kf.y, t.y, local) : String(t.y);
		const Sg = `${kf.scale?.length ? keyframeExpr(kf.scale, t.scale, local) : String(t.scale)}${zoomIn(local)}`;
		const dx = `${(((c.left - c.right) / 2) * sw * fitBase).toFixed(3)}*(${Sg})`;
		const dy = `${(((c.top - c.bottom) / 2) * sh * fitBase).toFixed(3)}*(${Sg})`;
		if (clip.frame?.shadow) {
			// The shadow sits under the picture where it rests (its keyframes aren't followed).
			const box = {
				x: W * t.x + ((c.left - c.right) / 2) * sw * fitBase * t.scale,
				y: H * t.y + ((c.top - c.bottom) / 2) * sh * fitBase * t.scale,
				w: baseW * t.scale,
				h: baseH * t.scale,
			};
			const shade = addInput([
				"-loop",
				"1",
				"-framerate",
				String(fps),
				"-t",
				s(clip.durationMs),
				"-i",
				await shadowImage(ctx.dir, W, H, box, clip.frame),
			]);
			const fadeShadow = [
				clip.fadeInMs > 0 ? `fade=t=in:st=0:d=${s(clip.fadeInMs)}:alpha=1` : "",
				clip.fadeOutMs > 0
					? `fade=t=out:st=${s(clip.durationMs - clip.fadeOutMs)}:d=${s(clip.fadeOutMs)}:alpha=1`
					: "",
			].filter(Boolean);
			chains.push(
				`[${shade}:v]format=rgba,fps=${fps}${fadeShadow.length ? `,${fadeShadow.join(",")}` : ""},setpts=PTS-STARTPTS+${start}/TB[sd${label}]`,
			);
			chains.push(
				`[${current}][sd${label}]overlay=x=0:y=0:enable='between(t,${start},${end})':eof_action=pass[sdo${label}]`,
			);
			current = `sdo${label}`;
		}
		// Wiggle is in pixels of a 1080-line frame.
		const position = `x='${W}*(${X})+${dx}+(${wig.x})*${(H / 1080).toFixed(5)}-w/2':y='${H}*(${Y})+${dy}+(${wig.y})*${(H / 1080).toFixed(5)}-h/2'`;
		if (clip.blend && clip.blend !== "normal") {
			// Blend modes: the picture is laid on a canvas of the mode's neutral colour (which
			// leaves what is below unchanged), then that whole frame is blended with the edit.
			const neutral =
				clip.blend === "multiply" || clip.blend === "darken"
					? "white"
					: clip.blend === "screen" || clip.blend === "lighten"
						? "black"
						: "0x808080";
			const mode = {
				multiply: "multiply",
				screen: "screen",
				overlay: "overlay",
				"soft-light": "softlight",
				darken: "darken",
				lighten: "lighten",
			}[clip.blend];
			chains.push(
				`color=c=${neutral}:s=${W}x${H}:r=${fps}:d=${s(lengthMs)},format=rgba[nb${label}]`,
				`[nb${label}][${label}]overlay=${position}:enable='between(t,${start},${end})':eof_action=pass,format=gbrap[nl${label}]`,
				`[${current}]format=gbrap[bb${label}]`,
				`[bb${label}][nl${label}]blend=all_mode=${mode}:enable='between(t,${start},${end})',format=yuva420p[o${index}]`,
			);
		} else
			chains.push(
				`[${current}][${label}]overlay=${position}:enable='between(t,${start},${end})':eof_action=pass[o${index}]`,
			);
		current = `o${index}`;
	}
	const scale = data.export.scale;
	const outW = Math.round((W * scale) / 2) * 2;
	const outH = Math.round((H * scale) / 2) * 2;
	chains.push(`[${current}]${scale !== 1 ? `scale=${outW}:${outH},` : ""}format=yuv420p[vout]`);

	const audio = audibleClips(ctx);
	const audioMaps: string[] = [];
	if (audio.length) {
		const first = n;
		for (const src of audio) addInput(["-i", src.file]);
		chains.push(...mixGraph(audio, first, lengthMs, data.export.normalize, "aout"));
		audioMaps.push(
			"-map",
			"[aout]",
			"-c:a",
			data.export.codec === "prores" ? "pcm_s16le" : "aac",
			...(data.export.codec === "prores" ? [] : ["-b:a", "192k"]),
		);
	}

	// Unique per export: two exports started in the same millisecond (tests run several at once)
	// used to share a name and read each other's graph ("Invalid file index … in filtergraph").
	const graph = path.join(
		os.tmpdir(),
		`cue-graph-${Date.now()}-${Math.random().toString(36).slice(2, 10)}.txt`,
	);
	await fs.writeFile(graph, chains.join(";\n"));
	const exported = ctx.range ? Math.min(lengthMs, ctx.range.endMs) - ctx.range.startMs : lengthMs;
	// Every input gets its own decoder threads (about one per core) by default. A long,
	// layered edit has 150–200 inputs, which runs the process out of threads (macOS allows
	// 4,096) before the encoder opens: "Error initializing output stream" with any encoder.
	// One decoder thread per input is plenty for stills, sequences and short clips; the
	// filter graph and the encoder still use every core.
	const inputCount = inputs.filter((a) => a === "-i").length;
	const decodeThreads = inputCount > 24 ? ["-threads", "1"] : [];
	const threadedInputs = inputs.flatMap((a) => (a === "-i" ? [...decodeThreads, a] : [a]));
	const encode = (video: string[]) =>
		ffmpegWithProgress(
			[
				...threadedInputs,
				"-filter_complex_script",
				graph,
				"-map",
				"[vout]",
				...audioMaps,
				...video,
				"-r",
				String(fps),
				...rangeArgs(ctx.range, lengthMs),
				...(out.endsWith(".mp4") ? ["-movflags", "+faststart"] : []),
				out,
			],
			exported,
			(fraction) =>
				ctx.onProgress?.((drawn.length ? 0.5 : 0) + fraction * (drawn.length ? 0.5 : 1)),
		);
	try {
		try {
			await encode(encoder(data));
		} catch (error) {
			// The Mac's hardware encoder sometimes refuses to start ("Error initializing
			// output stream"); the software encoder always can, so try that before failing.
			const hardwareFailed =
				data.export.hardware &&
				/videotoolbox|Error initializing output stream/i.test((error as Error).message);
			if (!hardwareFailed) throw error;
			await encode(encoder({ ...data, export: { ...data.export, hardware: false } }));
		}
	} catch (error) {
		// A failed export leaves no half-written file behind to block the next one.
		await fs.rm(out, { force: true });
		throw error;
	} finally {
		// CUE_KEEP_GRAPH keeps the filter graph, to run a failed export's command by hand.
		if (!process.env.CUE_KEEP_GRAPH) await fs.rm(graph, { force: true });
	}
	return { kind: "video", outputs: [out], missing: [], durationMs: exported };
}

/**
 * Filters for blur, sharpen and vignette, sized for a picture `height` pixels
 * tall. Glow comes back as "glow:<sigma>:<strength>" (it needs a small graph).
 */
function effectFilters(effects: Effects | undefined, height: number): string[] {
	if (!effects) return [];
	const px = height / 1080;
	return [
		effects.blur > 0 ? `gblur=sigma=${(effects.blur * 24 * px).toFixed(2)}` : "",
		effects.sharpen > 0 ? `unsharp=5:5:${(effects.sharpen * 2).toFixed(3)}:5:5:0` : "",
		// Drawn with the preview's own gradient (see vignetteMask), so both look the same.
		effects.vignette > 0 ? "vignette:" : "",
		effects.glow > 0
			? `glow:${(10 * px + effects.glow * 20 * px).toFixed(2)}:${(effects.glow * 0.8).toFixed(3)}`
			: "",
		// Grain on brightness only (like film), new every frame.
		effects.grain > 0
			? `format=yuva420p,noise=c0s=${Math.round(4 + effects.grain * 34)}:c0f=t+u`
			: "",
	].filter(Boolean);
}

/** Effects as a piece of a clip's filter chain (starting with a comma). */
function effectChain(
	effects: Effects | undefined,
	height: number,
	label: string,
	vignette?: string,
): string {
	return filterPiece(effectFilters(effects, height), label, "", vignette);
}

/**
 * Filters as a piece of a chain (starting with a comma). Glow and vignette need
 * small graphs of their own; `enable` (e.g. ":enable='between(t,1,2)'") limits
 * every filter to a time range.
 */
function filterPiece(filters: string[], label: string, enable = "", vignette?: string): string {
	let chain = "";
	let k = 0;
	for (const f of filters) {
		const id = `${label}_${k++}`;
		if (f.startsWith("vignette:")) {
			// A black mask of the picture's size (an input, see vignetteMask) laid over
			// it, then the picture's own alpha put back so see-through parts stay clear.
			if (!vignette) throw new Error("Vignette mask input missing.");
			chain +=
				`,format=rgba,split[vA${id}][vB${id}];[vB${id}]alphaextract[vX${id}];` +
				`[${vignette}]format=rgba[vM${id}];` +
				`[vA${id}][vM${id}]overlay=x=0:y=0:format=auto${enable}[vO${id}];` +
				`[vO${id}][vX${id}]alphamerge`;
			continue;
		}
		if (!f.startsWith("glow:")) {
			chain += `,${f}${enable}`;
			continue;
		}
		// Glow: a blurred copy screened over the picture.
		const [, sigma, strength] = f.split(":");
		chain +=
			`,format=gbrp,split[gA${id}][gB${id}];` +
			`[gB${id}]gblur=sigma=${sigma}[gC${id}];` +
			`[gA${id}][gC${id}]blend=all_mode=screen:all_opacity=${strength}${enable}`;
	}
	return chain;
}

/**
 * The preview's vignette as a black mask `width` × `height` whose alpha is the
 * darkening: CSS radial-gradient(ellipse at center, transparent inner%,
 * rgba(0,0,0,A) 100%), the ellipse reaching the corners. Made once per amount
 * and size.
 */
async function vignetteMask(amount: number, width: number, height: number): Promise<string> {
	const w = Math.max(2, Math.round(width));
	const h = Math.max(2, Math.round(height));
	const file = path.join(os.tmpdir(), `cue-vignette-a-${amount.toFixed(3)}-${w}x${h}.png`);
	const inner = Math.round(70 - amount * 45) / 100;
	const dark = 0.35 + amount * 0.55;
	try {
		await fs.access(file);
	} catch {
		const tmp = `${file}.${process.pid}-${Date.now()}.png`;
		const d = "sqrt(pow((X-W/2)/(W/2),2)+pow((Y-H/2)/(H/2),2))/sqrt(2)";
		await ffmpeg([
			"-f",
			"lavfi",
			"-i",
			`color=c=black:s=${w}x${h}`,
			"-vf",
			`format=rgba,geq=r=0:g=0:b=0:a='255*${dark.toFixed(4)}*clip((${d}-${inner})/${(1 - inner).toFixed(4)},0,1)'`,
			"-frames:v",
			"1",
			tmp,
		]);
		await fs.rename(tmp, file);
	}
	return file;
}

/**
 * Pass one of stabilisation: the camera motion of the part of the source a
 * clip uses, analysed once and cached next to the project.
 */
async function shakeAnalysis(dir: string, file: string, clip: MediaClip): Promise<string> {
	const key = JSON.stringify([file, clip.inMs, sourceSpan(clip)]);
	let hash = 0;
	for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
	const trf = path.join(dir, ".cue-cache", "stabilize", `${(hash >>> 0).toString(36)}.trf`);
	try {
		await fs.access(trf);
		return trf;
	} catch {}
	await fs.mkdir(path.dirname(trf), { recursive: true });
	const tmp = `${trf}.part`;
	await ffmpeg([
		"-ss",
		s(clip.inMs),
		"-t",
		s(sourceSpan(clip)),
		"-i",
		file,
		"-vf",
		`vidstabdetect=shakiness=6:result='${tmp.replace(/'/g, "\\'")}'`,
		"-f",
		"null",
		"-",
	]);
	await fs.rename(tmp, trf);
	return trf;
}

/** Colour-correction filters for a grade (shared by clips and adjustment layers). */
function gradeFilters(grade: ColorGrade | undefined): string[] {
	if (!grade) return [];
	return [
		grade.brightness !== 0 || grade.contrast !== 1 || grade.saturation !== 1
			? `eq=brightness=${grade.brightness.toFixed(3)}:contrast=${grade.contrast.toFixed(3)}:saturation=${grade.saturation.toFixed(3)}`
			: "",
		grade.temperature !== 0
			? `colortemperature=temperature=${Math.round(6500 - grade.temperature * 2500)}`
			: "",
		grade.lut ? `lut3d=file='${grade.lut.replace(/'/g, "\\'")}'` : "",
	].filter(Boolean);
}

/**
 * A grey mask image (white shows, black hides) for a clip, drawn once with
 * ffmpeg's geq and cached. Same formula as the preview's mask.
 */
/** Signed distance to a rounded rectangle (negative inside), as a geq expression. */
function roundedDistance(cx: number, cy: number, hw: number, hh: number, r: number): string {
	const ax = `(abs(X-${cx.toFixed(2)})-${(hw - r).toFixed(2)})`;
	const ay = `(abs(Y-${cy.toFixed(2)})-${(hh - r).toFixed(2)})`;
	return `(hypot(max(${ax}\\,0)\\,max(${ay}\\,0))+min(max(${ax}\\,${ay})\\,0)-${r.toFixed(2)})`;
}

/** Cached one-frame PNG made with a geq expression over a blank picture. */
async function geqImage(
	dir: string,
	key: unknown,
	w: number,
	h: number,
	format: "gray" | "rgba",
	expr: string,
): Promise<string> {
	const text = JSON.stringify(key);
	let hash = 0;
	for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) | 0;
	const file = path.join(dir, ".cue-cache", "masks", `${(hash >>> 0).toString(36)}.png`);
	try {
		await fs.access(file);
		return file;
	} catch {}
	await fs.mkdir(path.dirname(file), { recursive: true });
	await ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`color=black:s=${w}x${h}:d=1`,
		"-vf",
		`format=${format},geq=${expr}`,
		"-frames:v",
		"1",
		file,
	]);
	return file;
}

/** White inside a w×h rectangle with corners of `radius` pixels, antialiased. */
export function roundedMask(dir: string, w: number, h: number, radius: number): Promise<string> {
	const r = Math.max(0, Math.min(radius, w / 2, h / 2));
	const d = roundedDistance(w / 2, h / 2, w / 2, h / 2, r);
	return geqImage(dir, ["round", w, h, r], w, h, "gray", `lum='255*clip(0.5-${d}\\,0\\,1)'`);
}

/** A soft dark shadow under a rounded box, on a transparent W×H canvas. */
export function shadowImage(
	dir: string,
	W: number,
	H: number,
	box: { x: number; y: number; w: number; h: number },
	frame: { radius: number; shadow: number },
): Promise<string> {
	const scale = H / 1080;
	const sigma = 36 * scale;
	const r = Math.max(0, Math.min(frame.radius, box.w / 2, box.h / 2));
	const d = roundedDistance(box.x, box.y + 14 * scale, box.w / 2, box.h / 2, r);
	const alpha = `255*${(0.75 * frame.shadow).toFixed(3)}*exp(-pow(max(${d}\\,0)/${sigma.toFixed(2)}\\,2))`;
	return geqImage(dir, ["shadow", W, H, box, frame], W, H, "rgba", `r=0:g=0:b=0:a='${alpha}'`);
}

async function maskImage(dir: string, mask: Mask, w: number, h: number): Promise<string> {
	const key = JSON.stringify([mask, w, h]);
	let hash = 0;
	for (let i = 0; i < key.length; i++) hash = (hash * 31 + key.charCodeAt(i)) | 0;
	const file = path.join(dir, ".cue-cache", "masks", `${(hash >>> 0).toString(36)}.png`);
	try {
		await fs.access(file);
		return file;
	} catch {}
	await fs.mkdir(path.dirname(file), { recursive: true });
	const cx = (mask.x * w).toFixed(2);
	const cy = (mask.y * h).toFixed(2);
	const rx = Math.max(1, (mask.width / 2) * w).toFixed(2);
	const ry = Math.max(1, (mask.height / 2) * h).toFixed(2);
	const d =
		mask.shape === "ellipse"
			? `hypot((X-${cx})/${rx}\\,(Y-${cy})/${ry})`
			: `max(abs(X-${cx})/${rx}\\,abs(Y-${cy})/${ry})`;
	const fe = Math.max(0.002, mask.feather).toFixed(4);
	const v = `clip((1-${d})/${fe}\\,0\\,1)`;
	const lum = `255*${mask.invert ? `(1-${v})` : v}`;
	await ffmpeg([
		"-f",
		"lavfi",
		"-i",
		`color=black:s=${w}x${h}:d=1`,
		"-vf",
		`format=gray,geq=lum='${lum}'`,
		"-frames:v",
		"1",
		file,
	]);
	return file;
}
