import { CaretLeft, CaretRight, Pause, Play, SkipBack } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { valueAt } from "../../../electron/core/anim";
import type { Clip, ProjectSnapshot, TextClip } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { keyLabel } from "../../lib/platform";
import { playback } from "../../lib/playback";
import { recorder } from "../../lib/recorder";
import { showTimeline, source } from "../../lib/source";
import { createStore, useApp, useProject } from "../../lib/state";
import { cn, formatSeconds } from "../../lib/utils";
import { compareView, layout } from "../../lib/workspace";
import { ClipStrip } from "./ClipStrip";
import { MonitorHeader, SourceMonitor, SourcePane, ViewerTabs } from "./SourceMonitor";

/** How far the viewer is zoomed in: a multiple of the size that fits (1 = Fit). */
export const viewerZoom = createStore({ scale: 1 });

const MIN_ZOOM = 0.25;
const MAX_ZOOM = 8;

/** Zoom presets as shares of the canvas's real pixels (100% = one canvas pixel per screen pixel). */
const ZOOM_PRESETS = [0.25, 0.5, 1, 2, 4];

export function PreviewPanel() {
	const safeAreas = layout.use((s) => s.overlays.safeAreas);
	const prompter = layout.use((s) => s.overlays.teleprompter);
	const compare = layout.use((s) => s.overlays.compare);
	const twoUp = layout.use((s) => s.overlays.sourceTwoUp);
	const strip = layout.use((s) => s.overlays.clipStrip);
	const sourceActive = source.use((s) => s.active);
	const sourceOpen = source.use((s) => !!s.assetId);
	const project = useProject();
	const area = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const textCanvas = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
	const scroller = useRef<HTMLDivElement>(null);
	const zoom = viewerZoom.use((z) => z.scale);
	// A point of the picture (as shares) to keep under the pointer while zooming.
	const anchor = useRef<{ u: number; v: number; x: number; y: number } | null>(null);
	const canvas = project?.data.canvas;
	const aspect = canvas ? canvas.width / canvas.height : 16 / 9;

	useLayoutEffect(() => {
		const el = area.current;
		if (!el) return;
		const observer = new ResizeObserver(() => {
			const aw = el.clientWidth - 48;
			const ah = el.clientHeight - 32;
			const w = Math.max(100, Math.min(aw, ah * aspect));
			setSize({ w, h: w / aspect });
		});
		observer.observe(el);
		return () => observer.disconnect();
	}, [aspect]);

	useEffect(() => {
		if (stage.current && textCanvas.current) playback.attach(stage.current, textCanvas.current);
		return () => playback.detach();
	}, []);

	const stageW = size.w * zoom;
	const stageH = size.h * zoom;

	// biome-ignore lint/correctness/useExhaustiveDependencies: the stage's size is what changed
	useEffect(() => {
		// Re-lay out pictures and text when the viewer is resized or zoomed.
		playback.refresh();
	}, [stageW, stageH]);

	// Pinch or ⌘/Ctrl-scroll zooms around the pointer; plain scrolling pans.
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.ctrlKey && !e.metaKey) return;
			e.preventDefault();
			const frame = stage.current?.getBoundingClientRect();
			if (!frame) return;
			const current = viewerZoom.get().scale;
						// Pinches send small steps, mouse wheels big ones: at most a quarter per event.
			const step = Math.max(-0.22, Math.min(0.22, -e.deltaY * 0.006));
			const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, current * Math.exp(step)));
			if (next === current) return;
			anchor.current = {
				u: (e.clientX - frame.left) / frame.width,
				v: (e.clientY - frame.top) / frame.height,
				x: e.clientX,
				y: e.clientY,
			};
			viewerZoom.set({ scale: next });
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// After a zoom, scroll so the anchored point is back where it was (or keep the middle).
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs on each zoom change
	useLayoutEffect(() => {
		const el = scroller.current;
		const frame = stage.current?.getBoundingClientRect();
		if (!el || !frame) return;
		const box = el.getBoundingClientRect();
		const a = anchor.current ?? {
			u: 0.5,
			v: 0.5,
			x: box.left + box.width / 2,
			y: box.top + box.height / 2,
		};
		anchor.current = null;
		el.scrollLeft += frame.left + a.u * frame.width - a.x;
		el.scrollTop += frame.top + a.v * frame.height - a.y;
	}, [zoom]);

	// Zoomed in, proxies look soft: play the originals.
	useEffect(() => playback.setFullQuality(zoom > 1.2), [zoom]);

	// Shift+Z: back to Fit.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			const t = e.target as HTMLElement | null;
			if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
			if (e.code === "KeyZ" && e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
				e.preventDefault();
				viewerZoom.set({ scale: 1 });
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Middle-button drag pans a zoomed viewer.
	const pan = (e: React.PointerEvent<HTMLDivElement>) => {
		if (e.button !== 1) return;
		e.preventDefault();
		const el = e.currentTarget;
		const start = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
		const move = (m: PointerEvent) => {
			el.scrollLeft = start.left - (m.clientX - start.x);
			el.scrollTop = start.top - (m.clientY - start.y);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const program = (
		<>
			<div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center">
				{/* biome-ignore lint/a11y/noStaticElementInteractions: middle-button panning of the zoomed viewer */}
				<div
					ref={scroller}
					onPointerDown={pan}
					className={cn("absolute inset-0 flex", zoom > 1 ? "overflow-auto" : "overflow-hidden")}
				>
					<div className="m-auto shrink-0 px-6 py-4">
						<div
							data-stage-frame
							ref={stage}
							className="relative overflow-hidden"
							style={{
								width: stageW,
								height: stageH,
								background: canvas?.background ?? "#000",
								boxShadow: "0 0 0 1px rgb(255 255 255 / 0.06)",
							}}
						>
							<canvas
								ref={textCanvas}
								className="pointer-events-none absolute inset-0 z-10 size-full"
							/>
							{project && <SelectionOverlay project={project} width={stageW} height={stageH} />}
							{safeAreas && <SafeAreas />}
							{compare && project && <SplitDivider />}
						</div>
					</div>
				</div>
				{project && project.data.clips.length === 0 && <EmptyProject project={project} />}
				<Teleprompter />
				{prompter && project && <ScriptPrompter />}
				{compare && project && <CompareControls />}
			</div>
			{strip && project && <ClipStrip project={project} />}
			{project && <Transport project={project} />}
		</>
	);

	// Two-up: the source monitor on the left, the timeline's viewer on the right, each with
	// its own transport. The viewer's elements keep their place either way, so playback stays attached.
	const two = twoUp && !!project;
	return (
		<section className="relative flex min-w-0 flex-1 bg-viewer">
			{two && project && <SourcePane project={project} />}
			{/* biome-ignore lint/a11y/noStaticElementInteractions: focus follows the click, as between Premiere's monitors */}
			<div
				className="relative flex min-w-0 flex-1 flex-col"
				onPointerDownCapture={() => two && sourceActive && showTimeline()}
			>
				{two && project && (
					<MonitorHeader label="Timeline" active={!sourceActive || !sourceOpen}>
						<span className="min-w-0 truncate text-foreground/80">
							{project.data.sequence?.name ?? ""}
						</span>
					</MonitorHeader>
				)}
				{!two && project && <ViewerTabs project={project} />}
				{!two && project && <SourceMonitor project={project} />}
				{program}
			</div>
		</section>
	);
}

function Transport({ project }: { project: ProjectSnapshot }) {
	const playing = playback.clock.use((s) => s.playing);
	const tenth = playback.clock.use((s) =>
		Math.floor(s.currentMs / (1000 / project.data.canvas.fps)),
	);
	const phase = recorder.status.use((s) => s.phase);
	const selectedLine = useApp((s) => s.selectedLineId);
	const line = project.lines.find((l) => l.id === selectedLine) ?? project.lines[0];
	const frame = 1000 / project.data.canvas.fps;
	const recording = phase !== "idle";
	const btn =
		"flex size-8 items-center justify-center rounded-md text-foreground/80 hover:bg-default hover:text-foreground";
	return (
		<div className="grid h-11 shrink-0 grid-cols-[1fr_auto_1fr] items-center border-t border-separator bg-surface px-3">
			<span className="font-mono text-[13px] tabular text-foreground">
				{timecode(tenth * frame, project.data.canvas.fps)}
			</span>
			<div className="flex items-center gap-0.5">
				<button
					type="button"
					className={btn}
					aria-label="Go to start"
					title="Go to start (Home)"
					onClick={() => playback.seek(0)}
				>
					<SkipBack weight="fill" className="size-3.5" />
				</button>
				<button
					type="button"
					className={btn}
					aria-label="Previous frame"
					title="Previous frame (←)"
					onClick={() => playback.seek(playback.currentMs - frame)}
				>
					<CaretLeft weight="bold" className="size-3.5" />
				</button>
				<button
					type="button"
					className={cn(btn, "size-9")}
					aria-label={playing ? "Pause" : "Play"}
					title="Play / pause (Space)"
					onClick={() => playback.toggle()}
				>
					{playing ? (
						<Pause weight="fill" className="size-5" />
					) : (
						<Play weight="fill" className="size-5" />
					)}
				</button>
				<button
					type="button"
					className={btn}
					aria-label="Next frame"
					title="Next frame (→)"
					onClick={() => playback.seek(playback.currentMs + frame)}
				>
					<CaretRight weight="bold" className="size-3.5" />
				</button>
				<button
					type="button"
					className={cn(btn, "ml-2")}
					disabled={!line && !recording}
					aria-label={recording ? "Stop recording" : "Record the selected line"}
					title={recording ? "Stop (Space)" : line ? `Record ${line.id} (R)` : "Record"}
					onClick={() =>
						recording ? void recorder.stop() : line && void recorder.record(project, line)
					}
				>
					<span
						className={cn(
							"block rounded-full bg-danger",
							recording ? "rec-pulse size-3 rounded-[2px]" : "size-3",
						)}
					/>
				</button>
			</div>
			<div className="flex items-center gap-3 justify-self-end">
				<ZoomMenu canvasWidth={project.data.canvas.width} />
				<Meters />
				<span className="font-mono text-[12px] tabular text-muted">
					{timecode(project.durationMs, project.data.canvas.fps)}
				</span>
			</div>
		</div>
	);
}

/** The viewer's zoom: Fit, or a share of the canvas's real pixels. */
function ZoomMenu({ canvasWidth }: { canvasWidth: number }) {
	const scale = viewerZoom.use((z) => z.scale);
	// Screen pixels per canvas pixel when fitted (from the stage's current width).
	const fitted = () => {
		const frame = document.querySelector("[data-stage-frame]")?.getBoundingClientRect();
		const width = frame ? frame.width / viewerZoom.get().scale : canvasWidth;
		return (width * window.devicePixelRatio) / canvasWidth;
	};
	const percent = Math.round(fitted() * scale * 100);
	return (
		<select
			aria-label="Viewer zoom"
			title="Viewer zoom: pinch or ⌘-scroll to zoom, scroll or middle-drag to pan, Shift+Z to fit"
			value={scale === 1 ? "fit" : "custom"}
			onChange={(e) => {
				const v = e.target.value;
				if (v === "fit") viewerZoom.set({ scale: 1 });
				else if (v !== "custom")
					viewerZoom.set({
						scale: Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(v) / fitted())),
					});
			}}
			className="h-6 rounded-md border border-border bg-default px-1 font-mono text-[11px] text-muted"
		>
			<option value="fit">Fit</option>
			{scale !== 1 && <option value="custom">{percent}%</option>}
			{ZOOM_PRESETS.map((p) => (
				<option key={p} value={p}>
					{Math.round(p * 100)}%
				</option>
			))}
		</select>
	);
}

/** Stereo peak meters, drawn in dBFS from -48 to 0. */
function Meters() {
	const left = playback.meter.use((s) => Math.round(level(s.left) * 60));
	const right = playback.meter.use((s) => Math.round(level(s.right) * 60));
	return (
		<div className="flex w-16 flex-col gap-[3px]" title="Output level">
			{[left, right].map((v, i) => (
				<div key={i} className="h-[3px] overflow-hidden rounded-full bg-default">
					<div
						className={cn(
							"h-full rounded-full",
							v > 57 ? "bg-danger" : v > 48 ? "bg-warning" : "bg-success",
						)}
						style={{ width: `${(v / 60) * 100}%` }}
					/>
				</div>
			))}
		</div>
	);
}

function level(peak: number) {
	if (peak <= 0) return 0;
	const db = 20 * Math.log10(peak);
	return Math.max(0, Math.min(1, (db + 48) / 48));
}

/** HH:MM:SS:FF */
function timecode(ms: number, fps: number) {
	const total = Math.max(0, ms) / 1000;
	const h = Math.floor(total / 3600);
	const m = Math.floor((total % 3600) / 60);
	const sec = Math.floor(total % 60);
	const f = Math.floor((total % 1) * fps);
	return [h, m, sec, f].map((n) => String(n).padStart(2, "0")).join(":");
}

/** Drag the selected text or visual clip around the frame. */
function SelectionOverlay({
	project,
	width,
	height,
}: {
	project: ProjectSnapshot;
	width: number;
	height: number;
}) {
	const selectedIds = useApp((s) => s.selectedClipIds) ?? [];
	const [drag, setDrag] = useState<{ dx: number; dy: number; scale?: number } | null>(null);
	const resize = useRef<{ cx: number; cy: number; d0: number } | null>(null);
	const [editing, setEditing] = useState<string | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const clip = project.data.clips.find((c) => selectedIds.length === 1 && c.id === selectedIds[0]);
	// Only re-render when the playhead enters or leaves the clip, not every frame.
	const visible = playback.clock.use(
		(s) => !!clip && s.currentMs >= clip.startMs && s.currentMs < clip.startMs + clip.durationMs,
	);
	// Animated clips move on their own: follow them (one render per frame, only then).
	const animated =
		clip?.type === "media" &&
		!!clip.keyframes &&
		(["x", "y", "scale"] as const).some((p) => clip.keyframes?.[p]?.length);
	const frame = playback.clock.use((s) => (animated ? Math.round(s.currentMs / 33) : 0));
	if (!clip || !visible) return null;
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	if (!track || track.kind === "audio" || track.locked) return null;
	const local = animated ? frame * 33 - clip.startMs : playback.currentMs - clip.startMs;
	const box = boxOf(clip, project, width, height, local, drag?.scale);
	if (!box) return null;
	const dx = drag?.dx ?? 0;
	const dy = drag?.dy ?? 0;
	if (editing !== null && clip.type === "text") {
		// Type straight into the title, sized like the real text.
		const s = clip.style;
		const scale = width / project.data.canvas.width;
		const commit = (value: string | null) => {
			setEditing(null);
			if (value !== null && value.trim() && value !== clip.text)
				void run("update_clip", { id: clip.id, patch: { text: value } });
		};
		return (
			<textarea
				// biome-ignore lint/a11y/noAutofocus: editing starts on double-click, as in every editor
				autoFocus
				value={editing}
				onChange={(e) => setEditing(e.target.value)}
				onFocus={(e) => e.target.select()}
				onBlur={() => commit(editing)}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Escape") commit(null);
					if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) commit(editing);
				}}
				className="absolute z-30 resize-none rounded-md bg-black/70 text-white outline outline-2 outline-accent"
				style={{
					left: Math.max(0, box.left - 6),
					top: Math.max(0, box.top - 6),
					width: Math.max(160, box.width + 12),
					height: Math.max(40, box.height + 12),
					fontFamily: `"${s.fontFamily}", system-ui`,
					fontWeight: s.fontWeight,
					fontStyle: s.italic ? "italic" : "normal",
					fontSize: Math.max(11, s.fontSize * scale),
					lineHeight: s.lineHeight,
					textAlign: s.align,
					padding: s.padding * scale,
					textTransform: s.uppercase ? "uppercase" : "none",
				}}
			/>
		);
	}
	return (
		<div
			className="absolute z-20 cursor-move outline outline-1 outline-accent"
			style={{ left: box.left + dx, top: box.top + dy, width: box.width, height: box.height }}
			title={clip.type === "text" ? "Drag to move · double-click to edit the text" : undefined}
			onDoubleClick={() => clip.type === "text" && setEditing(clip.text)}
			onPointerDown={(e) => {
				e.stopPropagation();
				start.current = { x: e.clientX, y: e.clientY };
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
				setDrag({ dx: 0, dy: 0 });
			}}
			onPointerMove={(e) =>
				start.current &&
				setDrag({ dx: e.clientX - start.current.x, dy: e.clientY - start.current.y })
			}
			onPointerUp={() => {
				if (!start.current) return;
				start.current = null;
				const moved = drag;
				setDrag(null);
				if (!moved || (Math.abs(moved.dx) < 2 && Math.abs(moved.dy) < 2)) return;
				const nx = Math.round((box.cx + moved.dx / width) * 1000) / 1000;
				const ny = Math.round((box.cy + moved.dy / height) * 1000) / 1000;
				if (clip.type === "text")
					void run("update_clip", { id: clip.id, patch: { style: { x: nx, y: ny } } });
				else setMotion(clip, { x: nx, y: ny });
			}}
		>
			{/* Corners resize around the centre. */}
			{["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map(
				(pos) => (
					<span
						key={pos}
						className={cn(
							"absolute size-2.5 cursor-nwse-resize border border-accent bg-white",
							pos,
							(pos.includes("right") && pos.includes("top")) ||
								(pos.includes("left") && pos.includes("bottom"))
								? "cursor-nesw-resize"
								: "",
						)}
						onPointerDown={(e) => {
							e.stopPropagation();
							const r = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
							const cx = r.left + r.width / 2;
							const cy = r.top + r.height / 2;
							resize.current = { cx, cy, d0: Math.hypot(e.clientX - cx, e.clientY - cy) };
							(e.target as HTMLElement).setPointerCapture(e.pointerId);
							setDrag({ dx: 0, dy: 0, scale: 1 });
						}}
						onPointerMove={(e) => {
							const r0 = resize.current;
							if (!r0) return;
							e.stopPropagation();
							const factor = Math.max(
								0.05,
								Math.hypot(e.clientX - r0.cx, e.clientY - r0.cy) / Math.max(1, r0.d0),
							);
							setDrag({ dx: 0, dy: 0, scale: factor });
						}}
						onPointerUp={(e) => {
							if (!resize.current) return;
							e.stopPropagation();
							resize.current = null;
							const factor = drag?.scale ?? 1;
							setDrag(null);
							if (Math.abs(factor - 1) < 0.01) return;
							if (clip.type === "text") {
								const s = clip.style;
								void run("update_clip", {
									id: clip.id,
									patch: {
										style: {
											fontSize: Math.max(8, Math.round(s.fontSize * factor)),
											width: Math.min(1, s.width * factor),
										},
										...(clip.shape
											? {
													shape: {
														width: clip.shape.width * factor,
														height: clip.shape.height * factor,
													},
												}
											: {}),
									},
								});
							} else
								setMotion(clip, { scale: Math.round((box.scale ?? 1) * factor * 1000) / 1000 });
						}}
					/>
				),
			)}
		</div>
	);
}

/**
 * Sets position or size from the viewer: as a keyframe at the playhead when
 * that property is animated (as the inspector does), else on the clip.
 */
function setMotion(clip: Clip, values: { x?: number; y?: number; scale?: number }) {
	if (clip.type !== "media") return;
	const local = Math.round(
		Math.max(0, Math.min(clip.durationMs, playback.currentMs - clip.startMs)),
	);
	const plain: Record<string, number> = {};
	for (const [prop, value] of Object.entries(values)) {
		if (clip.keyframes?.[prop as "x"]?.length)
			void run("set_keyframe", { clipId: clip.id, prop, atMs: local, value, ease: "ease" });
		else plain[prop] = value;
	}
	if (Object.keys(plain).length)
		void run("update_clip", { id: clip.id, patch: { transform: plain } });
}

function boxOf(
	clip: Clip,
	project: ProjectSnapshot,
	width: number,
	height: number,
	local = 0,
	resizeBy = 1,
) {
	const scale = (width / project.data.canvas.width) * (clip.type === "text" ? resizeBy : 1);
	if (clip.type === "text" && clip.shape && !clip.text.trim()) {
		// A shape on its own: its own size (a line's or arrow's bounding box).
		const s = clip.style;
		const w = Math.max(24, Math.abs(clip.shape.width) * width);
		const h = Math.max(24, Math.abs(clip.shape.height) * height);
		return {
			left: s.x * width - w / 2,
			top: s.y * height - h / 2,
			width: w,
			height: h,
			cx: s.x,
			cy: s.y,
		};
	}
	if (clip.type === "text") {
		const s = (clip as TextClip).style;
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return null;
		ctx.font = `${s.italic ? "italic " : ""}${s.fontWeight} ${s.fontSize}px "${s.fontFamily}"`;
		ctx.letterSpacing = `${s.letterSpacing}px`;
		const words = clip.text.split(/\s+/);
		const maxW = s.width * project.data.canvas.width - s.padding * 2;
		let lines = 1;
		let current = "";
		let widest = 0;
		for (const word of words) {
			const next = current ? `${current} ${word}` : word;
			if (current && ctx.measureText(next).width > maxW) {
				lines++;
				widest = Math.max(widest, ctx.measureText(current).width);
				current = word;
			} else current = next;
		}
		widest = Math.max(widest, ctx.measureText(current).width);
		const w = Math.min(s.width * project.data.canvas.width, widest + s.padding * 2) * scale;
		const h = (lines * s.fontSize * s.lineHeight + s.padding * 2) * scale;
		return {
			left: s.x * width - w / 2,
			top: s.y * height - h / 2,
			width: w,
			height: h,
			cx: s.x,
			cy: s.y,
		};
	}
	// Where the picture is at this moment (keyframes), and the part the crop leaves visible.
	const t = clip.transform;
	const kf = clip.keyframes;
	const x = valueAt(kf?.x, local, t.x);
	const y = valueAt(kf?.y, local, t.y);
	const s = valueAt(kf?.scale, local, t.scale);
	const asset = project.data.assets.find((a) => a.id === clip.assetId);
	const ar = asset?.width && asset.height ? asset.width / asset.height : width / height;
	const fit = Math.min(width / ar, height) * s * resizeBy;
	const w = fit * ar;
	const h = fit;
	const c = t.crop;
	return {
		left: x * width - w / 2 + c.left * w,
		top: y * height - h / 2 + c.top * h,
		width: w * (1 - c.left - c.right),
		height: h * (1 - c.top - c.bottom),
		cx: x,
		cy: y,
		scale: s,
	};
}

/**
 * An empty project: a place to drop footage, and the few steps that get an
 * edit going. Dropped files are imported and laid out on the timeline.
 */
function EmptyProject({ project }: { project: ProjectSnapshot }) {
	const [over, setOver] = useState(false);
	const place = async (files: string[]) => {
		const assets = await run<{ id: string; kind: string; durationMs: number }[]>("import_media", {
			files,
		});
		if (!assets?.length) return;
		const video = project.data.tracks.find((t) => t.kind === "video" && !t.locked);
		const audio = project.data.tracks.find((t) => t.kind === "audio" && !t.voiceover && !t.locked);
		// Pictures back to back on the first video track, sound on the first audio track.
		let at = 0;
		const clips = [];
		for (const a of assets) {
			if ((a.kind === "video" || a.kind === "image") && video) {
				clips.push({ type: "media", trackId: video.id, assetId: a.id, startMs: at });
				// Stills get the default five seconds.
				at += a.kind === "image" ? 5000 : a.durationMs;
			} else if (a.kind === "audio" && audio)
				clips.push({ type: "media", trackId: audio.id, assetId: a.id, startMs: 0 });
		}
		if (clips.length) await run("add_clips", { clips });
		window.dispatchEvent(new CustomEvent("cue:fit"));
	};
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a drop zone; the button inside imports by click
		<div
			className={cn(
				"absolute inset-6 z-20 flex flex-col items-center justify-center gap-6 rounded-2xl border-2 border-dashed transition-colors",
				over ? "border-accent bg-accent/10" : "border-white/10 bg-black/30",
			)}
			onDragOver={(e) => {
				e.preventDefault();
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(e) => {
				e.preventDefault();
				setOver(false);
				const files = [...e.dataTransfer.files]
					.map((f) => window.cue.pathForFile(f))
					.filter(Boolean);
				if (files.length) void place(files);
			}}
		>
			<div className="text-center">
				<p className="text-[17px] font-semibold text-white">Drop footage here</p>
				<p className="mt-1 text-[13px] text-white/60">
					Video, sound or pictures. They go straight onto the timeline.
				</p>
			</div>
			<button
				type="button"
				onClick={() => void window.cue.importDialog()}
				className="h-9 rounded-lg bg-accent px-4 text-[13px] font-semibold text-accent-foreground"
			>
				Import media… <span className="ml-1 opacity-70">{keyLabel("⌘I")}</span>
			</button>
			<ol className="grid max-w-xl grid-cols-2 gap-x-8 gap-y-2 text-[12px] text-white/65">
				<li>
					<b className="text-white/90">1. Arrange.</b> Drag clips from Media onto the timeline.
				</li>
				<li>
					<b className="text-white/90">2. Cut.</b> Space plays, {keyLabel("⌘K")} splits, drag an
					edge to trim.
				</li>
				<li>
					<b className="text-white/90">3. Polish.</b> Titles in Text, colour and effects in the
					inspector.
				</li>
				<li>
					<b className="text-white/90">4. Share.</b> Export, or ask the Agent to do any of it.
				</li>
			</ol>
			<a
				href="https://cue.wicker.life/docs"
				target="_blank"
				rel="noreferrer"
				className="text-[12px] text-white/50 underline underline-offset-4 hover:text-white/80"
			>
				Read the guide
			</a>
		</div>
	);
}

/** Title-safe (80%) and action-safe (90%) frames, and a centre mark. */
function SafeAreas() {
	return (
		<div className="pointer-events-none absolute inset-0 z-20">
			<div className="absolute inset-[5%] border border-dashed border-white/35" />
			<div className="absolute inset-[10%] border border-dashed border-white/50" />
			<div className="absolute top-1/2 left-1/2 h-4 w-px -translate-1/2 bg-white/50" />
			<div className="absolute top-1/2 left-1/2 h-px w-4 -translate-1/2 bg-white/50" />
		</div>
	);
}

/**
 * Before/after: hold to see the pictures without their grade and effects, or
 * split the viewer with the original on the left and the grade on the right.
 */
function CompareControls() {
	const [on, setOn] = useState(false);
	const split = compareView.use((s) => s.split);
	const set = (value: boolean) => {
		setOn(value);
		playback.setOriginal(value);
	};
	useEffect(() => () => playback.setOriginal(false), []);
	const btn =
		"h-7 px-2.5 text-[11px] font-medium first:rounded-l-md last:rounded-r-md focus-visible:outline-none";
	return (
		<div className="absolute top-3 right-3 z-30 flex overflow-hidden rounded-md shadow ring-1 ring-white/10 backdrop-blur">
			<button
				type="button"
				title="Hold to see the original picture"
				onPointerDown={() => set(true)}
				onPointerUp={() => set(false)}
				onPointerLeave={() => on && set(false)}
				className={cn(
					btn,
					on ? "bg-accent text-accent-foreground" : "bg-black/55 text-white/85 hover:bg-black/70",
				)}
			>
				{on ? "Original" : "Hold to compare"}
			</button>
			<button
				type="button"
				aria-pressed={split}
				title="Original on the left, graded on the right; drag the line to move it"
				onClick={() => compareView.set({ split: !split })}
				className={cn(
					btn,
					"border-l border-white/10",
					split
						? "bg-accent text-accent-foreground"
						: "bg-black/55 text-white/85 hover:bg-black/70",
				)}
			>
				Split
			</button>
		</div>
	);
}

/** The split before/after divider over the picture; drag it to move the split. */
function SplitDivider() {
	const { split, at } = compareView.use((s) => s);
	const dragging = useRef(false);
	useEffect(() => {
		playback.setSplit(split ? at : null);
	}, [split, at]);
	useEffect(() => () => playback.setSplit(null), []);
	if (!split) return null;
	const move = (e: React.PointerEvent<HTMLElement>) => {
		const stage = e.currentTarget.closest("[data-stage-frame]");
		if (!stage) return;
		const r = stage.getBoundingClientRect();
		compareView.set({ at: Math.max(0.02, Math.min(0.98, (e.clientX - r.left) / r.width)) });
	};
	const label =
		"pointer-events-none absolute top-2 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white/85";
	return (
		<div className="pointer-events-none absolute inset-0 z-[25]">
			<span className={label} style={{ right: `calc(${(1 - at) * 100}% + 8px)` }}>
				Original
			</span>
			<span className={label} style={{ left: `calc(${at * 100}% + 8px)` }}>
				Graded
			</span>
			<div
				role="slider"
				tabIndex={0}
				aria-label="Split position"
				aria-valuemin={0}
				aria-valuemax={100}
				aria-valuenow={Math.round(at * 100)}
				className="pointer-events-auto absolute top-0 bottom-0 flex w-4 -translate-x-1/2 cursor-col-resize justify-center focus-visible:outline-none"
				style={{ left: `${at * 100}%` }}
				onPointerDown={(e) => {
					e.stopPropagation();
					dragging.current = true;
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => dragging.current && move(e)}
				onPointerUp={() => {
					dragging.current = false;
				}}
				onKeyDown={(e) => {
					if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
					e.preventDefault();
					e.stopPropagation();
					const step = (e.shiftKey ? 0.1 : 0.02) * (e.key === "ArrowLeft" ? -1 : 1);
					compareView.set({ at: Math.max(0.02, Math.min(0.98, at + step)) });
				}}
			>
				<div className="h-full w-px bg-white/90 shadow-[0_0_0_1px_rgb(0_0_0/0.35)]" />
				<div className="absolute top-1/2 size-5 -translate-y-1/2 rounded-full border border-black/30 bg-white shadow" />
			</div>
		</div>
	);
}

/**
 * The script beside the picture while not recording (Voiceover workspace): the
 * line under the playhead, or the selected one, with the next one below.
 */
function ScriptPrompter() {
	const project = useProject();
	const phase = recorder.status.use((s) => s.phase);
	const selectedLineId = useApp((s) => s.selectedLineId);
	const now = playback.clock.use((s) => Math.round(s.currentMs / 100) * 100);
	if (!project || phase !== "idle" || project.lines.length === 0) return null;
	const at = project.lines.findIndex((l) => now >= l.startMs && now < l.startMs + l.maxMs);
	const index =
		at >= 0
			? at
			: Math.max(
					0,
					project.lines.findIndex((l) => l.id === selectedLineId),
				);
	const line = project.lines[index];
	const next = project.lines[index + 1];
	return (
		<div className="pointer-events-none absolute inset-x-8 bottom-6 z-30 flex justify-center">
			<div className="w-full max-w-3xl rounded-2xl bg-slate-950/80 px-6 py-4 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
				<p className="mb-1 text-[11px] font-medium text-white/60">{line.id} · press R to record</p>
				<p className="text-[22px] leading-snug font-semibold">{line.text}</p>
				{next && <p className="mt-2 text-[14px] text-white/45">{next.text}</p>}
			</div>
		</div>
	);
}

function Teleprompter() {
	const phase = recorder.status.use((s) => s.phase);
	return phase === "idle" ? null : <TeleprompterCard />;
}

function TeleprompterCard() {
	const phase = recorder.status.use((s) => s.phase);
	const lineId = recorder.status.use((s) => s.lineId);
	const level = recorder.status.use((s) => s.level);
	const now = playback.clock.use((s) => s.currentMs);
	const project = useProject();
	if (phase === "idle" || !project) return null;
	const index = project.lines.findIndex((l) => l.id === lineId);
	const line = project.lines[index];
	const next = project.lines[index + 1];
	if (!line) return null;
	const elapsed = now - line.startMs;
	const before = elapsed < 0;
	const pct = Math.max(0, Math.min(1, elapsed / line.maxMs));
	const targetPct = line.targetMs / line.maxMs;
	const over = elapsed > line.maxMs;
	return (
		<div className="pointer-events-none absolute inset-x-8 bottom-6 z-30 flex justify-center">
			<div className="w-full max-w-3xl rounded-2xl bg-slate-950/85 px-6 py-5 text-white shadow-2xl ring-1 ring-white/10 backdrop-blur">
				<div className="mb-2 flex items-center gap-3 text-[12px] font-medium text-white/70">
					<span
						className={cn(
							"flex items-center gap-1.5 rounded-full px-2 py-0.5",
							before ? "bg-white/10" : "bg-red-500/90 text-white",
						)}
					>
						<span
							className={cn("size-2 rounded-full", before ? "bg-white/70" : "rec-pulse bg-white")}
						/>
						{phase === "saving" ? "Saving" : before ? "Starting" : "Recording"} {line.id}
					</span>
					{before ? (
						<span className="text-2xl font-bold text-white tabular-nums">
							{(-elapsed / 1000).toFixed(1)}
						</span>
					) : (
						<span className={cn("tabular-nums", over && "text-red-300")}>
							{formatSeconds(elapsed)} · target {formatSeconds(line.targetMs)} · max{" "}
							{formatSeconds(line.maxMs)}
						</span>
					)}
					<div className="ml-auto h-1.5 w-20 overflow-hidden rounded-full bg-white/15">
						<div
							className="h-full rounded-full bg-emerald-400"
							style={{ width: `${level * 100}%` }}
						/>
					</div>
				</div>
				<p
					className={cn(
						"text-[22px] leading-snug font-semibold transition-opacity",
						before && "opacity-60",
					)}
				>
					{line.text}
				</p>
				<div className="relative mt-4 h-1.5 overflow-hidden rounded-full bg-white/15">
					<div
						className={cn(
							"h-full rounded-full transition-[width] duration-75",
							over ? "bg-red-400" : pct > targetPct ? "bg-amber-400" : "bg-sky-400",
						)}
						style={{ width: `${pct * 100}%` }}
					/>
					<div
						className="absolute top-0 h-full w-0.5 bg-white/60"
						style={{ left: `${targetPct * 100}%` }}
					/>
				</div>
				{next && <p className="mt-3 truncate text-[13px] text-white/45">Next · {next.text}</p>}
				<p className="mt-2 text-[11px] text-white/40">
					Space or Enter to stop and keep · Esc to discard
				</p>
			</div>
		</div>
	);
}
