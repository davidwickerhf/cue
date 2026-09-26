import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { resolveInProject } from "./paths";
import { projectDuration } from "./project";
import type { Asset, Clip, MediaClip, ProjectData, TextClip, Track } from "./types";

/**
 * Timeline interchange with other editors. Exports keep what each format can
 * carry (cuts, trims, track layout, speed, volume, titles where supported);
 * OpenTimelineIO also round-trips Cue's own clip settings in its metadata.
 *
 * - OpenTimelineIO (.otio): DaVinci Resolve, Premiere (via plug-in), Kdenlive, Avid, Nuke…
 * - FCPXML 1.10: Final Cut Pro, DaVinci Resolve, Premiere (via XtoCC)
 * - MLT XML (.mlt): Shotcut, and any MLT-based editor
 * - CMX3600 EDL (.edl): nearly every NLE and online tool
 */

export type InterchangeFormat = "otio" | "fcpxml" | "mlt" | "edl";

export const INTERCHANGE_EXTENSIONS: Record<InterchangeFormat, string> = {
	otio: ".otio",
	fcpxml: ".fcpxml",
	mlt: ".mlt",
	edl: ".edl",
};

interface Layout {
	fps: number;
	/** Total length in frames. */
	length: number;
	/** Visual tracks, top of the stack first. */
	visual: Track[];
	audio: Track[];
	clipsOn: (trackId: string) => Clip[];
	asset: (id: string) => Asset | undefined;
	file: (asset: Asset) => string;
	frames: (ms: number) => number;
	/** Media clips on a track, as frame spans without overlaps. */
	spans: (trackId: string) => Span[];
}

interface Span {
	clip: Clip;
	start: number;
	end: number;
	/** Frames into the source (media clips). */
	in: number;
}

function layout(data: ProjectData, dir: string): Layout {
	const fps = data.canvas.fps;
	const frames = (ms: number) => Math.round((ms * fps) / 1000);
	const assets = new Map(data.assets.map((a) => [a.id, a]));
	const clipsOn = (trackId: string) =>
		data.clips.filter((c) => c.trackId === trackId).sort((a, b) => a.startMs - b.startMs);
	const spans = (trackId: string): Span[] => {
		const out: Span[] = [];
		let cursor = 0;
		for (const clip of clipsOn(trackId)) {
			// Adjustment layers have no equivalent in these formats.
			if (clip.type === "media" && assets.get(clip.assetId)?.kind === "adjustment") continue;
			let start = frames(clip.startMs);
			const end = frames(clip.startMs + clip.durationMs);
			let inFrames = clip.type === "media" ? frames(clip.inMs) : 0;
			// Overlaps (e.g. crossfades) become straight cuts: trim the later clip's head.
			if (start < cursor) {
				const skip = cursor - start;
				inFrames += clip.type === "media" ? Math.round(skip * clip.speed) : 0;
				start = cursor;
			}
			if (end - start < 1) continue;
			out.push({ clip, start, end, in: inFrames });
			cursor = end;
		}
		return out;
	};
	return {
		fps,
		length: Math.max(1, frames(projectDuration(data))),
		visual: data.tracks.filter((t) => t.kind === "video" || t.kind === "text"),
		audio: data.tracks.filter((t) => t.kind === "audio"),
		clipsOn,
		asset: (id) => assets.get(id),
		file: (asset) => resolveInProject(dir, asset.path),
		frames,
		spans,
	};
}

/** Whether a clip on a video track carries its own sound. */
function audible(l: Layout, clip: Clip, track: Track): clip is MediaClip {
	if (clip.type !== "media" || track.muted || clip.volume <= 0) return false;
	const asset = l.asset(clip.assetId);
	return !!asset && asset.kind === "video" && asset.hasAudio;
}

const xml = (value: string) =>
	value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// ---------------------------------------------------------------------------
// OpenTimelineIO
// ---------------------------------------------------------------------------

export function toOtio(data: ProjectData, dir: string): string {
	const l = layout(data, dir);
	const rt = (value: number) => ({ OTIO_SCHEMA: "RationalTime.1", rate: l.fps, value });
	const range = (start: number, duration: number) => ({
		OTIO_SCHEMA: "TimeRange.1",
		start_time: rt(start),
		duration: rt(duration),
	});
	const gap = (frames: number) => ({
		OTIO_SCHEMA: "Gap.1",
		name: "",
		source_range: range(0, frames),
		effects: [],
		markers: [],
		metadata: {},
	});
	const item = (span: Span, audioOnly = false) => {
		const { clip } = span;
		const duration = span.end - span.start;
		if (clip.type === "text") {
			return {
				OTIO_SCHEMA: "Clip.2",
				name: clip.name ?? clip.text.slice(0, 40),
				source_range: range(0, duration),
				media_references: {
					DEFAULT_MEDIA: {
						OTIO_SCHEMA: "GeneratorReference.1",
						name: "Text",
						generator_kind: "Text",
						parameters: { text: clip.text },
						available_range: null,
						metadata: {},
					},
				},
				active_media_reference_key: "DEFAULT_MEDIA",
				effects: [],
				markers: [],
				enabled: true,
				metadata: { cue: { clip } },
			};
		}
		const asset = l.asset(clip.assetId);
		return {
			OTIO_SCHEMA: "Clip.2",
			name: clip.name ?? asset?.name ?? clip.assetId,
			source_range: range(span.in, duration),
			media_references: {
				DEFAULT_MEDIA: {
					OTIO_SCHEMA: "ExternalReference.1",
					name: asset?.name ?? "",
					target_url: asset ? pathToFileURL(l.file(asset)).href : "",
					available_range:
						asset && asset.durationMs > 0 ? range(0, l.frames(asset.durationMs)) : null,
					metadata: {},
				},
			},
			active_media_reference_key: "DEFAULT_MEDIA",
			effects:
				clip.speed !== 1
					? [
							{
								OTIO_SCHEMA: "LinearTimeWarp.1",
								name: "",
								effect_name: "LinearTimeWarp",
								time_scalar: clip.speed,
								metadata: {},
							},
						]
					: [],
			markers: [],
			enabled: true,
			metadata: { cue: audioOnly ? { linkedAudio: true } : { clip } },
		};
	};
	const track = (t: Track, kind: "Video" | "Audio", linked = false) => {
		const children: unknown[] = [];
		let cursor = 0;
		for (const span of l.spans(t.id)) {
			if (linked && !audible(l, span.clip, t)) continue;
			if (span.start > cursor) children.push(gap(span.start - cursor));
			children.push(item(span, linked));
			cursor = span.end;
		}
		return {
			OTIO_SCHEMA: "Track.1",
			name: linked ? `${t.name} audio` : t.name,
			kind,
			children,
			source_range: null,
			effects: [],
			markers: [],
			enabled: kind === "Video" ? !t.hidden : !t.muted,
			metadata: { cue: linked ? { linkedAudio: true } : { track: t } },
		};
	};
	const COLORS = { accent: "BLUE", success: "GREEN", warning: "YELLOW", danger: "RED" } as const;
	const video = [...l.visual].reverse().map((t) => track(t, "Video"));
	const linked = [...l.visual]
		.reverse()
		.filter((t) => t.kind === "video" && l.clipsOn(t.id).some((c) => audible(l, c, t)))
		.map((t) => track(t, "Audio", true));
	const audio = l.audio.map((t) => track(t, "Audio"));
	return `${JSON.stringify(
		{
			OTIO_SCHEMA: "Timeline.1",
			name: data.name,
			global_start_time: null,
			metadata: { cue: { canvas: data.canvas } },
			tracks: {
				OTIO_SCHEMA: "Stack.1",
				name: "tracks",
				children: [...video, ...linked, ...audio],
				source_range: null,
				effects: [],
				markers: data.markers.map((m) => ({
					OTIO_SCHEMA: "Marker.2",
					name: m.label,
					marked_range: range(l.frames(m.atMs), 0),
					color: COLORS[m.color],
					comment: "",
					metadata: {},
				})),
				enabled: true,
				metadata: {},
			},
		},
		null,
		2,
	)}\n`;
}

/** A timeline read from another editor, ready to be rebuilt as Cue tracks and clips. */
export interface ImportedTimeline {
	name: string;
	fps: number;
	width?: number;
	height?: number;
	/** Top of the stack first, like Cue. */
	tracks: {
		name: string;
		kind: "video" | "audio" | "text";
		muted: boolean;
		hidden: boolean;
		clips: (
			| {
					type: "media";
					file: string;
					startMs: number;
					durationMs: number;
					inMs: number;
					speed: number;
					volume?: number;
					extra?: Partial<MediaClip>;
					name?: string;
			  }
			| {
					type: "text";
					text: string;
					startMs: number;
					durationMs: number;
					extra?: Partial<TextClip>;
			  }
		)[];
	}[];
	markers: { atMs: number; label: string }[];
}

type OtioNode = Record<string, unknown> & { OTIO_SCHEMA?: string };

export function fromOtio(raw: unknown, baseDir: string): ImportedTimeline {
	const root = raw as OtioNode;
	if (!String(root?.OTIO_SCHEMA ?? "").startsWith("Timeline."))
		throw new Error("Not an OpenTimelineIO timeline.");
	const toMs = (t: unknown) => {
		const r = t as { value?: number; rate?: number } | null;
		return r?.rate ? ((r.value ?? 0) * 1000) / r.rate : 0;
	};
	const stack = root.tracks as OtioNode;
	const children = (stack?.children as OtioNode[]) ?? [];
	let fps = 30;
	const cueMeta = (
		root.metadata as { cue?: { canvas?: { width: number; height: number; fps: number } } }
	)?.cue;
	const tracks: ImportedTimeline["tracks"] = [];
	const hasAudioTracks = children.some((t) => t.kind === "Audio" && !isLinked(t));
	for (const t of children) {
		if (!String(t.OTIO_SCHEMA).startsWith("Track.") || isLinked(t)) continue;
		const video = t.kind === "Video";
		const clips: ImportedTimeline["tracks"][number]["clips"] = [];
		let cursor = 0;
		let isText = video;
		for (const c of (t.children as OtioNode[]) ?? []) {
			const schema = String(c.OTIO_SCHEMA);
			const sr = c.source_range as { start_time: unknown; duration: unknown } | null;
			const duration = sr ? toMs(sr.duration) : 0;
			if (schema.startsWith("Transition.")) continue;
			if (!schema.startsWith("Clip.")) {
				cursor += duration;
				continue;
			}
			const rate = (sr?.duration as { rate?: number } | undefined)?.rate;
			if (rate) fps = rate;
			const ref = activeReference(c);
			const meta = (c.metadata as { cue?: { clip?: Clip } } | undefined)?.cue?.clip;
			if (
				String(ref?.OTIO_SCHEMA).startsWith("GeneratorReference.") &&
				ref?.generator_kind === "Text"
			) {
				const text = String((ref.parameters as { text?: string })?.text ?? c.name ?? "");
				clips.push({
					type: "text",
					text,
					startMs: Math.round(cursor),
					durationMs: Math.round(duration),
					extra:
						meta?.type === "text"
							? {
									style: meta.style,
									animationIn: meta.animationIn,
									animationOut: meta.animationOut,
								}
							: undefined,
				});
			} else if (typeof ref?.target_url === "string" && ref.target_url) {
				isText = false;
				const url = ref.target_url;
				const file = url.startsWith("file:") ? fileURLToPath(url) : path.resolve(baseDir, url);
				const warp = ((c.effects as OtioNode[]) ?? []).find((e) =>
					String(e.OTIO_SCHEMA).startsWith("LinearTimeWarp."),
				);
				const speed = Math.min(8, Math.max(0.1, Number(warp?.time_scalar ?? 1) || 1));
				const extra =
					meta?.type === "media"
						? {
								transform: meta.transform,
								fadeInMs: meta.fadeInMs,
								fadeOutMs: meta.fadeOutMs,
								denoise: meta.denoise,
								color: meta.color,
								keyframes: meta.keyframes,
								zooms: meta.zooms,
							}
						: undefined;
				clips.push({
					type: "media",
					file,
					startMs: Math.round(cursor),
					durationMs: Math.max(1, Math.round(duration)),
					inMs: Math.round(sr ? toMs(sr.start_time) : 0),
					speed,
					// Foreign timelines carry picture and sound on separate tracks.
					volume: meta?.type === "media" ? meta.volume : video && hasAudioTracks ? 0 : undefined,
					name: typeof c.name === "string" ? c.name : undefined,
					extra,
				});
			}
			cursor += duration;
		}
		const kind = video ? (isText && clips.length > 0 ? "text" : "video") : "audio";
		tracks.push({
			name: String(t.name || (video ? "Video" : "Audio")),
			kind,
			muted: !video && t.enabled === false,
			hidden: video && t.enabled === false,
			clips,
		});
	}
	// OTIO stacks list the bottom track first; Cue lists the top one first.
	const visual = tracks.filter((t) => t.kind !== "audio").reverse();
	const audio = tracks.filter((t) => t.kind === "audio");
	const markers = ((stack?.markers as OtioNode[]) ?? []).map((m) => ({
		atMs: Math.round(toMs((m.marked_range as { start_time: unknown })?.start_time)),
		label: String(m.name ?? ""),
	}));
	return {
		name: String(root.name || "Imported timeline"),
		fps: cueMeta?.canvas?.fps ?? fps,
		width: cueMeta?.canvas?.width,
		height: cueMeta?.canvas?.height,
		tracks: [...visual, ...audio],
		markers,
	};
}

function isLinked(node: OtioNode) {
	return !!(node.metadata as { cue?: { linkedAudio?: boolean } } | undefined)?.cue?.linkedAudio;
}

function activeReference(clip: OtioNode): OtioNode | undefined {
	const refs = clip.media_references as Record<string, OtioNode> | undefined;
	if (refs)
		return (
			refs[String(clip.active_media_reference_key ?? "DEFAULT_MEDIA")] ?? Object.values(refs)[0]
		);
	return clip.media_reference as OtioNode | undefined;
}

// ---------------------------------------------------------------------------
// FCPXML
// ---------------------------------------------------------------------------

export function toFcpxml(data: ProjectData, dir: string): string {
	const l = layout(data, dir);
	// Frame duration as a rational: NTSC rates use 1001/…
	const ntsc =
		Math.abs(l.fps * 1.001 - Math.round(l.fps * 1.001)) < 0.01 && !Number.isInteger(l.fps);
	const [num, den] = ntsc ? [1001, Math.round(l.fps * 1.001) * 1000] : [1, Math.round(l.fps)];
	const t = (frames: number) => (frames === 0 ? "0s" : `${frames * num}/${den}s`);
	const db = (gain: number) => (gain <= 0 ? -96 : 20 * Math.log10(gain)).toFixed(1);

	const resources: string[] = [
		`<format id="r1" frameDuration="${num}/${den}s" width="${data.canvas.width}" height="${data.canvas.height}"/>`,
	];
	const assetRef = new Map<string, string>();
	let nextId = 2;
	for (const clip of data.clips) {
		if (clip.type !== "media" || assetRef.has(clip.assetId)) continue;
		const asset = l.asset(clip.assetId);
		if (!asset) continue;
		const id = `r${nextId++}`;
		assetRef.set(asset.id, id);
		const video = asset.kind !== "audio";
		const audio = asset.kind === "audio" || asset.hasAudio;
		resources.push(
			`<asset id="${id}" name="${xml(asset.name)}" start="0s" duration="${t(l.frames(asset.durationMs))}" hasVideo="${video ? 1 : 0}" hasAudio="${audio ? 1 : 0}"${video ? ' format="r1"' : ""}${audio ? ' audioSources="1" audioChannels="2" audioRate="48000"' : ""}>` +
				`<media-rep kind="original-media" src="${xml(pathToFileURL(l.file(asset)).href)}"/></asset>`,
		);
	}
	const titleRef = `r${nextId++}`;
	resources.push(
		`<effect id="${titleRef}" name="Basic Title" uid=".../Titles.localized/Bumper:Opener.localized/Basic Title.localized/Basic Title.moti"/>`,
	);

	// Everything hangs off one gap on the primary storyline, one lane per track:
	// top video track gets the highest lane, audio tracks go below zero.
	const connected: string[] = [];
	let styleId = 0;
	const lanes: [Track, number][] = [
		...l.visual.map((track, i): [Track, number] => [track, l.visual.length - i]),
		...l.audio.map((track, i): [Track, number] => [track, -(i + 1)]),
	];
	for (const [track, lane] of lanes) {
		if (track.hidden && track.kind !== "audio") continue;
		for (const span of l.spans(track.id)) {
			const { clip } = span;
			const offset = t(span.start);
			const duration = t(span.end - span.start);
			if (clip.type === "text") {
				const ts = `ts${++styleId}`;
				const s = clip.style;
				const rgb = hexToRgb(s.color);
				connected.push(
					`<title ref="${titleRef}" lane="${lane}" offset="${offset}" duration="${duration}" name="${xml(clip.text.slice(0, 40))}">` +
						`<text><text-style ref="${ts}">${xml(clip.text)}</text-style></text>` +
						`<text-style-def id="${ts}"><text-style font="${xml(s.fontFamily.split(",")[0].replace(/["']/g, "").trim())}" fontSize="${s.fontSize}" fontColor="${rgb.join(" ")} 1" bold="${s.fontWeight >= 600 ? 1 : 0}" alignment="${s.align}"/></text-style-def>` +
						"</title>",
				);
				continue;
			}
			const ref = assetRef.get(clip.assetId);
			const asset = l.asset(clip.assetId);
			if (!ref || !asset) continue;
			const tag = asset.kind === "image" ? "video" : "asset-clip";
			const gain = clip.volume * track.volume;
			const inner: string[] = [];
			if (clip.speed !== 1)
				inner.push(
					`<timeMap><timept time="0s" value="0s" interp="linear"/><timept time="${duration}" value="${t(Math.round((span.end - span.start) * clip.speed))}" interp="linear"/></timeMap>`,
				);
			if (tag === "asset-clip" && (gain !== 1 || track.muted))
				inner.push(`<adjust-volume amount="${track.muted ? "-96" : db(gain)}dB"/>`);
			connected.push(
				`<${tag} ref="${ref}" lane="${lane}" offset="${offset}" name="${xml(clip.name ?? asset.name)}" start="${t(span.in)}" duration="${duration}"${asset.kind === "audio" ? ' audioRole="dialogue"' : ""}>${inner.join("")}</${tag}>`,
			);
		}
	}
	const markers = data.markers
		.map(
			(m) => `<marker start="${t(l.frames(m.atMs))}" duration="${t(1)}" value="${xml(m.label)}"/>`,
		)
		.join("");
	return [
		'<?xml version="1.0" encoding="UTF-8"?>',
		"<!DOCTYPE fcpxml>",
		'<fcpxml version="1.10">',
		`<resources>${resources.join("")}</resources>`,
		`<library><event name="Cue"><project name="${xml(data.name)}">`,
		`<sequence format="r1" duration="${t(l.length)}" tcStart="0s" tcFormat="NDF" audioLayout="stereo" audioRate="48k">`,
		`<spine><gap name="Gap" offset="0s" start="0s" duration="${t(l.length)}">${markers}${connected.join("")}</gap></spine>`,
		"</sequence></project></event></library></fcpxml>",
		"",
	].join("\n");
}

function hexToRgb(color: string): [string, string, string] {
	const m = /^#?([0-9a-f]{6})/i.exec(color);
	const n = m ? Number.parseInt(m[1], 16) : 0xffffff;
	return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => (v / 255).toFixed(3)) as [
		string,
		string,
		string,
	];
}

// ---------------------------------------------------------------------------
// MLT XML (Shotcut)
// ---------------------------------------------------------------------------

export function toMlt(data: ProjectData, dir: string): string {
	const l = layout(data, dir);
	const fps = Math.round(l.fps * 1000);
	const out: string[] = [
		'<?xml version="1.0" standalone="no"?>',
		`<mlt LC_NUMERIC="C" version="7.0.0" title="${xml(data.name)}" producer="main_bin">`,
		`<profile description="Cue" width="${data.canvas.width}" height="${data.canvas.height}" progressive="1" sample_aspect_num="1" sample_aspect_den="1" display_aspect_num="${data.canvas.width}" display_aspect_den="${data.canvas.height}" frame_rate_num="${fps}" frame_rate_den="1000" colorspace="709"/>`,
		'<playlist id="main_bin"><property name="xml_retain">1</property></playlist>',
		`<producer id="black" in="0" out="${l.length - 1}"><property name="length">${l.length}</property><property name="eof">pause</property><property name="resource">${xml(data.canvas.background)}</property><property name="mlt_service">color</property><property name="mlt_image_format">rgba</property><property name="set.test_audio">0</property></producer>`,
		`<playlist id="background"><entry producer="black" in="0" out="${l.length - 1}"/></playlist>`,
	];
	const playlists: { id: string; track: Track }[] = [];
	let producer = 0;
	// MLT draws later tracks on top: bottom visual track first, audio last.
	const ordered = [...[...l.visual].reverse(), ...l.audio];
	ordered.forEach((track, index) => {
		const entries: string[] = [];
		let cursor = 0;
		for (const span of l.spans(track.id)) {
			const { clip } = span;
			const length = span.end - span.start;
			if (span.start > cursor) entries.push(`<blank length="${span.start - cursor}"/>`);
			cursor = span.end;
			const id = `producer${producer++}`;
			if (clip.type === "text") {
				const s = clip.style;
				out.push(
					`<producer id="${id}" in="0" out="${length - 1}"><property name="length">${length}</property><property name="resource">#00000000</property><property name="mlt_service">color</property><property name="shotcut:caption">${xml(clip.text.slice(0, 40))}</property>` +
						`<filter><property name="mlt_service">dynamictext</property><property name="argument">${xml(clip.text)}</property><property name="family">${xml(s.fontFamily.split(",")[0].replace(/["']/g, "").trim())}</property><property name="size">${s.fontSize}</property><property name="weight">${s.fontWeight * 10}</property><property name="fgcolour">${xml(s.color)}</property><property name="bgcolour">${xml(s.background ?? "#00000000")}</property><property name="halign">${s.align}</property><property name="valign">${s.y > 0.66 ? "bottom" : s.y < 0.33 ? "top" : "middle"}</property><property name="geometry">0 0 ${data.canvas.width} ${data.canvas.height} 1</property></filter></producer>`,
				);
				entries.push(`<entry producer="${id}" in="0" out="${length - 1}"/>`);
				continue;
			}
			const asset = l.asset(clip.assetId);
			if (!asset) continue;
			const file = l.file(asset);
			const warped = clip.speed !== 1;
			const resource = warped ? `${clip.speed}:${file}` : file;
			const inFrame = warped ? Math.round(span.in / clip.speed) : span.in;
			const total =
				asset.durationMs > 0
					? l.frames(asset.durationMs / (warped ? clip.speed : 1))
					: inFrame + length;
			out.push(
				`<producer id="${id}" in="0" out="${Math.max(total, inFrame + length) - 1}"><property name="length">${Math.max(total, inFrame + length)}</property><property name="resource">${xml(resource)}</property>${warped ? `<property name="mlt_service">timewarp</property><property name="warp_speed">${clip.speed}</property><property name="warp_resource">${xml(file)}</property>` : ""}<property name="shotcut:caption">${xml(clip.name ?? asset.name)}</property></producer>`,
			);
			const gain = clip.volume * track.volume;
			const filter =
				gain !== 1 && asset.kind !== "image"
					? `<filter><property name="mlt_service">volume</property><property name="level">${(gain <= 0 ? -96 : 20 * Math.log10(gain)).toFixed(2)}</property></filter>`
					: "";
			entries.push(
				`<entry producer="${id}" in="${inFrame}" out="${inFrame + length - 1}">${filter}</entry>`,
			);
		}
		const id = `playlist${index}`;
		const video = track.kind !== "audio";
		out.push(
			`<playlist id="${id}"><property name="shotcut:${video ? "video" : "audio"}">1</property><property name="shotcut:name">${xml(track.name)}</property>${entries.join("")}</playlist>`,
		);
		playlists.push({ id, track });
	});
	const tracks = playlists
		.map(({ id, track }) => {
			const hide =
				track.kind === "audio"
					? track.muted
						? "both"
						: "video"
					: track.kind === "text"
						? track.hidden
							? "both"
							: "audio"
						: track.hidden && track.muted
							? "both"
							: track.hidden
								? "video"
								: track.muted
									? "audio"
									: "";
			return `<track producer="${id}"${hide ? ` hide="${hide}"` : ""}/>`;
		})
		.join("");
	const transitions = playlists
		.map(({ track }, i) => {
			const b = i + 1;
			const mix = `<transition><property name="a_track">0</property><property name="b_track">${b}</property><property name="mlt_service">mix</property><property name="always_active">1</property><property name="sum">1</property></transition>`;
			const blend =
				track.kind !== "audio"
					? `<transition><property name="a_track">0</property><property name="b_track">${b}</property><property name="version">0.1</property><property name="mlt_service">frei0r.cairoblend</property><property name="threads">0</property><property name="disable">0</property></transition>`
					: "";
			return mix + blend;
		})
		.join("");
	out.push(
		`<tractor id="tractor0" title="${xml(data.name)}" in="0" out="${l.length - 1}"><property name="shotcut">1</property><track producer="background"/>${tracks}${transitions}</tractor>`,
		"</mlt>",
		"",
	);
	return out.join("\n");
}

// ---------------------------------------------------------------------------
// CMX3600 EDL
// ---------------------------------------------------------------------------

/**
 * EDLs describe one picture track plus up to two sound channels, so this
 * takes the lowest video track with clips (the main storyline) and the first
 * two audio tracks.
 */
export function toEdl(data: ProjectData, dir: string): { text: string; skipped: string[] } {
	const l = layout(data, dir);
	const fps = Math.round(l.fps);
	const tc = (frames: number) => {
		const f = Math.max(0, frames);
		const h = Math.floor(f / (fps * 3600));
		const m = Math.floor((f / (fps * 60)) % 60);
		const s = Math.floor((f / fps) % 60);
		return [h, m, s, f % fps].map((n) => String(n).padStart(2, "0")).join(":");
	};
	const skipped: string[] = [];
	const videoTracks = l.visual.filter((t) => t.kind === "video");
	const main = [...videoTracks]
		.reverse()
		.find((t) => l.clipsOn(t.id).some((c) => c.type === "media"));
	for (const t of l.visual) if (t !== main && l.clipsOn(t.id).length) skipped.push(t.name);
	for (const t of l.audio.slice(2)) if (l.clipsOn(t.id).length) skipped.push(t.name);
	const events: { start: number; line: (n: string) => string[] }[] = [];
	const add = (track: Track, channel: (clip: MediaClip) => string) => {
		for (const span of l.spans(track.id)) {
			const clip = span.clip;
			if (clip.type !== "media") continue;
			const asset = l.asset(clip.assetId);
			if (!asset) continue;
			const length = span.end - span.start;
			const srcOut = span.in + Math.round(length * clip.speed);
			const reel = "AX      ";
			events.push({
				start: span.start,
				line: (n) => [
					`${n}  ${reel} ${channel(clip).padEnd(5)} C        ${tc(span.in)} ${tc(srcOut)} ${tc(span.start)} ${tc(span.end)}`,
					...(clip.speed !== 1
						? [
								`M2   ${reel}       ${(fps * clip.speed).toFixed(1).padStart(5, "0")}                ${tc(span.in)}`,
							]
						: []),
					`* FROM CLIP NAME: ${clip.name ?? asset.name}`,
					`* SOURCE FILE: ${l.file(asset)}`,
				],
			});
		}
	};
	if (main) add(main, (clip) => (audible(l, clip, main) ? "B" : "V"));
	l.audio.slice(0, 2).forEach((track, i) => {
		if (!track.muted) add(track, () => (i === 0 ? "A" : "A2"));
	});
	events.sort((a, b) => a.start - b.start);
	const lines = [`TITLE: ${data.name.slice(0, 70)}`, "FCM: NON-DROP FRAME", ""];
	events.forEach((e, i) => {
		lines.push(...e.line(String(i + 1).padStart(3, "0")), "");
	});
	return { text: lines.join("\n"), skipped };
}
