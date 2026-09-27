import { Button } from "@heroui/react";
import {
	CaretRight,
	FilmSlate,
	FolderPlus,
	FolderSimple,
	Image as ImageIcon,
	LinkBreak,
	ListBullets,
	MagnifyingGlass,
	MusicNotes,
	PencilSimple,
	Plus,
	RecordIcon,
	Sparkle,
	SquaresFour,
	Star,
	Trash,
	UploadSimple,
	Waveform,
	X,
} from "@phosphor-icons/react";
import { type DragEvent, type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import {
	binTree,
	filterMedia,
	type MediaSort,
	sortMedia,
	usedAssetIds,
} from "../../../electron/core/bins";
import type { Asset, Bin, ProjectSnapshot } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { motionPoster } from "../../lib/motion";
import { playback } from "../../lib/playback";
import { openSource } from "../../lib/source";
import { createStore, editor, useProject } from "../../lib/state";
import { cn, formatTime, nameFieldKeys } from "../../lib/utils";
import { recordDialog } from "../RecordDialog";
import { locate } from "../RelinkMedia";
import { Empty, IconButton, Section, Segmented } from "../ui/controls";

type Kind = "all" | "video" | "audio" | "image" | "takes";

export const ASSET_MIME = "application/x-cue-asset";
/** Several media items at once (JSON ids), for dropping onto bins. */
const ASSETS_MIME = "application/x-cue-assets";

/** How the panel is browsing; kept while switching panels. */
export const mediaView = createStore({
	binId: null as string | null,
	query: "",
	kind: "all" as Kind,
	unused: false,
	rated: false,
	sort: "name" as MediaSort,
	view: "grid" as "grid" | "list",
});

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

export function addAtPlayhead(project: ProjectSnapshot, asset: Asset) {
	const trackId = trackFor(project, asset);
	if (!trackId) return;
	void run("add_clips", {
		clips: [{ type: "media", trackId, assetId: asset.id, startMs: Math.round(playback.currentMs) }],
	});
}

/** Removes media, asking first when clips use it (they go too). */
export async function removeMedia(project: ProjectSnapshot, ids: string[]) {
	const used = usedAssetIds(project.data);
	const inUse = ids.filter((id) => used.has(id)).length;
	if (
		inUse &&
		!window.confirm(
			`${inUse === 1 && ids.length === 1 ? "This item is" : `${inUse} of these items are`} used in the edit. Remove ${ids.length === 1 ? "it" : "them"} and the clips that use ${ids.length === 1 ? "it" : "them"}?`,
		)
	)
		return;
	await run("remove_media", ids.length === 1 ? { id: ids[0] } : { ids });
	editor.set((s) => ({ selectedAssetIds: s.selectedAssetIds.filter((id) => !ids.includes(id)) }));
}

/** A frame of a video (or the image itself) to show for a media item. */
export function useThumb(asset: Asset, project: ProjectSnapshot): string | null {
	const url = project.assetUrls[asset.id];
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
		// A new file (relinked, re-rendered) has new frames.
	}, [asset.id, asset.kind, asset.path]);
	// Motion graphics: a still drawn by the player.
	useEffect(() => {
		if (asset.kind !== "lottie" || !asset.motion || !url) return;
		let alive = true;
		void motionPoster(url, asset.motion)
			.then((poster) => alive && setThumb(poster))
			.catch(() => {});
		return () => {
			alive = false;
		};
	}, [asset.kind, asset.motion, url]);
	return thumb;
}

function draggedIds(e: DragEvent): string[] | null {
	const raw = e.dataTransfer.getData(ASSETS_MIME);
	if (raw) return JSON.parse(raw) as string[];
	const one = e.dataTransfer.getData(ASSET_MIME);
	return one ? [one] : null;
}

const carriesMedia = (e: DragEvent) =>
	e.dataTransfer.types.includes(ASSETS_MIME) || e.dataTransfer.types.includes(ASSET_MIME);

/** Props that make an element accept dragged media and file it in a bin (null: the top level). */
function useBinDrop(binId: string | null) {
	const [over, setOver] = useState(false);
	return {
		over,
		props: {
			onDragOver: (e: DragEvent) => {
				if (!carriesMedia(e)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				setOver(true);
			},
			onDragLeave: () => setOver(false),
			onDrop: (e: DragEvent) => {
				setOver(false);
				const ids = draggedIds(e);
				if (!ids?.length) return;
				e.preventDefault();
				void run("move_media", { assetIds: ids, binId });
			},
		},
	};
}

export function MediaPanel() {
	const project = useProject();
	const view = mediaView.use((s) => s);
	const selected = editor.use((s) => s.selectedAssetIds);
	const [renaming, setRenaming] = useState<string | null>(null);
	const anchor = useRef<string | null>(null);
	const data = project?.data;
	const bins = data?.bins ?? [];
	// A removed bin (undo, an agent) sends the panel back to the top level.
	const binId = view.binId && bins.some((b) => b.id === view.binId) ? view.binId : null;
	const current = bins.find((b) => b.id === binId);
	const parent = current?.parentId ? bins.find((b) => b.id === current.parentId) : undefined;
	// Searching and the Unused and Rated filters look through every bin.
	const everywhere = !!view.query.trim() || view.unused || view.rated;

	const used = useMemo(() => (data ? usedAssetIds(data) : new Set<string>()), [data]);
	const assets = useMemo(() => {
		if (!data) return [];
		const list = filterMedia(data, {
			binId: everywhere ? undefined : binId,
			kind: view.kind === "all" || view.kind === "takes" ? undefined : view.kind,
			unused: view.unused || undefined,
			minRating: view.rated ? 1 : undefined,
			query: view.query.trim() || undefined,
		}).filter((a) => (view.kind === "takes" ? !!a.lineId : !a.lineId));
		return sortMedia(list, view.sort);
	}, [data, binId, everywhere, view]);
	const folders = useMemo(() => {
		if (everywhere || current?.parentId) return [];
		if (!binId) return binTree(bins).map((n) => n.bin);
		return bins
			.filter((b) => b.parentId === binId)
			.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
	}, [bins, binId, current, everywhere]);

	if (!project || !data) return null;

	const select = (e: MouseEvent, id: string) => {
		e.stopPropagation();
		let next: string[];
		if (e.metaKey || e.ctrlKey)
			next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
		else if (e.shiftKey && anchor.current) {
			const order = assets.map((a) => a.id);
			const from = order.indexOf(anchor.current);
			const to = order.indexOf(id);
			const range = from < 0 ? [id] : order.slice(Math.min(from, to), Math.max(from, to) + 1);
			next = [...new Set([...selected, ...range])];
		} else next = [id];
		if (!e.shiftKey) anchor.current = id;
		editor.set({ selectedAssetIds: next });
		// The inspector shows media only while no clip is selected.
		if (next.length) window.cue.selectClips([]);
	};
	const dragStart = (e: DragEvent, id: string) => {
		const ids = selected.includes(id) ? selected : [id];
		e.dataTransfer.setData(ASSET_MIME, id);
		e.dataTransfer.setData(ASSETS_MIME, JSON.stringify(ids));
		e.dataTransfer.effectAllowed = "copyMove";
	};
	const newBin = async () => {
		// Sub-bins go one level deep, so inside a sub-bin the new one becomes its sibling.
		const parentId = current ? (current.parentId ?? current.id) : undefined;
		const taken = new Set(bins.filter((b) => b.parentId === parentId).map((b) => b.name));
		let name = "New bin";
		for (let n = 2; taken.has(name); n++) name = `New bin ${n}`;
		const result = await run<{ created?: string[] }>("create_bin", { name, parentId });
		const id = result?.created?.[0];
		if (id) setRenaming(id);
	};
	const open = (id: string | null) => {
		mediaView.set({ binId: id });
		editor.set({ selectedAssetIds: [] });
	};

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: clicking empty space clears the selection
		<div
			className="flex min-h-full flex-col"
			onClick={() => selected.length && editor.set({ selectedAssetIds: [] })}
			onKeyDown={(e) => {
				if (e.key === "Escape") editor.set({ selectedAssetIds: [] });
			}}
		>
			<Section>
				<div className="flex gap-1.5">
					<Button
						variant="secondary"
						className="flex-1 gap-2"
						onPress={() => void window.cue.importDialog()}
					>
						<UploadSimple className="size-4" /> Import media
					</Button>
					<IconButton label="New bin" variant="secondary" size="md" onPress={() => void newBin()}>
						<FolderPlus className="size-4" />
					</IconButton>
				</div>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-full gap-1.5 text-[12px]"
					onPress={() => recordDialog.set({ open: true })}
				>
					<RecordIcon weight="fill" className="size-3.5 text-danger" /> Record screen or camera…
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-full text-[12px]"
					onPress={() =>
						void run("add_adjustment_layer", { startMs: Math.round(playback.currentMs) })
					}
				>
					New adjustment layer at the playhead
				</Button>
				<Button
					variant="ghost"
					size="sm"
					className="h-7 w-full gap-1.5 text-[12px]"
					onPress={() => void addProject()}
				>
					<FilmSlate className="size-3.5" /> Add another project as media…
				</Button>
				<label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-field px-2 focus-within:border-accent">
					<MagnifyingGlass className="size-3.5 shrink-0 text-muted" />
					<input
						value={view.query}
						placeholder="Search names, tags, notes and speech"
						onChange={(e) => mediaView.set({ query: e.target.value })}
						onKeyDown={(e) => {
							e.stopPropagation();
							if (e.key === "Escape") mediaView.set({ query: "" });
						}}
						className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-muted"
					/>
					{view.query && (
						<button
							type="button"
							aria-label="Clear search"
							onClick={() => mediaView.set({ query: "" })}
							className="text-muted hover:text-foreground"
						>
							<X className="size-3" />
						</button>
					)}
				</label>
				<Segmented
					value={view.kind}
					onChange={(kind) => mediaView.set({ kind })}
					size="xs"
					options={[
						{ value: "all", label: "All" },
						{ value: "video", label: "Video" },
						{ value: "audio", label: "Audio" },
						{ value: "image", label: "Images" },
						{ value: "takes", label: "Takes" },
					]}
				/>
				<div className="flex items-center gap-1.5">
					<Chip active={view.unused} onClick={() => mediaView.set({ unused: !view.unused })}>
						Unused
					</Chip>
					<Chip active={view.rated} onClick={() => mediaView.set({ rated: !view.rated })}>
						<Star weight="fill" className="size-2.5" /> Rated
					</Chip>
					<select
						aria-label="Sort by"
						value={view.sort}
						onChange={(e) => mediaView.set({ sort: e.target.value as MediaSort })}
						className="ml-auto h-6 rounded-md border border-border bg-field px-1 text-[11px] text-foreground outline-none"
					>
						<option value="name">Name</option>
						<option value="added">Newest</option>
						<option value="duration">Longest</option>
						<option value="rating">Rating</option>
					</select>
					<IconButton
						label={view.view === "grid" ? "Show as list" : "Show as grid"}
						onPress={() => mediaView.set({ view: view.view === "grid" ? "list" : "grid" })}
					>
						{view.view === "grid" ? (
							<ListBullets className="size-3.5" />
						) : (
							<SquaresFour className="size-3.5" />
						)}
					</IconButton>
				</div>
			</Section>

			<nav className="flex min-h-8 flex-wrap items-center gap-0.5 px-3 pt-2 text-[12px]">
				{everywhere ? (
					<span className="px-1 text-muted">
						{assets.length} result{assets.length === 1 ? "" : "s"} in every bin
					</span>
				) : (
					<>
						<Crumb label="Media" binId={null} active={!current} onOpen={open} />
						{parent && (
							<>
								<CaretRight className="size-3 text-muted" />
								<Crumb label={parent.name} binId={parent.id} onOpen={open} />
							</>
						)}
						{current && (
							<>
								<CaretRight className="size-3 text-muted" />
								<Crumb label={current.name} binId={current.id} active onOpen={open} />
							</>
						)}
					</>
				)}
			</nav>

			{folders.length > 0 && (
				<div className="flex flex-col gap-0.5 px-3 pt-1">
					{folders.map((bin) => (
						<BinRow
							key={bin.id}
							bin={bin}
							count={data.assets.filter((a) => a.binId === bin.id).length}
							subBins={bins.filter((b) => b.parentId === bin.id).length}
							renaming={renaming === bin.id}
							onRename={(on) => setRenaming(on ? bin.id : null)}
							onOpen={() => open(bin.id)}
						/>
					))}
				</div>
			)}

			{selected.length > 1 && (
				<div className="mx-3 mt-2 flex items-center gap-1 rounded-md bg-accent/10 px-2 py-1 text-[12px]">
					<span className="flex-1 font-medium">{selected.length} selected</span>
					<IconButton
						label="Remove from project"
						onPress={() => void removeMedia(project, selected)}
					>
						<Trash className="size-3.5" />
					</IconButton>
					<IconButton label="Clear selection" onPress={() => editor.set({ selectedAssetIds: [] })}>
						<X className="size-3.5" />
					</IconButton>
				</div>
			)}

			{assets.length === 0 ? (
				data.assets.length === 0 ? (
					<Empty icon={<FilmSlate className="size-5" />} title="Nothing here yet">
						Import video, audio or images, or drop files from Finder onto the timeline.
					</Empty>
				) : (
					<Empty
						icon={<MagnifyingGlass className="size-5" />}
						title={
							everywhere ? "No matches" : folders.length ? "No media here" : "This bin is empty"
						}
					>
						{everywhere
							? "Try other words or turn a filter off."
							: "Drag media onto a bin to file it."}
					</Empty>
				)
			) : view.view === "grid" ? (
				<div className="grid grid-cols-2 gap-2.5 px-4 pt-2 pb-4">
					{assets.map((asset) => (
						<AssetCard
							key={asset.id}
							asset={asset}
							project={project}
							used={used.has(asset.id)}
							selected={selected.includes(asset.id)}
							onSelect={select}
							onDragStart={dragStart}
						/>
					))}
				</div>
			) : (
				<div className="flex flex-col px-3 pt-2 pb-4">
					{assets.map((asset) => (
						<AssetRow
							key={asset.id}
							asset={asset}
							project={project}
							used={used.has(asset.id)}
							selected={selected.includes(asset.id)}
							onSelect={select}
							onDragStart={dragStart}
						/>
					))}
				</div>
			)}
		</div>
	);
}

function Chip({
	active,
	onClick,
	children,
}: {
	active: boolean;
	onClick: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			aria-pressed={active}
			onClick={onClick}
			className={cn(
				"flex h-6 items-center gap-1 rounded-full border px-2 text-[11px] font-medium transition-colors",
				active
					? "border-accent/60 bg-accent/15 text-foreground"
					: "border-border text-muted hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function Crumb({
	label,
	binId,
	active,
	onOpen,
}: {
	label: string;
	binId: string | null;
	active?: boolean;
	onOpen: (id: string | null) => void;
}) {
	const drop = useBinDrop(binId);
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				onOpen(binId);
			}}
			{...drop.props}
			title={binId ? undefined : "Drop media here to take it out of its bin"}
			className={cn(
				"max-w-40 truncate rounded px-1 py-0.5",
				active ? "font-medium text-foreground" : "text-muted hover:text-foreground",
				drop.over && "bg-accent/20 text-foreground ring-1 ring-accent",
			)}
		>
			{label}
		</button>
	);
}

function BinRow({
	bin,
	count,
	subBins,
	renaming,
	onRename,
	onOpen,
}: {
	bin: Bin;
	count: number;
	subBins: number;
	renaming: boolean;
	onRename: (on: boolean) => void;
	onOpen: () => void;
}) {
	const drop = useBinDrop(bin.id);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a drop target that also opens on click
		<div
			{...drop.props}
			onClick={(e) => {
				e.stopPropagation();
				if (!renaming) onOpen();
			}}
			onKeyDown={(e) => e.key === "Enter" && !renaming && onOpen()}
			className={cn(
				"group flex h-8 cursor-pointer items-center gap-2 rounded-md px-2 text-[12px] hover:bg-default",
				drop.over && "bg-accent/20 ring-1 ring-accent",
			)}
		>
			<FolderSimple weight="fill" className="size-4 shrink-0 text-accent/80" />
			{renaming ? (
				<input
					// biome-ignore lint/a11y/noAutofocus: a new bin is named straight away
					autoFocus
					defaultValue={bin.name}
					onClick={(e) => e.stopPropagation()}
					onFocus={(e) => e.currentTarget.select()}
					onKeyDown={nameFieldKeys(bin.name)}
					onBlur={(e) => {
						const name = e.currentTarget.value.trim();
						if (name && name !== bin.name) void run("rename_bin", { id: bin.id, name });
						onRename(false);
					}}
					className="h-6 min-w-0 flex-1 rounded border border-accent bg-field px-1 outline-none"
				/>
			) : (
				<span className="min-w-0 flex-1 truncate">{bin.name}</span>
			)}
			<span className="text-[11px] text-muted tabular-nums">
				{subBins ? `${subBins} bin${subBins === 1 ? "" : "s"} · ` : ""}
				{count}
			</span>
			<div className="hidden gap-0.5 group-hover:flex">
				<IconButton label="Rename bin" onPress={() => onRename(true)}>
					<PencilSimple className="size-3" />
				</IconButton>
				<IconButton
					label="Delete bin (its media moves up a level)"
					onPress={() => void run("remove_bin", { id: bin.id })}
				>
					<Trash className="size-3" />
				</IconButton>
			</div>
		</div>
	);
}

interface ItemProps {
	asset: Asset;
	project: ProjectSnapshot;
	used: boolean;
	selected: boolean;
	onSelect: (e: MouseEvent, id: string) => void;
	onDragStart: (e: DragEvent, id: string) => void;
}

function KindIcon({ kind, className }: { kind: Asset["kind"]; className?: string }) {
	if (kind === "audio") return <Waveform className={className} />;
	if (kind === "image") return <ImageIcon className={className} />;
	if (kind === "lottie") return <Sparkle className={className} />;
	return <FilmSlate className={className} />;
}

function Stars({ rating }: { rating?: number }) {
	if (!rating) return null;
	return (
		<span className="flex shrink-0 items-center gap-0.5 text-[10px] text-warning tabular-nums">
			<Star weight="fill" className="size-2.5" />
			{rating}
		</span>
	);
}

function AssetCard({ asset, project, used, selected, onSelect, onDragStart }: ItemProps) {
	const offline = project.offline.includes(asset.id);
	const thumb = useThumb(asset, project);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: media cards are dragged and clicked
		<div
			draggable
			onDragStart={(e) => onDragStart(e, asset.id)}
			onClick={(e) => onSelect(e, asset.id)}
			onKeyDown={(e) => e.key === "Enter" && openSource(asset.id)}
			onDoubleClick={() => openSource(asset.id)}
			// Off-screen cards skip layout and paint, so long libraries stay quick.
			style={{ contentVisibility: "auto", containIntrinsicSize: "auto 120px" }}
			className={cn(
				"group relative flex cursor-grab flex-col overflow-hidden rounded-xl border bg-surface transition hover:shadow-sm active:cursor-grabbing",
				selected ? "border-accent ring-2 ring-accent/40" : "border-border hover:border-accent/50",
			)}
			title={asset.name}
		>
			<div className="relative aspect-video overflow-hidden bg-default">
				{thumb ? (
					<img
						src={thumb}
						alt=""
						draggable={false}
						loading="lazy"
						className="size-full object-cover"
					/>
				) : (
					<div className="flex size-full items-center justify-center text-muted">
						<KindIcon kind={asset.kind} className="size-7" />
					</div>
				)}
				<span className="absolute bottom-1 left-1 rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white tabular-nums">
					{asset.kind === "image" ? "Image" : formatTime(asset.durationMs, false)}
				</span>
				{offline && (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							void locate(asset);
						}}
						className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-background/80 text-[11px] font-medium text-warning"
						title={`Offline. Was at ${asset.path}`}
					>
						<LinkBreak className="size-4" /> Offline · Locate…
					</button>
				)}
				{asset.projectSource ? (
					<button
						type="button"
						onClick={(e) => {
							e.stopPropagation();
							void openSourceProject(asset);
						}}
						title={`A render of ${asset.projectSource.path}. It updates when that project changes. Click to open it.`}
						className="absolute top-1 left-1 flex items-center gap-1 rounded-md bg-sky-600/85 px-1.5 py-0.5 text-[10px] font-medium text-white hover:bg-sky-500"
					>
						<FilmSlate weight="fill" className="size-2.5" /> Project
					</button>
				) : null}
				{asset.origin === "generated" || asset.origin === "tts" ? (
					<span className="absolute top-1 left-1 flex items-center gap-1 rounded-md bg-violet-600/85 px-1.5 py-0.5 text-[10px] font-medium text-white">
						<Sparkle weight="fill" className="size-2.5" /> AI
					</span>
				) : null}
				<div className="absolute top-1 right-1 flex gap-0.5 opacity-0 transition group-hover:opacity-100">
					<IconButton
						label="Add at playhead"
						variant="secondary"
						onPress={() => addAtPlayhead(project, asset)}
					>
						<Plus className="size-3.5" />
					</IconButton>
					<IconButton
						label="Remove from project"
						variant="secondary"
						onPress={() => void removeMedia(project, [asset.id])}
					>
						<Trash className="size-3.5" />
					</IconButton>
				</div>
			</div>
			<div className="flex items-center gap-1.5 px-2 py-1.5">
				{asset.kind === "audio" ? <MusicNotes className="size-3 shrink-0 text-muted" /> : null}
				<p className={cn("min-w-0 flex-1 truncate text-[12px] font-medium", !used && "text-muted")}>
					{asset.name}
				</p>
				<Stars rating={asset.rating} />
			</div>
		</div>
	);
}

/** Pick a Cue project and place it in this one as media (rendered, and kept up to date). */
async function addProject() {
	const file = await window.cue.chooseFile({
		title: "Choose a project to place in this one",
		extensions: ["cueproj"],
	});
	if (!file) return;
	const asset = await run<{ name: string }>("add_project_media", { path: file });
	if (asset) notify(`Added "${asset.name}". It updates when that project changes.`, "success");
}

/** Opens the project a project-media item is rendered from (this project is saved first). */
async function openSourceProject(asset: Asset) {
	if (!asset.projectSource) return;
	await run("open_project", { path: asset.projectSource.path });
}

function AssetRow({ asset, project, used, selected, onSelect, onDragStart }: ItemProps) {
	const offline = project.offline.includes(asset.id);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: media rows are dragged and clicked
		<div
			draggable
			onDragStart={(e) => onDragStart(e, asset.id)}
			onClick={(e) => onSelect(e, asset.id)}
			onKeyDown={(e) => e.key === "Enter" && openSource(asset.id)}
			onDoubleClick={() => openSource(asset.id)}
			title={asset.name}
			className={cn(
				"group flex h-7 shrink-0 cursor-grab items-center gap-2 rounded-md px-2 text-[12px] active:cursor-grabbing",
				selected ? "bg-accent/20" : "hover:bg-default",
			)}
		>
			<KindIcon kind={asset.kind} className="size-3.5 shrink-0 text-muted" />
			<span className={cn("min-w-0 flex-1 truncate", !used && "text-muted")}>{asset.name}</span>
			{offline && <LinkBreak className="size-3 shrink-0 text-warning" />}
			{asset.tags?.length ? (
				<span className="max-w-20 truncate text-[10px] text-muted">{asset.tags.join(", ")}</span>
			) : null}
			<Stars rating={asset.rating} />
			<span className="w-10 shrink-0 text-right text-[11px] text-muted tabular-nums">
				{asset.kind === "image" ? "" : formatTime(asset.durationMs, false)}
			</span>
		</div>
	);
}
