import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { keyframeExpr, zoomExprs } from "./anim";
import { toSrt, toVtt } from "./captions";
import { ffmpeg } from "./media";
import { resolveInProject } from "./paths";
import {
	clipEnd,
	deriveLines,
	projectDuration,
	sourceSpan,
	stemName,
	voiceoverTrack,
} from "./project";
import type { Asset, Clip, MediaClip, ProjectData, TextClip, Track } from "./types";

/** A text clip rendered by the editor window: one still, or a frame sequence for animated text. */
export type TextRender =
	| { kind: "still"; file: string }
	| { kind: "sequence"; pattern: string; fps: number };

export interface ExportContext {
	dir: string;
	data: ProjectData;
	/** Rasterises text clips (done by the editor window so text looks identical to the preview). */
	renderText?: (clips: TextClip[]) => Promise<Record<string, TextRender>>;
	onProgress?: (fraction: number) => void;
}

export interface ExportReport {
	kind: "stems" | "voiceover" | "audio" | "video" | "captions";
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
	gain: number;
	voiceover: boolean;
	duck: boolean;
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
			x.transitionIn?.kind === "crossfade" &&
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
				t.muted ||
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
					gain: c.volume * t.volume,
					voiceover: !!t.voiceover,
					duck: !!t.duck && !t.voiceover,
					fadeOutMs: effectiveFadeOut(data, c),
				},
			];
		});
}

/** Filter chain for one audio clip, delayed to its timeline position. */
function audioChain(input: string, src: AudioSource, label: string): string {
	const { clip } = src;
	const fades = [
		clip.fadeInMs > 0 ? `afade=t=in:st=0:d=${s(clip.fadeInMs)}` : "",
		src.fadeOutMs > 0
			? `afade=t=out:st=${s(clip.durationMs - src.fadeOutMs)}:d=${s(src.fadeOutMs)}`
			: "",
	].filter(Boolean);
	const keyed = clip.keyframes?.volume?.length;
	const volume = keyed
		? `volume='${src.gain.toFixed(4)}*(${keyframeExpr(clip.keyframes?.volume, 1, "t*1000")})':eval=frame`
		: `volume=${src.gain.toFixed(3)}`;
	return (
		`${input}atrim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))},asetpts=PTS-STARTPTS${tempo(clip.speed)}` +
		`,aresample=48000,aformat=channel_layouts=stereo${clip.denoise ? ",highpass=f=80,afftdn=nf=-25:tn=1" : ""},${volume}` +
		(fades.length ? `,${fades.join(",")}` : "") +
		`,adelay=${Math.round(clip.startMs)}:all=1[${label}]`
	);
}

/**
 * Mixes audio sources into [label]. Tracks marked `duck` are compressed by
 * the voiceover (sidechain), so music dips while someone is speaking.
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
	const pad = `apad,atrim=0:${s(lengthMs)}`;
	const post = normalize ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ",alimiter=limit=0.97";
	const labels = (list: AudioSource[]) =>
		list.map((src) => `[a${firstInput + sources.indexOf(src)}]`).join("");
	const ducked = sources.filter((x) => x.duck);
	const voice = sources.filter((x) => x.voiceover);
	if (ducked.length && voice.length) {
		const rest = sources.filter((x) => !x.duck && !x.voiceover);
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
			`${labels(sources)}amix=inputs=${sources.length}:normalize=0,${pad}${post}[${label}]`,
		);
	}
	return chains;
}

async function mixAudio(sources: AudioSource[], out: string, lengthMs: number, normalize: boolean) {
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
		out,
	]);
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
		const clean = clip.denoise ? ",highpass=f=80,afftdn=nf=-25:tn=1" : "";
		await ffmpeg([
			"-ss",
			s(clip.inMs),
			"-t",
			s(sourceSpan(clip)),
			"-i",
			resolveInProject(ctx.dir, a.path),
			"-af",
			`volume=${clip.volume.toFixed(3)}${tempo(clip.speed)}${clean}${ctx.data.export.normalize ? ",loudnorm=I=-18:TP=-2:LRA=11" : ""}`,
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

/** Every audible track mixed down (with ducking). */
export async function exportAudioMix(ctx: ExportContext, outFile: string): Promise<ExportReport> {
	const lengthMs = projectDuration(ctx.data);
	await mixAudio(audibleClips(ctx), outFile, lengthMs, ctx.data.export.normalize);
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
			c.type === "text" && (c.source?.kind === "caption" || c.trackId === captionTrack?.id),
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
	const bitrate = { draft: "4M", standard: "10M", high: "20M" }[videoQuality];
	if (hardware && mac) {
		const name = codec === "hevc" ? "hevc_videotoolbox" : "h264_videotoolbox";
		return [
			"-c:v",
			name,
			"-b:v",
			bitrate,
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
		data.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.startMs - b.startMs),
	);
	const textClips = layers.filter(
		(c): c is TextClip => c.type === "text" && c.text.trim().length > 0,
	);
	const rendered = textClips.length
		? await (ctx.renderText?.(textClips) ??
				Promise.reject(new Error("Open the Cue window to render text.")))
		: {};

	const inputs: string[] = [];
	const chains: string[] = [
		`color=c=${background}:s=${W}x${H}:r=${fps}:d=${s(lengthMs)},format=yuva420p[base]`,
	];
	let current = "base";
	let n = 0;
	const addInput = (args: string[]) => {
		inputs.push(...args);
		return n++;
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
		const file = resolveInProject(ctx.dir, a.path);
		const t = clip.transform;
		const c = t.crop;
		const sw = a.width || W;
		const sh = a.height || H;
		const fitBase = Math.min(W / sw, H / sh);
		const cropW = 1 - c.left - c.right;
		const cropH = 1 - c.top - c.bottom;
		// Keyframed values are in clip-local milliseconds; filters see local seconds as `t`.
		const kf = clip.keyframes ?? {};
		const S = kf.scale?.length ? keyframeExpr(kf.scale, t.scale, "t*1000") : String(t.scale);
		const zoom = zoomExprs(clip.zooms, "t");
		const zoomChain = zoom
			? `,scale=w='trunc(iw*${zoom.scale}/2)*2':h='trunc(ih*${zoom.scale}/2)*2':eval=frame:flags=bicubic,crop=w=${sw}:h=${sh}:x='max(0,min(iw-${sw},${zoom.x}*iw-${sw}/2))':y='max(0,min(ih-${sh},${zoom.y}*ih-${sh}/2))'`
			: "";
		const grade = clip.color;
		const colorChain = grade
			? [
					grade.brightness !== 0 || grade.contrast !== 1 || grade.saturation !== 1
						? `eq=brightness=${grade.brightness.toFixed(3)}:contrast=${grade.contrast.toFixed(3)}:saturation=${grade.saturation.toFixed(3)}`
						: "",
					grade.temperature !== 0
						? `colortemperature=temperature=${Math.round(6500 - grade.temperature * 2500)}`
						: "",
					grade.lut ? `lut3d=file='${grade.lut.replace(/'/g, "\\'")}'` : "",
				]
					.filter(Boolean)
					.map((f) => `,${f}`)
					.join("")
			: "";
		const crop =
			c.left || c.top || c.right || c.bottom
				? `,crop=w=iw*${cropW.toFixed(4)}:h=ih*${cropH.toFixed(4)}:x=iw*${c.left.toFixed(4)}:y=ih*${c.top.toFixed(4)}`
				: "";
		const baseW = sw * cropW * fitBase;
		const baseH = sh * cropH * fitBase;
		const size = kf.scale?.length
			? `,scale=w='max(2,trunc(${baseW.toFixed(2)}*(${S})/2)*2)':h='max(2,trunc(${baseH.toFixed(2)}*(${S})/2)*2)':eval=frame`
			: `,scale=${Math.max(2, Math.round((baseW * t.scale) / 2) * 2)}:${Math.max(2, Math.round((baseH * t.scale) / 2) * 2)}`;
		const opacity = t.opacity < 1 ? `,colorchannelmixer=aa=${t.opacity.toFixed(3)}` : "";
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
		} else if (a.kind === "video") {
			index = addInput(["-i", file]);
			source = `[${index}:v]trim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))},setpts=(PTS-STARTPTS)/${clip.speed},fps=${fps}`;
		} else continue;
		chains.push(
			`${source}${zoomChain}${colorChain}${crop}${size},format=rgba${opacity}${fades.length ? `,${fades.join(",")}` : ""},setpts=PTS+${start}/TB[${label}]`,
		);
		// Position: centre of the (uncropped) picture, shifted so the visible crop stays where it was.
		const local = `(t-${start})*1000`;
		const X = kf.x?.length ? keyframeExpr(kf.x, t.x, local) : String(t.x);
		const Y = kf.y?.length ? keyframeExpr(kf.y, t.y, local) : String(t.y);
		const Sg = kf.scale?.length ? keyframeExpr(kf.scale, t.scale, local) : String(t.scale);
		const dx = `${(((c.left - c.right) / 2) * sw * fitBase).toFixed(3)}*(${Sg})`;
		const dy = `${(((c.top - c.bottom) / 2) * sh * fitBase).toFixed(3)}*(${Sg})`;
		chains.push(
			`[${current}][${label}]overlay=x='${W}*(${X})+${dx}-w/2':y='${H}*(${Y})+${dy}-h/2':enable='between(t,${start},${end})':eof_action=pass[o${index}]`,
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

	const graph = path.join(os.tmpdir(), `cue-graph-${Date.now()}.txt`);
	await fs.writeFile(graph, chains.join(";\n"));
	try {
		await ffmpeg([
			...inputs,
			"-filter_complex_script",
			graph,
			"-map",
			"[vout]",
			...audioMaps,
			...encoder(data),
			"-r",
			String(fps),
			"-t",
			s(lengthMs),
			...(out.endsWith(".mp4") ? ["-movflags", "+faststart"] : []),
			out,
		]);
	} finally {
		await fs.rm(graph, { force: true });
	}
	return { kind: "video", outputs: [out], missing: [], durationMs: lengthMs };
}
