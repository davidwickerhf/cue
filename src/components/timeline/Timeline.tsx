import { Dropdown } from "@heroui/react";
import {
	ArrowLineLeft,
	ArrowsHorizontal,
	ArrowsLeftRight,
	ArrowsOutLineHorizontal,
	CaretDown,
	ChartLine,
	Copy,
	Cursor,
	DotsSixVertical,
	Eye,
	EyeSlash as EyeOff,
	EyeSlash,
	FilmStrip,
	LinkSimple,
	LockSimple,
	LockSimpleOpen,
	Magnet,
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
	Microphone,
	Pause,
	Plus,
	Robot,
	Scissors,
	SpeakerHigh,
	SpeakerSlash,
	Stack,
	Star,
	TextT,
	Trash,
	Waveform as WaveIcon,
} from "@phosphor-icons/react";
import {
	Fragment,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	Clip,
	LineView,
	MediaClip,
	ProjectSnapshot,
	Track,
} from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { agentDraft } from "../../lib/chat";
import { playback } from "../../lib/playback";
import { recorder } from "../../lib/recorder";
import { app, createStore, editor, useApp, useProject } from "../../lib/state";
import { cn, formatTime } from "../../lib/utils";
import { ASSET_MIME } from "../panels/MediaPanel";
import { STATUS_STYLE } from "../panels/ScriptPanel";
import { IconButton, Segmented } from "../ui/controls";
import { Filmstrip, Tiled, Waveform } from "./ClipVisuals";
import { SequenceTabs } from "./SequenceTabs";

const HEADER_W = 212;
const RULER_H = 28;
const SCRIPT_H = 34;
const TRACK_H: Record<Track["kind"], number> = { video: 58, audio: 50, text: 34 };
const SNAP_PX = 8;

type Drag =
	| {
			kind: "move";
			ids: string[];
			primary: string;
			x0: number;
			y0: number;
			deltaMs: number;
			dy: number;
			targetTrack: string | null;
			snapTo: number | null;
			copy: boolean;
	  }
	| {
			kind: "trim";
			id: string;
			edge: "start" | "end";
			x0: number;
			toMs: number;
			snapTo: number | null;
	  }
	| { kind: "slip"; id: string; x0: number; deltaMs: number }
	| {
			kind: "roll";
			leftId: string;
			rightId: string;
			x0: number;
			toMs: number;
			snapTo: number | null;
	  }
	| { kind: "slide"; id: string; x0: number; deltaMs: number }
	| { kind: "line"; id: string; x0: number; deltaMs: number }
	| { kind: "scrub" };

const end = (c: { startMs: number; durationMs: number }) => c.startMs + c.durationMs;

export function Timeline() {
	const project = useProject();
	const selected = useApp((s) => s.selectedClipIds) ?? [];
	const selectedLine = useApp((s) => s.selectedLineId);
	const { zoom, tool, snapping } = editor.use((s) => s);
	const scroller = useRef<HTMLDivElement>(null);
	const [liveDrag, setDrag] = useState<Drag | null>(null);
	const dragRef = useRef<Drag | null>(null);
	// A dropped edit stays drawn where it was dropped until the project confirms it, so nothing flickers back.
	const [committed, setCommitted] = useState<{ drag: Drag; revision: number } | null>(null);
	// A committed drag is shown until the edit arrives; never on top of the new positions
	// (which would draw the move twice for a frame).
	const revision = project?.revision ?? 0;
	const drag = liveDrag ?? (committed?.revision === revision ? committed.drag : null);
	useEffect(() => {
		if (committed && revision !== committed.revision) setCommitted(null);
	}, [revision, committed]);
	const [menu, setMenu] = useState<{ x: number; y: number; clip: Clip; atMs: number } | null>(null);
	const [viewWidth, setViewWidth] = useState(1000);

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setViewWidth(el.clientWidth - HEADER_W));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	const pxPerMs = zoom / 1000;
	const duration = project?.durationMs ?? 0;
	const contentWidth = Math.max(viewWidth, (duration + 20000) * pxPerMs);
	const toX = useCallback((ms: number) => ms * pxPerMs, [pxPerMs]);

	const snapPoints = useMemo(() => {
		if (!project) return [] as number[];
		const points = new Set<number>([
			0,
			...project.data.markers.map((m) => m.atMs),
			...project.lines.map((l) => l.startMs),
		]);
		for (const c of project.data.clips) {
			points.add(c.startMs);
			points.add(end(c));
		}
		return [...points];
	}, [project]);

	const snap = useCallback(
		(ms: number, exclude: Set<number> = new Set()): number | null => {
			if (!snapping) return null;
			const threshold = SNAP_PX / pxPerMs;
			let best: number | null = null;
			for (const p of [...snapPoints, playback.currentMs]) {
				if (exclude.has(p)) continue;
				if (
					Math.abs(p - ms) <= threshold &&
					(best === null || Math.abs(p - ms) < Math.abs(best - ms))
				)
					best = p;
			}
			return best;
		},
		[snapping, snapPoints, pxPerMs],
	);

	const timeAt = (clientX: number) => {
		const el = scroller.current;
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, (clientX - rect.left - HEADER_W + el.scrollLeft) / pxPerMs);
	};

	useEffect(() => {
		const fit = () => {
			const el = scroller.current;
			const total = app.get().state?.project?.durationMs ?? 0;
			if (!el || total <= 0) return;
			editor.set({
				zoom: Math.max(4, Math.min(600, (el.clientWidth - HEADER_W - 40) / (total / 1000))),
			});
			el.scrollLeft = 0;
		};
		window.addEventListener("cue:fit", fit);
		return () => window.removeEventListener("cue:fit", fit);
	}, []);

	// Zoom with ⌘/Ctrl + wheel around the pointer.
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!(e.metaKey || e.ctrlKey)) return;
			e.preventDefault();
			const rect = el.getBoundingClientRect();
			const anchorX = e.clientX - rect.left - HEADER_W;
			const anchorMs = (anchorX + el.scrollLeft) / (editor.get().zoom / 1000);
			const next = Math.min(600, Math.max(4, editor.get().zoom * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
			editor.set({ zoom: next });
			requestAnimationFrame(() => {
				el.scrollLeft = anchorMs * (next / 1000) - anchorX;
			});
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	if (!project) return null;
	const tracks = project.data.tracks;
	const clipsByTrack = new Map<string, Clip[]>(tracks.map((t) => [t.id, []]));
	for (const c of project.data.clips) clipsByTrack.get(c.trackId)?.push(c);

	// ---------------------------------------------------------------------
	// Pointer handling
	// ---------------------------------------------------------------------

	const begin = (d: Drag, e: ReactPointerEvent) => {
		dragRef.current = d;
		setDrag(d);
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
	};

	const neighbour = (clip: Clip, edge: "start" | "end") =>
		project.data.clips.find(
			(x) =>
				x.id !== clip.id &&
				x.trackId === clip.trackId &&
				(edge === "end"
					? Math.abs(x.startMs - end(clip)) <= 2
					: Math.abs(end(x) - clip.startMs) <= 2),
		);

	const onClipDown = (clip: Clip, e: ReactPointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		const track = tracks.find((t) => t.id === clip.trackId);
		const atMs = timeAt(e.clientX);
		if (tool === "blade") {
			void run("split_clip", { id: clip.id, atMs: Math.round(snap(atMs) ?? atMs) });
			return;
		}
		// Linked clips (picture and sound, groups) are selected together, as in other editors.
		const withLinks = (ids: string[]) => {
			const groups = new Set(
				project.data.clips.filter((c) => ids.includes(c.id) && c.groupId).map((c) => c.groupId),
			);
			return [
				...new Set([
					...ids,
					...project.data.clips.filter((c) => c.groupId && groups.has(c.groupId)).map((c) => c.id),
				]),
			];
		};
		const already = selected.includes(clip.id);
		const ids =
			e.shiftKey || e.metaKey
				? already
					? selected.filter((id) => id !== clip.id)
					: withLinks([...selected, clip.id])
				: already
					? selected
					: withLinks([clip.id]);
		window.cue.selectClips(ids);
		if (clip.type === "media" && clip.lineId) window.cue.selectLine(clip.lineId);
		if (track?.locked || !ids.includes(clip.id)) return;
		if (tool === "slip" && clip.type === "media")
			return begin({ kind: "slip", id: clip.id, x0: e.clientX, deltaMs: 0 }, e);
		if (tool === "slide")
			return begin({ kind: "slide", id: clip.id, x0: e.clientX, deltaMs: 0 }, e);
		begin(
			{
				kind: "move",
				ids,
				primary: clip.id,
				x0: e.clientX,
				y0: e.clientY,
				deltaMs: 0,
				dy: 0,
				targetTrack: null,
				snapTo: null,
				copy: e.altKey,
			},
			e,
		);
	};

	const onEdgeDown = (clip: Clip, edge: "start" | "end", e: ReactPointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		window.cue.selectClips([clip.id]);
		if (tracks.find((t) => t.id === clip.trackId)?.locked) return;
		const other = neighbour(clip, edge);
		if (tool === "roll" && other) {
			const [left, right] = edge === "end" ? [clip, other] : [other, clip];
			return begin(
				{
					kind: "roll",
					leftId: left.id,
					rightId: right.id,
					x0: e.clientX,
					toMs: right.startMs,
					snapTo: null,
				},
				e,
			);
		}
		begin(
			{
				kind: "trim",
				id: clip.id,
				edge,
				x0: e.clientX,
				toMs: edge === "start" ? clip.startMs : end(clip),
				snapTo: null,
			},
			e,
		);
	};

	const onLineDown = (line: LineView, e: ReactPointerEvent) => {
		e.stopPropagation();
		window.cue.selectLine(line.id);
		begin({ kind: "line", id: line.id, x0: e.clientX, deltaMs: 0 }, e);
	};

	const onMove = (e: ReactPointerEvent) => {
		const d = dragRef.current;
		if (!d) return;
		let next: Drag = d;
		if (d.kind === "scrub") {
			playback.seek(Math.round(timeAt(e.clientX)));
			return;
		}
		if (d.kind === "move") {
			const primary = project.data.clips.find((c) => c.id === d.primary);
			if (!primary) return;
			let delta = (e.clientX - d.x0) / pxPerMs;
			const earliest = Math.min(
				...project.data.clips.filter((c) => d.ids.includes(c.id)).map((c) => c.startMs),
			);
			delta = Math.max(-earliest, delta);
			const exclude = new Set(
				project.data.clips.filter((c) => d.ids.includes(c.id)).flatMap((c) => [c.startMs, end(c)]),
			);
			const s = snap(primary.startMs + delta, exclude);
			const e2 = snap(end(primary) + delta, exclude);
			let snapTo: number | null = null;
			if (s !== null) {
				delta = s - primary.startMs;
				snapTo = s;
			} else if (e2 !== null) {
				delta = e2 - end(primary);
				snapTo = e2;
			}
			// Moving to another track of the same kind (single-track selections).
			const row = (
				document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null
			)?.closest<HTMLElement>("[data-track-id]");
			const hovered = row?.dataset.trackId ?? null;
			const sameTrack =
				new Set(project.data.clips.filter((c) => d.ids.includes(c.id)).map((c) => c.trackId))
					.size === 1;
			const from = tracks.find((t) => t.id === primary.trackId);
			const to = tracks.find((t) => t.id === hovered);
			const targetTrack =
				sameTrack && to && from && to.id !== from.id && to.kind === from.kind && !to.locked
					? to.id
					: null;
			next = { ...d, deltaMs: delta, dy: targetTrack ? e.clientY - d.y0 : 0, targetTrack, snapTo };
		}
		if (d.kind === "trim") {
			const clip = project.data.clips.find((c) => c.id === d.id);
			if (!clip) return;
			const original = d.edge === "start" ? clip.startMs : end(clip);
			let to = original + (e.clientX - d.x0) / pxPerMs;
			const s = snap(to, new Set([original]));
			if (s !== null) to = s;
			// Respect the source length when extending media.
			if (clip.type === "media") {
				const asset = project.data.assets.find((a) => a.id === clip.assetId);
				if (asset && asset.kind !== "image") {
					if (d.edge === "start") to = Math.max(to, clip.startMs - clip.inMs / clip.speed);
					else to = Math.min(to, clip.startMs + (asset.durationMs - clip.inMs) / clip.speed);
				}
			}
			to =
				d.edge === "start"
					? Math.min(Math.max(0, to), end(clip) - 20)
					: Math.max(to, clip.startMs + 20);
			next = { ...d, toMs: to, snapTo: s };
		}
		if (d.kind === "slip") {
			const clip = project.data.clips.find((c) => c.id === d.id);
			if (!clip || clip.type !== "media") return;
			const asset = project.data.assets.find((a) => a.id === clip.assetId);
			const source = -((e.clientX - d.x0) / pxPerMs) * clip.speed;
			const max = Math.max(0, (asset?.durationMs ?? 0) - clip.durationMs * clip.speed);
			next = {
				...d,
				deltaMs: (Math.min(max, Math.max(0, clip.inMs + source)) - clip.inMs) / clip.speed,
			};
		}
		if (d.kind === "slide") {
			const clip = project.data.clips.find((c) => c.id === d.id);
			if (!clip) return;
			const left = neighbour(clip, "start");
			const right = neighbour(clip, "end");
			let delta = (e.clientX - d.x0) / pxPerMs;
			if (left) delta = Math.max(delta, -(left.durationMs - 20));
			else delta = Math.max(delta, -clip.startMs);
			if (right) delta = Math.min(delta, right.durationMs - 20);
			next = { ...d, deltaMs: delta };
		}
		if (d.kind === "roll") {
			const left = project.data.clips.find((c) => c.id === d.leftId);
			const right = project.data.clips.find((c) => c.id === d.rightId);
			if (!left || !right) return;
			let to = right.startMs + (e.clientX - d.x0) / pxPerMs;
			const s = snap(to, new Set([right.startMs]));
			if (s !== null) to = s;
			to = Math.max(left.startMs + 20, Math.min(end(right) - 20, to));
			next = { ...d, toMs: to, snapTo: s };
		}
		if (d.kind === "line") {
			const line = project.lines.find((l) => l.id === d.id);
			if (!line) return;
			let delta = (e.clientX - d.x0) / pxPerMs;
			const s = snap(line.startMs + delta, new Set([line.startMs]));
			if (s !== null) delta = s - line.startMs;
			next = { ...d, deltaMs: Math.max(-line.startMs, delta) };
		}
		dragRef.current = next;
		setDrag(next);
	};

	const onUp = () => {
		const d = dragRef.current;
		dragRef.current = null;
		setDrag(null);
		if (!d || d.kind === "scrub") return;
		const commit = (promise: Promise<unknown>) => {
			setCommitted({ drag: d, revision });
			void promise.then((result) => {
				if (result === undefined) setCommitted(null);
			});
		};
		if (d.kind === "move" && (Math.abs(d.deltaMs) >= 1 || d.targetTrack)) {
			if (d.copy)
				void run("duplicate_clips", {
					ids: d.ids,
					offsetMs: Math.round(d.deltaMs),
					trackId: d.targetTrack ?? undefined,
				});
			else
				commit(
					run("move_clips", {
						ids: d.ids,
						deltaMs: Math.round(d.deltaMs),
						trackId: d.targetTrack ?? undefined,
					}),
				);
		}
		if (d.kind === "trim") {
			const clip = project.data.clips.find((c) => c.id === d.id);
			if (clip && Math.abs(d.toMs - (d.edge === "start" ? clip.startMs : end(clip))) >= 1)
				commit(run("trim_clip", { id: d.id, edge: d.edge, toMs: Math.round(d.toMs) }));
		}
		if (d.kind === "slip" && Math.abs(d.deltaMs) >= 1)
			commit(run("slip_clip", { id: d.id, deltaMs: Math.round(d.deltaMs) }));
		if (d.kind === "slide" && Math.abs(d.deltaMs) >= 1)
			commit(run("slide_clip", { id: d.id, deltaMs: Math.round(d.deltaMs) }));
		if (d.kind === "roll") {
			const right = project.data.clips.find((c) => c.id === d.rightId);
			if (right && Math.abs(d.toMs - right.startMs) >= 1)
				commit(
					run("roll_edit", { leftId: d.leftId, rightId: d.rightId, toMs: Math.round(d.toMs) }),
				);
		}
		if (d.kind === "line" && Math.abs(d.deltaMs) >= 1) {
			const line = project.lines.find((l) => l.id === d.id);
			if (line)
				commit(
					run("update_line", {
						id: d.id,
						patch: { startMs: Math.round(line.startMs + d.deltaMs) },
					}),
				);
		}
	};

	/** Where a clip should be drawn given the drag in progress. */
	const preview = (clip: Clip): { left: number; width: number; inMs?: number; dy?: number } => {
		let left = clip.startMs;
		let width = clip.durationMs;
		let inMs: number | undefined;
		let dy: number | undefined;
		const d = drag;
		if (!d) return { left, width };
		if (d.kind === "move" && d.ids.includes(clip.id)) {
			left += d.deltaMs;
			dy = d.dy || undefined;
		}
		if (d.kind === "trim" && d.id === clip.id) {
			if (d.edge === "start") {
				left = d.toMs;
				width = end(clip) - d.toMs;
			} else width = d.toMs - clip.startMs;
		}
		if (d.kind === "slip" && d.id === clip.id && clip.type === "media")
			inMs = clip.inMs + d.deltaMs * clip.speed;
		if (d.kind === "slide") {
			const target = project.data.clips.find((c) => c.id === d.id);
			if (target) {
				if (clip.id === d.id) left += d.deltaMs;
				else if (neighbour(target, "start")?.id === clip.id) width += d.deltaMs;
				else if (neighbour(target, "end")?.id === clip.id) {
					left += d.deltaMs;
					width -= d.deltaMs;
				}
			}
		}
		if (d.kind === "roll") {
			if (clip.id === d.leftId) width = d.toMs - clip.startMs;
			if (clip.id === d.rightId) {
				left = d.toMs;
				width = end(clip) - d.toMs;
			}
		}
		return { left, width, inMs, dy };
	};

	const onDrop = async (track: Track, e: React.DragEvent) => {
		e.preventDefault();
		const at = Math.round(timeAt(e.clientX));
		const assetId = e.dataTransfer.getData(ASSET_MIME);
		if (assetId) {
			void run("add_clips", {
				clips: [{ type: "media", trackId: track.id, assetId, startMs: snap(at) ?? at }],
			});
			return;
		}
		const files = [...e.dataTransfer.files].map((f) => window.cue.pathForFile(f)).filter(Boolean);
		if (files.length)
			void run("import_media", {
				files,
				trackId: track.kind === "text" ? undefined : track.id,
				startMs: at,
			});
	};

	const snapLine =
		drag && (drag.kind === "move" || drag.kind === "trim" || drag.kind === "roll")
			? drag.snapTo
			: null;

	return (
		<section className="flex h-full min-h-0 flex-col overflow-hidden bg-surface">
			<SequenceTabs project={project} />
			<Toolbar
				project={project}
				viewWidth={viewWidth}
				scroller={scroller}
				selectedLine={selectedLine ?? null}
			/>
			<div
				ref={scroller}
				className="custom-scrollbar relative min-h-0 flex-1 overflow-auto"
				onPointerMove={onMove}
				onPointerUp={onUp}
				onPointerCancel={onUp}
				onPointerDown={(e) => {
					// Clicking empty timeline deselects; the ruler only moves the playhead.
					if (
						e.button === 0 &&
						!(e.target as HTMLElement).closest("[data-clip],[data-track-header],[data-ruler]")
					)
						window.cue.selectClips([]);
				}}
			>
				<div className="relative" style={{ width: HEADER_W + contentWidth }}>
					{/* Ruler */}
					<div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
						<div
							className="sticky left-0 z-40 shrink-0 border-r border-b border-separator bg-surface"
							style={{ width: HEADER_W }}
						/>
						<Ruler
							width={contentWidth}
							pxPerMs={pxPerMs}
							markers={project.data.markers}
							onDown={(e) => {
								playback.seek(Math.round(timeAt(e.clientX)));
								begin({ kind: "scrub" }, e);
							}}
						/>
					</div>

					{/* Script lines */}
					<Row
						header={
							<RowLabel
								icon={<Microphone className="size-3.5" />}
								label="Script"
								sub={`${project.lines.filter((l) => l.status !== "empty").length}/${project.lines.length}`}
							/>
						}
						height={SCRIPT_H}
					>
						{project.lines.map((line) => {
							const offset = drag?.kind === "line" && drag.id === line.id ? drag.deltaMs : 0;
							const status = STATUS_STYLE[line.status];
							return (
								<div
									key={line.id}
									role="button"
									tabIndex={-1}
									onPointerDown={(e) => onLineDown(line, e)}
									onDoubleClick={() => project && void recorder.record(project, line)}
									title={`${line.id}: ${line.text}`}
									className={cn(
										"absolute top-1.5 bottom-1.5 flex cursor-grab items-center gap-1.5 overflow-hidden rounded-md border px-1.5 text-[11px] font-medium",
										line.id === selectedLine
											? "border-accent/70 bg-accent/15 text-foreground"
											: "border-border bg-surface-secondary text-foreground/70",
									)}
									style={{ left: toX(line.startMs + offset), width: Math.max(8, toX(line.maxMs)) }}
								>
									<span
										className="absolute inset-y-0 left-0 bg-foreground/5"
										style={{ width: toX(line.targetMs) }}
									/>
									<span className={cn("relative size-1.5 shrink-0 rounded-full", status.dot)} />
									<span className="relative truncate">
										{line.id} · {line.text}
									</span>
								</div>
							);
						})}
					</Row>

					{/* Tracks */}
					{tracks.map((track, i) => (
						<Fragment key={track.id}>
							{track.kind === "audio" && i > 0 && tracks[i - 1].kind !== "audio" && (
								<GroupDivider />
							)}
							<Row
								key={track.id}
								trackId={track.id}
								height={TRACK_H[track.kind]}
								header={<TrackHeader track={track} project={project} />}
								dim={track.hidden || track.muted}
								onDragOver={(e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "copy";
								}}
								onDrop={(e) => void onDrop(track, e)}
							>
								{(clipsByTrack.get(track.id) ?? []).map((clip) => {
									const view = preview(clip);
									return (
										<ClipView
											key={clip.id}
											clip={clip}
											project={project}
											left={toX(view.left)}
											width={Math.max(2, toX(view.width))}
											inMs={view.inMs}
											height={TRACK_H[track.kind]}
											pxPerMs={pxPerMs}
											selected={selected.includes(clip.id)}
											dragging={
												!!liveDrag && liveDrag.kind === "move" && liveDrag.ids.includes(clip.id)
											}
											transform={view.dy ? `translateY(${view.dy}px)` : undefined}
											tool={tool}
											locked={track.locked}
											onDown={(e) => onClipDown(clip, e)}
											onEdgeDown={(edge, e) => onEdgeDown(clip, edge, e)}
											onContext={(e) => {
												e.preventDefault();
												if (!selected.includes(clip.id)) window.cue.selectClips([clip.id]);
												setMenu({ x: e.clientX, y: e.clientY, clip, atMs: timeAt(e.clientX) });
											}}
										/>
									);
								})}
							</Row>
						</Fragment>
					))}
					<AddTrackRow />

					{/* Snap guide and playhead */}
					{snapLine !== null && <SnapGuide x={HEADER_W + toX(snapLine)} scroller={scroller} />}
					<Playhead pxPerMs={pxPerMs} scroller={scroller} />
				</div>
			</div>
			{menu && (
				<ClipMenu menu={menu} onClose={() => setMenu(null)} selected={selected} project={project} />
			)}
		</section>
	);
}

// -------------------------------------------------------------------------

function Toolbar({
	project,
	viewWidth,
	scroller,
	selectedLine,
}: {
	project: ProjectSnapshot;
	viewWidth: number;
	scroller: React.RefObject<HTMLDivElement | null>;
	selectedLine: string | null;
}) {
	const { tool, snapping, ripple, previewMode, zoom } = editor.use((s) => s);
	void selectedLine;
	return (
		<div className="flex h-9 shrink-0 items-center gap-2 border-b border-separator bg-surface px-2">
			<div className="flex items-center gap-0.5">
				<IconButton
					label="Selection"
					shortcut="V"
					active={tool === "select"}
					onPress={() => editor.set({ tool: "select" })}
				>
					<Cursor className="size-4" />
				</IconButton>
				<IconButton
					label="Blade: click a clip to cut it"
					shortcut="C"
					active={tool === "blade"}
					onPress={() => editor.set({ tool: "blade" })}
				>
					<Scissors className="size-4" />
				</IconButton>
				<IconButton
					label="Slip: drag a clip to change what it shows"
					shortcut="Y"
					active={tool === "slip"}
					onPress={() => editor.set({ tool: "slip" })}
				>
					<ArrowsLeftRight className="size-4" />
				</IconButton>
				<IconButton
					label="Rolling edit: drag a cut between two clips"
					shortcut="N"
					active={tool === "roll"}
					onPress={() => editor.set({ tool: "roll" })}
				>
					<ArrowsHorizontal className="size-4" />
				</IconButton>
				<IconButton
					label="Slide: drag a clip between its neighbours"
					shortcut="U"
					active={tool === "slide"}
					onPress={() => editor.set({ tool: "slide" })}
				>
					<ArrowsOutLineHorizontal className="size-4" />
				</IconButton>
				<span className="mx-1 h-4 w-px bg-separator" />
				<IconButton
					label="Split at playhead"
					shortcut="⌘K"
					onPress={() => void run("split_at", { atMs: Math.round(playback.currentMs) })}
				>
					<ScissorsIcon />
				</IconButton>
				<IconButton
					label={snapping ? "Snapping on" : "Snapping off"}
					shortcut="S"
					active={snapping}
					onPress={() => editor.set({ snapping: !snapping })}
				>
					<Magnet className="size-4" />
				</IconButton>
				<button
					type="button"
					onClick={() => editor.set({ ripple: !ripple })}
					className={cn(
						"ml-1 h-7 rounded-md px-2 text-[11px] font-medium transition",
						ripple ? "bg-default text-foreground" : "text-muted hover:bg-default",
					)}
					title="Ripple delete closes gaps"
				>
					Ripple
				</button>
				<button
					type="button"
					onClick={async () => {
						const preview = await run<{ ranges: unknown[]; removedMs: number }>("remove_silence", {
							dryRun: true,
						});
						if (!preview) return;
						if (preview.ranges.length === 0) return notify("No pauses long enough to remove.");
						if (
							window.confirm(
								`Remove ${preview.ranges.length} pauses (${(preview.removedMs / 1000).toFixed(1)} s) from every track?`,
							)
						)
							void run("remove_silence", {});
					}}
					className="h-7 rounded-md px-2 text-[11px] font-medium text-muted transition hover:bg-default hover:text-foreground"
					title="Find pauses in the speech and cut them from every track"
				>
					Remove pauses
				</button>
			</div>

			<div className="flex-1" />

			<div className="flex items-center gap-2">
				<Segmented
					size="xs"
					value={previewMode}
					onChange={(mode) => {
						editor.set({ previewMode: mode });
						playback.setFilter(mode === "all" ? "all" : mode);
					}}
					options={[
						{ value: "all", label: "All audio", title: "Hear every track" },
						{ value: "voiceover", label: "Voice", title: "Only the voiceover track" },
						{ value: "muted", label: "Mute", title: "No audio" },
					]}
				/>
				<IconButton
					label="Zoom out"
					shortcut="−"
					onPress={() => editor.set({ zoom: Math.max(4, zoom / 1.25) })}
				>
					<MagnifyingGlassMinus className="size-4" />
				</IconButton>
				<input
					type="range"
					min={4}
					max={600}
					value={zoom}
					onChange={(e) => editor.set({ zoom: Number(e.target.value) })}
					className="w-24 accent-[var(--accent)]"
					aria-label="Zoom"
				/>
				<IconButton
					label="Zoom in"
					shortcut="+"
					onPress={() => editor.set({ zoom: Math.min(600, zoom * 1.25) })}
				>
					<MagnifyingGlassPlus className="size-4" />
				</IconButton>
				<button
					type="button"
					className="h-7 rounded-md px-2 text-[11px] font-semibold text-muted hover:bg-default"
					onClick={() => {
						editor.set({
							zoom: Math.max(
								4,
								Math.min(600, (viewWidth - 40) / Math.max(1, project.durationMs / 1000)),
							),
						});
						if (scroller.current) scroller.current.scrollLeft = 0;
					}}
				>
					Fit
				</button>
			</div>
		</div>
	);
}

function ScissorsIcon() {
	return (
		<span className="relative flex size-4 items-center justify-center">
			<Scissors className="size-3.5" />
			<span className="absolute -right-0.5 -bottom-0.5 h-2 w-px bg-danger" />
		</span>
	);
}

function Row({
	header,
	children,
	height,
	trackId,
	dim,
	onDragOver,
	onDrop,
}: {
	header: React.ReactNode;
	children: React.ReactNode;
	height: number;
	trackId?: string;
	dim?: boolean;
	onDragOver?: (e: React.DragEvent) => void;
	onDrop?: (e: React.DragEvent) => void;
}) {
	const drop = trackDrag.use((d) =>
		d.overId === trackId && d.id !== trackId ? (d.after ? "after" : "before") : null,
	);
	return (
		<div
			className={cn(
				"relative flex border-b border-separator",
				drop === "before" && "shadow-[inset_0_2px_0_var(--accent)]",
				drop === "after" && "shadow-[inset_0_-2px_0_var(--accent)]",
			)}
			style={{ height }}
			data-track-id={trackId}
		>
			<div
				data-track-header
				className="sticky left-0 z-20 shrink-0 border-r border-separator bg-surface"
				style={{ width: HEADER_W }}
			>
				{header}
			</div>
			<div
				className={cn("timeline-grid relative flex-1", dim && "opacity-50")}
				onDragOver={onDragOver}
				onDrop={onDrop}
			>
				{children}
			</div>
		</div>
	);
}

/** Which track is being dragged by its header, and where it would land. */
const trackDrag = createStore<{ id: string | null; overId: string | null; after: boolean }>({
	id: null,
	overId: null,
	after: false,
});

/** Drag handle: reorder tracks within their group (picture above, sound below). */
function TrackGrip({ track, project }: { track: Track; project: ProjectSnapshot }) {
	const group = (t: Track) => (t.kind === "audio" ? "sound" : "picture");
	const target = (e: React.PointerEvent) => {
		const row = document
			.elementFromPoint(e.clientX, e.clientY)
			?.closest<HTMLElement>("[data-track-id]");
		const over = project.data.tracks.find((t) => t.id === row?.dataset.trackId);
		if (!row || !over || group(over) !== group(track)) return null;
		const r = row.getBoundingClientRect();
		return { overId: over.id, after: e.clientY > r.top + r.height / 2 };
	};
	return (
		<button
			type="button"
			aria-label={`Drag to reorder ${track.name}`}
			title="Drag to reorder"
			className="flex h-6 w-3.5 shrink-0 cursor-grab touch-none items-center justify-center rounded text-muted/0 group-hover:text-muted/70 hover:bg-default active:cursor-grabbing"
			onPointerDown={(e) => {
				e.currentTarget.setPointerCapture(e.pointerId);
				trackDrag.set({ id: track.id, overId: null, after: false });
			}}
			onPointerMove={(e) => {
				if (trackDrag.get().id !== track.id) return;
				const t = target(e);
				trackDrag.set(t ?? { overId: null, after: false });
			}}
			onPointerUp={() => {
				const { overId, after } = trackDrag.get();
				trackDrag.set({ id: null, overId: null, after: false });
				if (!overId || overId === track.id) return;
				const rest = project.data.tracks.filter((t) => t.id !== track.id);
				const index = rest.findIndex((t) => t.id === overId) + (after ? 1 : 0);
				void run("move_track", { id: track.id, index });
			}}
		>
			<DotsSixVertical weight="bold" className="size-3.5" />
		</button>
	);
}

/** The line between picture tracks and sound tracks. */
function GroupDivider() {
	return (
		<div className="flex h-1.5 border-b border-separator bg-background">
			<div
				className="sticky left-0 z-20 shrink-0 border-r border-separator bg-background"
				style={{ width: HEADER_W }}
			/>
		</div>
	);
}

function RowLabel({ icon, label, sub }: { icon: React.ReactNode; label: string; sub?: string }) {
	return (
		<div className="flex h-full items-center gap-2 px-3 text-[12px] font-medium text-muted">
			{icon}
			{label}
			{sub && <span className="ml-auto text-[11px] tabular-nums">{sub}</span>}
		</div>
	);
}

const KIND_ICON = { video: FilmStrip, audio: WaveIcon, text: TextT } as const;

function TrackHeader({ track, project }: { track: Track; project: ProjectSnapshot }) {
	const Icon = KIND_ICON[track.kind];
	const patch = (p: Partial<Track>) => void run("update_track", { id: track.id, patch: p });
	const index = project.data.tracks.findIndex((t) => t.id === track.id);
	return (
		<div className="group flex h-full items-center gap-1 pr-1.5 pl-1">
			<TrackGrip track={track} project={project} />
			<Icon
				className={cn(
					"size-3.5 shrink-0",
					track.kind === "video"
						? "text-track-video"
						: track.kind === "audio"
							? track.voiceover
								? "text-track-voice"
								: "text-track-audio"
							: "text-track-text",
				)}
			/>
			<div className="min-w-0 flex-1">
				<input
					key={track.name}
					defaultValue={track.name}
					onBlur={(e) =>
						e.target.value.trim() &&
						e.target.value !== track.name &&
						patch({ name: e.target.value.trim() })
					}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					}}
					className="w-full truncate rounded bg-transparent px-1 text-[12px] font-semibold outline-none focus:bg-default"
				/>
				{track.kind === "audio" && (track.voiceover || track.duck) && (
					<p className="px-1 text-[10px] text-muted">
						{track.voiceover ? "Voiceover" : "Ducks under voice"}
					</p>
				)}
			</div>
			<div className="flex items-center">
				{track.kind !== "text" && (
					<IconButton
						label={track.muted ? "Unmute" : "Mute"}
						active={track.muted}
						className={cn(!track.muted && "hidden group-hover:flex")}
						onPress={() => patch({ muted: !track.muted })}
					>
						{track.muted ? (
							<SpeakerSlash className="size-3.5" />
						) : (
							<SpeakerHigh className="size-3.5" />
						)}
					</IconButton>
				)}
				{track.kind !== "text" && (
					<button
						type="button"
						title={track.solo ? "Unsolo" : "Solo: hear only this track"}
						aria-label={track.solo ? "Unsolo" : "Solo"}
						aria-pressed={!!track.solo}
						onClick={() => patch({ solo: !track.solo })}
						className={cn(
							"flex size-7 items-center justify-center rounded-md text-[11px] font-bold",
							track.solo
								? "bg-warning/20 text-warning"
								: "hidden text-muted group-hover:flex hover:bg-default hover:text-foreground",
						)}
					>
						S
					</button>
				)}
				{track.kind !== "audio" && (
					<IconButton
						label={track.hidden ? "Show" : "Hide"}
						active={track.hidden}
						className={cn(!track.hidden && "hidden group-hover:flex")}
						onPress={() => patch({ hidden: !track.hidden })}
					>
						{track.hidden ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
					</IconButton>
				)}
				<IconButton
					label={track.locked ? "Unlock" : "Lock"}
					active={track.locked}
					className={cn(!track.locked && "hidden group-hover:flex")}
					onPress={() => patch({ locked: !track.locked })}
				>
					{track.locked ? (
						<LockSimple className="size-3.5" />
					) : (
						<LockSimpleOpen className="size-3.5" />
					)}
				</IconButton>
				<Dropdown>
					<Dropdown.Trigger
						aria-label="Track options"
						className="hidden size-7 group-hover:flex data-[pressed]:flex items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<CaretDown className="size-3" />
					</Dropdown.Trigger>
					<Dropdown.Popover placement="bottom start">
						<Dropdown.Menu
							aria-label="Track options"
							onAction={(key) => {
								if (key === "up")
									void run("move_track", { id: track.id, index: Math.max(0, index - 1) });
								if (key === "down") void run("move_track", { id: track.id, index: index + 1 });
								if (key === "voiceover") patch({ voiceover: true });
								if (key === "duck") patch({ duck: !track.duck });
								if (key === "vol-50") patch({ volume: 0.5 });
								if (key === "vol-100") patch({ volume: 1 });
								if (key === "vol-150") patch({ volume: 1.5 });
								if (key === "delete") void run("remove_track", { id: track.id });
							}}
						>
							<Dropdown.Item id="up" textValue="Move up">
								Move up
							</Dropdown.Item>
							<Dropdown.Item id="down" textValue="Move down">
								Move down
							</Dropdown.Item>
							{track.kind === "audio" && !track.voiceover ? (
								<Dropdown.Item id="voiceover" textValue="Voiceover">
									<span className="flex items-center gap-2">
										<Star className="size-3.5" /> Use for voiceover takes
									</span>
								</Dropdown.Item>
							) : null}
							{track.kind === "audio" && !track.voiceover ? (
								<Dropdown.Item id="duck" textValue="Duck under voiceover">
									{track.duck ? "✓ " : ""}Lower while the voiceover speaks
								</Dropdown.Item>
							) : null}
							{track.kind !== "text" ? (
								<Dropdown.Item id="vol-50" textValue="Volume 50%">
									Volume 50%{track.volume === 0.5 ? " ✓" : ""}
								</Dropdown.Item>
							) : null}
							{track.kind !== "text" ? (
								<Dropdown.Item id="vol-100" textValue="Volume 100%">
									Volume 100%{track.volume === 1 ? " ✓" : ""}
								</Dropdown.Item>
							) : null}
							{track.kind !== "text" ? (
								<Dropdown.Item id="vol-150" textValue="Volume 150%">
									Volume 150%{track.volume === 1.5 ? " ✓" : ""}
								</Dropdown.Item>
							) : null}
							<Dropdown.Item id="delete" textValue="Delete track" className="text-danger">
								Delete track
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</div>
	);
}

function AddTrackRow() {
	return (
		<div className="flex h-9">
			<div
				className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-separator bg-surface px-2"
				style={{ width: HEADER_W }}
			>
				<Dropdown>
					<Dropdown.Trigger className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] font-medium text-muted hover:bg-default hover:text-foreground">
						<Plus className="size-3.5" /> Add track
					</Dropdown.Trigger>
					<Dropdown.Popover placement="top start">
						<Dropdown.Menu
							aria-label="Add track"
							onAction={(key) => void run("add_track", { kind: key as "video" })}
						>
							<Dropdown.Item id="video" textValue="Video">
								Video track
							</Dropdown.Item>
							<Dropdown.Item id="audio" textValue="Audio">
								Audio track
							</Dropdown.Item>
							<Dropdown.Item id="text" textValue="Text">
								Text track
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
			<div className="flex-1" />
		</div>
	);
}

function Ruler({
	width,
	pxPerMs,
	markers,
	onDown,
}: {
	width: number;
	pxPerMs: number;
	markers: ProjectSnapshot["data"]["markers"];
	onDown: (e: ReactPointerEvent) => void;
}) {
	const inPoint = editor.use((s) => s.inPoint);
	const outPoint = editor.use((s) => s.outPoint);
	const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000];
	const step = steps.find((s) => s * pxPerMs >= 72) ?? 120000;
	const count = Math.ceil(width / (step * pxPerMs));
	return (
		<div
			data-ruler
			role="slider"
			aria-label="Timeline position"
			aria-valuenow={0}
			tabIndex={-1}
			onPointerDown={onDown}
			className="relative flex-1 cursor-text border-b border-separator bg-surface"
			style={{ width }}
		>
			{Array.from({ length: count + 1 }, (_, i) => {
				const ms = i * step;
				return (
					<div key={ms} className="absolute top-0 bottom-0" style={{ left: ms * pxPerMs }}>
						<div className="h-full w-px bg-foreground/10" />
						<span className="absolute top-1 left-1.5 text-[10px] font-medium text-muted tabular-nums">
							{formatTime(ms, step < 1000)}
						</span>
						{[1, 2, 3, 4].map((j) => (
							<div
								key={j}
								className="absolute bottom-0 h-1.5 w-px bg-foreground/15"
								style={{ left: (step / 5) * j * pxPerMs }}
							/>
						))}
					</div>
				);
			})}
			{(inPoint !== null || outPoint !== null) && (
				<div
					className="pointer-events-none absolute inset-y-0 border-x border-accent bg-accent/15"
					style={{
						left: (inPoint ?? 0) * pxPerMs,
						width: Math.max(1, ((outPoint ?? width / pxPerMs) - (inPoint ?? 0)) * pxPerMs),
					}}
					title="In/out range (I, O, / to play, X to clear)"
				/>
			)}
			{markers.map((m) => (
				<button
					key={m.id}
					type="button"
					title={`${m.label} (double-click to remove)`}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => playback.seek(m.atMs)}
					onDoubleClick={() => void run("remove_marker", { id: m.id })}
					className={cn(
						"absolute bottom-0.5 z-10 h-3 w-3 -translate-x-1/2 rotate-45 rounded-[2px]",
						m.color === "danger"
							? "bg-danger"
							: m.color === "warning"
								? "bg-warning"
								: m.color === "success"
									? "bg-success"
									: "bg-accent",
					)}
					style={{ left: m.atMs * pxPerMs }}
				/>
			))}
		</div>
	);
}

/** The timeline's horizontal scroll position, updated as it scrolls. */
function useScrollLeft(scroller: React.RefObject<HTMLDivElement | null>) {
	const [left, setLeft] = useState(0);
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const update = () => setLeft(el.scrollLeft);
		update();
		el.addEventListener("scroll", update, { passive: true });
		return () => el.removeEventListener("scroll", update);
	}, [scroller]);
	return left;
}

function SnapGuide({
	x,
	scroller,
}: {
	x: number;
	scroller: React.RefObject<HTMLDivElement | null>;
}) {
	const scrollLeft = useScrollLeft(scroller);
	if (x < scrollLeft + HEADER_W) return null;
	return (
		<div
			className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-warning"
			style={{ left: x }}
		/>
	);
}

function Playhead({
	pxPerMs,
	scroller,
}: {
	pxPerMs: number;
	scroller: React.RefObject<HTMLDivElement | null>;
}) {
	const ms = playback.clock.use((s) => s.currentMs);
	const playing = playback.clock.use((s) => s.playing);
	const scrollLeft = useScrollLeft(scroller);
	const x = HEADER_W + ms * pxPerMs;
	useEffect(() => {
		const el = scroller.current;
		if (!el || !playing) return;
		const visibleStart = el.scrollLeft + HEADER_W;
		const visibleEnd = el.scrollLeft + el.clientWidth;
		if (x > visibleEnd - 60 || x < visibleStart) el.scrollLeft = x - HEADER_W - 80;
	}, [x, playing, scroller]);
	// Scrolled behind the track headers: out of view, like the clips there.
	if (x < scrollLeft + HEADER_W) return null;
	return (
		<div
			className="pointer-events-none absolute top-0 bottom-0 z-30 w-px bg-danger"
			style={{ left: x }}
		>
			<div className="absolute -top-px left-1/2 h-3 w-3 -translate-x-1/2 rounded-b-[3px] bg-danger" />
		</div>
	);
}

// -------------------------------------------------------------------------

/** Label swatches, matching the usual NLE label colours. */
export const LABEL_COLORS: Record<string, string> = {
	red: "#ef4444",
	orange: "#f97316",
	yellow: "#eab308",
	green: "#22c55e",
	blue: "#3b82f6",
	purple: "#a855f7",
	pink: "#ec4899",
};

const CLIP_TONE: Record<string, string> = {
	adjustment:
		"bg-[repeating-linear-gradient(135deg,rgb(139_92_246/0.55)_0_6px,rgb(139_92_246/0.35)_6px_12px)]",
	video: "bg-track-video",
	image: "bg-track-image",
	audio: "bg-track-audio",
	voice: "bg-track-voice",
	text: "bg-track-text",
};

function ClipView({
	clip,
	project,
	left,
	width,
	inMs,
	height,
	pxPerMs,
	selected,
	dragging,
	transform,
	tool,
	locked,
	onDown,
	onEdgeDown,
	onContext,
}: {
	clip: Clip;
	project: ProjectSnapshot;
	left: number;
	width: number;
	/** In-point while slipping. */
	inMs?: number;
	height: number;
	pxPerMs: number;
	selected: boolean;
	dragging: boolean;
	transform?: string;
	tool: string;
	locked: boolean;
	onDown: (e: ReactPointerEvent) => void;
	onEdgeDown: (edge: "start" | "end", e: ReactPointerEvent) => void;
	onContext: (e: React.MouseEvent) => void;
}) {
	const asset =
		clip.type === "media" ? project.data.assets.find((a) => a.id === clip.assetId) : undefined;
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	const tone =
		clip.type === "text"
			? "text"
			: asset?.kind === "adjustment"
				? "adjustment"
				: asset?.kind === "image"
					? "image"
					: track?.kind === "video"
						? "video"
						: track?.voiceover
							? "voice"
							: "audio";
	const line =
		clip.type === "media" && clip.lineId
			? project.lines.find((l) => l.id === clip.lineId)
			: undefined;
	const inner = height - 6;
	const label =
		clip.type === "text"
			? clip.text
			: line
				? `${line.id} · ${asset?.name ?? ""}`
				: (clip.name ?? asset?.name ?? "Clip");
	const media = clip.type === "media" ? clip : null;
	const sourceIn = inMs ?? media?.inMs ?? 0;
	const keyframeTimes = media?.keyframes
		? [
				...new Set(
					Object.values(media.keyframes).flatMap((list) => (list ?? []).map((k) => k.atMs)),
				),
			]
		: [];
	const cursor =
		tool === "blade"
			? "cursor-crosshair"
			: locked
				? "cursor-not-allowed"
				: tool === "slip" || tool === "slide"
					? "cursor-ew-resize"
					: "cursor-grab active:cursor-grabbing";
	return (
		<div
			data-clip
			onPointerDown={onDown}
			onContextMenu={onContext}
			onDoubleClick={() => {
				const inner = nestedSequence(project, clip);
				if (inner) void run("open_sequence", { id: inner });
			}}
			className={cn(
				"group absolute top-[3px] overflow-hidden rounded-[4px] text-white",
				CLIP_TONE[tone],
				selected
					? "outline outline-2 -outline-offset-1 outline-white/90"
					: "outline outline-1 -outline-offset-1 outline-black/25",
				dragging && "opacity-85 shadow-lg shadow-black/40",
				clip.disabled && "opacity-35 grayscale",
				cursor,
			)}
			style={{ left, width, height: inner, transform, zIndex: dragging ? 25 : selected ? 5 : 1 }}
			title={clip.disabled ? `${label} (disabled)` : label}
		>
			{clip.label && (
				<div
					className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[3px]"
					style={{ background: LABEL_COLORS[clip.label] }}
				/>
			)}
			{media && asset?.kind === "video" && track?.kind === "video" && (
				<Filmstrip
					assetId={asset.id}
					file={asset.path}
					inMs={sourceIn}
					speed={media.speed}
					width={width}
					height={inner}
					pxPerMs={pxPerMs}
				/>
			)}
			{media && asset?.kind === "image" && (
				<Tiled url={project.assetUrls[asset.id]} width={width} height={inner} />
			)}
			{media && asset?.hasAudio && track?.kind === "audio" && (
				<Waveform
					assetId={asset.id}
					file={asset.path}
					inMs={sourceIn}
					spanMs={media.durationMs * media.speed}
					width={width}
					height={inner - 14}
					color="rgba(255,255,255,0.55)"
				/>
			)}
			{media && track?.kind === "video" && (
				<div className="absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/55 to-transparent" />
			)}
			{media && media.fadeInMs > 0 && (
				<div
					className="pointer-events-none absolute top-0 left-0 h-full bg-gradient-to-r from-black/40 to-transparent"
					style={{ width: media.fadeInMs * pxPerMs }}
				/>
			)}
			{media && media.fadeOutMs > 0 && (
				<div
					className="pointer-events-none absolute top-0 right-0 h-full bg-gradient-to-l from-black/40 to-transparent"
					style={{ width: media.fadeOutMs * pxPerMs }}
				/>
			)}
			{media?.transitionIn && (
				<div
					className="pointer-events-none absolute top-0 left-0 h-full border-r border-white/60 bg-white/15"
					style={{
						width: Math.max(4, media.transitionIn.durationMs * pxPerMs),
						clipPath: "polygon(0 0, 100% 50%, 0 100%)",
					}}
					title={media.transitionIn.kind === "crossfade" ? "Crossfade" : "Dip to black"}
				/>
			)}
			{media?.zooms?.map((z) => (
				<div
					key={z.id}
					className="pointer-events-none absolute bottom-0.5 h-1.5 rounded-full bg-violet-300/90"
					style={{ left: z.startMs * pxPerMs, width: Math.max(3, (z.endMs - z.startMs) * pxPerMs) }}
					title={`Zoom ${z.scale.toFixed(1)}×`}
				/>
			))}
			{keyframeTimes.map((t) => (
				<span
					key={t}
					className="pointer-events-none absolute bottom-0.5 size-2 -translate-x-1/2 rotate-45 bg-amber-300"
					style={{ left: t * pxPerMs }}
				/>
			))}
			<div
				className={cn(
					"relative flex items-center gap-1 px-1.5 text-[11px] leading-none font-medium whitespace-nowrap",
					clip.type === "text" ? "h-full" : "pt-1",
				)}
			>
				{clip.type === "text" && <TextT weight="bold" className="size-3 shrink-0" />}
				{clip.groupId && <LinkSimple weight="bold" className="size-3 shrink-0 opacity-80" />}
				<span className="truncate">{label}</span>
				{media && media.speed !== 1 && (
					<span className="rounded bg-black/30 px-1 text-[10px]">{media.speed}×</span>
				)}
				{line && line.status !== "ok" && line.status !== "empty" && (
					<span
						className={cn(
							"size-1.5 rounded-full",
							line.status === "over" ? "bg-danger" : "bg-warning",
						)}
						title={
							line.status === "over" ? "Longer than the line's max" : "Close to the line's max"
						}
					/>
				)}
			</div>
			{tool !== "blade" && !locked && (
				<>
					<div
						className="absolute top-0 left-0 z-10 h-full w-2 cursor-ew-resize bg-white/0 transition group-hover:bg-white/30"
						onPointerDown={(e) => onEdgeDown("start", e)}
					/>
					<div
						className="absolute top-0 right-0 z-10 h-full w-2 cursor-ew-resize bg-white/0 transition group-hover:bg-white/30"
						onPointerDown={(e) => onEdgeDown("end", e)}
					/>
				</>
			)}
		</div>
	);
}

/** The sequence a nested clip stands for, if it is one. */
function nestedSequence(project: ProjectSnapshot, clip: Clip): string | undefined {
	return clip.type === "media"
		? project.data.assets.find((a) => a.id === clip.assetId)?.sequenceId
		: undefined;
}

/** Opens the agent chat with the selected clips as the subject. */
function askAgentAbout(ids: string[]) {
	window.cue.selectClips(ids);
	editor.set({ panel: "agent" });
	agentDraft.set({
		text: ids.length > 1 ? "About the selected clips: " : "About the selected clip: ",
	});
}

function ClipMenu({
	menu,
	onClose,
	selected,
	project,
}: {
	menu: { x: number; y: number; clip: Clip; atMs: number };
	onClose: () => void;
	selected: string[];
	project: ProjectSnapshot;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		const left = Math.min(menu.x, window.innerWidth - width - 8);
		const top = menu.y + height > window.innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y;
		setPos({ left, top, ready: true });
	}, [menu.x, menu.y]);
	useEffect(() => {
		const close = () => onClose();
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("pointerdown", close);
		window.addEventListener("blur", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("blur", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [onClose]);
	const ids = selected.length ? selected : [menu.clip.id];
	const media = menu.clip.type === "media" ? (menu.clip as MediaClip) : null;
	const items: (
		| { label: string; icon: React.ReactNode; keys?: string; danger?: boolean; action: () => void }
		| "sep"
	)[] = [
		{
			label: "Split",
			icon: <Scissors className="size-3.5" />,
			keys: "⌘K",
			action: () => void run("split_clip", { id: menu.clip.id, atMs: Math.round(menu.atMs) }),
		},
		{
			label: "Duplicate",
			icon: <Copy className="size-3.5" />,
			keys: "⌥ drag",
			action: () => void run("duplicate_clips", { ids }),
		},
		...(media
			? [
					media.transitionIn
						? {
								label: "Remove transition",
								icon: <ChartLine className="size-3.5" />,
								action: () => void run("remove_transition", { clipId: media.id }),
							}
						: {
								label: "Crossfade from previous",
								icon: <ChartLine className="size-3.5" />,
								keys: "⌘D",
								action: () =>
									void run("add_transition", {
										clipId: media.id,
										kind: "crossfade",
										durationMs: 500,
									}),
							},
					...(!media.transitionIn
						? [
								{
									label: "Dip to black",
									icon: <ChartLine className="size-3.5" />,
									action: () =>
										void run("add_transition", { clipId: media.id, kind: "dip", durationMs: 600 }),
								},
							]
						: []),
					{
						label: "Fade in and out",
						icon: <ChartLine className="size-3.5" />,
						action: () =>
							void run("update_clip", { id: media.id, patch: { fadeInMs: 500, fadeOutMs: 500 } }),
					},
					{
						label: media.volume === 0 ? "Unmute clip" : "Mute clip",
						icon:
							media.volume === 0 ? (
								<SpeakerHigh className="size-3.5" />
							) : (
								<SpeakerSlash className="size-3.5" />
							),
						action: () =>
							void run("update_clip", {
								id: media.id,
								patch: { volume: media.volume === 0 ? 1 : 0 },
							}),
					},
				]
			: []),
		...(media &&
		project.data.assets.find((a) => a.id === media.assetId)?.kind === "video" &&
		media.volume > 0
			? [
					{
						label: "Detach audio",
						icon: <SpeakerHigh className="size-3.5" />,
						action: () => void run("detach_audio", { id: media.id }),
					},
				]
			: []),
		...(media && project.data.tracks.find((t) => t.id === media.trackId)?.kind === "video"
			? [
					{
						label: "Zoom in here",
						icon: <MagnifyingGlassPlus className="size-3.5" />,
						action: () => {
							const local = Math.max(0, Math.round(menu.atMs - media.startMs));
							void run("add_zoom", {
								clipId: media.id,
								startMs: local,
								endMs: Math.min(media.durationMs, local + 2500),
								scale: 1.8,
							});
						},
					},
				]
			: []),
		...(media && project.data.assets.find((a) => a.id === media.assetId)?.kind === "video"
			? [
					{
						label: "Hold this frame",
						icon: <Pause className="size-3.5" />,
						action: () =>
							void run("freeze_frame", {
								clipId: media.id,
								atMs: Math.round(menu.atMs),
								durationMs: 2000,
							}),
					},
				]
			: []),
		{
			label: nestedSequence(project, menu.clip) ? "Open nested sequence" : "Nest…",
			icon: <Stack className="size-3.5" />,
			action: () => {
				const inner = nestedSequence(project, menu.clip);
				if (inner) void run("open_sequence", { id: inner });
				else void run("nest_clips", { ids });
			},
		},
		{
			label: menu.clip.disabled ? "Enable" : "Disable",
			icon: <EyeOff className="size-3.5" />,
			keys: "⇧E",
			action: () => {
				const on = !menu.clip.disabled;
				for (const id of ids) void run("update_clip", { id, patch: { disabled: on } });
			},
		},
		{
			label: menu.clip.groupId ? "Unlink" : "Link selected",
			icon: <LinkSimple className="size-3.5" />,
			keys: "⌘L",
			action: () => void run(menu.clip.groupId ? "ungroup_clips" : "group_clips", { ids }),
		},
		{
			label: "Ask the agent about this…",
			icon: <Robot className="size-3.5" />,
			action: () => askAgentAbout(ids),
		},
		"sep",
		{
			label: "Delete",
			icon: <Trash className="size-3.5" />,
			keys: "⌫",
			danger: true,
			action: () => void run("delete_clips", { ids }),
		},
		{
			label: "Ripple delete",
			icon: <ArrowLineLeft className="size-3.5" />,
			keys: "⇧⌫",
			danger: true,
			action: () => void run("delete_clips", { ids, ripple: true }),
		},
	];
	return (
		<div
			ref={ref}
			role="menu"
			className="fixed z-[100] min-w-[190px] rounded-lg border border-border bg-overlay p-1 text-[12px] shadow-xl shadow-black/30"
			style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="flex items-center gap-1 px-2 pt-1 pb-1.5" role="group" aria-label="Label">
				{Object.entries(LABEL_COLORS).map(([name, color]) => (
					<button
						key={name}
						type="button"
						title={`Label ${name}`}
						aria-label={`Label ${name}`}
						onClick={() => {
							const clear = menu.clip.label === name;
							for (const id of ids)
								void run("update_clip", { id, patch: { label: clear ? null : name } });
							onClose();
						}}
						className={cn(
							"size-3.5 rounded-full ring-offset-1 ring-offset-overlay hover:ring-2 hover:ring-foreground/40",
							menu.clip.label === name && "ring-2 ring-foreground",
						)}
						style={{ background: color }}
					/>
				))}
			</div>
			{items.map((item, i) =>
				item === "sep" ? (
					<div key={`sep-${i}`} className="my-1 h-px bg-separator" />
				) : (
					<button
						key={item.label}
						type="button"
						role="menuitem"
						onClick={() => {
							item.action();
							onClose();
						}}
						className={cn(
							"flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-default",
							item.danger && "text-danger",
						)}
					>
						<span className="flex w-4 justify-center text-muted">{item.icon}</span>
						<span className="flex-1">{item.label}</span>
						{item.keys && <span className="text-[11px] text-muted">{item.keys}</span>}
					</button>
				),
			)}
		</div>
	);
}
