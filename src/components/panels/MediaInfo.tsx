import { Button } from "@heroui/react";
import {
	ArrowSquareOut,
	FilmSlate,
	MonitorPlay,
	Plus,
	Star,
	Trash,
	X,
} from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { allTags, binTree, mediaUses } from "../../../electron/core/bins";
import type { Asset, MediaInfo, ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { openSource } from "../../lib/source";
import { cn, formatTime } from "../../lib/utils";
import { Empty, Field, IconButton, Section, TextInput } from "../ui/controls";
import { addAtPlayhead, removeMedia, useThumb } from "./MediaPanel";

/**
 * The inspector for media picked in the Media panel: technical details,
 * where it sits in the edit, and its bin, tags, rating and note. Several
 * items at once get the organising tools only.
 */
export function AssetInspector({ ids, project }: { ids: string[]; project: ProjectSnapshot }) {
	const assets = project.data.assets.filter((a) => ids.includes(a.id));
	if (!assets.length)
		return <Empty icon={<FilmSlate className="size-5" />} title="That media is gone" />;
	if (assets.length === 1) return <OneAsset asset={assets[0]} project={project} />;
	return <ManyAssets assets={assets} project={project} />;
}

/** Where the file is on disk (paths are stored relative to the project when they can be). */
function absolutePath(project: ProjectSnapshot, stored: string): string {
	const joined = stored.startsWith("/") ? stored : `${project.dir}/${stored}`;
	const parts: string[] = [];
	for (const part of joined.split("/")) {
		if (part === "..") parts.pop();
		else if (part && part !== ".") parts.push(part);
	}
	return `/${parts.join("/")}`;
}

const bytes = (n: number) =>
	n >= 1e9
		? `${(n / 1e9).toFixed(2)} GB`
		: n >= 1e6
			? `${(n / 1e6).toFixed(1)} MB`
			: `${Math.max(1, Math.round(n / 1e3))} KB`;

const bitrate = (kbps: number) =>
	kbps >= 1000 ? `${(kbps / 1000).toFixed(1)} Mb/s` : `${kbps} kb/s`;

const CODECS: Record<string, string> = {
	h264: "H.264",
	hevc: "HEVC (H.265)",
	prores: "ProRes",
	av1: "AV1",
	vp9: "VP9",
	vp8: "VP8",
	mpeg4: "MPEG-4",
	aac: "AAC",
	mp3: "MP3",
	opus: "Opus",
	flac: "FLAC",
	alac: "Apple Lossless",
	pcm_s16le: "PCM 16-bit",
	pcm_s24le: "PCM 24-bit",
	pcm_f32le: "PCM 32-bit float",
	png: "PNG",
	mjpeg: "JPEG",
};
// ffmpeg's demuxer names, as people know the formats.
const FORMATS: Record<string, string> = {
	mov: "MP4 / QuickTime",
	matroska: "Matroska / WebM",
	wav: "WAV",
	mp3: "MP3",
	flac: "FLAC",
	ogg: "Ogg",
	aiff: "AIFF",
	avi: "AVI",
	png_pipe: "PNG",
	jpeg_pipe: "JPEG",
	webp_pipe: "WebP",
	gif: "GIF",
};
const codec = (name?: string) => (name ? (CODECS[name] ?? name.toUpperCase()) : undefined);

function channels(info: MediaInfo): string | undefined {
	const layout = info.channelLayout?.replace(/\(.*\)$/, "");
	if (layout === "mono") return "Mono";
	if (layout === "stereo") return "Stereo";
	if (layout) return `${layout} (${info.audioChannels ?? "?"} channels)`;
	return info.audioChannels ? `${info.audioChannels} channels` : undefined;
}

function detailRows(asset: Asset): [string, string][] {
	const info = asset.info;
	const rows: [string, string | undefined][] = [
		[
			"Kind",
			{
				video: "Video",
				audio: "Audio",
				image: "Image",
				adjustment: "Adjustment",
				lottie: "Motion graphic (Lottie)",
			}[asset.kind],
		],
		["Duration", asset.kind === "image" ? undefined : formatTime(asset.durationMs)],
		["Size", asset.width ? `${asset.width} × ${asset.height}` : undefined],
		[
			"Frame rate",
			info?.fps || asset.motion?.fps
				? `${Math.round((info?.fps ?? asset.motion?.fps ?? 0) * 100) / 100} fps`
				: undefined,
		],
		["Text layers", asset.motion?.texts.length ? String(asset.motion.texts.length) : undefined],
		["Colours", asset.motion?.colors.length ? String(asset.motion.colors.length) : undefined],
		[
			"Markers",
			asset.motion?.markers.length ? asset.motion.markers.map((m) => m.name).join(", ") : undefined,
		],
		["Fonts", asset.motion?.fonts.length ? asset.motion.fonts.join(", ") : undefined],
		[
			"Video",
			info?.videoCodec && asset.kind !== "audio"
				? [codec(info.videoCodec), info.videoProfile, info.pixelFormat].filter(Boolean).join(" · ")
				: undefined,
		],
		[
			"Audio",
			info?.audioCodec
				? [
						codec(info.audioCodec),
						channels(info),
						info.sampleRate ? `${info.sampleRate / 1000} kHz` : undefined,
					]
						.filter(Boolean)
						.join(" · ")
				: undefined,
		],
		["Bitrate", info?.bitrateKbps ? bitrate(info.bitrateKbps) : undefined],
		["Rotation", info?.rotation ? `${info.rotation}°` : undefined],
		["File size", asset.size !== undefined ? bytes(asset.size) : undefined],
		["Container", info?.format ? (FORMATS[info.format] ?? info.format) : undefined],
		["Recorded", info?.creationTime ? new Date(info.creationTime).toLocaleString() : undefined],
		["Added", asset.createdAt ? new Date(asset.createdAt).toLocaleString() : undefined],
		[
			"Origin",
			{
				import: "Imported",
				recording: "Recorded in Cue",
				tts: "AI voice",
				generated: "Generated",
			}[asset.origin],
		],
	];
	return rows.filter((r): r is [string, string] => !!r[1]);
}

function OneAsset({ asset, project }: { asset: Asset; project: ProjectSnapshot }) {
	const thumb = useThumb(asset, project);
	const uses = useMemo(() => mediaUses(project.data, asset.id), [project.data, asset.id]);
	const offline = project.offline.includes(asset.id);
	const file = asset.path ? absolutePath(project, asset.path) : null;
	const jump = async (use: (typeof uses)[number]) => {
		if (!use.open) await run("open_sequence", { id: use.sequenceId });
		playback.seek(use.startMs);
	};
	return (
		<>
			<Section>
				<div className="relative aspect-video overflow-hidden rounded-lg bg-default">
					{thumb ? (
						<img src={thumb} alt="" className="size-full object-contain" />
					) : (
						<div className="flex size-full items-center justify-center text-muted">
							<FilmSlate className="size-7" />
						</div>
					)}
				</div>
				<TextInput
					value={asset.name}
					onCommit={(name) => name.trim() && void run("rename_media", { id: asset.id, name })}
				/>
				<div className="flex gap-1">
					<Button
						size="sm"
						variant="secondary"
						className="flex-1 gap-1.5 text-[12px]"
						onPress={() => addAtPlayhead(project, asset)}
					>
						<Plus className="size-3.5" /> Add at playhead
					</Button>
					<IconButton label="Open in the source monitor" onPress={() => openSource(asset.id)}>
						<MonitorPlay className="size-4" />
					</IconButton>
					{file && (
						<IconButton label="Reveal in Finder" onPress={() => void window.cue.reveal(file)}>
							<ArrowSquareOut className="size-4" />
						</IconButton>
					)}
					<IconButton
						label="Remove from project"
						onPress={() => void removeMedia(project, [asset.id])}
					>
						<Trash className="size-4" />
					</IconButton>
				</div>
				{offline && (
					<p className="text-[12px] text-warning">
						Offline: the file isn't at {asset.path} any more.
					</p>
				)}
			</Section>
			<Organise assets={[asset]} project={project} />
			<Section title="Used in the edit">
				{uses.length === 0 ? (
					<p className="text-[12px] text-muted">Not used yet.</p>
				) : (
					<ul className="flex flex-col gap-0.5">
						{uses.map((use) => (
							<li key={`${use.sequenceId}-${use.clipId}`}>
								<button
									type="button"
									onClick={() => void jump(use)}
									title="Jump to this clip"
									className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[12px] hover:bg-default"
								>
									<span className="font-mono text-[11px] text-muted">{use.trackId}</span>
									<span className="flex-1 tabular-nums">
										{formatTime(use.startMs)} – {formatTime(use.startMs + use.durationMs)}
									</span>
									{!use.open && (
										<span className="truncate text-[11px] text-muted">{use.sequenceName}</span>
									)}
								</button>
							</li>
						))}
					</ul>
				)}
			</Section>
			<Section title="Media info">
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
					{detailRows(asset).map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="truncate text-right tabular-nums" title={v}>
								{v}
							</dd>
						</div>
					))}
				</dl>
				{!asset.info && asset.path && (
					<p className="text-[11px] text-muted">Reading codec details…</p>
				)}
				{file && (
					<p className="truncate text-[11px] text-muted" title={file}>
						{file}
					</p>
				)}
			</Section>
		</>
	);
}

function ManyAssets({ assets, project }: { assets: Asset[]; project: ProjectSnapshot }) {
	const total = assets.reduce((sum, a) => sum + a.durationMs, 0);
	return (
		<>
			<Section>
				<p className="text-[12px] text-muted">
					{assets.length} items · {formatTime(total, false)} in total. Changes here apply to all of
					them.
				</p>
				<Button
					size="sm"
					variant="danger-soft"
					className="gap-1.5 text-[12px]"
					onPress={() =>
						void removeMedia(
							project,
							assets.map((a) => a.id),
						)
					}
				>
					<Trash className="size-3.5" /> Remove {assets.length} items
				</Button>
			</Section>
			<Organise assets={assets} project={project} />
		</>
	);
}

/** Bin, rating, tags and note for one or several items. */
function Organise({ assets, project }: { assets: Asset[]; project: ProjectSnapshot }) {
	const assetIds = assets.map((a) => a.id);
	const bins = binTree(project.data.bins);
	const binIds = new Set(assets.map((a) => a.binId ?? ""));
	const ratings = new Set(assets.map((a) => a.rating ?? 0));
	const rating = ratings.size === 1 ? [...ratings][0] : null;
	const tags = allTags(assets);
	const known = allTags(project.data.assets).map((t) => t.tag);
	const [draft, setDraft] = useState("");
	const addTags = (text: string) => {
		const add = text
			.split(",")
			.map((t) => t.trim())
			.filter(Boolean);
		if (add.length) void run("tag_media", { assetIds, add });
		setDraft("");
	};
	const single = assets.length === 1 ? assets[0] : null;
	return (
		<Section title="Organise">
			<Field label="Bin">
				<select
					value={binIds.size === 1 ? [...binIds][0] : "mixed"}
					onChange={(e) => void run("move_media", { assetIds, binId: e.target.value || null })}
					className="h-7 w-full rounded-md border border-border bg-field px-1.5 text-[12px] text-foreground outline-none focus:border-accent"
				>
					{binIds.size > 1 && (
						<option value="mixed" disabled>
							Several bins
						</option>
					)}
					<option value="">No bin (top level)</option>
					{bins.map(({ bin, children }) => [
						<option key={bin.id} value={bin.id}>
							{bin.name}
						</option>,
						...children.map((c) => (
							<option key={c.id} value={c.id}>
								{"   "}
								{bin.name} › {c.name}
							</option>
						)),
					])}
				</select>
			</Field>
			<div className="flex items-center justify-between text-[12px]">
				<span className="text-muted">Rating</span>
				<div className="flex items-center gap-0.5">
					{[1, 2, 3, 4, 5].map((n) => (
						<button
							key={n}
							type="button"
							aria-pressed={rating === n}
							aria-label={`${n} star${n === 1 ? "" : "s"}${n === 5 ? " (favourite)" : ""}`}
							title={rating === n ? "Click again to clear" : undefined}
							onClick={() => void run("tag_media", { assetIds, rating: rating === n ? 0 : n })}
							className={cn(
								"p-0.5 transition-colors",
								rating !== null && n <= rating ? "text-warning" : "text-muted hover:text-warning",
							)}
						>
							<Star
								weight={rating !== null && n <= rating ? "fill" : "regular"}
								className="size-4"
							/>
						</button>
					))}
				</div>
			</div>
			<Field label="Tags">
				<div className="flex flex-wrap gap-1">
					{tags.map(({ tag, count }) => (
						<span
							key={tag}
							className="flex h-6 items-center gap-1 rounded-full bg-default pr-1 pl-2 text-[11px]"
						>
							{tag}
							{assets.length > 1 && count < assets.length && (
								<span className="text-muted">{count}</span>
							)}
							<button
								type="button"
								aria-label={`Remove tag ${tag}`}
								onClick={() => void run("tag_media", { assetIds, remove: [tag] })}
								className="rounded-full p-0.5 text-muted hover:text-foreground"
							>
								<X className="size-2.5" />
							</button>
						</span>
					))}
				</div>
				<input
					value={draft}
					list="cue-media-tags"
					placeholder="Add tags, separated by commas"
					onChange={(e) => setDraft(e.target.value)}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") addTags(draft);
						if (e.key === "Escape") setDraft("");
					}}
					onBlur={() => draft.trim() && addTags(draft)}
					className="h-7 w-full rounded-md border border-border bg-field px-2 text-[12px] text-foreground outline-none focus:border-accent"
				/>
				<datalist id="cue-media-tags">
					{known.map((t) => (
						<option key={t} value={t} />
					))}
				</datalist>
			</Field>
			{single && (
				<Field label="Note">
					<TextInput
						multiline
						rows={2}
						value={single.note ?? ""}
						placeholder="What's in it, what to use it for"
						onCommit={(note) => void run("tag_media", { assetIds, note })}
					/>
				</Field>
			)}
		</Section>
	);
}
