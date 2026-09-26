import { ArrowFatLinesDown, ArrowLineDown, Pause, Play, Waveform, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { ProjectSnapshot } from "../../../electron/core/types";
import {
	attachSource,
	closeSource,
	markSource,
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

export function SourceMonitor({ project }: { project: ProjectSnapshot }) {
	const { assetId, active, inMs, outMs, currentMs, playing } = source.use((s) => s);
	const asset = project.data.assets.find((a) => a.id === assetId);
	const url = asset ? project.assetUrls[asset.id] : "";
	const durationMs = asset?.durationMs ?? 0;

	useEffect(() => () => attachSource(null), []);

	if (!asset || !active) return null;
	const pct = (ms: number) => `${durationMs ? (ms / durationMs) * 100 : 0}%`;
	const onBar = (e: React.PointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		seekSource(((e.clientX - r.left) / r.width) * durationMs);
	};
	const span = (outMs ?? durationMs) - (inMs ?? 0);

	return (
		<div className="absolute inset-0 z-30 flex flex-col bg-viewer">
			<div className="relative flex min-h-0 flex-1 items-center justify-center p-4 pt-12">
				{asset.kind === "image" ? (
					<img src={url} alt="" className="max-h-full max-w-full object-contain" />
				) : (
					<>
						<video
							ref={attachSource}
							src={url}
							className={cn("max-h-full max-w-full", asset.kind === "audio" && "hidden")}
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
			<div className="flex flex-col gap-2 border-t border-separator bg-surface px-4 py-2.5">
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
						{(inMs !== null || outMs !== null) && (
							<div
								className="absolute top-1.5 h-2 rounded-sm bg-accent/50"
								style={{ left: pct(inMs ?? 0), width: pct((outMs ?? durationMs) - (inMs ?? 0)) }}
							/>
						)}
						<div
							className="absolute top-0 bottom-0 w-0.5 bg-danger"
							style={{ left: pct(currentMs) }}
						/>
					</div>
				)}
				<div className="grid grid-cols-[1fr_auto_1fr] items-center">
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
						<div className="mx-2 h-5 w-px bg-separator" />
						<Mark label="Insert at the playhead (,)" onPress={() => void sourceEdit("insert")}>
							<ArrowFatLinesDown className="size-4" />
						</Mark>
						<Mark
							label="Overwrite at the playhead (.)"
							onPress={() => void sourceEdit("overwrite")}
						>
							<ArrowLineDown className="size-4" />
						</Mark>
					</div>
					<span className="justify-self-end text-[11px] text-muted tabular">
						{inMs !== null || outMs !== null
							? `In ${formatTime(inMs ?? 0)} · Out ${formatTime(outMs ?? durationMs)} · ${formatTime(span)}`
							: "Mark in and out, then insert or overwrite"}
					</span>
				</div>
			</div>
		</div>
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
