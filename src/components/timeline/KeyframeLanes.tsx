import { Check, X } from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { curveOf, DEFAULT_CURVE, valueAt } from "../../../electron/core/anim";
import type {
	Asset,
	Clip,
	Curve,
	Ease,
	Keyframe,
	KeyframeProp,
	MediaClip,
	ProjectSnapshot,
	Track,
} from "../../../electron/core/types";
import { run } from "../../lib/api";
import { type KeyRef, keyframeLanes } from "../../lib/keyframes";
import { cn } from "../../lib/utils";
import { CurveEditor } from "./CurveEditor";

const LANE_H = 44;
/** Room above and below the graph, so diamonds at the extremes stay whole. */
const PAD = 7;

const PROPS: { prop: KeyframeProp; label: string }[] = [
	{ prop: "x", label: "Position X" },
	{ prop: "y", label: "Position Y" },
	{ prop: "scale", label: "Scale" },
	{ prop: "rotation", label: "Rotation" },
	{ prop: "opacity", label: "Opacity" },
	{ prop: "volume", label: "Volume" },
];

/** What a value may be dragged to (the schema allows more; these keep drags sane). */
const LIMITS: Record<KeyframeProp, [number, number]> = {
	x: [-1, 2],
	y: [-1, 2],
	scale: [0.01, 10],
	rotation: [-360, 360],
	opacity: [0, 1],
	volume: [0, 2],
};
/** The smallest value range a lane shows, so tiny moves don't fill it top to bottom. */
const MIN_SPAN: Record<KeyframeProp, number> = {
	x: 0.2,
	y: 0.2,
	scale: 0.2,
	rotation: 10,
	opacity: 0.25,
	volume: 0.25,
};

const EASES: { ease: Ease; label: string }[] = [
	{ ease: "linear", label: "Linear" },
	{ ease: "ease", label: "Ease" },
	{ ease: "ease-in", label: "Ease in" },
	{ ease: "ease-out", label: "Ease out" },
	{ ease: "hold", label: "Hold" },
];

const staticValue = (clip: MediaClip, prop: KeyframeProp): number =>
	prop === "volume"
		? clip.volume
		: prop === "rotation"
			? (clip.transform.rotation ?? 0)
			: clip.transform[prop];

function formatValue(prop: KeyframeProp, v: number): string {
	if (prop === "volume") return v > 0 ? `${(20 * Math.log10(v)).toFixed(1)} dB` : "−∞ dB";
	if (prop === "scale") return `${v.toFixed(2)}×`;
	if (prop === "rotation") return `${v.toFixed(1)}°`;
	return `${Math.round(v * 100)}%`;
}

/** The values a lane spans: its line (or still value), padded, at least MIN_SPAN tall. */
function domainOf(clip: MediaClip, prop: KeyframeProp): [number, number] {
	const keys = clip.keyframes?.[prop];
	// Sampled too, so a curve that overshoots its keyframes stays inside the lane.
	const values = keys?.length
		? [
				...keys.map((k) => k.value),
				...Array.from({ length: 65 }, (_, i) =>
					valueAt(keys, (clip.durationMs * i) / 64, keys[0].value),
				),
			]
		: [staticValue(clip, prop)];
	const lo = Math.min(...values);
	const hi = Math.max(...values);
	const span = Math.max(MIN_SPAN[prop], hi - lo) * 1.15;
	const mid = (lo + hi) / 2;
	return [mid - span / 2, mid + span / 2];
}

const valueY = (v: number, [lo, hi]: [number, number]) =>
	PAD + (1 - (v - lo) / Math.max(1e-9, hi - lo)) * (LANE_H - 2 * PAD);

const refKey = (r: KeyRef) => `${r.prop}:${r.atMs}`;

/** A drag of the selected keyframes, in pixels from where it started. */
interface LaneDrag {
	clipId: string;
	x0: number;
	y0: number;
	dx: number;
	dy: number;
	moved: boolean;
	/** Frozen at the start so the lane doesn't rescale under the pointer. */
	domains: Record<KeyframeProp, [number, number]>;
}

/** Where each selected keyframe of `clip` is while `drag` is under way. */
function movedKeys(
	clip: MediaClip,
	selected: KeyRef[],
	drag: LaneDrag,
	pxPerMs: number,
): Map<string, { atMs: number; value: number }> {
	const out = new Map<string, { atMs: number; value: number }>();
	const keys = selected.flatMap((r) => {
		const k = clip.keyframes?.[r.prop]?.find((x) => x.atMs === r.atMs);
		return k ? [{ ref: r, k }] : [];
	});
	if (keys.length === 0) return out;
	// The whole selection moves together and stops at the clip's edges.
	const first = Math.min(...keys.map(({ k }) => k.atMs));
	const last = Math.max(...keys.map(({ k }) => k.atMs));
	const dt = Math.round(Math.min(clip.durationMs - last, Math.max(-first, drag.dx / pxPerMs)));
	for (const { ref, k } of keys) {
		const [lo, hi] = drag.domains[ref.prop];
		const dv = (-drag.dy / (LANE_H - 2 * PAD)) * (hi - lo);
		const [min, max] = LIMITS[ref.prop];
		out.set(refKey(ref), {
			atMs: k.atMs + dt,
			value: Math.round(Math.min(max, Math.max(min, k.value + dv)) * 10000) / 10000,
		});
	}
	return out;
}

type Menu = { x: number; y: number; clipId: string; targets: KeyRef[]; key: Keyframe };

/**
 * Lanes under a track, one per animatable property, for the clips whose
 * lanes are open: the property as a line over the clip with its keyframes as
 * diamonds. Drag diamonds (⇧ to select several), double-click the line to add
 * one, ⌫ deletes, right-click sets the ease. Drags are drawn here and saved
 * as one edit on release.
 */
export function KeyframeLanes({
	track,
	clips,
	assets,
	project,
	pxPerMs,
	headerWidth,
	window: [windowStart, windowEnd],
}: {
	track: Track;
	clips: Clip[];
	assets: Map<string, Asset>;
	project: ProjectSnapshot;
	pxPerMs: number;
	headerWidth: number;
	/** The part of the timeline (px) worth drawing. */
	window: [number, number];
}) {
	const open = keyframeLanes.use((s) => s.open);
	const selClip = keyframeLanes.use((s) => s.clipId);
	const selected = keyframeLanes.use((s) => s.selected);
	const [liveDrag, setDrag] = useState<LaneDrag | null>(null);
	const dragRef = useRef<LaneDrag | null>(null);
	// A released drag stays drawn until the edit arrives, so nothing jumps back for a frame.
	const [pending, setPending] = useState<{ drag: LaneDrag; revision: number } | null>(null);
	const drag = liveDrag ?? (pending?.revision === project.revision ? pending.drag : null);
	useEffect(() => {
		if (pending && pending.revision !== project.revision) setPending(null);
	}, [pending, project.revision]);
	const [menu, setMenu] = useState<Menu | null>(null);
	const [curveEdit, setCurveEdit] = useState<(Menu & { curve: Curve }) | null>(null);

	// Esc during a drag puts the keyframes back.
	useEffect(() => {
		if (!liveDrag) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.preventDefault();
			e.stopImmediatePropagation();
			dragRef.current = null;
			setDrag(null);
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [liveDrag]);

	const shown = clips.filter((c): c is MediaClip => c.type === "media" && open.includes(c.id));
	if (shown.length === 0) return null;
	const visual = track.kind === "video";
	const props = PROPS.filter(({ prop }) =>
		prop === "volume"
			? shown.some((c) => track.kind === "audio" || assets.get(c.assetId)?.hasAudio)
			: visual,
	);
	const isSelected = (clipId: string, r: KeyRef) =>
		selClip === clipId && selected.some((s) => s.prop === r.prop && s.atMs === r.atMs);

	const startDrag = (clip: MediaClip, r: KeyRef, e: React.PointerEvent) => {
		if (e.button !== 0) return;
		e.stopPropagation();
		e.preventDefault();
		const already = isSelected(clip.id, r);
		const current = selClip === clip.id ? selected : [];
		// ⇧ adds to (or takes out of) the selection; a plain click on a selected diamond keeps it
		// so the whole selection can be dragged.
		const next = e.shiftKey
			? already
				? current.filter((s) => !(s.prop === r.prop && s.atMs === r.atMs))
				: [...current, r]
			: already
				? current
				: [r];
		keyframeLanes.set({ clipId: clip.id, selected: next });
		if (track.locked || (e.shiftKey && already)) return;
		const d: LaneDrag = {
			clipId: clip.id,
			x0: e.clientX,
			y0: e.clientY,
			dx: 0,
			dy: 0,
			moved: false,
			domains: Object.fromEntries(PROPS.map(({ prop }) => [prop, domainOf(clip, prop)])) as Record<
				KeyframeProp,
				[number, number]
			>,
		};
		dragRef.current = d;
		const move = (m: PointerEvent) => {
			const cur = dragRef.current;
			if (!cur) return;
			const dx = m.clientX - cur.x0;
			const dy = m.clientY - cur.y0;
			const moved = cur.moved || Math.abs(dx) > 3 || Math.abs(dy) > 3;
			if (!moved) return;
			const nextDrag = { ...cur, dx, dy, moved };
			dragRef.current = nextDrag;
			setDrag(nextDrag);
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
			const done = dragRef.current;
			dragRef.current = null;
			setDrag(null);
			if (!done) return;
			if (!done.moved) {
				// A click on one of several selected diamonds selects just that one.
				if (!e.shiftKey && already) keyframeLanes.set({ clipId: clip.id, selected: [r] });
				return;
			}
			const sel = keyframeLanes.get().selected;
			const moves = movedKeys(clip, sel, done, pxPerMs);
			const edits = sel.flatMap((s) => {
				const to = moves.get(refKey(s));
				return to ? [{ prop: s.prop, atMs: s.atMs, toMs: to.atMs, value: to.value }] : [];
			});
			if (edits.length === 0) return;
			setPending({ drag: done, revision: project.revision });
			void run("edit_keyframes", { clipId: clip.id, edits }).then((result) => {
				if (result === undefined) {
					setPending(null);
					return;
				}
				keyframeLanes.set({
					clipId: clip.id,
					selected: edits.map((x) => ({ prop: x.prop, atMs: x.toMs })),
				});
			});
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const openMenu = (clip: MediaClip, r: KeyRef, e: React.MouseEvent) => {
		e.preventDefault();
		e.stopPropagation();
		const key = clip.keyframes?.[r.prop]?.find((k) => k.atMs === r.atMs);
		if (!key || track.locked) return;
		// The menu acts on the whole selection when the diamond is part of it.
		const targets = isSelected(clip.id, r) ? selected : [r];
		if (!isSelected(clip.id, r)) keyframeLanes.set({ clipId: clip.id, selected: [r] });
		setMenu({ x: e.clientX, y: e.clientY, clipId: clip.id, targets, key });
	};

	const setEase = (m: Menu, ease: Ease, curve?: Curve) =>
		void run("edit_keyframes", {
			clipId: m.clipId,
			edits: m.targets.map((t) => ({ ...t, ease, ...(curve ? { curve } : {}) })),
		});

	return (
		<>
			{props.map(({ prop, label }, row) => (
				<div
					key={prop}
					data-lane
					className="relative flex border-b border-separator/60 bg-background/60"
					style={{ height: LANE_H }}
				>
					<div
						className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-separator bg-surface pr-1.5 pl-5 text-[11px] text-muted"
						style={{ width: headerWidth }}
					>
						<span className="h-full w-px bg-amber-300/40" />
						<span className="truncate">{label}</span>
						{row === 0 && (
							<button
								type="button"
								title="Hide keyframes (⇧K)"
								aria-label="Hide keyframes"
								onClick={() =>
									keyframeLanes.set((s) => ({
										open: s.open.filter((id) => !shown.some((c) => c.id === id)),
									}))
								}
								className="ml-auto flex size-5 items-center justify-center rounded hover:bg-default hover:text-foreground"
							>
								<X className="size-3" />
							</button>
						)}
					</div>
					<div className="relative flex-1">
						{shown.map((clip) => {
							const left = clip.startMs * pxPerMs;
							const width = Math.max(2, clip.durationMs * pxPerMs);
							if (left + width < windowStart || left > windowEnd) return null;
							return (
								<LaneGraph
									key={clip.id}
									clip={clip}
									prop={prop}
									left={left}
									width={width}
									visible={[Math.max(0, windowStart - left), Math.min(width, windowEnd - left)]}
									pxPerMs={pxPerMs}
									locked={track.locked}
									drag={drag?.clipId === clip.id ? drag : null}
									selected={selClip === clip.id ? selected : []}
									onKeyDown={(r, e) => startDrag(clip, r, e)}
									onKeyMenu={(r, e) => openMenu(clip, r, e)}
								/>
							);
						})}
					</div>
				</div>
			))}
			{menu && (
				<EaseMenu
					menu={menu}
					onClose={() => setMenu(null)}
					onEase={(ease) => setEase(menu, ease)}
					onCustom={() => setCurveEdit({ ...menu, curve: curveOf(menu.key) ?? DEFAULT_CURVE })}
					onDelete={() =>
						void run("edit_keyframes", {
							clipId: menu.clipId,
							edits: menu.targets.map((t) => ({ ...t, remove: true })),
						})
					}
				/>
			)}
			{curveEdit && (
				<CurveEditor
					x={curveEdit.x}
					y={curveEdit.y}
					initial={curveEdit.curve}
					onApply={(curve) => setEase(curveEdit, "bezier", curve)}
					onClose={() => setCurveEdit(null)}
				/>
			)}
		</>
	);
}

/** One property of one clip: its line and keyframes. */
function LaneGraph({
	clip,
	prop,
	left,
	width,
	visible,
	pxPerMs,
	locked,
	drag,
	selected,
	onKeyDown,
	onKeyMenu,
}: {
	clip: MediaClip;
	prop: KeyframeProp;
	left: number;
	width: number;
	visible: [number, number];
	pxPerMs: number;
	locked: boolean;
	drag: LaneDrag | null;
	selected: KeyRef[];
	onKeyDown: (r: KeyRef, e: React.PointerEvent) => void;
	onKeyMenu: (r: KeyRef, e: React.MouseEvent) => void;
}) {
	const committed = clip.keyframes?.[prop] ?? [];
	const moves = drag?.moved ? movedKeys(clip, selected, drag, pxPerMs) : null;
	// The keyframes as drawn: the dragged ones where the pointer has them.
	const drawn = committed
		.map((k) => {
			const to = moves?.get(refKey({ prop, atMs: k.atMs }));
			return { k: to ? { ...k, ...to } : k, ref: { prop, atMs: k.atMs } };
		})
		.sort((a, b) => a.k.atMs - b.k.atMs);
	const keys = drawn.map((d) => d.k);
	const domain = drag?.domains[prop] ?? domainOf(clip, prop);
	const fallback = staticValue(clip, prop);
	const animated = keys.length > 0;

	// The line, sampled every few pixels over the visible part (plus each keyframe exactly).
	const [from, to] = visible;
	const step = Math.max(2, (to - from) / 800);
	const xs: number[] = [];
	for (let x = from; x < to; x += step) xs.push(x);
	xs.push(to);
	for (const k of keys)
		if (k.atMs * pxPerMs > from && k.atMs * pxPerMs < to) xs.push(k.atMs * pxPerMs);
	xs.sort((a, b) => a - b);
	const points = xs
		.map(
			(x) => `${x.toFixed(1)},${valueY(valueAt(keys, x / pxPerMs, fallback), domain).toFixed(1)}`,
		)
		.join(" ");

	const localAt = (e: React.MouseEvent) =>
		Math.max(
			0,
			Math.min(
				clip.durationMs,
				(e.clientX - e.currentTarget.getBoundingClientRect().left) / pxPerMs,
			),
		);
	const live = moves && drawn.find((d) => moves.has(refKey(d.ref)));
	return (
		<svg
			className={cn("absolute top-0", !animated && "opacity-60")}
			style={{ left, width, height: LANE_H }}
			width={width}
			height={LANE_H}
			onPointerDown={(e) => {
				// Clicking beside the diamonds clears the keyframe selection (and never starts a marquee).
				if (e.button !== 0) return;
				e.stopPropagation();
				keyframeLanes.set({ clipId: null, selected: [] });
			}}
			onDoubleClick={(e) => {
				if (locked) return;
				const atMs = Math.round(localAt(e));
				const value = Math.round(valueAt(keys, atMs, fallback) * 10000) / 10000;
				// A new keyframe keeps the ease of the stretch it lands in.
				const before = [...keys].reverse().find((k) => k.atMs <= atMs);
				void run("set_keyframe", {
					clipId: clip.id,
					prop,
					atMs,
					value,
					ease: before?.ease ?? "ease",
					...(before?.curve ? { curve: before.curve } : {}),
				}).then((r) => {
					if (r !== undefined) keyframeLanes.set({ clipId: clip.id, selected: [{ prop, atMs }] });
				});
			}}
			onContextMenu={(e) => {
				// Right-click on the line: the ease of the stretch it is in.
				e.preventDefault();
				const t = localAt(e);
				const seg = [...drawn].reverse().find((d) => d.k.atMs <= t) ?? drawn[0];
				if (seg) onKeyMenu(seg.ref, e);
			}}
		>
			<title>
				{animated
					? "Drag keyframes to move them, double-click the line to add one, right-click for the ease"
					: "Double-click to animate from here"}
			</title>
			<rect x={0} y={0} width={width} height={LANE_H} fill="rgba(255,255,255,0.025)" />
			<polyline
				points={points}
				fill="none"
				stroke={animated ? "rgb(252,211,77)" : "rgba(255,255,255,0.35)"}
				strokeWidth={1.5}
				strokeDasharray={animated ? undefined : "4 3"}
			/>
			{drawn.map(({ k, ref }) => {
				const sel = selected.some((s) => s.prop === prop && s.atMs === ref.atMs);
				const x = k.atMs * pxPerMs;
				const y = valueY(k.value, domain);
				return (
					// biome-ignore lint/a11y/useSemanticElements: an SVG shape can't be a <button>
					<g
						key={ref.atMs}
						role="button"
						tabIndex={-1}
						aria-label={`${prop} keyframe at ${(k.atMs / 1000).toFixed(2)} s`}
						aria-pressed={sel}
						transform={`translate(${x},${y})`}
						className={locked ? "cursor-not-allowed" : "cursor-grab active:cursor-grabbing"}
						onPointerDown={(e) => onKeyDown(ref, e)}
						onDoubleClick={(e) => e.stopPropagation()}
						onContextMenu={(e) => onKeyMenu(ref, e)}
					>
						<title>{`${(k.atMs / 1000).toFixed(2)} s · ${formatValue(prop, k.value)} · ${k.ease}`}</title>
						{/* A bigger invisible target than the diamond itself. */}
						<rect x={-7} y={-7} width={14} height={14} fill="transparent" />
						<rect
							x={-4}
							y={-4}
							width={8}
							height={8}
							transform="rotate(45)"
							fill={sel ? "white" : k.ease === "hold" ? "rgb(251,146,60)" : "rgb(252,211,77)"}
							stroke={sel ? "var(--accent)" : "rgba(0,0,0,0.55)"}
							strokeWidth={sel ? 2 : 1}
						/>
					</g>
				);
			})}
			{live && (
				<text
					x={Math.min(width - 90, Math.max(4, live.k.atMs * pxPerMs + 8))}
					y={Math.max(11, Math.min(LANE_H - 3, valueY(live.k.value, domain) - 6))}
					fill="white"
					fontSize={10}
					className="pointer-events-none tabular-nums"
				>
					{`${(live.k.atMs / 1000).toFixed(2)} s · ${formatValue(prop, live.k.value)}`}
				</text>
			)}
		</svg>
	);
}

/** Right-click menu of a keyframe: its ease, a custom curve, delete. */
function EaseMenu({
	menu,
	onClose,
	onEase,
	onCustom,
	onDelete,
}: {
	menu: Menu;
	onClose: () => void;
	onEase: (ease: Ease) => void;
	onCustom: () => void;
	onDelete: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: menu.x, top: menu.y, ready: false });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos({
			left: Math.min(menu.x, window.innerWidth - width - 8),
			top: menu.y + height > window.innerHeight - 8 ? Math.max(8, menu.y - height) : menu.y,
			ready: true,
		});
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
	const many = menu.targets.length > 1;
	const item = (
		label: string,
		action: () => void,
		opts: { checked?: boolean; danger?: boolean } = {},
	) => (
		<button
			key={label}
			type="button"
			role="menuitem"
			onClick={() => {
				action();
				onClose();
			}}
			className={cn(
				"flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-default",
				opts.danger && "text-danger",
			)}
		>
			<span className="flex w-4 justify-center text-muted">
				{opts.checked && <Check className="size-3.5" />}
			</span>
			<span className="flex-1">{label}</span>
		</button>
	);
	return (
		<div
			ref={ref}
			role="menu"
			className="fixed z-[100] min-w-[170px] rounded-lg border border-border bg-overlay p-1 text-[12px] shadow-xl shadow-black/30"
			style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
				const at = items.indexOf(document.activeElement as HTMLElement);
				if (e.key === "ArrowDown") items[(at + 1) % items.length]?.focus();
				else if (e.key === "ArrowUp") items[(at - 1 + items.length) % items.length]?.focus();
				else return;
				e.preventDefault();
			}}
		>
			<div className="px-2 pt-1 pb-1 text-[11px] text-muted">
				{many ? `Ease of ${menu.targets.length} keyframes` : "Ease to the next keyframe"}
			</div>
			{EASES.map((e) =>
				item(e.label, () => onEase(e.ease), { checked: !many && menu.key.ease === e.ease }),
			)}
			{item("Custom curve…", onCustom, { checked: !many && menu.key.ease === "bezier" })}
			<div className="my-1 h-px bg-separator" />
			{item(many ? "Delete keyframes" : "Delete keyframe", onDelete, { danger: true })}
		</div>
	);
}
