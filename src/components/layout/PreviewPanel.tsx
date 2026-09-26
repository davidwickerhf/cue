import { CaretLeft, CaretRight, Pause, Play, SkipBack } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Clip, ProjectSnapshot, TextClip } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { recorder } from "../../lib/recorder";
import { useApp, useProject } from "../../lib/state";
import { cn, formatSeconds } from "../../lib/utils";

export function PreviewPanel() {
	const project = useProject();
	const area = useRef<HTMLDivElement>(null);
	const stage = useRef<HTMLDivElement>(null);
	const textCanvas = useRef<HTMLCanvasElement>(null);
	const [size, setSize] = useState({ w: 0, h: 0 });
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

	useEffect(() => {
		// Re-lay out pictures and text when the viewer is resized.
		playback.refresh();
	}, [size.w]);

	return (
		<section className="flex min-w-0 flex-1 flex-col bg-viewer">
			<div ref={area} className="relative flex min-h-0 flex-1 items-center justify-center">
				<div
					data-stage-frame
					ref={stage}
					className="relative overflow-hidden"
					style={{
						width: size.w,
						height: size.h,
						background: canvas?.background ?? "#000",
						boxShadow: "0 0 0 1px rgb(255 255 255 / 0.06)",
					}}
				>
					<canvas
						ref={textCanvas}
						className="pointer-events-none absolute inset-0 z-10 size-full"
					/>
					{project && <SelectionOverlay project={project} width={size.w} height={size.h} />}
				</div>
				<Teleprompter />
			</div>
			{project && <Transport project={project} />}
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
				<Meters />
				<span className="font-mono text-[12px] tabular text-muted">
					{timecode(project.durationMs, project.data.canvas.fps)}
				</span>
			</div>
		</div>
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
	const [drag, setDrag] = useState<{ dx: number; dy: number } | null>(null);
	const start = useRef<{ x: number; y: number } | null>(null);
	const clip = project.data.clips.find((c) => selectedIds.length === 1 && c.id === selectedIds[0]);
	// Only re-render when the playhead enters or leaves the clip, not every frame.
	const visible = playback.clock.use(
		(s) => !!clip && s.currentMs >= clip.startMs && s.currentMs < clip.startMs + clip.durationMs,
	);
	if (!clip || !visible) return null;
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	if (!track || track.kind === "audio" || track.locked) return null;
	const box = boxOf(clip, project, width, height);
	if (!box) return null;
	const dx = drag?.dx ?? 0;
	const dy = drag?.dy ?? 0;
	return (
		<div
			className="absolute z-20 cursor-move outline outline-1 outline-accent"
			style={{ left: box.left + dx, top: box.top + dy, width: box.width, height: box.height }}
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
				else void run("update_clip", { id: clip.id, patch: { transform: { x: nx, y: ny } } });
			}}
		>
			{["-top-1 -left-1", "-top-1 -right-1", "-bottom-1 -left-1", "-bottom-1 -right-1"].map(
				(pos) => (
					<span key={pos} className={cn("absolute size-2 border border-accent bg-white", pos)} />
				),
			)}
		</div>
	);
}

function boxOf(clip: Clip, project: ProjectSnapshot, width: number, height: number) {
	const scale = width / project.data.canvas.width;
	if (clip.type === "text") {
		const s = (clip as TextClip).style;
		const ctx = document.createElement("canvas").getContext("2d");
		if (!ctx) return null;
		ctx.font = `${s.fontWeight} ${s.fontSize}px "${s.fontFamily}"`;
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
	const t = clip.transform;
	const asset = project.data.assets.find((a) => a.id === clip.assetId);
	const ar = asset?.width && asset.height ? asset.width / asset.height : width / height;
	const fit = Math.min(width / ar, height) * t.scale;
	const w = fit * ar;
	const h = fit;
	return {
		left: t.x * width - w / 2,
		top: t.y * height - h / 2,
		width: w,
		height: h,
		cx: t.x,
		cy: t.y,
	};
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
