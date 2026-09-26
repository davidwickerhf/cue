import {
	ArrowFatLinesDown,
	ArrowLineDown,
	FilmSlate,
	Pause,
	Play,
	Waveform,
	X,
} from "@phosphor-icons/react";
import { useEffect } from "react";
import type { Asset, ProjectSnapshot } from "../../../electron/core/types";
import {
	attachSource,
	closeSource,
	markSource,
	SOURCE_MIME,
	seekSource,
	showTimeline,
	source,
	sourceEdit,
	toggleSource,
} from "../../lib/source";
import { cn, formatTime } from "../../lib/utils";

/** Tabs over the viewer: the timeline, or the clip open in the source monitor. */
export function ViewerTabs({ project }: { project: ProjectSnapshot }) {
	const { assetId, active } = source.use((s) => s);
	const asset = project.data.assets.find((a) => a.id === assetId);
	if (!asset) return null;
	const tab = "flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12px]";
	return (
		<div className="absolute top-2 left-1/2 z-40 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-border bg-surface/95 p-0.5 shadow-lg shadow-black/30">
			<button
				type="button"
				onClick={showTimeline}
				className={cn(
					tab,
					!active ? "bg-default text-foreground" : "text-muted hover:text-foreground",
				)}
			>
				Timeline
			</button>
			<span className={cn(tab, "pr-1", active ? "bg-default text-foreground" : "text-muted")}>
				<button
					type="button"
					onClick={() => source.set({ active: true })}
					className="max-w-[220px] truncate"
				>
					Source · {asset.name}
				</button>
				<button
					type="button"
					aria-label="Close source"
					onClick={closeSource}
					className="flex size-5 items-center justify-center rounded hover:bg-background/60"
				>
					<X className="size-3" />
				</button>
			</span>
		</div>
	);
}

/** The source monitor over the viewer (single-viewer layout), while its tab is chosen. */
export function SourceMonitor({ project }: { project: ProjectSnapshot }) {
	const { assetId, active } = source.use((s) => s);
	const asset = project.data.assets.find((a) => a.id === assetId);
	useEffect(() => () => attachSource(null), []);
	if (!asset || !active) return null;
	return (
		<div className="absolute inset-0 z-30 flex flex-col bg-viewer">
			<SourceBody project={project} asset={asset} className="pt-12" />
		</div>
	);
}

/**
 * The source monitor beside the viewer (two-up, as in Premiere and Resolve):
 * always there, empty until a clip is opened. Clicking it gives it the
 * transport keys; clicking the viewer gives them back to the timeline.
 */
export function SourcePane({ project }: { project: ProjectSnapshot }) {
	const { assetId, active } = source.use((s) => s);
	const asset = project.data.assets.find((a) => a.id === assetId);
	useEffect(() => () => attachSource(null), []);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: focus follows the click, as between Premiere's monitors
		<div
			className="relative flex min-w-0 flex-1 flex-col border-r border-separator bg-viewer"
			onPointerDownCapture={() => asset && !active && source.set({ active: true })}
		>
			<MonitorHeader label="Source" active={active && !!asset}>
				{asset && (
					<>
						<span className="min-w-0 truncate text-foreground/80">{asset.name}</span>
						<button
							type="button"
							aria-label="Close source"
							title="Close source"
							onClick={closeSource}
							className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
						>
							<X className="size-3.5" />
						</button>
					</>
				)}
			</MonitorHeader>
			{asset ? (
				<SourceBody project={project} asset={asset} />
			) : (
				<div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
					<FilmSlate className="size-8 text-white/25" />
					<p className="text-[13px] font-medium text-white/70">No source clip</p>
					<p className="max-w-60 text-[12px] text-white/45">
						Double-click a clip in Media to open it here, mark in and out, then insert or overwrite
						it on the timeline or drag it there.
					</p>
				</div>
			)}
		</div>
	);
}

/** The strip over each monitor in two-up: its name, lit while it has the transport keys. */
export function MonitorHeader({
	label,
	active,
	children,
}: {
	label: string;
	active: boolean;
	children?: React.ReactNode;
}) {
	return (
		<div className="flex h-8 shrink-0 items-center gap-2 border-b border-separator bg-surface px-3 text-[12px]">
			<span
				className={cn("size-1.5 shrink-0 rounded-full", active ? "bg-accent" : "bg-white/20")}
			/>
			<span className={cn("font-semibold", active ? "text-foreground" : "text-muted")}>
				{label}
			</span>
			{children}
		</div>
	);
}

function SourceBody({
	project,
	asset,
	className,
}: {
	project: ProjectSnapshot;
	asset: Asset;
	className?: string;
}) {
	const { inMs, outMs, currentMs, playing } = source.use((s) => s);
	const url = project.assetUrls[asset.id] ?? "";
	const durationMs = asset.durationMs ?? 0;
	const pct = (ms: number) => `${durationMs ? (ms / durationMs) * 100 : 0}%`;
	const onBar = (e: React.PointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		seekSource(((e.clientX - r.left) / r.width) * durationMs);
	};
	const span = (outMs ?? durationMs) - (inMs ?? 0);
	const marked = inMs !== null || outMs !== null;

	return (
		<>
			{/* biome-ignore lint/a11y/noStaticElementInteractions: dragging the picture places the marked range on the timeline */}
			<div
				draggable
				onDragStart={(e) => {
					e.dataTransfer.setData(SOURCE_MIME, JSON.stringify({ assetId: asset.id, inMs, outMs }));
					e.dataTransfer.effectAllowed = "copy";
				}}
				title="Drag onto the timeline to place the marked part"
				className={cn(
					"relative flex min-h-0 flex-1 cursor-grab items-center justify-center p-4 active:cursor-grabbing",
					className,
				)}
			>
				{asset.kind === "image" ? (
					<img
						src={url}
						alt=""
						draggable={false}
						className="max-h-full max-w-full object-contain"
					/>
				) : (
					<>
						<video
							ref={attachSource}
							src={url}
							className={cn(
								"pointer-events-none max-h-full max-w-full",
								asset.kind === "audio" && "hidden",
							)}
							// Coming back to the source monitor continues where it was.
							onLoadedMetadata={(e) => {
								e.currentTarget.currentTime = source.get().currentMs / 1000;
							}}
							onTimeUpdate={(e) => source.set({ currentMs: e.currentTarget.currentTime * 1000 })}
							onPlay={() => source.set({ playing: true })}
							onPause={() => source.set({ playing: false })}
						/>
						{asset.kind === "audio" && <Waveform className="size-16 text-muted" />}
					</>
				)}
			</div>
			<div className="flex flex-col gap-2 border-t border-separator bg-surface px-3 py-2">
				{asset.kind !== "image" && (
					// biome-ignore lint/a11y/noStaticElementInteractions: a scrub bar, like the timeline ruler
					<div
						className="relative h-5 cursor-pointer"
						onPointerDown={(e) => {
							e.currentTarget.setPointerCapture(e.pointerId);
							onBar(e);
						}}
						onPointerMove={(e) => e.buttons && onBar(e)}
					>
						<div className="absolute inset-x-0 top-2 h-1 rounded-full bg-default" />
						{marked && (
							<div
								className="absolute top-1.5 h-2 rounded-sm bg-accent/50"
								style={{ left: pct(inMs ?? 0), width: pct(span) }}
							/>
						)}
						{/* The in and out marks as brackets on the bar. */}
						{inMs !== null && (
							<div
								className="absolute top-0.5 h-4 w-1 rounded-l-sm border-y-2 border-l-2 border-accent"
								style={{ left: pct(inMs) }}
							/>
						)}
						{outMs !== null && (
							<div
								className="absolute top-0.5 h-4 w-1 -translate-x-full rounded-r-sm border-y-2 border-r-2 border-accent"
								style={{ left: pct(outMs) }}
							/>
						)}
						<div
							className="absolute top-0 bottom-0 w-0.5 bg-danger"
							style={{ left: pct(currentMs) }}
						/>
					</div>
				)}
				<div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
					<span className="font-mono text-[12px] tabular text-foreground">
						{formatTime(currentMs)}
					</span>
					<div className="flex items-center gap-1">
						<Mark label="Mark in (I)" onPress={() => markSource("in")}>
							{"{"}
						</Mark>
						{asset.kind !== "image" && (
							<button
								type="button"
								aria-label={playing ? "Pause" : "Play"}
								onClick={toggleSource}
								className="flex size-9 items-center justify-center rounded-md hover:bg-default"
							>
								{playing ? (
									<Pause weight="fill" className="size-5" />
								) : (
									<Play weight="fill" className="size-5" />
								)}
							</button>
						)}
						<Mark label="Mark out (O)" onPress={() => markSource("out")}>
							{"}"}
						</Mark>
						<div className="mx-1.5 h-5 w-px bg-separator" />
						<EditButton
							label="Insert"
							keys=","
							title="Insert at the playhead: later clips move along (,)"
							onPress={() => void sourceEdit("insert")}
						>
							<ArrowFatLinesDown className="size-3.5" />
						</EditButton>
						<EditButton
							label="Overwrite"
							keys="."
							title="Overwrite at the playhead: replaces what is there (.)"
							onPress={() => void sourceEdit("overwrite")}
						>
							<ArrowLineDown className="size-3.5" />
						</EditButton>
					</div>
					<span className="text-[11px] text-muted tabular">
						{marked
							? `In ${formatTime(inMs ?? 0)} · Out ${formatTime(outMs ?? durationMs)} · ${formatTime(span)}`
							: "Mark in and out, then insert, overwrite or drag"}
					</span>
				</div>
			</div>
		</>
	);
}

function EditButton({
	label,
	keys,
	title,
	onPress,
	children,
}: {
	label: string;
	keys: string;
	title: string;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={title}
			onClick={onPress}
			className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-foreground/85 hover:bg-default hover:text-foreground"
		>
			{children}
			{label}
			<kbd className="font-mono text-[11px] text-muted">{keys}</kbd>
		</button>
	);
}

function Mark({
	label,
	onPress,
	children,
}: {
	label: string;
	onPress: () => void;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			onClick={onPress}
			className="flex size-8 items-center justify-center rounded-md font-mono text-[14px] font-bold text-foreground/80 hover:bg-default hover:text-foreground"
		>
			{children}
		</button>
	);
}
