import { Button } from "@heroui/react";
import {
	FilmSlate,
	Image as ImageIcon,
	LinkBreak,
	MusicNotes,
	Plus,
	Sparkle,
	Trash,
	UploadSimple,
	Waveform,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Asset, ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { openSource } from "../../lib/source";
import { locate } from "../RelinkMedia";
import { playback } from "../../lib/playback";
import { useProject } from "../../lib/state";
import { cn, formatTime } from "../../lib/utils";
import { Empty, IconButton, Section, Segmented } from "../ui/controls";

type Filter = "all" | "video" | "audio" | "image" | "takes";

export const ASSET_MIME = "application/x-cue-asset";

/** Picks a track that can hold the asset (first matching, voiceover-aware for takes). */
export function trackFor(project: ProjectSnapshot, asset: Asset): string | undefined {
	const tracks = project.data.tracks.filter((t) => !t.locked);
	if (asset.kind === "audio")
		return (
			tracks.find((t) => t.kind === "audio" && (asset.lineId ? t.voiceover : !t.voiceover)) ??
			tracks.find((t) => t.kind === "audio")
		)?.id;
	return tracks.find((t) => t.kind === "video")?.id;
}

export function MediaPanel() {
	const project = useProject();
	const [filter, setFilter] = useState<Filter>("all");
	if (!project) return null;
	const assets = project.data.assets.filter((a) =>
		filter === "all" ? !a.lineId : filter === "takes" ? !!a.lineId : a.kind === filter && !a.lineId,
	);

	return (
		<div className="flex flex-col">
			<Section>
				<Button
					variant="secondary"
					className="w-full gap-2"
					onPress={() => void window.cue.importDialog()}
				>
					<UploadSimple className="size-4" /> Import media
				</Button>
				<Segmented
					value={filter}
					onChange={setFilter}
					size="xs"
					options={[
						{ value: "all", label: "All" },
						{ value: "video", label: "Video" },
						{ value: "audio", label: "Audio" },
						{ value: "image", label: "Images" },
						{ value: "takes", label: "Takes" },
					]}
				/>
			</Section>
			{assets.length === 0 ? (
				<Empty icon={<FilmSlate className="size-5" />} title="Nothing here yet">
					Import video, audio or images, or drop files from Finder onto the timeline.
				</Empty>
			) : (
				<div className="grid grid-cols-2 gap-2.5 px-4 pb-4">
					{assets.map((asset) => (
						<AssetCard key={asset.id} asset={asset} project={project} />
					))}
				</div>
			)}
		</div>
	);
}

function AssetCard({ asset, project }: { asset: Asset; project: ProjectSnapshot }) {
	const url = project.assetUrls[asset.id];
	const used = project.data.clips.some((c) => c.type === "media" && c.assetId === asset.id);
	const offline = project.offline.includes(asset.id);
	const [thumb, setThumb] = useState<string | null>(asset.kind === "image" ? url : null);
	useEffect(() => {
		if (asset.kind !== "video") return;
		let alive = true;
		void window.cue
			.thumbnails(asset.id)
			.then((t) => alive && setThumb(t.urls[Math.min(1, t.urls.length - 1)] ?? null))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [asset.id, asset.kind]);

	const addAtPlayhead = () => {
		const trackId = trackFor(project, asset);
		if (!trackId) return;
		void run("add_clips", {
			clips: [
				{ type: "media", trackId, assetId: asset.id, startMs: Math.round(playback.currentMs) },
			],
		});
	};

	return (
		<div
			draggable
			onDragStart={(e) => {
				e.dataTransfer.setData(ASSET_MIME, asset.id);
				e.dataTransfer.effectAllowed = "copy";
			}}
			onDoubleClick={() => openSource(asset.id)}
			className="group relative flex cursor-grab flex-col overflow-hidden rounded-xl border border-border bg-surface transition hover:border-accent/50 hover:shadow-sm active:cursor-grabbing"
			title={asset.name}
		>
			<div className="relative aspect-video overflow-hidden bg-default">
				{thumb ? (
					<img src={thumb} alt="" draggable={false} className="size-full object-cover" />
				) : (
					<div className="flex size-full items-center justify-center text-muted">
						{asset.kind === "audio" ? (
							<Waveform className="size-7" />
						) : asset.kind === "image" ? (
							<ImageIcon className="size-7" />
						) : (
							<FilmSlate className="size-7" />
						)}
					</div>
				)}
				<span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
					{asset.kind === "image" ? "Image" : formatTime(asset.durationMs, false)}
				</span>
				{offline && (
					<button
						type="button"
						onClick={() => void locate(asset)}
						className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 text-[11px] font-medium text-warning"
						title={`Offline. Was at ${asset.path}`}
					>
						<LinkBreak className="size-4" /> Offline · Locate…
					</button>
				)}
				{asset.origin === "generated" || asset.origin === "tts" ? (
					<span className="absolute top-1 left-1 flex items-center gap-1 rounded-md bg-violet-600/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
						<Sparkle weight="fill" className="size-2.5" /> AI
					</span>
				) : null}
				<div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
					<IconButton label="Add at playhead" variant="secondary" onPress={addAtPlayhead}>
						<Plus className="size-3.5" />
					</IconButton>
					<IconButton
						label="Remove from project"
						variant="secondary"
						onPress={() => void run("remove_media", { id: asset.id })}
					>
						<Trash className="size-3.5" />
					</IconButton>
				</div>
			</div>
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				{asset.kind === "audio" ? <MusicNotes className="size-3 shrink-0 text-muted" /> : null}
				<p className={cn("truncate text-[12px] font-medium", !used && "text-muted")}>
					{asset.name}
				</p>
			</div>
		</div>
	);
}
