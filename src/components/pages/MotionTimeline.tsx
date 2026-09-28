import {
	CaretLeft,
	CaretRight,
	Circle,
	CircleNotch,
	Eye,
	EyeSlash,
	FolderOpen,
	FolderSimple,
	Image,
	LineSegment,
	MagnifyingGlassMinus,
	MagnifyingGlassPlus,
	Path,
	Pause,
	Play,
	Plus,
	Square,
	TextT,
	Timer,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
	addPreset,
	animatedProps,
	KEY_PROPS,
	type KeyProp,
	keyableProps,
	keysOf,
	type PresetSide,
	presetDuration,
	presetsOf,
	removePreset,
	updatePreset,
	valueAt,
} from "../../../electron/core/motionKeys";
import {
	type LayerRow,
	layerAt,
	listLayers,
	updateLayer,
} from "../../../electron/core/motionLayers";
import { MOTION_PRESETS } from "../../../electron/core/motionSpec";
import {
	clampKeyDelta,
	clampSlide,
	copyKeys,
	deleteKeys,
	type Interpolation,
	interpolateKeys,
	interpolationOf,
	type KeyClipboard,
	type KeySel,
	keyGlyph,
	keyIndexAt,
	keysAsSel,
	layerSpan,
	moveKeys,
	nextKeyTime,
	pasteKeys,
	resizePreset,
	selId,
	setValueAt,
	slideLayer,
	snapTime,
	startAnimating,
	stopAnimating,
	toggleKeyAt,
	trimLayer,
} from "../../../electron/core/motionTimeline";
import { cn } from "../../lib/utils";
import {
	ColorValue,
	KeyGlyph,
	type MenuItem,
	PopupMenu,
	type PresetSel,
	propUi,
	RenameText,
	RowButton,
	ScrubValue,
	timecode,
} from "./MotionKeys";

/**
 * The Motion page's timeline, laid out like After Effects: the layer tree on
 * the left (twirl a layer open for its properties, each with a stopwatch, a
 * scrubbable value and key navigation), and on the right a time ruler with a
 * playhead, each layer's bar (trim its ends, slide it, stretch its entrance and
 * exit) and the keys of each property, shaped by their eases. Drags preview
 * live and are saved once, on release; every save is one undoable step.
 */

type Json = Record<string, unknown>;

const LEFT = 330;
const ROW_H = 22;
const RULER_H = 26;
const TAIL = 32;
const MAX_ZOOM = 60;

/** Copied keys, kept while the page is open (pasted at the playhead with ⌘V). */
let clipboard: KeyClipboard = [];

type Row =
	| { kind: "layer"; row: LayerRow }
	| { kind: "prop"; row: LayerRow; prop: KeyProp }
	| { kind: "preset"; row: LayerRow; side: PresetSide };

type Drag =
	| {
			kind: "keys";
			x0: number;
			base: Json;
			sel: KeySel[];
			anchor: number;
			delta: number;
			moved: boolean;
			/** A plain click on a key already picked with others: pick just it on release. */
			only?: KeySel;
	  }
	| {
			kind: "slide" | "start" | "end";
			x0: number;
			base: Json;
			path: number[];
			/** The time under the pointer when the drag began (an edge, or the grab point). */
			ms0: number;
			ms: number;
			moved: boolean;
	  }
	| {
			kind: "preset";
			x0: number;
			base: Json;
			path: number[];
			side: PresetSide;
			index: number;
			edge: "start" | "end" | "move";
			ms0: number;
			ms: number;
			moved: boolean;
	  }
	| {
			kind: "marquee";
			x0: number;
			y0: number;
			x1: number;
			y1: number;
			add: KeySel[];
			picked?: KeySel[];
	  }
	| { kind: "scrub" };

const TYPE_ICON: Record<string, ReactNode> = {
	rect: <Square className="size-3.5" />,
	ellipse: <Circle className="size-3.5" />,
	arc: <CircleNotch className="size-3.5" />,
	line: <LineSegment className="size-3.5" />,
	path: <Path className="size-3.5" />,
	text: <TextT className="size-3.5" />,
	image: <Image className="size-3.5" />,
};

/** A layer's property rows: what its type can animate, plus anything it already animates. */
function propsOf(layer: Json): KeyProp[] {
	const order = KEY_PROPS.map((p) => p.prop);
	const all = new Set([...keyableProps(layer), ...animatedProps(layer)]);
	return order.filter((p) => all.has(p));
}

/** Ruler steps: whole frames, then seconds. */
function rulerSteps(fps: number) {
	const f = 1000 / fps;
	return [1, 2, 5, 10, 15]
		.map((n) => n * f)
		.concat([1, 2, 5, 10, 15, 30, 60].map((s) => s * 1000))
		.filter((v, i, all) => all.indexOf(v) === i)
		.sort((a, b) => a - b);
}

export function MotionTimeline({
	spec,
	fps,
	atMs,
	onSeekMs,
	playing,
	onTogglePlay,
	selected,
	onSelect,
	keySel,
	onKeySel,
	presetSel,
	onPresetSel,
	commit,
	preview,
}: {
	/** The graphic as shown (a drag's preview, or as saved). */
	spec: Json;
	fps: number;
	/** The playhead, on a whole frame. */
	atMs: number;
	onSeekMs: (ms: number) => void;
	playing: boolean;
	onTogglePlay: () => void;
	selected: number[] | null;
	onSelect: (path: number[] | null) => void;
	keySel: KeySel[];
	onKeySel: (sel: KeySel[]) => void;
	presetSel: PresetSel | null;
	onPresetSel: (sel: PresetSel | null) => void;
	commit: (next: Json) => Promise<void>;
	preview: (next: Json | null) => void;
}) {
	const duration = Number(spec.durationMs ?? 3000);
	const frameMs = 1000 / fps;
	const [open, setOpen] = useState<Set<string>>(() => new Set());
	const [folded, setFolded] = useState<Set<string>>(() => new Set());
	const [zoom, setZoom] = useState(1);
	const [viewW, setViewW] = useState(800);
	const [drag, setDragState] = useState<Drag | null>(null);
	const dragRef = useRef<Drag | null>(null);
	const setDrag = (d: Drag | null) => {
		dragRef.current = d;
		setDragState(d);
	};
	const [menu, setMenu] = useState<{
		x: number;
		y: number;
		title?: string;
		items: (MenuItem | null)[];
	} | null>(null);
	const scroller = useRef<HTMLDivElement>(null);
	const content = useRef<HTMLDivElement>(null);
	const rowsEl = useRef<HTMLDivElement>(null);
	const zoomAnchor = useRef<{ ms: number; x: number } | null>(null);

	const fitPx = Math.max(0.01, (viewW - LEFT - TAIL) / duration);
	const px = fitPx * zoom;
	const trackW = Math.ceil(duration * px) + TAIL;

	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => setViewW(entry.contentRect.width));
		observer.observe(el);
		return () => observer.disconnect();
	}, []);

	// Zooming keeps the time under the pointer (or the playhead) in place.
	const zoomTo = (next: number, anchor?: { ms: number; x: number }) => {
		const z = Math.min(MAX_ZOOM, Math.max(1, next));
		const el = scroller.current;
		if (el)
			zoomAnchor.current = anchor ?? {
				ms: atMs,
				x: LEFT + atMs * px - el.scrollLeft,
			};
		setZoom(z);
	};
	useLayoutEffect(() => {
		const a = zoomAnchor.current;
		const el = scroller.current;
		if (!a || !el) return;
		zoomAnchor.current = null;
		el.scrollLeft = Math.max(0, LEFT + a.ms * px - a.x);
	}, [px]);
	const zoomRef = useRef({ zoom, px });
	zoomRef.current = { zoom, px };
	useEffect(() => {
		const el = scroller.current;
		if (!el) return;
		const onWheel = (e: WheelEvent) => {
			if (!e.metaKey && !e.ctrlKey) return;
			e.preventDefault();
			const r = el.getBoundingClientRect();
			const x = e.clientX - r.left;
			const { zoom: z, px: p } = zoomRef.current;
			const ms = Math.max(0, (x + el.scrollLeft - LEFT) / p);
			const factor = Math.exp(-e.deltaY * 0.01);
			const nz = Math.min(MAX_ZOOM, Math.max(1, z * factor));
			zoomAnchor.current = { ms, x };
			setZoom(nz);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, []);

	// The rows: every layer (a folded group hides what is in it), and a twirled layer's properties.
	const rows = useMemo(() => {
		const out: Row[] = [];
		const hiddenUnder: string[] = [];
		for (const row of listLayers(spec)) {
			const id = row.path.join(".");
			if (hiddenUnder.some((g) => id.startsWith(`${g}.`))) continue;
			out.push({ kind: "layer", row });
			if (row.type === "group" && folded.has(id)) hiddenUnder.push(id);
			if (!open.has(id)) continue;
			for (const prop of propsOf(row.layer)) out.push({ kind: "prop", row, prop });
			out.push({ kind: "preset", row, side: "enter" });
			out.push({ kind: "preset", row, side: "exit" });
		}
		return out;
	}, [spec, open, folded]);

	const selKey = selected?.join(".");
	const selSet = useMemo(() => new Set(keySel.map(selId)), [keySel]);
	const keyDrag = drag?.kind === "keys" && drag.moved ? drag : null;
	const isPicked = (path: number[], prop: KeyProp, ms: number) =>
		selSet.has(selId({ path, prop, ms: keyDrag ? ms - keyDrag.delta : ms }));

	const toggle = (set: Set<string>, id: string) => {
		const next = new Set(set);
		if (next.has(id)) next.delete(id);
		else next.add(id);
		return next;
	};

	/** The time at a pointer's x. */
	const msAt = (clientX: number) => {
		const r = content.current?.getBoundingClientRect();
		return r ? (clientX - r.left - LEFT) / px : 0;
	};
	const seekTo = (ms: number) => onSeekMs(Math.min(duration, Math.max(0, snapTime(ms, fps))));

	const saveLayer = (path: number[], patch: Json) => void commit(updateLayer(spec, path, patch));

	// -------------------------------------------------------------------------
	// Dragging (keys, layer bars, presets, the marquee, the ruler)
	// -------------------------------------------------------------------------

	const latest = useRef({ spec, rows, px, atMs, keySel, duration });
	latest.current = { spec, rows, px, atMs, keySel, duration };

	const dragging = drag !== null;
	// biome-ignore lint/correctness/useExhaustiveDependencies: listeners read the latest values through refs
	useEffect(() => {
		if (!dragging) return;
		// Scrolled during the drag (at an edge): the time under the pointer moves by that much too.
		const scroll0 = scroller.current?.scrollLeft ?? 0;
		let last: { clientX: number; clientY: number } | null = null;
		const onMove = (e: { clientX: number; clientY: number }) => {
			last = { clientX: e.clientX, clientY: e.clientY };
			const d = dragRef.current;
			if (!d) return;
			const shift = (scroller.current?.scrollLeft ?? scroll0) - scroll0;
			const { px: p, atMs: playhead, rows: rs } = latest.current;
			const tol = 6 / p;
			if (d.kind === "scrub") return seekTo(msAt(e.clientX));
			if (d.kind === "marquee") {
				const r = rowsEl.current?.getBoundingClientRect();
				if (!r) return;
				const x1 = e.clientX - r.left;
				const y1 = e.clientY - r.top;
				const lo = { x: Math.min(d.x0, x1), y: Math.min(d.y0, y1) };
				const hi = { x: Math.max(d.x0, x1), y: Math.max(d.y0, y1) };
				const hits: KeySel[] = [];
				rs.forEach((row, i) => {
					if (row.kind !== "prop") return;
					const cy = i * ROW_H + ROW_H / 2;
					if (cy < lo.y - 4 || cy > hi.y + 4) return;
					for (const k of keysOf(row.row.layer)[row.prop] ?? []) {
						const cx = LEFT + k[0] * p;
						if (cx >= lo.x - 4 && cx <= hi.x + 4)
							hits.push({ path: row.row.path, prop: row.prop, ms: k[0] });
					}
				});
				const ids = new Set(d.add.map(selId));
				const picked = [...d.add, ...hits.filter((h) => !ids.has(selId(h)))];
				onKeySel(picked);
				setDrag({ ...d, x1, y1, picked });
				return;
			}
			const moved = d.moved || Math.abs(e.clientX + shift - d.x0) > 2;
			const raw = (e.clientX + shift - d.x0) / p;
			if (d.kind === "keys") {
				const target = snapTime(d.anchor + raw, fps, [playhead], tol);
				const delta = Math.round(clampKeyDelta(d.base, d.sel, target - d.anchor));
				if (moved) preview(moveKeys(d.base, d.sel, delta).spec);
				setDrag({ ...d, delta, moved });
				return;
			}
			const layer = layerAt(d.base, d.path);
			if (!layer) return;
			const span = layerSpan(d.base, layer);
			const targets = [playhead, 0, latest.current.duration];
			if (d.kind === "slide") {
				// The layer's start snaps (to frames, the playhead, 0); its end snaps to the playhead too.
				let start = snapTime(span.start + raw, fps, targets, tol);
				const endSnap = snapTime(span.end + raw, fps, [playhead, latest.current.duration], tol);
				if (Math.abs(endSnap - (span.end + raw)) < Math.abs(start - (span.start + raw)))
					start = endSnap - (span.end - span.start);
				const by = clampSlide(d.base, d.path, start - span.start);
				if (moved) preview(slideLayer(d.base, d.path, by));
				setDrag({ ...d, ms: span.start + by, moved });
				return;
			}
			if (d.kind === "start" || d.kind === "end") {
				const ms = snapTime(d.ms0 + raw, fps, targets, tol);
				if (moved) preview(trimLayer(d.base, d.path, d.kind, ms));
				setDrag({ ...d, ms, moved });
				return;
			}
			if (d.kind === "preset") {
				const ms = snapTime(d.ms0 + raw, fps, [...targets, span.start, span.end], tol);
				if (moved)
					preview(
						updateLayer(d.base, d.path, resizePreset(d.base, layer, d.side, d.index, d.edge, ms)),
					);
				setDrag({ ...d, ms, moved });
			}
		};
		const onUp = () => {
			const d = dragRef.current;
			setDrag(null);
			if (!d || d.kind === "scrub") return;
			if (d.kind === "marquee") {
				// A click (no box) on empty space picks nothing.
				if (Math.abs(d.x1 - d.x0) < 3 && Math.abs(d.y1 - d.y0) < 3 && !d.add.length) onKeySel([]);
				// Keys of one layer boxed: that layer is the one picked (pastes go to it).
				const layers = new Set(d.picked?.map((k) => k.path.join(".")));
				if (d.picked?.length && layers.size === 1) onSelect(d.picked[0].path);
				return;
			}
			if (d.kind === "keys") {
				if (d.moved && d.delta) {
					const r = moveKeys(d.base, d.sel, d.delta);
					onKeySel(r.sel);
					void commit(r.spec);
				} else {
					preview(null);
					if (!d.moved && d.only) onKeySel([d.only]);
				}
				return;
			}
			if (!d.moved) return preview(null);
			const layer = layerAt(d.base, d.path);
			if (!layer) return preview(null);
			let next: Json = d.base;
			if (d.kind === "slide") {
				const span = layerSpan(d.base, layer);
				next = slideLayer(d.base, d.path, d.ms - span.start);
			} else if (d.kind === "start" || d.kind === "end")
				next = trimLayer(d.base, d.path, d.kind, d.ms);
			else if (d.kind === "preset")
				next = updateLayer(
					d.base,
					d.path,
					resizePreset(d.base, layer, d.side, d.index, d.edge, d.ms),
				);
			if (next === d.base) return preview(null);
			void commit(next);
		};
		// Near an edge of the visible time, the timeline scrolls, faster the further out.
		let raf = 0;
		const edgeScroll = () => {
			raf = requestAnimationFrame(edgeScroll);
			const el = scroller.current;
			if (!el || !last) return;
			const r = el.getBoundingClientRect();
			const from = r.left + LEFT + 24;
			const to = r.right - 32;
			const x = last.clientX;
			const speed =
				x > to ? Math.min(28, (x - to) / 2 + 4) : x < from ? -Math.min(28, (from - x) / 2 + 4) : 0;
			if (!speed) return;
			const before = el.scrollLeft;
			el.scrollLeft = Math.max(0, before + speed);
			if (el.scrollLeft !== before) onMove(last);
		};
		raf = requestAnimationFrame(edgeScroll);
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
		};
	}, [dragging]);

	const startKeyDrag = (e: React.PointerEvent, s: KeySel) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const id = selId(s);
		const add = e.shiftKey || e.metaKey || e.ctrlKey;
		let sel = keySel;
		if (add) {
			sel = selSet.has(id) ? keySel.filter((k) => selId(k) !== id) : [...keySel, s];
			onKeySel(sel);
			if (!sel.some((k) => selId(k) === id)) return;
		} else if (!selSet.has(id)) {
			sel = [s];
			onKeySel(sel);
		}
		onSelect(s.path);
		onPresetSel(null);
		setDrag({
			kind: "keys",
			x0: e.clientX,
			base: spec,
			sel,
			anchor: s.ms,
			delta: 0,
			moved: false,
			only: !add && sel.length > 1 ? s : undefined,
		});
	};

	const startLayerDrag = (
		e: React.PointerEvent,
		kind: "slide" | "start" | "end",
		row: LayerRow,
	) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		onSelect(row.path);
		const span = layerSpan(spec, row.layer);
		const ms0 = kind === "start" ? span.start : kind === "end" ? span.end : span.start;
		setDrag({ kind, x0: e.clientX, base: spec, path: row.path, ms0, ms: ms0, moved: false });
	};

	const startPresetDrag = (
		e: React.PointerEvent,
		row: LayerRow,
		side: PresetSide,
		index: number,
		edge: "start" | "end" | "move",
	) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		onSelect(row.path);
		onPresetSel({ path: row.path, side, index });
		onKeySel([]);
		const p = presetsOf(row.layer, side)[index];
		const ms0 = edge === "end" ? p.atMs + presetDuration(p) : p.atMs;
		setDrag({
			kind: "preset",
			x0: e.clientX,
			base: spec,
			path: row.path,
			side,
			index,
			edge,
			ms0,
			ms: ms0,
			moved: false,
		});
	};

	// -------------------------------------------------------------------------
	// Keys: menus and the keyboard
	// -------------------------------------------------------------------------

	const interpolate = (sel: KeySel[], mode: Interpolation) => {
		if (sel.length) void commit(interpolateKeys(spec, sel, mode));
	};

	const openKeyMenu = (e: React.MouseEvent, s: KeySel) => {
		e.preventDefault();
		e.stopPropagation();
		const targets = selSet.has(selId(s)) ? keySel : [s];
		if (!selSet.has(selId(s))) onKeySel(targets);
		const ks = keysOf(layerAt(spec, s.path) ?? {})[s.prop] ?? [];
		const i = ks.findIndex((k) => Math.abs(k[0] - s.ms) < 0.5);
		const current = targets.length === 1 && i >= 0 ? interpolationOf(ks, i) : undefined;
		const item = (label: string, mode: Interpolation, shortcut?: string): MenuItem => ({
			label,
			shortcut,
			checked: current === mode,
			action: () => interpolate(targets, mode),
		});
		setMenu({
			x: e.clientX,
			y: e.clientY,
			title:
				targets.length > 1
					? `${targets.length} keys`
					: `${propUi(s.prop).label} at ${timecode(s.ms, fps)}`,
			items: [
				item("Linear", "linear"),
				item("Easy Ease", "easy", "F9"),
				item("Ease In", "easeIn", "⇧F9"),
				item("Ease Out", "easeOut", "⌘⇧F9"),
				item("Hold", "hold"),
				null,
				{ label: "Go to key", action: () => onSeekMs(s.ms) },
				{
					label: targets.length > 1 ? "Delete keys" : "Delete key",
					danger: true,
					action: () => {
						onKeySel([]);
						void commit(deleteKeys(spec, targets));
					},
				},
			],
		});
	};

	const openPresetMenu = (e: React.MouseEvent, row: LayerRow, side: PresetSide, index: number) => {
		e.preventDefault();
		e.stopPropagation();
		const p = presetsOf(row.layer, side)[index];
		onPresetSel({ path: row.path, side, index });
		setMenu({
			x: e.clientX,
			y: e.clientY,
			title: side === "enter" ? "Comes in with" : "Goes out with",
			items: [
				...MOTION_PRESETS.map(
					(name): MenuItem => ({
						label: name,
						checked: p?.preset === name,
						action: () =>
							saveLayer(row.path, updatePreset(row.layer, side, index, { preset: name })),
					}),
				),
				null,
				{
					label: "Remove",
					danger: true,
					action: () => {
						onPresetSel(null);
						saveLayer(row.path, removePreset(row.layer, side, index));
					},
				},
			],
		});
	};

	const keyboard = useRef<(e: KeyboardEvent) => void>(() => {});
	keyboard.current = (e: KeyboardEvent) => {
		const el = e.target as HTMLElement | null;
		if (
			el &&
			(el.tagName === "INPUT" ||
				el.tagName === "TEXTAREA" ||
				el.tagName === "SELECT" ||
				el.isContentEditable)
		)
			return;
		if (document.querySelector('[role="dialog"], [role="alertdialog"], [role="menu"]')) return;
		const mod = e.metaKey || e.ctrlKey;
		const key = e.key.toLowerCase();
		const layer = selected ? layerAt(spec, selected) : undefined;
		const handled = () => e.preventDefault();
		if (key === " " && !mod) {
			handled();
			return onTogglePlay();
		}
		if ((key === "delete" || key === "backspace") && !mod) {
			if (keySel.length) {
				handled();
				onKeySel([]);
				return void commit(deleteKeys(spec, keySel));
			}
			if (presetSel) {
				const l = layerAt(spec, presetSel.path);
				if (!l) return;
				handled();
				onPresetSel(null);
				return saveLayer(presetSel.path, removePreset(l, presetSel.side, presetSel.index));
			}
			return;
		}
		if (mod && key === "c" && keySel.length) {
			handled();
			clipboard = copyKeys(spec, keySel);
			return;
		}
		if (mod && key === "v" && clipboard.length) {
			const path = selected ?? keySel[0]?.path;
			if (!path) return;
			handled();
			const r = pasteKeys(spec, path, clipboard, atMs);
			if (!r.sel.length) return;
			onKeySel(r.sel);
			return void commit(r.spec);
		}
		if (mod && key === "a" && selected && layer) {
			handled();
			return onKeySel(keysAsSel(layer, selected));
		}
		if ((key === "j" || key === "k") && !mod && layer) {
			handled();
			const t = nextKeyTime(spec, layer, atMs, key === "j" ? -1 : 1, undefined, frameMs / 2);
			if (t !== undefined) onSeekMs(t);
			return;
		}
		if (key === "u" && !mod && selected) {
			handled();
			return setOpen((s) => toggle(s, selected.join(".")));
		}
		if (e.key === "F9") {
			handled();
			return interpolate(keySel, e.shiftKey ? (mod ? "easeOut" : "easeIn") : "easy");
		}
		if (key === "escape") {
			onKeySel([]);
			onPresetSel(null);
			return;
		}
		if ((key === "arrowleft" || key === "arrowright") && !mod) {
			handled();
			const step = (e.shiftKey ? 10 : 1) * frameMs * (key === "arrowleft" ? -1 : 1);
			return seekTo(atMs + step);
		}
		if (key === "home" || key === "end") {
			handled();
			return onSeekMs(key === "home" ? 0 : snapTime(duration, fps));
		}
	};
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => keyboard.current(e);
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	// Keep the playhead in view while playing or stepping.
	useEffect(() => {
		const el = scroller.current;
		if (!el || drag) return;
		const x = LEFT + atMs * px;
		const left = el.scrollLeft + LEFT;
		const right = el.scrollLeft + el.clientWidth - 16;
		if (x < left || x > right) el.scrollLeft = Math.max(0, x - LEFT - 40);
	}, [atMs, px, drag]);

	// -------------------------------------------------------------------------
	// Drawing
	// -------------------------------------------------------------------------

	const steps = rulerSteps(fps);
	const major = steps.find((s) => s * px >= 64) ?? steps[steps.length - 1];
	const minor = steps.filter((s) => s < major && s * px >= 7).pop();
	const ticks: { ms: number; major: boolean }[] = [];
	for (let t = 0; t <= duration + 0.5; t += minor ?? major) {
		const isMajor = Math.abs(t / major - Math.round(t / major)) < 1e-6;
		ticks.push({ ms: t, major: isMajor });
	}
	const label = (ms: number) => {
		if (Math.abs(ms / 1000 - Math.round(ms / 1000)) < 1e-6) return `${Math.round(ms / 1000)}s`;
		return `${Math.round((ms % 1000) / frameMs)}f`;
	};

	const dragLabel = (() => {
		if (!drag || drag.kind === "marquee" || drag.kind === "scrub") return null;
		if (drag.kind === "keys") {
			if (!drag.moved) return null;
			const at = drag.anchor + drag.delta;
			return {
				ms: at,
				text: `${timecode(at, fps)}  ${drag.delta >= 0 ? "+" : "−"}${timecode(Math.abs(drag.delta), fps)}`,
			};
		}
		if (!drag.moved) return null;
		return { ms: drag.ms, text: timecode(drag.ms, fps) };
	})();

	const layerRowTrack = (row: LayerRow) => {
		const { start, end } = layerSpan(spec, row.layer);
		const on = row.path.join(".") === selKey;
		const enter = presetsOf(row.layer, "enter");
		const exit = presetsOf(row.layer, "exit");
		return (
			<>
				<div
					role="presentation"
					title={`${row.name}: ${timecode(start, fps)} – ${timecode(end, fps)}. Drag to slide, drag its ends to trim.`}
					className={cn(
						"absolute top-[3px] bottom-[3px] cursor-grab rounded-[3px] border active:cursor-grabbing",
						on
							? "border-accent/80 bg-accent/35"
							: "border-white/10 bg-[#34343c] hover:bg-[#3a3a43]",
						row.layer.hidden ? "opacity-40" : "",
					)}
					style={{ left: start * px, width: Math.max(2, (end - start) * px) }}
					onPointerDown={(e) => startLayerDrag(e, "slide", row)}
				>
					{/* Trim handles at both ends. */}
					<span
						role="presentation"
						className="absolute inset-y-0 -left-[3px] w-[7px] cursor-ew-resize rounded-l-[3px] hover:bg-accent/60"
						onPointerDown={(e) => startLayerDrag(e, "start", row)}
					/>
					<span
						role="presentation"
						className="absolute inset-y-0 -right-[3px] w-[7px] cursor-ew-resize rounded-r-[3px] hover:bg-accent/60"
						onPointerDown={(e) => startLayerDrag(e, "end", row)}
					/>
				</div>
				{enter.map((p, i) => presetTint(row, "enter", i, p.atMs, presetDuration(p), p.preset))}
				{exit.map((p, i) => presetTint(row, "exit", i, p.atMs, presetDuration(p), p.preset))}
			</>
		);
	};

	/** An entrance or exit drawn on the layer's bar; its inner edge stretches it. */
	const presetTint = (
		row: LayerRow,
		side: PresetSide,
		index: number,
		at: number,
		len: number,
		name: string,
	) => (
		<div
			key={`${side}${index}`}
			role="presentation"
			title={`${side === "enter" ? "Comes in" : "Goes out"}: ${name}, ${timecode(len, fps)}. Drag its edge to change its length.`}
			className={cn(
				"pointer-events-none absolute top-[4px] bottom-[4px]",
				side === "enter"
					? "rounded-l-[2px] bg-gradient-to-r from-[#3fbf8f]/70 to-[#3fbf8f]/25"
					: "rounded-r-[2px] bg-gradient-to-l from-[#e0a64a]/70 to-[#e0a64a]/25",
			)}
			style={{ left: at * px, width: Math.max(2, len * px) }}
		>
			<span
				role="presentation"
				className={cn(
					"pointer-events-auto absolute inset-y-0 w-[6px] cursor-ew-resize hover:bg-white/50",
					side === "enter" ? "-right-[3px]" : "-left-[3px]",
				)}
				onPointerDown={(e) =>
					startPresetDrag(e, row, side, index, side === "enter" ? "end" : "start")
				}
			/>
		</div>
	);

	const presetRowTrack = (row: LayerRow, side: PresetSide) =>
		presetsOf(row.layer, side).map((p, i) => {
			const len = presetDuration(p);
			const on =
				presetSel?.side === side &&
				presetSel.index === i &&
				presetSel.path.join(".") === row.path.join(".");
			return (
				// biome-ignore lint/a11y/noStaticElementInteractions: a block to drag and right-click, like a clip
				<div
					// biome-ignore lint/suspicious/noArrayIndexKey: presets are identified by their place
					key={i}
					title={`${p.preset}: ${timecode(p.atMs, fps)}, ${timecode(len, fps)} long. Drag to move, drag an edge to stretch, right-click to change.`}
					className={cn(
						"absolute top-[3px] bottom-[3px] cursor-grab overflow-hidden rounded-[3px] border px-1.5 text-[10px] leading-[14px] text-white/90 active:cursor-grabbing",
						side === "enter"
							? "border-[#3fbf8f]/60 bg-[#3fbf8f]/30"
							: "border-[#e0a64a]/60 bg-[#e0a64a]/30",
						on && "ring-1 ring-white/80",
					)}
					style={{ left: p.atMs * px, width: Math.max(4, len * px) }}
					onPointerDown={(e) => startPresetDrag(e, row, side, i, "move")}
					onContextMenu={(e) => openPresetMenu(e, row, side, i)}
				>
					<span className="pointer-events-none truncate">{p.preset}</span>
					<span
						role="presentation"
						className="absolute inset-y-0 left-0 w-[5px] cursor-ew-resize hover:bg-white/40"
						onPointerDown={(e) => startPresetDrag(e, row, side, i, "start")}
					/>
					<span
						role="presentation"
						className="absolute inset-y-0 right-0 w-[5px] cursor-ew-resize hover:bg-white/40"
						onPointerDown={(e) => startPresetDrag(e, row, side, i, "end")}
					/>
				</div>
			);
		});

	const propRowTrack = (row: LayerRow, prop: KeyProp) => {
		const ks = keysOf(row.layer)[prop] ?? [];
		return (
			<>
				{ks.length > 1 && (
					<div
						className="pointer-events-none absolute top-1/2 h-px -translate-y-1/2 bg-white/12"
						style={{ left: ks[0][0] * px, width: (ks[ks.length - 1][0] - ks[0][0]) * px }}
					/>
				)}
				{ks.map((k, i) => {
					const s: KeySel = { path: row.path, prop, ms: k[0] };
					const picked = isPicked(row.path, prop, k[0]);
					return (
						<button
							key={`${k[0]}`}
							type="button"
							aria-label={`${propUi(prop).label} key at ${timecode(k[0], fps)}`}
							aria-pressed={picked}
							title={`${propUi(prop).label} ${timecode(k[0], fps)}: ${typeof k[1] === "number" ? (k[1] * propUi(prop).factor).toFixed(propUi(prop).digits) : k[1]}`}
							className="absolute top-1/2 z-[1] flex size-[17px] -translate-x-1/2 -translate-y-1/2 items-center justify-center outline-none"
							style={{ left: k[0] * px }}
							onPointerDown={(e) => startKeyDrag(e, s)}
							onDoubleClick={(e) => {
								e.stopPropagation();
								onSeekMs(k[0]);
							}}
							onContextMenu={(e) => openKeyMenu(e, s)}
						>
							<KeyGlyph glyph={keyGlyph(ks, i)} selected={picked} />
						</button>
					);
				})}
			</>
		);
	};

	// -------------------------------------------------------------------------
	// The left column
	// -------------------------------------------------------------------------

	const layerCell = (row: LayerRow) => {
		const id = row.path.join(".");
		const isOpen = open.has(id);
		const isGroup = row.type === "group";
		const animated = animatedProps(row.layer).length > 0;
		return (
			<>
				<RowButton
					label={isOpen ? "Hide properties" : "Show properties"}
					onPress={() => setOpen((s) => toggle(s, id))}
					className="size-4"
				>
					<CaretRight
						weight="fill"
						className={cn("size-2.5 transition-transform", isOpen && "rotate-90")}
					/>
				</RowButton>
				{isGroup ? (
					<RowButton
						label={
							folded.has(id) ? "Show the layers in this group" : "Hide the layers in this group"
						}
						onPress={() => setFolded((s) => toggle(s, id))}
						className="size-4"
					>
						{folded.has(id) ? (
							<FolderSimple className="size-3.5" />
						) : (
							<FolderOpen className="size-3.5" />
						)}
					</RowButton>
				) : (
					<span className="flex size-4 shrink-0 items-center justify-center text-muted">
						{TYPE_ICON[row.type] ?? <Square className="size-3.5" />}
					</span>
				)}
				<RenameText
					value={row.name}
					onCommit={(name) => saveLayer(row.path, { name: name || undefined })}
					className={cn("flex-1 pl-1 text-[12px]", !!row.layer.hidden && "text-muted line-through")}
				/>
				{animated && !isOpen && (
					<span title="Animated" className="shrink-0 text-accent/80">
						<KeyGlyph glyph={{ in: "linear", out: "linear" }} className="scale-75" />
					</span>
				)}
				<RowButton
					label={row.layer.hidden ? "Show layer" : "Hide layer"}
					active={false}
					onPress={() => saveLayer(row.path, { hidden: row.layer.hidden ? undefined : true })}
				>
					{row.layer.hidden ? <EyeSlash className="size-3.5" /> : <Eye className="size-3.5" />}
				</RowButton>
			</>
		);
	};

	const propCell = (row: LayerRow, prop: KeyProp) => {
		const layer = row.layer;
		const ks = keysOf(layer)[prop] ?? [];
		const animated = ks.length > 0;
		const ui = propUi(prop);
		const value = valueAt(spec, layer, prop, atMs);
		const hereIndex = keyIndexAt(layer, prop, atMs, frameMs / 2);
		const prev = nextKeyTime(spec, layer, atMs, -1, prop, frameMs / 2);
		const next = nextKeyTime(spec, layer, atMs, 1, prop, frameMs / 2);
		const setValue = (v: number | string, draft: boolean) => {
			const out = updateLayer(spec, row.path, setValueAt(layer, prop, atMs, v));
			if (draft) preview(out);
			else void commit(out);
		};
		return (
			<>
				<RowButton
					label={
						animated ? `Stop animating ${ui.label}` : `Animate ${ui.label} (a key at the playhead)`
					}
					active={animated}
					onPress={() =>
						saveLayer(
							row.path,
							animated
								? stopAnimating(spec, layer, prop, atMs)
								: startAnimating(spec, layer, prop, atMs),
						)
					}
				>
					<Timer weight={animated ? "fill" : "regular"} className="size-3.5" />
				</RowButton>
				<span className="w-[78px] shrink-0 truncate pl-1 text-[11px] text-foreground/80">
					{ui.label}
				</span>
				<div className="flex min-w-0 flex-1 items-center">
					{typeof value === "string" ? (
						<ColorValue
							value={value}
							onPreview={(v) => (v === null ? preview(null) : setValue(v, true))}
							onCommit={(v) => setValue(v, false)}
						/>
					) : (
						<ScrubValue
							value={value}
							ui={ui}
							onPreview={(v) => (v === null ? preview(null) : setValue(v, true))}
							onCommit={(v) => setValue(v, false)}
						/>
					)}
				</div>
				{animated && (
					<div className="flex shrink-0 items-center">
						<RowButton
							label="Previous key"
							className="size-4"
							onPress={() => prev !== undefined && onSeekMs(prev)}
						>
							<CaretLeft
								weight="fill"
								className={cn("size-2.5", prev === undefined && "opacity-30")}
							/>
						</RowButton>
						<RowButton
							label={
								hereIndex >= 0 ? "Remove the key at the playhead" : "Add a key at the playhead"
							}
							className="size-4"
							onPress={() => saveLayer(row.path, toggleKeyAt(spec, layer, prop, atMs, frameMs / 2))}
						>
							<svg viewBox="0 0 10 10" width={9} height={9} aria-hidden>
								<path
									d="M5 0.8 L9.2 5 L5 9.2 L0.8 5 Z"
									fill={hereIndex >= 0 ? "var(--accent)" : "none"}
									stroke={hereIndex >= 0 ? "var(--accent)" : "currentColor"}
									strokeWidth={1.1}
								/>
							</svg>
						</RowButton>
						<RowButton
							label="Next key"
							className="size-4"
							onPress={() => next !== undefined && onSeekMs(next)}
						>
							<CaretRight
								weight="fill"
								className={cn("size-2.5", next === undefined && "opacity-30")}
							/>
						</RowButton>
					</div>
				)}
			</>
		);
	};

	const presetCell = (row: LayerRow, side: PresetSide) => {
		const list = presetsOf(row.layer, side);
		return (
			<>
				<span className="size-5 shrink-0" />
				<span className="w-[78px] shrink-0 truncate pl-1 text-[11px] text-foreground/80">
					{side === "enter" ? "Comes in" : "Goes out"}
				</span>
				<span className="min-w-0 flex-1 truncate px-1 text-[11px] text-muted">
					{list.length
						? list.map((p) => p.preset).join(", ")
						: side === "enter"
							? "Just there"
							: "Stays"}
				</span>
				<RowButton
					label={side === "enter" ? "Add an entrance" : "Add an exit"}
					onPress={() => {
						const patch = addPreset(spec, row.layer, side);
						if (!Object.keys(patch).length) return;
						onPresetSel({ path: row.path, side, index: list.length });
						saveLayer(row.path, patch);
					}}
				>
					<Plus className="size-3" />
				</RowButton>
			</>
		);
	};

	// -------------------------------------------------------------------------

	const playX = atMs * px;
	const height = rows.length * ROW_H;
	const marquee = drag?.kind === "marquee" ? drag : null;

	return (
		<div className="flex min-h-0 flex-1 flex-col bg-surface">
			<div className="flex h-8 shrink-0 items-center gap-2 border-b border-separator px-2">
				<button
					type="button"
					aria-label={playing ? "Pause" : "Play"}
					title={playing ? "Pause (Space)" : "Play (Space)"}
					onClick={onTogglePlay}
					className="flex size-6 items-center justify-center rounded-md hover:bg-default"
				>
					{playing ? (
						<Pause weight="fill" className="size-3.5" />
					) : (
						<Play weight="fill" className="size-3.5" />
					)}
				</button>
				<span
					className="w-14 font-mono text-[13px] text-accent tabular-nums"
					title="Seconds:frames"
				>
					{timecode(atMs, fps)}
				</span>
				<span className="text-[11px] text-muted tabular-nums">
					{(atMs / 1000).toFixed(2)} s · frame {Math.round(atMs / frameMs)}
				</span>
				<span className="ml-auto hidden text-[11px] text-muted xl:inline">
					J/K previous/next key · F9 Easy Ease · ⌫ delete · ⌘C/⌘V copy/paste keys
				</span>
				<div className="ml-auto flex items-center gap-1 xl:ml-3">
					<RowButton label="Zoom out" onPress={() => zoomTo(zoom / 1.5)}>
						<MagnifyingGlassMinus className="size-3.5" />
					</RowButton>
					<input
						type="range"
						aria-label="Zoom the timeline"
						min={0}
						max={Math.log(MAX_ZOOM)}
						step={0.01}
						value={Math.log(zoom)}
						onChange={(e) => zoomTo(Math.exp(Number(e.target.value)))}
						className="w-24 accent-[var(--accent)]"
					/>
					<RowButton label="Zoom in" onPress={() => zoomTo(zoom * 1.5)}>
						<MagnifyingGlassPlus className="size-3.5" />
					</RowButton>
					<button
						type="button"
						onClick={() => zoomTo(1)}
						className="h-5 rounded px-1.5 text-[11px] text-muted hover:bg-default hover:text-foreground"
					>
						Fit
					</button>
				</div>
			</div>

			<div ref={scroller} className="custom-scrollbar relative min-h-0 flex-1 overflow-auto">
				<div ref={content} className="relative" style={{ width: LEFT + trackW, minHeight: "100%" }}>
					{/* The ruler. */}
					<div className="sticky top-0 z-30 flex" style={{ height: RULER_H }}>
						<div
							className="sticky left-0 z-10 flex shrink-0 items-center border-r border-b border-border bg-surface-secondary px-2 text-[11px] text-muted"
							style={{ width: LEFT }}
						>
							Layers
						</div>
						<div
							role="presentation"
							className="relative flex-1 cursor-text border-b border-border bg-surface-secondary"
							onPointerDown={(e) => {
								if (e.button !== 0) return;
								seekTo(msAt(e.clientX));
								setDrag({ kind: "scrub" });
							}}
						>
							<div
								className="absolute inset-y-0 bg-black/30"
								style={{ left: duration * px, right: 0 }}
							/>
							{ticks.map((t) => (
								<div
									key={t.ms}
									className={cn(
										"pointer-events-none absolute bottom-0 w-px",
										t.major ? "h-2.5 bg-white/40" : "h-1.5 bg-white/20",
									)}
									style={{ left: t.ms * px }}
								>
									{t.major && (
										<span className="absolute bottom-3 left-1 text-[10px] whitespace-nowrap text-muted tabular-nums">
											{label(t.ms)}
										</span>
									)}
								</div>
							))}
							{dragLabel && (
								<div
									className="pointer-events-none absolute top-0.5 z-10 -translate-x-1/2 rounded bg-black/90 px-1.5 py-0.5 font-mono text-[10px] whitespace-nowrap text-white tabular-nums"
									style={{ left: dragLabel.ms * px }}
								>
									{dragLabel.text}
								</div>
							)}
							{/* The playhead's handle. */}
							<div
								className="pointer-events-none absolute top-0 bottom-0 -translate-x-1/2"
								style={{ left: playX }}
							>
								<div className="mx-auto h-full w-px bg-accent" />
								<svg
									viewBox="0 0 11 12"
									width={11}
									height={12}
									className="absolute bottom-0 left-1/2 -translate-x-1/2"
									aria-hidden
								>
									<path d="M0.5 0.5 H10.5 V7 L5.5 11.5 L0.5 7 Z" fill="var(--accent)" />
								</svg>
							</div>
						</div>
					</div>

					{/* The rows. */}
					<div
						ref={rowsEl}
						role="presentation"
						className="relative"
						style={{ height: Math.max(height, 40) }}
						onPointerDown={(e) => {
							if (e.button !== 0) return;
							const r = rowsEl.current?.getBoundingClientRect();
							if (!r) return;
							const x = e.clientX - r.left;
							const y = e.clientY - r.top;
							const row = rows[Math.floor(y / ROW_H)];
							if (row && row.kind !== "prop") onSelect(row.row.path);
							if (!(e.shiftKey || e.metaKey || e.ctrlKey)) onPresetSel(null);
							setDrag({
								kind: "marquee",
								x0: x,
								y0: y,
								x1: x,
								y1: y,
								add: e.shiftKey || e.metaKey || e.ctrlKey ? keySel : [],
							});
						}}
					>
						{rows.map((r) => {
							const id = r.row.path.join(".");
							const on = id === selKey;
							const rowKey =
								r.kind === "layer"
									? `L${id}`
									: r.kind === "prop"
										? `P${id}.${r.prop}`
										: `S${id}.${r.side}`;
							const indent = 6 + r.row.depth * 14 + (r.kind === "layer" ? 0 : 18);
							return (
								<div
									key={rowKey}
									className={cn(
										"flex border-b border-white/[0.04]",
										r.kind === "layer" && on && "bg-accent/10",
									)}
									style={{ height: ROW_H }}
								>
									<div
										role="presentation"
										className={cn(
											"sticky left-0 z-20 flex shrink-0 items-center gap-0.5 border-r border-border pr-1",
											r.kind === "layer"
												? on
													? "bg-[#1f2b3b]"
													: "bg-surface hover:bg-[#1b1b1f]"
												: "bg-[#141417]",
										)}
										style={{ width: LEFT, paddingLeft: indent }}
										// A property's controls work on its layer, so touching them picks it.
										onPointerDownCapture={() => {
											if (r.kind !== "layer") onSelect(r.row.path);
										}}
										onPointerDown={(e) => {
											e.stopPropagation();
											onSelect(r.row.path);
										}}
									>
										{r.kind === "layer"
											? layerCell(r.row)
											: r.kind === "prop"
												? propCell(r.row, r.prop)
												: presetCell(r.row, r.side)}
									</div>
									<div className={cn("relative flex-1", r.kind !== "layer" && "bg-black/10")}>
										{r.kind === "layer"
											? layerRowTrack(r.row)
											: r.kind === "prop"
												? propRowTrack(r.row, r.prop)
												: presetRowTrack(r.row, r.side)}
									</div>
								</div>
							);
						})}
						{rows.length === 0 && (
							<div
								className="sticky left-0 px-3 py-3 text-[12px] text-muted"
								style={{ width: LEFT }}
							>
								No layers yet.
							</div>
						)}
						{/* Past the graphic's end. */}
						<div
							className="pointer-events-none absolute top-0 bottom-0 bg-black/25"
							style={{ left: LEFT + duration * px, right: 0 }}
						/>
						{/* The playhead through every row. */}
						<div
							className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent"
							style={{ left: LEFT + playX }}
						/>
						{marquee && (
							<div
								className="pointer-events-none absolute z-30 border border-accent/80 bg-accent/10"
								style={{
									left: Math.min(marquee.x0, marquee.x1),
									top: Math.min(marquee.y0, marquee.y1),
									width: Math.abs(marquee.x1 - marquee.x0),
									height: Math.abs(marquee.y1 - marquee.y0),
								}}
							/>
						)}
					</div>
				</div>
			</div>
			{menu && (
				<PopupMenu
					x={menu.x}
					y={menu.y}
					title={menu.title}
					items={menu.items}
					onClose={() => setMenu(null)}
				/>
			)}
		</div>
	);
}
