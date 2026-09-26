import { Dropdown } from "@heroui/react";
import {
	ArrowCounterClockwise,
	ArrowLineLeft,
	ArrowsHorizontal,
	ArrowsLeftRight,
	ArrowsOutLineHorizontal,
	CaretDown,
	ChartLine,
	Check,
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
	X,
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
import { transitionLabel } from "../../../electron/core/transitions";
import type {
	Asset,
	Clip,
	LineView,
	MediaClip,
	ProjectSnapshot,
	Track,
} from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { agentDraft } from "../../lib/chat";
import { notes } from "../../lib/notes";
import { playback } from "../../lib/playback";
import { recorder } from "../../lib/recorder";
import { app, createStore, editor, useApp, useProject } from "../../lib/state";
import { cn, formatTime, nameFieldKeys } from "../../lib/utils";
import { clampLayout, layout } from "../../lib/workspace";
import { ASSET_MIME } from "../panels/MediaPanel";
import { STATUS_STYLE } from "../panels/ScriptPanel";
import { IconButton, Segmented } from "../ui/controls";
import { Filmstrip, Tiled, Waveform } from "./ClipVisuals";
import { SequenceTabs } from "./SequenceTabs";

/** Width of the track headers (resizable, remembered with the layout). */
const headerW = () => layout.get().headerWidth;
const RULER_H = 28;
const SCRIPT_H = 34;
const TRACK_H: Record<Track["kind"], number> = { video: 64, audio: 60, text: 40 };

/**
 * Track heights the user dragged, per project (a view setting, not an edit, so
 * it isn't undone and doesn't change the project file).
 */
export const trackHeights = createStore<{ project: string; heights: Record<string, number> }>({
	project: "",
	heights: {},
});
const heightsKey = (project: string) => `cue.trackHeights.${project}`;
app.subscribe(() => {
	const project = app.get().state?.project?.path ?? "";
	if (project === trackHeights.get().project) return;
	let heights: Record<string, number> = {};
	try {
		heights = JSON.parse(localStorage.getItem(heightsKey(project)) ?? "{}");
	} catch {}
	trackHeights.set({ project, heights });
});
function setTrackHeight(trackId: string, height: number | null) {
	const { project, heights } = trackHeights.get();
	const next = { ...heights };
	if (height === null) delete next[trackId];
	else next[trackId] = Math.round(Math.min(220, Math.max(26, height)));
	trackHeights.set({ heights: next });
	try {
		localStorage.setItem(heightsKey(project), JSON.stringify(next));
	} catch {}
}
/** A track's height: the user's own, else the workspace's for its kind. */
const heightOf = (
	track: Track,
	heights: Record<string, number>,
	byKind: Record<Track["kind"], number> = TRACK_H,
) => heights[track.id] ?? byKind[track.kind];
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

/** A selection rectangle being drawn, in window coordinates. */
interface Marquee {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	add: boolean;
}

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
	const [scrollerWidth, setScrollerWidth] = useState(1200);
	// Re-render when the header column is resized.
	const headerWidth = layout.use((s) => s.headerWidth);
	const viewWidth = scrollerWidth - headerWidth;
	const heights = trackHeights.use((s) => s.heights);
	const kindHeights = layout.use((s) => s.tracks);
	const [marquee, setMarquee] = useState<Marquee | null>(null);
	const marqueeRef = useRef<Marquee | null>(null);
	const scrollBucket = useScrollBucket(scroller);

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const observer = new ResizeObserver(() => setScrollerWidth(el.clientWidth));
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
		return Math.max(0, (clientX - rect.left - headerW() + el.scrollLeft) / pxPerMs);
	};

	useEffect(() => {
		const fit = () => {
			const el = scroller.current;
			const total = app.get().state?.project?.durationMs ?? 0;
			if (!el || total <= 0) return;
			editor.set({
				zoom: Math.max(4, Math.min(600, (el.clientWidth - headerW() - 40) / (total / 1000))),
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
			const anchorX = e.clientX - rect.left - headerW();
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
	const assetsById = new Map(project.data.assets.map((a) => [a.id, a]));
	const proposal = project.proposal;
	// Only clips within a screen of the view are drawn (and only their visible part of
	// filmstrips and waveforms), so long timelines stay smooth to zoom and scroll.
	const windowStart = scrollBucket - viewWidth;
	const windowEnd = scrollBucket + SCROLL_BUCKET + 2 * viewWidth;

	// ---------------------------------------------------------------------
	// Pointer handling
	// ---------------------------------------------------------------------

	// Esc during a drag, trim or slip puts everything back where it was.
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape" || !dragRef.current) return;
			e.preventDefault();
			e.stopImmediatePropagation();
			dragRef.current = null;
			setDrag(null);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, []);

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
		if (marqueeRef.current) {
			const m = { ...marqueeRef.current, x1: e.clientX, y1: e.clientY };
			marqueeRef.current = m;
			setMarquee(m);
			return;
		}
		const d = dragRef.current;
		if (!d) return;
		let next: Drag = d;
		if (d.kind === "scrub") {
			// Dragging the playhead plays the sound under it.
			playback.scrub(Math.round(timeAt(e.clientX)));
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
		const m = marqueeRef.current;
		if (m) {
			marqueeRef.current = null;
			setMarquee(null);
			// Every drawn clip the rectangle touches is selected (added to the selection with ⇧).
			const box = {
				left: Math.min(m.x0, m.x1),
				right: Math.max(m.x0, m.x1),
				top: Math.min(m.y0, m.y1),
				bottom: Math.max(m.y0, m.y1),
			};
			if (box.right - box.left < 3 && box.bottom - box.top < 3) return;
			const hit = [...document.querySelectorAll<HTMLElement>("[data-clip-id]")]
				.filter((el) => {
					const r = el.getBoundingClientRect();
					return (
						r.right > box.left && r.left < box.right && r.bottom > box.top && r.top < box.bottom
					);
				})
				.map((el) => el.dataset.clipId as string);
			window.cue.selectClips(m.add ? [...new Set([...selected, ...hit])] : hit);
			return;
		}
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
			{proposal && <ProposalBar proposal={proposal} />}
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
					// Clicking empty timeline deselects and starts a selection rectangle;
					// the ruler only moves the playhead.
					const target = e.target as HTMLElement;
					if (
						e.button !== 0 ||
						target.closest(
							"[data-clip],[data-track-header],[data-ruler],button,input,[role=button]",
						)
					)
						return;
					if (!e.shiftKey) window.cue.selectClips([]);
					if (tool !== "select") return;
					const m = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey };
					marqueeRef.current = m;
					setMarquee(m);
					e.currentTarget.setPointerCapture(e.pointerId);
				}}
			>
				<div className="relative" style={{ width: headerW() + contentWidth }}>
					{/* Ruler */}
					<div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
						<div
							className="sticky left-0 z-40 shrink-0 border-r border-b border-separator bg-surface"
							style={{ width: headerW() }}
						>
							<HeaderResizer />
						</div>
						<Ruler
							width={contentWidth}
							pxPerMs={pxPerMs}
							window={[windowStart, windowEnd]}
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
								height={heightOf(track, heights, kindHeights)}
								onResize={(h) => setTrackHeight(track.id, h)}
								header={
									<TrackHeader
										track={track}
										project={project}
										height={heightOf(track, heights, kindHeights)}
									/>
								}
								dim={track.hidden || track.muted}
								onDragOver={(e) => {
									e.preventDefault();
									e.dataTransfer.dropEffect = "copy";
								}}
								onDrop={(e) => void onDrop(track, e)}
							>
								{(clipsByTrack.get(track.id) ?? []).map((clip) => {
									const view = preview(clip);
									const left = toX(view.left);
									const width = Math.max(2, toX(view.width));
									const moving = !!liveDrag && "ids" in liveDrag && liveDrag.ids.includes(clip.id);
									if (!moving && (left + width < windowStart || left > windowEnd)) return null;
									return (
										<ClipView
											key={clip.id}
											clip={clip}
											project={project}
											asset={clip.type === "media" ? assetsById.get(clip.assetId) : undefined}
											track={track}
											left={left}
											width={width}
											visible={[Math.max(0, windowStart - left), Math.min(width, windowEnd - left)]}
											inMs={view.inMs}
											height={heightOf(track, heights, kindHeights)}
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
											review={
												proposal?.added.includes(clip.id)
													? "added"
													: proposal?.changed.includes(clip.id)
														? "changed"
														: undefined
											}
										/>
									);
								})}
								{/* Clips an agent removed (review mode), shown where they were. */}
								{proposal?.removed
									.filter((c) => c.trackId === track.id)
									.map((c) => (
										<RemovedGhost
											key={c.id}
											clip={c}
											left={toX(c.startMs)}
											width={Math.max(2, toX(c.durationMs))}
											height={heightOf(track, heights, kindHeights)}
										/>
									))}
							</Row>
						</Fragment>
					))}
					<AddTrackRow />

					{/* Snap guide and playhead */}
					{snapLine !== null && <SnapGuide x={headerW() + toX(snapLine)} scroller={scroller} />}
					<Playhead pxPerMs={pxPerMs} scroller={scroller} />
					{marquee && <MarqueeBox marquee={marquee} scroller={scroller} />}
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
	onResize,
}: {
	header: React.ReactNode;
	children: React.ReactNode;
	height: number;
	trackId?: string;
	dim?: boolean;
	onDragOver?: (e: React.DragEvent) => void;
	onDrop?: (e: React.DragEvent) => void;
	/** Drag the header's bottom edge to change the height; null resets it. */
	onResize?: (height: number | null) => void;
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
				style={{ width: headerW() }}
			>
				<HeaderResizer />
				{header}
				{onResize && (
					// biome-ignore lint/a11y/noStaticElementInteractions: a resize handle, double-click resets
					<div
						title="Drag to resize, double-click to reset"
						className="absolute inset-x-0 -bottom-[3px] z-10 h-[6px] cursor-row-resize touch-none hover:bg-accent/40"
						onPointerDown={(e) => {
							e.stopPropagation();
							e.currentTarget.setPointerCapture(e.pointerId);
							const y0 = e.clientY;
							const h0 = height;
							const el = e.currentTarget;
							const move = (m: PointerEvent) => onResize(h0 + m.clientY - y0);
							const up = () => {
								el.removeEventListener("pointermove", move);
								el.removeEventListener("pointerup", up);
							};
							el.addEventListener("pointermove", move);
							el.addEventListener("pointerup", up);
						}}
						onDoubleClick={() => onResize(null)}
					/>
				)}
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
const trackDrag = createStore<{
	id: string | null;
	overId: string | null;
	after: boolean;
	y: number;
}>({
	y: 0,
	id: null,
	overId: null,
	after: false,
});

/** Drag handle: reorder tracks within their group (picture above, sound below). */
/**
 * Reordering by dragging a track's header (anywhere but its buttons and name):
 * a line shows where it will land, within its own group (picture or sound),
 * and the timeline scrolls when you reach its top or bottom.
 */
function startTrackDrag(
	e: React.PointerEvent<HTMLElement>,
	track: Track,
	project: ProjectSnapshot,
) {
	if (e.button !== 0 || (e.target as HTMLElement).closest("button,input,[role=button]")) return;
	const group = (t: Track) => (t.kind === "audio" ? "sound" : "picture");
	const el = e.currentTarget;
	const scroller = el.closest<HTMLElement>(".overflow-auto");
	const y0 = e.clientY;
	let moving = false;
	let timer = 0;
	const at = (y: number, x: number) => {
		const rows = [...document.querySelectorAll<HTMLElement>("[data-track-id]")];
		const same = rows.filter((r) => {
			const t = project.data.tracks.find((x) => x.id === r.dataset.trackId);
			return t && group(t) === group(track);
		});
		if (!same.length) return null;
		// The nearest row of the same group, even when the pointer is past its group.
		let best = same[0];
		let bestDistance = Number.POSITIVE_INFINITY;
		for (const r of same) {
			const b = r.getBoundingClientRect();
			const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
			if (d < bestDistance) {
				bestDistance = d;
				best = r;
			}
		}
		const b = best.getBoundingClientRect();
		return { overId: best.dataset.trackId as string, after: y > b.top + b.height / 2, x };
	};
	const move = (m: PointerEvent) => {
		if (!moving && Math.abs(m.clientY - y0) < 4) return;
		if (!moving) {
			moving = true;
			el.setPointerCapture(m.pointerId);
		}
		const t = at(m.clientY, m.clientX);
		trackDrag.set({
			id: track.id,
			overId: t?.overId ?? null,
			after: t?.after ?? false,
			y: m.clientY,
		});
		// Scroll when near the top or bottom edge of the timeline.
		window.clearInterval(timer);
		if (scroller) {
			const r = scroller.getBoundingClientRect();
			const dir = m.clientY < r.top + 40 ? -1 : m.clientY > r.bottom - 30 ? 1 : 0;
			if (dir) timer = window.setInterval(() => (scroller.scrollTop += dir * 12), 16);
		}
	};
	const up = () => {
		window.removeEventListener("pointermove", move);
		window.removeEventListener("pointerup", up);
		window.clearInterval(timer);
		const { overId, after } = trackDrag.get();
		trackDrag.set({ id: null, overId: null, after: false, y: 0 });
		if (!moving || !overId || overId === track.id) return;
		const rest = project.data.tracks.filter((t) => t.id !== track.id);
		const index = rest.findIndex((t) => t.id === overId) + (after ? 1 : 0);
		void run("move_track", { id: track.id, index });
	};
	window.addEventListener("pointermove", move);
	window.addEventListener("pointerup", up);
}

/** The line between picture tracks and sound tracks. */
function GroupDivider() {
	return (
		<div className="flex h-1.5 border-b border-separator bg-background">
			<div
				className="sticky left-0 z-20 shrink-0 border-r border-separator bg-background"
				style={{ width: headerW() }}
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

/** Drag the right edge of the track headers to make them wider or narrower. */
function HeaderResizer() {
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: a resize edge; double-click resets
		<div
			title="Drag to resize the track headers"
			className="absolute inset-y-0 -right-[3px] z-30 w-[6px] cursor-col-resize hover:bg-accent/40"
			onPointerDown={(e) => {
				e.stopPropagation();
				e.preventDefault();
				const x0 = e.clientX;
				const w0 = layout.get().headerWidth;
				const move = (m: PointerEvent) =>
					layout.set(clampLayout({ headerWidth: w0 + m.clientX - x0 }));
				const up = () => {
					window.removeEventListener("pointermove", move);
					window.removeEventListener("pointerup", up);
				};
				window.addEventListener("pointermove", move);
				window.addEventListener("pointerup", up);
			}}
			onDoubleClick={() => layout.set({ headerWidth: 236 })}
		/>
	);
}

/** A small toggle in a track header: dim when off, coloured when on, always in place. */
function HeaderToggle({
	label,
	on,
	onToggle,
	children,
	tone = "accent",
}: {
	label: string;
	on: boolean;
	onToggle: () => void;
	children: React.ReactNode;
	tone?: "accent" | "warning" | "danger";
}) {
	return (
		<button
			type="button"
			title={label}
			aria-label={label}
			aria-pressed={on}
			onClick={onToggle}
			className={cn(
				"flex size-6 shrink-0 items-center justify-center rounded-md text-[10px] font-bold transition-colors",
				on
					? tone === "warning"
						? "bg-warning/20 text-warning"
						: tone === "danger"
							? "bg-danger/15 text-danger"
							: "bg-accent/15 text-accent"
					: "text-muted/60 hover:bg-default hover:text-foreground",
			)}
		>
			{children}
		</button>
	);
}

function TrackHeader({
	track,
	project,
	height,
}: {
	track: Track;
	project: ProjectSnapshot;
	height: number;
}) {
	const Icon = KIND_ICON[track.kind];
	const patch = (p: Partial<Track>) => void run("update_track", { id: track.id, patch: p });
	const index = project.data.tracks.findIndex((t) => t.id === track.id);
	const dragging = trackDrag.use((d) => d.id === track.id);
	// Tall tracks show the controls on their own row; short ones fit them beside the name.
	const tall = height >= 52;
	const note =
		track.kind === "audio" && track.voiceover
			? "Voiceover"
			: track.kind === "audio" && track.duck
				? "Ducks"
				: null;
	const controls = (
		<div className="flex shrink-0 items-center gap-px">
			{track.kind !== "text" && (
				<HeaderToggle
					label={track.muted ? "Unmute" : "Mute"}
					on={track.muted}
					tone="danger"
					onToggle={() => patch({ muted: !track.muted })}
				>
					{track.muted ? (
						<SpeakerSlash className="size-3.5" />
					) : (
						<SpeakerHigh className="size-3.5" />
					)}
				</HeaderToggle>
			)}
			{track.kind !== "text" && (
				<HeaderToggle
					label={track.solo ? "Unsolo" : "Solo: hear only this track"}
					on={!!track.solo}
					tone="warning"
					onToggle={() => patch({ solo: !track.solo })}
				>
					S
				</HeaderToggle>
			)}
			{track.kind !== "audio" && (
				<HeaderToggle
					label={track.hidden ? "Show" : "Hide"}
					on={track.hidden}
					onToggle={() => patch({ hidden: !track.hidden })}
				>
					{track.hidden ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
				</HeaderToggle>
			)}
			<HeaderToggle
				label={track.locked ? "Unlock" : "Lock"}
				on={track.locked}
				onToggle={() => patch({ locked: !track.locked })}
			>
				{track.locked ? (
					<LockSimple className="size-3.5" />
				) : (
					<LockSimpleOpen className="size-3.5" />
				)}
			</HeaderToggle>
			<Dropdown>
				<Dropdown.Trigger
					aria-label="Track options"
					className="flex size-6 items-center justify-center rounded-md text-muted/60 hover:bg-default hover:text-foreground"
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
	);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: dragging the header reorders; the grip button says so
		<div
			className={cn(
				"group flex h-full min-w-0 cursor-grab flex-col justify-center gap-0.5 pr-1.5 pl-1 active:cursor-grabbing",
				dragging && "opacity-50",
			)}
			onPointerDown={(e) => startTrackDrag(e, track, project)}
		>
			<div className="flex min-w-0 items-center gap-1">
				<span
					aria-hidden
					title="Drag to reorder"
					className="flex h-6 w-3.5 shrink-0 items-center justify-center text-muted/30 group-hover:text-muted/80"
				>
					<DotsSixVertical weight="bold" className="size-3.5" />
				</span>
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
				<input
					key={track.name}
					defaultValue={track.name}
					title={track.name}
					onBlur={(e) =>
						e.target.value.trim() &&
						e.target.value !== track.name &&
						patch({ name: e.target.value.trim() })
					}
					onKeyDown={nameFieldKeys(track.name)}
					className="min-w-0 flex-1 cursor-text truncate rounded bg-transparent px-1 text-[12px] font-semibold outline-none focus:bg-default"
				/>
				{!tall && controls}
			</div>
			{tall && (
				<div className="flex min-w-0 items-center gap-1 pl-5">
					{note ? (
						<span className="min-w-0 truncate text-[10px] text-muted">{note}</span>
					) : (
						<span className="flex-1" />
					)}
					<div className="ml-auto">{controls}</div>
				</div>
			)}
		</div>
	);
}

function AddTrackRow() {
	return (
		<div className="flex h-9">
			<div
				className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-separator bg-surface px-2"
				style={{ width: headerW() }}
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
	window: [from, to],
	markers,
	onDown,
}: {
	width: number;
	pxPerMs: number;
	/** Only ticks in this range (px) are drawn. */
	window: [number, number];
	markers: ProjectSnapshot["data"]["markers"];
	onDown: (e: ReactPointerEvent) => void;
}) {
	const inPoint = editor.use((s) => s.inPoint);
	const outPoint = editor.use((s) => s.outPoint);
	const noteDots = notes.use((s) => s.list);
	const steps = [100, 250, 500, 1000, 2000, 5000, 10000, 15000, 30000, 60000, 120000];
	const step = steps.find((s) => s * pxPerMs >= 72) ?? 120000;
	const first = Math.max(0, Math.floor(from / (step * pxPerMs)));
	const last = Math.min(Math.ceil(width / (step * pxPerMs)), Math.ceil(to / (step * pxPerMs)));
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
			{Array.from({ length: Math.max(0, last - first + 1) }, (_, n) => {
				const ms = (first + n) * step;
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
			{/* Director's notes, while the Notes pane is open: small dots, under the markers. */}
			{noteDots.map((n) => (
				<button
					key={n.id}
					type="button"
					title={n.message}
					onPointerDown={(e) => e.stopPropagation()}
					onClick={() => playback.seek(n.atMs)}
					className={cn(
						"absolute top-0.5 z-10 size-1.5 -translate-x-1/2 rounded-full opacity-80 hover:opacity-100",
						n.severity === "problem"
							? "bg-danger"
							: n.severity === "warning"
								? "bg-warning"
								: "bg-accent",
					)}
					style={{ left: n.atMs * pxPerMs }}
				/>
			))}
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

/** Keep or undo one clip's proposed change. */
function ReviewButtons({ clipId }: { clipId: string }) {
	const button =
		"flex size-5 items-center justify-center rounded bg-black/60 text-white/90 hover:bg-black/80";
	return (
		<div className="absolute top-1 right-1 z-20 hidden gap-0.5 group-hover:flex">
			<button
				type="button"
				title="Keep this change"
				className={button}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => void run("review_changes", { action: "accept", clipIds: [clipId] })}
			>
				<Check className="size-3" weight="bold" />
			</button>
			<button
				type="button"
				title="Undo this change"
				className={button}
				onPointerDown={(e) => e.stopPropagation()}
				onClick={() => void run("review_changes", { action: "reject", clipIds: [clipId] })}
			>
				<X className="size-3" weight="bold" />
			</button>
		</div>
	);
}

/** Where a clip the agent removed used to be, with a way to bring it back. */
function RemovedGhost({
	clip,
	left,
	width,
	height,
}: {
	clip: Clip;
	left: number;
	width: number;
	height: number;
}) {
	return (
		<div
			className="group absolute top-[3px] z-[2] overflow-hidden rounded-[4px] border border-dashed border-rose-400/80 bg-rose-500/10"
			style={{ left, width, height: height - 6 }}
			title="Removed by the agent"
		>
			<span className="absolute top-1 left-1.5 truncate text-[10px] text-rose-200/80 line-through">
				{clip.type === "text" ? clip.text : (clip.name ?? "Clip")}
			</span>
			<div className="absolute top-1 right-1 hidden gap-0.5 group-hover:flex">
				<button
					type="button"
					title="Keep it removed"
					className="flex size-5 items-center justify-center rounded bg-black/60 text-white/90 hover:bg-black/80"
					onClick={() => void run("review_changes", { action: "accept", clipIds: [clip.id] })}
				>
					<Check className="size-3" weight="bold" />
				</button>
				<button
					type="button"
					title="Bring it back"
					className="flex size-5 items-center justify-center rounded bg-black/60 text-white/90 hover:bg-black/80"
					onClick={() => void run("review_changes", { action: "reject", clipIds: [clip.id] })}
				>
					<ArrowCounterClockwise className="size-3" weight="bold" />
				</button>
			</div>
		</div>
	);
}

/** The agent's pending changes, with keep and undo for all of them. */
function ProposalBar({ proposal }: { proposal: NonNullable<ProjectSnapshot["proposal"]> }) {
	const parts = [
		proposal.added.length && `${proposal.added.length} added`,
		proposal.changed.length && `${proposal.changed.length} changed`,
		proposal.removed.length && `${proposal.removed.length} removed`,
		proposal.other && "other changes",
	].filter(Boolean);
	return (
		<div className="flex h-9 shrink-0 items-center gap-3 border-b border-separator bg-amber-500/10 px-3 text-[12px]">
			<Robot className="size-4 text-amber-300" />
			<span className="font-medium">The agent proposes changes</span>
			<span className="truncate text-muted" title={proposal.steps.join("\n")}>
				{parts.join(" · ")} · {proposal.steps.at(-1)}
			</span>
			<div className="ml-auto flex gap-1.5">
				<button
					type="button"
					className="h-7 rounded-md px-2.5 text-muted hover:bg-default hover:text-foreground"
					onClick={() => void run("review_changes", { action: "reject" })}
				>
					Undo all
				</button>
				<button
					type="button"
					className="h-7 rounded-md bg-accent px-3 font-medium text-accent-foreground"
					onClick={() => void run("review_changes", { action: "accept" })}
				>
					Keep all
				</button>
			</div>
		</div>
	);
}

/** Volume 0–2 as a height inside a clip (1 = unity sits at a third from the top). */
const volumeY = (v: number, h: number) =>
	Math.max(2, h - 4 - (Math.min(2, Math.max(0, v)) / 2) * (h - 8) * 1.33);

/**
 * The clip's volume drawn as a line (following its volume keyframes). Dragging
 * the line up or down sets the clip's level, as in Premiere; the keyframes
 * themselves are edited in the inspector.
 */
function VolumeLine({ clip, width, height }: { clip: MediaClip; width: number; height: number }) {
	const [live, setLive] = useState<number | null>(null);
	const keys = clip.keyframes?.volume ?? [];
	const volume = live ?? clip.volume;
	const points =
		keys.length && live === null
			? [
					`0,${volumeY(keys[0].value, height)}`,
					...keys.map((k) => `${(k.atMs / clip.durationMs) * width},${volumeY(k.value, height)}`),
					`${width},${volumeY(keys[keys.length - 1].value, height)}`,
				].join(" ")
			: `0,${volumeY(volume, height)} ${width},${volumeY(volume, height)}`;
	const db = volume > 0 ? `${(20 * Math.log10(volume)).toFixed(1)} dB` : "−∞ dB";
	return (
		<svg
			className="absolute inset-0 z-[6]"
			width={width}
			height={height}
			aria-label={`Volume ${db}`}
			role="img"
		>
			<title>{`Volume ${db}${keys.length ? " (keyframed)" : ""}`}</title>
			<polyline points={points} fill="none" stroke="rgba(255,236,140,0.9)" strokeWidth={1.25} />
			{!keys.length && (
				// A wider invisible line to grab.
				<line
					x1={0}
					x2={width}
					y1={volumeY(volume, height)}
					y2={volumeY(volume, height)}
					stroke="transparent"
					strokeWidth={8}
					className="cursor-ns-resize"
					onPointerDown={(e) => {
						e.stopPropagation();
						const el = e.currentTarget;
						el.setPointerCapture(e.pointerId);
						const y0 = e.clientY;
						const v0 = clip.volume;
						const scale = (height - 8) * 1.33;
						let value = v0;
						const move = (m: PointerEvent) => {
							value =
								Math.round(Math.min(2, Math.max(0, v0 - ((m.clientY - y0) / scale) * 2)) * 100) /
								100;
							setLive(value);
						};
						const up = () => {
							el.removeEventListener("pointermove", move);
							el.removeEventListener("pointerup", up);
							if (value !== v0) void run("update_clip", { id: clip.id, patch: { volume: value } });
							setLive(null);
						};
						el.addEventListener("pointermove", move);
						el.addEventListener("pointerup", up);
					}}
				/>
			)}
			{live !== null && (
				<text x={6} y={Math.max(12, volumeY(volume, height) - 4)} fill="white" fontSize={10}>
					{db}
				</text>
			)}
		</svg>
	);
}

/** The selection rectangle, drawn in the timeline's content. */
function MarqueeBox({
	marquee: m,
	scroller,
}: {
	marquee: Marquee;
	scroller: React.RefObject<HTMLDivElement | null>;
}) {
	const el = scroller.current;
	if (!el) return null;
	const r = el.getBoundingClientRect();
	const x = (v: number) => v - r.left + el.scrollLeft;
	const y = (v: number) => v - r.top + el.scrollTop;
	return (
		<div
			className="pointer-events-none absolute z-40 rounded-sm border border-accent bg-accent/15"
			style={{
				left: Math.min(x(m.x0), x(m.x1)),
				top: Math.min(y(m.y0), y(m.y1)),
				width: Math.abs(m.x1 - m.x0),
				height: Math.abs(m.y1 - m.y0),
			}}
		/>
	);
}

/** Clips are culled against the scroll position rounded to this many pixels. */
const SCROLL_BUCKET = 512;

/** The scroll position in steps of SCROLL_BUCKET, so scrolling re-renders rarely. */
function useScrollBucket(scroller: React.RefObject<HTMLDivElement | null>) {
	const [bucket, setBucket] = useState(0);
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const update = () => setBucket(Math.floor(el.scrollLeft / SCROLL_BUCKET) * SCROLL_BUCKET);
		update();
		el.addEventListener("scroll", update, { passive: true });
		return () => el.removeEventListener("scroll", update);
	}, [scroller]);
	return bucket;
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
	if (x < scrollLeft + headerW()) return null;
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
	const x = headerW() + ms * pxPerMs;
	useEffect(() => {
		const el = scroller.current;
		if (!el || !playing) return;
		const visibleStart = el.scrollLeft + headerW();
		const visibleEnd = el.scrollLeft + el.clientWidth;
		if (x > visibleEnd - 60 || x < visibleStart) el.scrollLeft = x - headerW() - 80;
	}, [x, playing, scroller]);
	// Scrolled behind the track headers: out of view, like the clips there.
	if (x < scrollLeft + headerW()) return null;
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
	asset,
	track,
	left,
	width,
	visible,
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
	review,
}: {
	clip: Clip;
	project: ProjectSnapshot;
	asset: Asset | undefined;
	track: Track;
	left: number;
	width: number;
	/** The part of the clip (px from its left edge) worth drawing. */
	visible: [number, number];
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
	/** Proposed by an agent and waiting for the user (review mode). */
	review?: "added" | "changed";
}) {
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
			data-clip-id={clip.id}
			// Reachable with Tab: Enter selects (⇧ adds), the menu key or ⇧F10 opens the clip menu.
			role="button"
			tabIndex={0}
			aria-label={label}
			aria-pressed={selected}
			onKeyDown={(e) => {
				if (e.key === "Enter") {
					e.preventDefault();
					e.stopPropagation();
					const ids = window.cue ? [clip.id] : [];
					if (e.shiftKey) {
						const current = app.get().state?.selectedClipIds ?? [];
						window.cue.selectClips(
							current.includes(clip.id)
								? current.filter((id) => id !== clip.id)
								: [...current, clip.id],
						);
					} else window.cue.selectClips(ids);
				} else if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
					e.preventDefault();
					const r = e.currentTarget.getBoundingClientRect();
					onContext({
						preventDefault() {},
						clientX: r.left + Math.min(24, r.width / 2),
						clientY: r.bottom,
					} as unknown as React.MouseEvent);
				}
			}}
			onPointerDown={onDown}
			onContextMenu={onContext}
			onDoubleClick={() => {
				const inner = nestedSequence(project, clip);
				if (inner) void run("open_sequence", { id: inner });
			}}
			className={cn(
				"group absolute top-[3px] overflow-hidden rounded-[4px] text-white focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none",
				CLIP_TONE[tone],
				selected
					? "outline outline-2 -outline-offset-1 outline-white/90"
					: review === "added"
						? "outline outline-2 -outline-offset-1 outline-emerald-400"
						: review === "changed"
							? "outline outline-2 -outline-offset-1 outline-amber-400"
							: "outline outline-1 -outline-offset-1 outline-black/25",
				dragging && "opacity-85 shadow-lg shadow-black/40",
				clip.disabled && "opacity-35 grayscale",
				cursor,
			)}
			style={{ left, width, height: inner, transform, zIndex: dragging ? 25 : selected ? 5 : 1 }}
			title={clip.disabled ? `${label} (disabled)` : label}
		>
			{review && <ReviewButtons clipId={clip.id} />}
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
					visible={visible}
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
					visible={visible}
					color="rgba(255,255,255,0.55)"
				/>
			)}
			{/* The sound of a video clip, as a thin strip along its bottom edge. */}
			{media &&
				asset?.kind === "video" &&
				asset.hasAudio &&
				track?.kind === "video" &&
				media.volume > 0 && (
					<>
						<div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-gradient-to-t from-black/60 to-transparent" />
						<Waveform
							assetId={asset.id}
							file={asset.path}
							inMs={sourceIn}
							spanMs={media.durationMs * media.speed}
							width={width}
							height={14}
							visible={visible}
							color="rgba(255,255,255,0.5)"
						/>
					</>
				)}
			{media && track?.kind === "video" && (
				<div className="absolute inset-x-0 top-0 h-5 bg-gradient-to-b from-black/55 to-transparent" />
			)}
			{media && track?.kind === "audio" && !locked && inner > 30 && (
				<VolumeLine clip={media} width={width} height={inner} />
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
					title={transitionLabel(media.transitionIn.kind)}
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
		// Keyboard users land on the first item.
		el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
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
		...(media && project.data.assets.find((a) => a.id === media.assetId)?.kind === "video"
			? [
					{
						label: "Split at shot changes",
						icon: <Scissors className="size-3.5" />,
						action: () => {
							notify("Finding shot changes…");
							void run<{ summary: string }>("split_at_scenes", { clipId: media.id }).then(
								(r) => r && notify(r.summary, "success"),
							);
						},
					},
				]
			: []),
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
			// Arrow keys move between items, as in a native menu.
			onKeyDown={(e) => {
				const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
				const at = items.indexOf(document.activeElement as HTMLElement);
				const go = (i: number) => items[(i + items.length) % items.length]?.focus();
				if (e.key === "ArrowDown") go(at + 1);
				else if (e.key === "ArrowUp") go(at < 0 ? -1 : at - 1);
				else if (e.key === "Home") go(0);
				else if (e.key === "End") go(-1);
				else return;
				e.preventDefault();
				e.stopPropagation();
			}}
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
