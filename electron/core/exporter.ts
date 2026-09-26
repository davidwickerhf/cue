import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ffmpeg } from "./media";
import { clipEnd, deriveLines, projectDuration, resolveInProject, sourceSpan, stemName, voiceoverTrack } from "./project";
import type { Asset, Clip, MediaClip, ProjectData, TextClip, Track } from "./types";

export interface ExportContext {
	dir: string;
	data: ProjectData;
	/** Rasterises text clips to full-canvas transparent PNGs (done by the editor window). */
	renderText?: (clips: TextClip[]) => Promise<Record<string, string>>;
	onProgress?: (fraction: number) => void;
}

export interface ExportReport {
	kind: "stems" | "voiceover" | "audio" | "video";
	outputs: string[];
	missing: string[];
	durationMs: number;
}

const s = (msValue: number) => (msValue / 1000).toFixed(3);

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
			if (t.muted || t.hidden || !a.hasAudio || a.kind === "image" || c.volume === 0 || t.volume === 0) return [];
			return [{ clip: c, file: resolveInProject(ctx.dir, a.path), gain: c.volume * t.volume }];
		});
}

/** Filter chain for one audio clip, delayed to its timeline position. */
function audioChain(input: string, src: AudioSource, label: string): string {
	const { clip } = src;
	const fades = [
		clip.fadeInMs > 0 ? `afade=t=in:st=0:d=${s(clip.fadeInMs)}` : "",
		clip.fadeOutMs > 0 ? `afade=t=out:st=${s(clip.durationMs - clip.fadeOutMs)}:d=${s(clip.fadeOutMs)}` : "",
	].filter(Boolean);
	return (
		`${input}atrim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))},asetpts=PTS-STARTPTS${tempo(clip.speed)}` +
		`,aresample=48000,aformat=channel_layouts=stereo,volume=${src.gain.toFixed(3)}` +
		(fades.length ? `,${fades.join(",")}` : "") +
		`,adelay=${Math.round(clip.startMs)}:all=1[${label}]`
	);
}

async function mixAudio(sources: AudioSource[], out: string, lengthMs: number, normalize: boolean) {
	if (sources.length === 0) throw new Error("Nothing is audible: no unmuted audio clips.");
	await fs.mkdir(path.dirname(out), { recursive: true });
	const inputs = sources.flatMap((src) => ["-i", src.file]);
	const chains = sources.map((src, i) => audioChain(`[${i}:a]`, src, `a${i}`));
	const post = normalize ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ",alimiter=limit=0.97";
	chains.push(`${sources.map((_, i) => `[a${i}]`).join("")}amix=inputs=${sources.length}:normalize=0,apad,atrim=0:${s(lengthMs)}${post}[out]`);
	await ffmpeg([...inputs, "-filter_complex", chains.join(";"), "-map", "[out]", "-ac", "2", "-ar", "48000", out]);
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
		await ffmpeg([
			"-ss", s(clip.inMs), "-t", s(sourceSpan(clip)), "-i", resolveInProject(ctx.dir, a.path),
			"-af", `volume=${clip.volume.toFixed(3)}${tempo(clip.speed)}${ctx.data.export.normalize ? ",highpass=f=70,loudnorm=I=-18:TP=-2:LRA=11" : ""}`,
			"-ac", "1", "-ar", "48000", "-c:a", "pcm_s16le", out,
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
	const missing = deriveLines(ctx.data).filter((l) => !l.clipId).map((l) => l.id);
	return { kind: "voiceover", outputs: [out], missing, durationMs: lengthMs };
}

/** Every audible track mixed down. */
export async function exportAudioMix(ctx: ExportContext, outFile: string): Promise<ExportReport> {
	const lengthMs = projectDuration(ctx.data);
	await mixAudio(audibleClips(ctx), outFile, lengthMs, ctx.data.export.normalize);
	return { kind: "audio", outputs: [outFile], missing: [], durationMs: lengthMs };
}

const QUALITY = {
	draft: ["-preset", "veryfast", "-crf", "28"],
	standard: ["-preset", "medium", "-crf", "20"],
	high: ["-preset", "slow", "-crf", "16"],
} as const;

/** Composites every visible video, image and text clip and mixes the audio. */
export async function exportVideo(ctx: ExportContext, outFile?: string): Promise<ExportReport> {
	const { data } = ctx;
	const { width: W, height: H, fps, background } = data.canvas;
	const lengthMs = projectDuration(data);
	if (lengthMs <= 0) throw new Error("The timeline is empty.");
	const out = outFile ?? resolveInProject(ctx.dir, data.export.videoFile.replaceAll("{name}", data.name.replace(/[^\w.-]+/g, "-")));
	await fs.mkdir(path.dirname(out), { recursive: true });

	// Tracks are listed top to bottom in the editor; draw the bottom ones first.
	const visualTracks = [...data.tracks].reverse().filter((t) => (t.kind === "video" || t.kind === "text") && !t.hidden);
	const layers: Clip[] = visualTracks.flatMap((t) => data.clips.filter((c) => c.trackId === t.id).sort((a, b) => a.startMs - b.startMs));
	const textClips = layers.filter((c): c is TextClip => c.type === "text" && c.text.trim().length > 0);
	const textPngs = textClips.length ? await (ctx.renderText?.(textClips) ?? Promise.reject(new Error("Open the Cue window to render text."))) : {};

	const inputs: string[] = [];
	const chains: string[] = [`color=c=${background}:s=${W}x${H}:r=${fps}:d=${s(lengthMs)},format=yuva420p[base]`];
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
			const png = textPngs[clip.id];
			if (!png) continue;
			const index = addInput(["-loop", "1", "-framerate", String(fps), "-t", s(clip.durationMs), "-i", png]);
			const fadeIn = clip.animationIn === "none" ? 0 : 250;
			const fadeOut = clip.animationOut === "none" ? 0 : 250;
			const fades = [
				fadeIn ? `fade=t=in:st=0:d=${s(fadeIn)}:alpha=1` : "",
				fadeOut ? `fade=t=out:st=${s(clip.durationMs - fadeOut)}:d=${s(fadeOut)}:alpha=1` : "",
			].filter(Boolean);
			chains.push(`[${index}:v]format=rgba${fades.length ? `,${fades.join(",")}` : ""},setpts=PTS-STARTPTS+${start}/TB[${label}]`);
			const y = clip.animationIn === "slide-up" ? `'if(lt(t-${start},0.3),(1-(t-${start})/0.3)*${Math.round(H * 0.03)},0)'` : "0";
			chains.push(`[${current}][${label}]overlay=x=0:y=${y}:enable='between(t,${start},${end})':eof_action=pass[o${index}]`);
			current = `o${index}`;
			continue;
		}
		const a = assetOf(data, clip.assetId);
		const file = resolveInProject(ctx.dir, a.path);
		const t = clip.transform;
		const fit = `scale=w='min(${W}/iw,${H}/ih)*iw*${t.scale.toFixed(4)}':h='min(${W}/iw,${H}/ih)*ih*${t.scale.toFixed(4)}':eval=init`;
		const opacity = t.opacity < 1 ? `,colorchannelmixer=aa=${t.opacity.toFixed(3)}` : "";
		const fades = [
			clip.fadeInMs > 0 ? `fade=t=in:st=0:d=${s(clip.fadeInMs)}:alpha=1` : "",
			clip.fadeOutMs > 0 ? `fade=t=out:st=${s(clip.durationMs - clip.fadeOutMs)}:d=${s(clip.fadeOutMs)}:alpha=1` : "",
		].filter(Boolean);
		let index: number;
		let source: string;
		if (a.kind === "image") {
			index = addInput(["-loop", "1", "-framerate", String(fps), "-t", s(clip.durationMs), "-i", file]);
			source = `[${index}:v]fps=${fps}`;
		} else if (a.kind === "video") {
			index = addInput(["-i", file]);
			source = `[${index}:v]trim=start=${s(clip.inMs)}:duration=${s(sourceSpan(clip))},setpts=(PTS-STARTPTS)/${clip.speed},fps=${fps}`;
		} else continue;
		chains.push(`${source},${fit},format=rgba${opacity}${fades.length ? `,${fades.join(",")}` : ""},setpts=PTS+${start}/TB[${label}]`);
		chains.push(
			`[${current}][${label}]overlay=x='${(t.x * W).toFixed(1)}-w/2':y='${(t.y * H).toFixed(1)}-h/2':enable='between(t,${start},${end})':eof_action=pass[o${index}]`,
		);
		current = `o${index}`;
	}
	chains.push(`[${current}]format=yuv420p[vout]`);

	const audio = audibleClips(ctx);
	const audioMaps: string[] = [];
	if (audio.length) {
		const first = n;
		for (const src of audio) addInput(["-i", src.file]);
		audio.forEach((src, i) => chains.push(audioChain(`[${first + i}:a]`, src, `au${i}`)));
		chains.push(
			`${audio.map((_, i) => `[au${i}]`).join("")}amix=inputs=${audio.length}:normalize=0,apad,atrim=0:${s(lengthMs)}${data.export.normalize ? ",loudnorm=I=-16:TP=-1.5:LRA=11" : ",alimiter=limit=0.97"}[aout]`,
		);
		audioMaps.push("-map", "[aout]", "-c:a", "aac", "-b:a", "192k");
	}

	const graph = path.join(os.tmpdir(), `cue-graph-${Date.now()}.txt`);
	await fs.writeFile(graph, chains.join(";\n"));
	try {
		await ffmpeg([
			...inputs,
			"-filter_complex_script", graph,
			"-map", "[vout]", ...audioMaps,
			"-c:v", "libx264", ...QUALITY[data.export.videoQuality], "-pix_fmt", "yuv420p",
			"-r", String(fps), "-t", s(lengthMs), "-movflags", "+faststart", out,
		]);
	} finally {
		await fs.rm(graph, { force: true });
	}
	return { kind: "video", outputs: [out], missing: [], durationMs: lengthMs };
}
