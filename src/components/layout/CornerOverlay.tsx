import { useRef, useState } from "react";
import { cornersAt, placement, sourceMsOf, trackedAt } from "../../../electron/core/pin";
import type { Corners, MediaClip, ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { createStore, useApp } from "../../lib/state";

/**
 * Corners on the viewer: the four corners a tracker should follow (set before
 * tracking), a pinned clip's corners (dragging one keys them at the playhead),
 * and the tracked corners of the selected clip, drawn as a thin outline.
 */

/** Corners being set for a tracker, before tracking (canvas shares). */
export const trackDraft = createStore<{ clipId: string | null; corners: Corners | null }>({
	clipId: null,
	corners: null,
});

const FRAME_MS = 1000 / 30;

export function CornerOverlay({
	project,
	width,
	height,
}: {
	project: ProjectSnapshot;
	width: number;
	height: number;
}) {
	const selectedIds = useApp((s) => s.selectedClipIds) ?? [];
	const draft = trackDraft.use((s) => s);
	const clip = project.data.clips.find(
		(c): c is MediaClip =>
			selectedIds.length === 1 && c.id === selectedIds[0] && c.type === "media",
	);
	const moving = !!clip && (!!clip.pin || !!clip.tracker?.result?.length);
	// Pins and tracks move every frame: follow the playhead then (one render per frame).
	const frame = playback.clock.use((s) => (moving ? Math.round(s.currentMs / FRAME_MS) : 0));
	const [dragging, setDragging] = useState<{ index: number; corners: Corners } | null>(null);
	const box = useRef<DOMRect | null>(null);
	if (!clip) return null;
	const ms = moving ? frame * FRAME_MS : playback.currentMs;
	const local = ms - clip.startMs;
	if (local < 0 || local >= clip.durationMs) return null;
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	if (!track || track.locked) return null;

	const drafting = draft.clipId === clip.id && draft.corners;
	let corners: Corners | null = null;
	let editable = false;
	let tone = "#7dd3fc";
	if (drafting) {
		corners = draft.corners;
		editable = true;
		tone = "#facc15";
	} else if (clip.pin) {
		corners = cornersAt(clip.pin, local);
		editable = true;
	} else if (clip.tracker?.result?.length) {
		const asset = project.data.assets.find((a) => a.id === clip.assetId);
		if (asset) {
			const at = trackedAt(clip.tracker.result, sourceMsOf(clip, local));
			const place = placement(clip, asset, project.data.canvas, local);
			corners = at.corners.map((p) => place.toCanvas(p)) as Corners;
			tone = at.confidence >= 0.6 ? "#38bdf8" : at.confidence >= 0.3 ? "#fbbf24" : "#f87171";
		}
	}
	if (!corners) return null;
	const shown = dragging?.corners ?? corners;
	const px = shown.map(([x, y]) => [x * width, y * height]);

	const commit = (next: Corners) => {
		if (drafting) {
			trackDraft.set({ corners: next });
			return;
		}
		const pin = clip.pin;
		if (!pin) return;
		// One key holds still: move it. Otherwise key the corners at the playhead.
		const at = Math.round(Math.max(0, Math.min(clip.durationMs, local)));
		const keys =
			pin.keys.length === 1
				? [{ atMs: pin.keys[0].atMs, corners: next }]
				: [
						...pin.keys.filter((k) => Math.abs(k.atMs - at) > FRAME_MS / 2),
						{ atMs: at, corners: next },
					].sort((a, b) => a.atMs - b.atMs);
		void run("update_clip", { id: clip.id, patch: { pin: { keys } } });
	};

	const toShare = (e: React.PointerEvent): [number, number] => {
		const r = box.current as DOMRect;
		const round = (v: number) => Math.round(v * 10000) / 10000;
		return [round((e.clientX - r.left) / r.width), round((e.clientY - r.top) / r.height)];
	};

	return (
		<svg
			className="pointer-events-none absolute inset-0 z-20 overflow-visible"
			width={width}
			height={height}
			ref={(el) => {
				if (el) box.current = el.getBoundingClientRect();
			}}
		>
			<title>Corners</title>
			<polygon
				points={px.map((p) => p.join(",")).join(" ")}
				fill={drafting ? "rgba(250,204,21,0.08)" : "none"}
				stroke={tone}
				strokeWidth={1.5}
				strokeDasharray={editable ? undefined : "4 3"}
			/>
			{editable &&
				px.map(([x, y], index) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: the four corners are fixed
						key={index}
						cx={x}
						cy={y}
						r={6}
						fill="white"
						stroke={tone}
						strokeWidth={2}
						className="pointer-events-auto cursor-move"
						onPointerDown={(e) => {
							e.stopPropagation();
							box.current = (
								e.currentTarget.ownerSVGElement as SVGSVGElement
							).getBoundingClientRect();
							(e.target as Element).setPointerCapture(e.pointerId);
							setDragging({ index, corners: shown });
						}}
						onPointerMove={(e) => {
							if (!dragging || dragging.index !== index) return;
							const next = dragging.corners.map((c, i) =>
								i === index ? toShare(e) : c,
							) as Corners;
							setDragging({ index, corners: next });
						}}
						onPointerUp={() => {
							if (!dragging) return;
							const next = dragging.corners;
							setDragging(null);
							commit(next);
						}}
					/>
				))}
		</svg>
	);
}
