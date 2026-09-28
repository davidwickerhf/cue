import { Check } from "@phosphor-icons/react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	EASE_NAMES,
	type KeyProp,
	keysOf,
	type PresetEntry,
	type PresetSide,
	presetAmount,
	presetDuration,
	presetsOf,
	updatePreset,
} from "../../../electron/core/motionKeys";
import { layerAt, updateLayer } from "../../../electron/core/motionLayers";
import { type Ease, MOTION_PRESETS } from "../../../electron/core/motionSpec";
import {
	easeKeys,
	type KeySel,
	type KeySide,
	moveKeys,
} from "../../../electron/core/motionTimeline";
import { cn } from "../../lib/utils";
import { ColorInput, Field, NumberInput, Section } from "../ui/controls";

/**
 * The pieces of the Motion page's timeline: how each property shows its value
 * (and scrubs it), key glyphs shaped by their eases, right-click menus, and the
 * inspector sections for picked keys and presets.
 */

type Json = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Properties as the timeline shows them
// ---------------------------------------------------------------------------

export interface PropUi {
	label: string;
	/** Shown value = stored value × factor (opacity and scale as percentages). */
	factor: number;
	digits: number;
	suffix?: string;
	/** Limits of the shown value. */
	min?: number;
	max?: number;
}

const PROP_UI: Record<KeyProp, PropUi> = {
	x: { label: "Position X", factor: 1, digits: 0 },
	y: { label: "Position Y", factor: 1, digits: 0 },
	scale: { label: "Scale", factor: 100, digits: 0, suffix: "%" },
	scaleX: { label: "Scale X", factor: 100, digits: 0, suffix: "%" },
	scaleY: { label: "Scale Y", factor: 100, digits: 0, suffix: "%" },
	rotation: { label: "Rotation", factor: 1, digits: 1, suffix: "°" },
	opacity: { label: "Opacity", factor: 100, digits: 0, suffix: "%", min: 0, max: 100 },
	width: { label: "Width", factor: 1, digits: 0, min: 0 },
	height: { label: "Height", factor: 1, digits: 0, min: 0 },
	trimStart: { label: "Trim start", factor: 100, digits: 0, suffix: "%", min: 0, max: 100 },
	trimEnd: { label: "Trim end", factor: 100, digits: 0, suffix: "%", min: 0, max: 100 },
	color: { label: "Colour", factor: 1, digits: 0 },
	blur: { label: "Blur", factor: 1, digits: 0, min: 0, max: 400 },
};

export const propUi = (prop: KeyProp): PropUi =>
	PROP_UI[prop] ?? { label: prop, factor: 1, digits: 2 };

export function formatProp(prop: KeyProp, v: number | string): string {
	if (typeof v === "string") return v;
	const ui = propUi(prop);
	return `${(v * ui.factor).toFixed(ui.digits)}${ui.suffix ?? ""}`;
}

/** Seconds and frames, "1:15" (a second and 15 frames). */
export function timecode(ms: number, fps: number): string {
	const frame = 1000 / fps;
	const total = Math.round(ms / frame);
	const per = Math.round(fps);
	const s = Math.floor(total / per);
	const f = total - s * per;
	return `${s}:${String(f).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Key glyphs
// ---------------------------------------------------------------------------

/** Each half of a glyph, as a path in an 11 × 11 box: triangle, hourglass half or square. */
const HALF: Record<KeySide, [string, string]> = {
	linear: ["M5.5 0.8 L0.8 5.5 L5.5 10.2 Z", "M5.5 0.8 L10.2 5.5 L5.5 10.2 Z"],
	eased: ["M1 1.2 L5.5 3.6 L5.5 7.4 L1 9.8 Z", "M10 1.2 L5.5 3.6 L5.5 7.4 L10 9.8 Z"],
	hold: ["M1.3 1.3 H5.5 V9.7 H1.3 Z", "M9.7 1.3 H5.5 V9.7 H9.7 Z"],
};

/** A key as After Effects draws it: diamond = linear, hourglass = eased, square = hold. */
export function KeyGlyph({
	glyph,
	selected,
	className,
}: {
	glyph: { in: KeySide; out: KeySide };
	selected?: boolean;
	className?: string;
}) {
	return (
		<svg
			viewBox="0 0 11 11"
			width={13}
			height={13}
			aria-hidden
			className={cn(
				"block overflow-visible",
				selected
					? "drop-shadow-[0_0_1.5px_rgba(255,255,255,0.95)]"
					: "drop-shadow-[0_0_1px_rgba(0,0,0,0.9)]",
				className,
			)}
		>
			<g
				fill={selected ? "var(--accent)" : "#cfcfd6"}
				stroke={selected ? "var(--accent)" : "#cfcfd6"}
				strokeWidth={0.5}
				strokeLinejoin="round"
			>
				<path d={HALF[glyph.in][0]} />
				<path d={HALF[glyph.out][1]} />
			</g>
		</svg>
	);
}

// ---------------------------------------------------------------------------
// Scrubbable values
// ---------------------------------------------------------------------------

/**
 * A value to drag left and right (shift ×10, alt ÷10) or click to type, like
 * After Effects' blue numbers. Dragging previews; releasing commits once.
 */
export function ScrubValue({
	value,
	ui,
	onPreview,
	onCommit,
	title,
}: {
	value: number;
	ui: PropUi;
	onPreview: (value: number | null) => void;
	onCommit: (value: number) => void;
	title?: string;
}) {
	const [editing, setEditing] = useState(false);
	const [live, setLive] = useState<number | null>(null);
	const drag = useRef<{ x: number; acc: number; start: number; moved: boolean } | null>(null);
	const shown = (v: number) => (v * ui.factor).toFixed(ui.digits);
	const clamp = (display: number) =>
		Math.min(
			ui.max ?? Number.POSITIVE_INFINITY,
			Math.max(ui.min ?? Number.NEGATIVE_INFINITY, display),
		);
	const fromDisplay = (display: number) => {
		const v = clamp(display) / ui.factor;
		return Number(v.toFixed(ui.digits + (ui.factor === 100 ? 3 : 2)));
	};

	if (editing)
		return (
			<ValueEditor
				initial={shown(value)}
				onDone={(text) => {
					setEditing(false);
					if (text === null) return;
					const parsed = Number.parseFloat(text);
					if (Number.isNaN(parsed)) return;
					const v = fromDisplay(parsed);
					if (Math.abs(v - value) > 1e-9) onCommit(v);
				}}
			/>
		);
	const v = live ?? value;
	return (
		<button
			type="button"
			title={title ?? "Drag to change (⇧ faster, ⌥ finer), click to type"}
			className="h-5 min-w-0 cursor-ew-resize truncate rounded px-1 text-left text-[11px] text-accent tabular-nums hover:bg-accent/10"
			onPointerDown={(e) => {
				if (e.button !== 0) return;
				e.stopPropagation();
				e.currentTarget.setPointerCapture(e.pointerId);
				drag.current = { x: e.clientX, acc: 0, start: value, moved: false };
			}}
			onPointerMove={(e) => {
				const d = drag.current;
				if (!d) return;
				const dx = e.clientX - d.x;
				d.x = e.clientX;
				d.acc +=
					dx *
					(e.shiftKey ? 10 : e.altKey ? 0.1 : 1) *
					(ui.digits > 0 && ui.factor === 1 ? 0.5 : 1);
				if (Math.abs(d.acc) >= 2) d.moved = true;
				if (!d.moved) return;
				const next = fromDisplay(d.start * ui.factor + d.acc);
				setLive(next);
				onPreview(next);
			}}
			onPointerUp={() => {
				const d = drag.current;
				drag.current = null;
				if (!d) return;
				if (!d.moved) return setEditing(true);
				const next = live;
				setLive(null);
				// Compared with where the drag began: the shown value already follows the preview.
				if (next === null || Math.abs(next - d.start) < 1e-9) return onPreview(null);
				onCommit(next);
			}}
			onPointerCancel={() => {
				drag.current = null;
				setLive(null);
				onPreview(null);
			}}
		>
			{shown(v)}
			{ui.suffix && <span className="text-accent/70">{ui.suffix}</span>}
		</button>
	);
}

/** The text field a value turns into when clicked: Enter keeps it, Escape leaves it. */
function ValueEditor({
	initial,
	onDone,
	className,
}: {
	initial: string;
	onDone: (text: string | null) => void;
	className?: string;
}) {
	const [draft, setDraft] = useState(initial);
	const done = useRef(false);
	const finish = (text: string | null) => {
		if (done.current) return;
		done.current = true;
		onDone(text);
	};
	return (
		<input
			// biome-ignore lint/a11y/noAutofocus: it opens because the value was clicked
			autoFocus
			value={draft}
			onFocus={(e) => e.currentTarget.select()}
			onChange={(e) => setDraft(e.target.value)}
			onBlur={() => finish(draft)}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				e.stopPropagation();
				if (e.key === "Enter") finish(draft);
				if (e.key === "Escape") finish(null);
			}}
			className={cn(
				"h-5 w-16 min-w-0 rounded border border-accent bg-field px-1 text-[11px] text-foreground tabular-nums outline-none",
				className,
			)}
		/>
	);
}

/** A name to double-click and type. */
export function RenameText({
	value,
	onCommit,
	className,
}: {
	value: string;
	onCommit: (value: string) => void;
	className?: string;
}) {
	const [editing, setEditing] = useState(false);
	if (editing)
		return (
			<ValueEditor
				initial={value}
				className="w-full"
				onDone={(text) => {
					setEditing(false);
					if (text !== null && text.trim() !== value) onCommit(text.trim());
				}}
			/>
		);
	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: double-click renames, as in layer panels everywhere
		<span
			title="Double-click to rename"
			onDoubleClick={(e) => {
				e.stopPropagation();
				setEditing(true);
			}}
			className={cn("min-w-0 truncate", className)}
		>
			{value}
		</span>
	);
}

/** A colour swatch that opens the system picker: live while picking, committed when closed. */
export function ColorValue({
	value,
	onPreview,
	onCommit,
}: {
	value: string;
	onPreview: (value: string | null) => void;
	onCommit: (value: string) => void;
}) {
	const input = useRef<HTMLInputElement>(null);
	const latest = useRef({ onPreview, onCommit, value });
	latest.current = { onPreview, onCommit, value };
	useEffect(() => {
		const el = input.current;
		if (!el) return;
		const onInput = () => latest.current.onPreview(el.value);
		const onChange = () => {
			if (el.value.toLowerCase() !== latest.current.value.toLowerCase())
				latest.current.onCommit(el.value);
			else latest.current.onPreview(null);
		};
		el.addEventListener("input", onInput);
		el.addEventListener("change", onChange);
		return () => {
			el.removeEventListener("input", onInput);
			el.removeEventListener("change", onChange);
		};
	}, []);
	const hex = /^#[0-9a-f]{6}/i.exec(value)?.[0] ?? "#ffffff";
	return (
		<label className="flex h-5 min-w-0 cursor-pointer items-center gap-1.5 rounded px-1 hover:bg-accent/10">
			<span
				className="size-3 shrink-0 rounded-[3px] border border-white/20"
				style={{ backgroundColor: value }}
			/>
			<span className="truncate text-[11px] text-accent tabular-nums">{value}</span>
			<input
				ref={input}
				type="color"
				defaultValue={hex}
				key={hex}
				className="sr-only"
				onPointerDown={(e) => e.stopPropagation()}
			/>
		</label>
	);
}

// ---------------------------------------------------------------------------
// Right-click menus
// ---------------------------------------------------------------------------

export interface MenuItem {
	label: string;
	shortcut?: string;
	checked?: boolean;
	danger?: boolean;
	action: () => void;
}

/** A small menu at the pointer; `null` items are separators. */
export function PopupMenu({
	x,
	y,
	title,
	items,
	onClose,
}: {
	x: number;
	y: number;
	title?: string;
	items: (MenuItem | null)[];
	onClose: () => void;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ left: x, top: y, ready: false });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos({
			left: Math.min(x, window.innerWidth - width - 8),
			top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
			ready: true,
		});
		el.querySelector<HTMLElement>('[role="menuitem"]')?.focus({ preventScroll: true });
	}, [x, y]);
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
	return (
		<div
			ref={ref}
			role="menu"
			className="fixed z-[100] min-w-[190px] rounded-lg border border-border bg-overlay p-1 text-[12px] shadow-xl shadow-black/30"
			style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
			onPointerDown={(e) => e.stopPropagation()}
			onKeyDown={(e) => {
				const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
				const at = all.indexOf(document.activeElement as HTMLElement);
				if (e.key === "ArrowDown") all[(at + 1) % all.length]?.focus();
				else if (e.key === "ArrowUp") all[(at - 1 + all.length) % all.length]?.focus();
				else return;
				e.preventDefault();
			}}
		>
			{title && <div className="px-2 pt-1 pb-1 text-[11px] text-muted">{title}</div>}
			{items.map((item, i) =>
				item ? (
					<button
						key={item.label}
						type="button"
						role="menuitem"
						onClick={() => {
							item.action();
							onClose();
						}}
						className={cn(
							"flex h-7 w-full items-center gap-2 rounded-md px-2 text-left outline-none hover:bg-default focus-visible:bg-default",
							item.danger && "text-danger",
						)}
					>
						<span className="flex w-4 justify-center text-muted">
							{item.checked && <Check className="size-3.5" />}
						</span>
						<span className="flex-1">{item.label}</span>
						{item.shortcut && <span className="text-[11px] text-muted">{item.shortcut}</span>}
					</button>
				) : (
					// biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
					<div key={i} className="my-1 h-px bg-separator" />
				),
			)}
		</div>
	);
}

// ---------------------------------------------------------------------------
// Inspector sections for what is picked on the timeline
// ---------------------------------------------------------------------------

const selectClass =
	"h-7 w-full min-w-0 rounded-md border border-border bg-field px-1.5 text-[12px] text-foreground outline-none focus:border-accent disabled:opacity-50";

/** An ease picker; `none` is what no ease means (linear for keys, the preset's own for presets). */
function EaseSelect({
	value,
	none,
	onChange,
	mixed,
}: {
	value: Ease | undefined;
	none: string;
	onChange: (ease: Ease | undefined) => void;
	mixed?: boolean;
}) {
	const custom = Array.isArray(value);
	return (
		<select
			aria-label="Ease"
			value={mixed ? "mixed" : custom ? "custom" : (value ?? "")}
			onChange={(e) => {
				const v = e.target.value;
				if (v !== "custom" && v !== "mixed") onChange(v ? (v as Ease) : undefined);
			}}
			className={selectClass}
		>
			{mixed && <option value="mixed">Mixed</option>}
			<option value="">{none}</option>
			{EASE_NAMES.filter((n) => n !== none).map((n) => (
				<option key={n} value={n}>
					{n}
				</option>
			))}
			{custom && <option value="custom">Custom curve ({(value as number[]).join(", ")})</option>}
		</select>
	);
}

/** The picked keys: time and value of one, and the ease to the next key of all. */
export function KeysSection({
	spec,
	sel,
	fps,
	commit,
	onSel,
}: {
	spec: Json;
	sel: KeySel[];
	fps: number;
	commit: (next: Json) => void;
	onSel: (sel: KeySel[]) => void;
}) {
	const found = sel
		.map((s) => {
			const layer = layerAt(spec, s.path);
			const ks = layer ? (keysOf(layer)[s.prop] ?? []) : [];
			const i = ks.findIndex((k) => Math.abs(k[0] - s.ms) < 0.5);
			return i >= 0 ? { s, k: ks[i], last: i === ks.length - 1 } : null;
		})
		.filter((f): f is NonNullable<typeof f> => !!f);
	if (!found.length) return null;
	const one = found.length === 1 ? found[0] : null;
	const eases = new Set(found.map((f) => JSON.stringify(f.k[2] ?? null)));
	const duration = Number(spec.durationMs ?? 3000);
	return (
		<Section title={one ? `${propUi(one.s.prop).label} key` : `${found.length} keys`}>
			{one && (
				<>
					<Field label="Time" inline>
						<NumberInput
							className="w-28"
							value={one.k[0]}
							scale={1000}
							digits={3}
							step={1 / fps}
							min={0}
							max={duration}
							suffix="s"
							onCommit={(ms) => {
								const snapped = Math.round((ms / 1000) * fps) * (1000 / fps);
								const r = moveKeys(spec, [one.s], snapped - one.k[0]);
								onSel(r.sel);
								commit(r.spec);
							}}
						/>
					</Field>
					<Field label="Value" inline>
						{typeof one.k[1] === "string" ? (
							<div className="w-40">
								<ColorInput
									value={one.k[1]}
									onCommit={(v) => v && commit(withKeyValue(spec, one.s, v))}
								/>
							</div>
						) : (
							<NumberInput
								className="w-28"
								value={one.k[1] * propUi(one.s.prop).factor}
								digits={propUi(one.s.prop).digits}
								suffix={propUi(one.s.prop).suffix}
								onCommit={(v) => commit(withKeyValue(spec, one.s, v / propUi(one.s.prop).factor))}
							/>
						)}
					</Field>
				</>
			)}
			<Field
				label="Ease to the next key"
				hint={
					one?.last
						? "The last key has nothing after it: its ease applies once a key follows."
						: "Right-click a key for Easy Ease (F9), Ease In, Ease Out, Linear and Hold."
				}
			>
				<EaseSelect
					value={found[0].k[2]}
					mixed={eases.size > 1}
					none="linear"
					onChange={(ease) => commit(easeKeys(spec, sel, ease))}
				/>
			</Field>
		</Section>
	);
}

function withKeyValue(spec: Json, s: KeySel, value: number | string): Json {
	const layer = layerAt(spec, s.path);
	if (!layer) return spec;
	const ks = [...(keysOf(layer)[s.prop] ?? [])];
	const i = ks.findIndex((k) => Math.abs(k[0] - s.ms) < 0.5);
	if (i < 0) return spec;
	ks[i] = [ks[i][0], value, ...ks[i].slice(2)] as (typeof ks)[number];
	return updateLayer(spec, s.path, { keys: { ...keysOf(layer), [s.prop]: ks } });
}

/** A preset picked on the timeline. */
export interface PresetSel {
	path: number[];
	side: PresetSide;
	index: number;
}

/** A picked enter or exit preset: its kind, timing, ease and amount. */
export function PresetSection({
	spec,
	sel,
	commit,
}: {
	spec: Json;
	sel: PresetSel;
	commit: (next: Json) => void;
}) {
	const layer = layerAt(spec, sel.path);
	const entry = layer ? presetsOf(layer, sel.side)[sel.index] : undefined;
	if (!layer || !entry) return null;
	const duration = Number(spec.durationMs ?? 3000);
	const change = (patch: Partial<PresetEntry>) =>
		commit(updateLayer(spec, sel.path, updatePreset(layer, sel.side, sel.index, patch)));
	const amount = presetAmount(entry.preset);
	const auto = sel.side === "enter" ? (entry.preset === "pop" ? "outBack" : "outExpo") : "inCubic";
	return (
		<Section title={sel.side === "enter" ? "Comes in" : "Goes out"}>
			<Field label="Preset">
				<select
					aria-label="Preset"
					value={entry.preset}
					onChange={(e) => change({ preset: e.target.value as PresetEntry["preset"] })}
					className={selectClass}
				>
					{MOTION_PRESETS.map((name) => (
						<option key={name} value={name}>
							{name}
						</option>
					))}
				</select>
			</Field>
			<div className="grid grid-cols-2 gap-2">
				<Field label="At">
					<NumberInput
						value={entry.atMs}
						scale={1000}
						digits={2}
						step={0.05}
						min={0}
						max={duration}
						suffix="s"
						onCommit={(v) => change({ atMs: v })}
					/>
				</Field>
				<Field label="For">
					<NumberInput
						value={presetDuration(entry)}
						scale={1000}
						digits={2}
						step={0.05}
						min={10}
						max={60000}
						suffix="s"
						onCommit={(v) => change({ durationMs: Math.round(v) })}
					/>
				</Field>
			</div>
			<Field label="Ease">
				<EaseSelect value={entry.ease} none={auto} onChange={(ease) => change({ ease })} />
			</Field>
			{amount && (
				<Field label={amount.label === "from ×" ? "From scale" : `Amount (${amount.label})`}>
					<NumberInput
						value={entry.amount ?? amount.fallback}
						step={amount.label === "from ×" ? 0.05 : 5}
						digits={amount.label === "from ×" ? 2 : 0}
						suffix={amount.label === "from ×" ? "×" : amount.label}
						onCommit={(v) => change({ amount: v })}
					/>
				</Field>
			)}
		</Section>
	);
}

/** A small icon button for the timeline's rows. */
export function RowButton({
	label,
	onPress,
	active,
	children,
	className,
}: {
	label: string;
	onPress: () => void;
	active?: boolean;
	children: ReactNode;
	className?: string;
}) {
	return (
		<button
			type="button"
			aria-label={label}
			aria-pressed={active}
			title={label}
			onPointerDown={(e) => e.stopPropagation()}
			onClick={(e) => {
				e.stopPropagation();
				onPress();
			}}
			className={cn(
				"flex size-5 shrink-0 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground",
				active && "text-accent hover:text-accent",
				className,
			)}
		>
			{children}
		</button>
	);
}
