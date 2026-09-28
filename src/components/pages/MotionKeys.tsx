import { Plus, Trash, X } from "@phosphor-icons/react";
import { type PointerEvent as ReactPointerEvent, useRef, useState } from "react";
import {
	addPreset,
	animatedProps,
	clearKeys,
	EASE_NAMES,
	KEY_PROPS,
	type Key,
	type KeyProp,
	keyableProps,
	keysOf,
	MAX_PRESETS,
	type PresetEntry,
	type PresetSide,
	presetAmount,
	presetDuration,
	presetsOf,
	removeKey,
	removePreset,
	retimeKey,
	setKey,
	setKeyEase,
	setKeyValue,
	updatePreset,
	valueAt,
} from "../../../electron/core/motionKeys";
import { type Ease, MOTION_PRESETS } from "../../../electron/core/motionSpec";
import { cn } from "../../lib/utils";
import { Field, NumberInput, TextInput } from "../ui/controls";

/**
 * Editing a layer's animation by hand on the Motion page: its keys, property by
 * property, in the inspector and on a slim strip under the preview's scrubber,
 * and its enter and exit presets. Each change is one update of the graphic, so
 * the preview redraws from the saved graphic straight away.
 */

type Json = Record<string, unknown>;

/** The key picked on the strip or in the inspector. */
export type PickedKey = { prop: KeyProp; index: number } | null;

const selectClass =
	"h-7 min-w-0 rounded-md border border-border bg-field px-1.5 text-[12px] text-foreground outline-none focus:border-accent disabled:opacity-50";

const propInfo = (prop: KeyProp) =>
	KEY_PROPS.find((p) => p.prop === prop) ?? { prop, label: prop, digits: 2, step: 1 };

const seconds = (ms: number) => (ms / 1000).toFixed(2);

function showValue(prop: KeyProp, v: number | string) {
	return typeof v === "number" ? v.toFixed(propInfo(prop).digits) : v;
}

/** Keys the property at `ms` with the value it has there; returns where the key landed. */
function keyHere(spec: Json, layer: Json, prop: KeyProp, ms: number) {
	const v = valueAt(spec, layer, prop, ms);
	const info = propInfo(prop);
	const rounded = typeof v === "number" ? Number(v.toFixed(Math.max(info.digits, 2))) : v;
	return setKey(layer, prop, ms, rounded);
}

/** A menu that keys a property not yet animated, at the playhead. */
function AddKeyMenu({
	spec,
	layer,
	atMs,
	apply,
	onPick,
	compact,
}: {
	spec: Json;
	layer: Json;
	atMs: number;
	apply: (patch: Json) => Promise<void>;
	onPick: (picked: PickedKey) => void;
	compact?: boolean;
}) {
	const animated = animatedProps(layer);
	const free = keyableProps(layer).filter((p) => !animated.includes(p));
	if (!free.length) return null;
	return (
		<select
			aria-label="Add a key at the playhead"
			value=""
			onChange={(e) => {
				const prop = e.target.value as KeyProp;
				if (!prop) return;
				const r = keyHere(spec, layer, prop, atMs);
				void apply(r.patch).then(() => onPick({ prop, index: r.index }));
			}}
			className={cn(selectClass, compact ? "h-5 w-full px-1 text-[11px]" : "w-full")}
		>
			<option value="">{compact ? "Add key…" : `Add a key at ${seconds(atMs)} s…`}</option>
			{free.map((p) => (
				<option key={p} value={p}>
					{propInfo(p).label}
				</option>
			))}
		</select>
	);
}

/** A diamond marking a key (a square for a hold). */
function Diamond({ picked, hold }: { picked: boolean; hold: boolean }) {
	return (
		<span
			className={cn(
				"block size-2 border",
				!hold && "rotate-45",
				picked
					? "border-accent bg-accent"
					: "border-foreground/70 bg-surface group-hover:border-accent",
			)}
		/>
	);
}

// ---------------------------------------------------------------------------
// The strip under the scrubber
// ---------------------------------------------------------------------------

/**
 * The picked layer's keys on the graphic's time, one row per animated property:
 * click a key to go there, drag it to retime it (saved on release), click the
 * row to move the playhead, + keys that property at the playhead.
 */
export function KeyStrip({
	spec,
	layer,
	fps,
	inFrame,
	outFrame,
	frame,
	onSeek,
	picked,
	onPick,
	apply,
}: {
	spec: Json;
	layer: Json;
	fps: number;
	inFrame: number;
	outFrame: number;
	frame: number;
	onSeek: (frame: number) => void;
	picked: PickedKey;
	onPick: (picked: PickedKey) => void;
	apply: (patch: Json) => Promise<void>;
}) {
	const inMs = (inFrame / fps) * 1000;
	const outMs = (outFrame / fps) * 1000;
	const span = Math.max(1, outMs - inMs);
	const atMs = (frame / fps) * 1000;
	const pct = (ms: number) => `${Math.min(100, Math.max(0, ((ms - inMs) / span) * 100))}%`;
	const toFrame = (ms: number) => (ms / 1000) * fps;
	const duration = Number(spec.durationMs ?? outMs);
	const startMs = Number(layer.startMs ?? 0);
	const endMs = Math.min(Number(layer.endMs ?? duration), duration);
	const props = animatedProps(layer);
	const keys = keysOf(layer);
	// A key being dragged: shown at its new time until the graphic is saved.
	const [drag, setDrag] = useState<{
		prop: KeyProp;
		index: number;
		x: number;
		width: number;
		from: number;
		ms: number;
	} | null>(null);
	const saving = useRef(false);

	const seekAt = (e: ReactPointerEvent<HTMLDivElement>) => {
		const r = e.currentTarget.getBoundingClientRect();
		const ms = inMs + ((e.clientX - r.left) / r.width) * span;
		onSeek(toFrame(Math.min(outMs, Math.max(inMs, ms))));
	};
	const track = (children: React.ReactNode, prop?: KeyProp) => (
		<div
			role="presentation"
			className="relative h-full min-w-0 flex-1 cursor-pointer"
			onPointerDown={(e) => {
				seekAt(e);
				if (prop) onPick(null);
			}}
		>
			<div className="absolute inset-x-0 top-1/2 h-px bg-border" />
			{children}
			<div
				className="pointer-events-none absolute inset-y-0 w-px bg-accent/70"
				style={{ left: pct(atMs) }}
			/>
		</div>
	);

	return (
		<div className="flex shrink-0 flex-col border-t border-separator bg-surface px-4 py-1.5">
			<div className="flex h-5 items-center gap-2">
				<span className="w-20 shrink-0 truncate text-[11px] text-muted">
					{String(layer.name ?? layer.type)}
				</span>
				{track(
					// The layer's own time: it shows from startMs to endMs.
					<div
						title={`Shows ${seconds(startMs)}–${seconds(endMs)} s`}
						className="absolute top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-accent/25"
						style={{ left: pct(startMs), width: `calc(${pct(endMs)} - ${pct(startMs)})` }}
					/>,
				)}
				<div className="w-20 shrink-0">
					<AddKeyMenu spec={spec} layer={layer} atMs={atMs} apply={apply} onPick={onPick} compact />
				</div>
			</div>
			{props.map((prop) => {
				const info = propInfo(prop);
				const ks = keys[prop] ?? [];
				return (
					<div key={prop} className="flex h-5 items-center gap-2">
						<span className="w-20 shrink-0 truncate text-[11px] text-foreground/80">
							{info.label}
						</span>
						{track(
							ks.map((k, i) => {
								const dragging = drag?.prop === prop && drag.index === i;
								const ms = dragging ? drag.ms : k[0];
								const on = picked?.prop === prop && picked.index === i;
								return (
									<button
										// biome-ignore lint/suspicious/noArrayIndexKey: keys are identified by their place
										key={i}
										type="button"
										aria-label={`${info.label} key at ${seconds(ms)} s`}
										title={`${info.label} at ${seconds(ms)} s: ${showValue(prop, k[1])}`}
										className="group absolute top-1/2 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center outline-none"
										style={{ left: pct(ms) }}
										onPointerDown={(e) => {
											e.stopPropagation();
											if (saving.current) return;
											e.currentTarget.setPointerCapture(e.pointerId);
											const row = e.currentTarget.parentElement?.getBoundingClientRect();
											setDrag({
												prop,
												index: i,
												x: e.clientX,
												width: row?.width ?? 1,
												from: k[0],
												ms: k[0],
											});
											onPick({ prop, index: i });
											onSeek(toFrame(k[0]));
										}}
										onPointerMove={(e) => {
											if (!dragging || saving.current) return;
											const raw = drag.from + ((e.clientX - drag.x) / drag.width) * span;
											// Whole frames, within the graphic.
											const step = 1000 / fps;
											const next = Math.min(duration, Math.max(0, Math.round(raw / step) * step));
											if (next !== drag.ms) setDrag({ ...drag, ms: next });
										}}
										onPointerUp={() => {
											if (!dragging) return;
											if (Math.round(drag.ms) === Math.round(drag.from)) return setDrag(null);
											const r = retimeKey(layer, prop, i, drag.ms);
											saving.current = true;
											void apply(r.patch).finally(() => {
												saving.current = false;
												setDrag(null);
												onPick({ prop, index: r.index });
												onSeek(toFrame(Math.round(drag.ms)));
											});
										}}
										onKeyDown={(e) => {
											if (e.key !== "Delete" && e.key !== "Backspace") return;
											e.stopPropagation();
											void apply(removeKey(layer, prop, i)).then(() => onPick(null));
										}}
									>
										<Diamond picked={on} hold={k[2] === "hold"} />
										{dragging && (
											<span className="pointer-events-none absolute bottom-full mb-0.5 rounded bg-default px-1 font-mono text-[10px] text-foreground">
												{seconds(ms)}
											</span>
										)}
									</button>
								);
							}),
							prop,
						)}
						<div className="flex w-20 shrink-0 justify-end">
							<button
								type="button"
								aria-label={`Add a ${info.label} key at the playhead`}
								title={`Add a ${info.label} key at the playhead`}
								onClick={() => {
									const r = keyHere(spec, layer, prop, atMs);
									void apply(r.patch).then(() => onPick({ prop, index: r.index }));
								}}
								className="flex size-5 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
							>
								<Plus className="size-3" />
							</button>
						</div>
					</div>
				);
			})}
		</div>
	);
}

// ---------------------------------------------------------------------------
// The inspector
// ---------------------------------------------------------------------------

/** An ease picker; `none` is what an unset ease means (linear for keys, the preset's own for presets). */
function EaseSelect({
	value,
	none,
	onChange,
	disabled,
	title,
}: {
	value: Ease | undefined;
	none: string;
	onChange: (ease: Ease | undefined) => void;
	disabled?: boolean;
	title?: string;
}) {
	const custom = Array.isArray(value);
	return (
		<select
			aria-label="Ease"
			title={title}
			disabled={disabled}
			value={custom ? "custom" : (value ?? "")}
			onChange={(e) => {
				const v = e.target.value;
				if (v !== "custom") onChange(v ? (v as Ease) : undefined);
			}}
			className={cn(selectClass, "w-full")}
		>
			<option value="">{none}</option>
			{EASE_NAMES.filter((n) => n !== none).map((n) => (
				<option key={n} value={n}>
					{n}
				</option>
			))}
			{custom && <option value="custom">custom curve</option>}
		</select>
	);
}

/** One property's keys: time, value and ease of each, and the playhead's value to key. */
function KeyList({
	spec,
	layer,
	prop,
	atMs,
	onSeekMs,
	picked,
	onPick,
	apply,
}: {
	spec: Json;
	layer: Json;
	prop: KeyProp;
	atMs: number;
	onSeekMs: (ms: number) => void;
	picked: PickedKey;
	onPick: (picked: PickedKey) => void;
	apply: (patch: Json) => Promise<void>;
}) {
	const info = propInfo(prop);
	const ks: Key[] = keysOf(layer)[prop] ?? [];
	const duration = Number(spec.durationMs ?? 3000);
	return (
		<div className="flex flex-col gap-1">
			<div className="flex items-center justify-between">
				<span className="text-[12px] text-foreground/85">
					{info.label} <span className="text-muted">· {ks.length}</span>
				</span>
				<div className="flex gap-0.5">
					<SmallAction
						label={`Add a ${info.label} key at the playhead`}
						onPress={() => {
							const r = keyHere(spec, layer, prop, atMs);
							void apply(r.patch).then(() => onPick({ prop, index: r.index }));
						}}
					>
						<Plus className="size-3.5" />
					</SmallAction>
					<SmallAction
						label={`Clear ${info.label} keys`}
						onPress={() => void apply(clearKeys(layer, prop)).then(() => onPick(null))}
					>
						<Trash className="size-3.5" />
					</SmallAction>
				</div>
			</div>
			{ks.map((k, i) => {
				const on = picked?.prop === prop && picked.index === i;
				const last = i === ks.length - 1;
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: keys are identified by their place
						key={i}
						className={cn(
							"-mx-1 grid grid-cols-[16px_64px_minmax(0,1fr)_84px_20px] items-center gap-1 rounded-md px-1 py-0.5",
							on && "bg-accent/10",
						)}
					>
						<button
							type="button"
							aria-label={`Go to this key (${seconds(k[0])} s)`}
							title="Go to this key"
							onClick={() => {
								onPick({ prop, index: i });
								onSeekMs(k[0]);
							}}
							className="group flex size-4 items-center justify-center"
						>
							<Diamond picked={on} hold={k[2] === "hold"} />
						</button>
						<NumberInput
							value={k[0]}
							scale={1000}
							digits={2}
							step={0.05}
							min={0}
							max={duration}
							suffix="s"
							onCommit={(v) => {
								const r = retimeKey(layer, prop, i, v);
								void apply(r.patch).then(() => onPick({ prop, index: r.index }));
							}}
						/>
						{typeof k[1] === "string" ? (
							<TextInput
								value={k[1]}
								onCommit={(v) => void apply(setKeyValue(layer, prop, i, v.trim()))}
							/>
						) : (
							<NumberInput
								value={k[1]}
								digits={info.digits}
								step={info.step}
								min={info.min}
								max={info.max}
								onCommit={(v) => void apply(setKeyValue(layer, prop, i, v))}
							/>
						)}
						<EaseSelect
							value={k[2]}
							none="linear"
							disabled={last}
							title={
								last
									? "The last key has nothing after it to ease into"
									: "How it moves from this key to the next"
							}
							onChange={(ease) => void apply(setKeyEase(layer, prop, i, ease))}
						/>
						<SmallAction
							label="Delete this key"
							onPress={() => void apply(removeKey(layer, prop, i)).then(() => onPick(null))}
						>
							<X className="size-3" />
						</SmallAction>
					</div>
				);
			})}
		</div>
	);
}

/** A layer's enter or exit presets, each fully editable. */
function PresetList({
	spec,
	layer,
	side,
	apply,
}: {
	spec: Json;
	layer: Json;
	side: PresetSide;
	apply: (patch: Json) => Promise<void>;
}) {
	const list = presetsOf(layer, side);
	const duration = Number(spec.durationMs ?? 3000);
	const change = (i: number, patch: Partial<PresetEntry>) =>
		void apply(updatePreset(layer, side, i, patch));
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center justify-between">
				<span className="text-[12px] text-foreground/85">
					{side === "enter" ? "Comes in" : "Goes out"}
				</span>
				{list.length < MAX_PRESETS && (
					<SmallAction
						label={side === "enter" ? "Add an entrance" : "Add an exit"}
						onPress={() => void apply(addPreset(spec, layer, side))}
					>
						<Plus className="size-3.5" />
					</SmallAction>
				)}
			</div>
			{list.length === 0 && (
				<p className="text-[11px] text-muted">{side === "enter" ? "Just there." : "Stays."}</p>
			)}
			{list.map((entry, i) => {
				const amount = presetAmount(entry.preset);
				const auto =
					side === "enter" ? (entry.preset === "pop" ? "outBack" : "outExpo") : "inCubic";
				return (
					<div
						// biome-ignore lint/suspicious/noArrayIndexKey: presets are identified by their place
						key={i}
						className="flex flex-col gap-1.5 rounded-md border border-border p-2"
					>
						<div className="flex items-center gap-1.5">
							<select
								aria-label="Preset"
								value={entry.preset}
								onChange={(e) => change(i, { preset: e.target.value as PresetEntry["preset"] })}
								className={cn(selectClass, "flex-1")}
							>
								{MOTION_PRESETS.map((name) => (
									<option key={name} value={name}>
										{name}
									</option>
								))}
							</select>
							<SmallAction label="Remove" onPress={() => void apply(removePreset(layer, side, i))}>
								<X className="size-3" />
							</SmallAction>
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							<Field label="At" inline>
								<NumberInput
									className="w-20"
									value={entry.atMs}
									scale={1000}
									digits={2}
									step={0.05}
									min={0}
									max={duration}
									suffix="s"
									onCommit={(v) => change(i, { atMs: v })}
								/>
							</Field>
							<Field label="For" inline>
								<NumberInput
									className="w-20"
									value={presetDuration(entry)}
									scale={1000}
									digits={2}
									step={0.05}
									min={1}
									max={60000}
									suffix="s"
									onCommit={(v) => change(i, { durationMs: Math.round(v) })}
								/>
							</Field>
						</div>
						<div className="grid grid-cols-2 gap-1.5">
							<EaseSelect value={entry.ease} none={auto} onChange={(ease) => change(i, { ease })} />
							{amount && (
								<NumberInput
									value={entry.amount ?? amount.fallback}
									step={amount.label === "from ×" ? 0.05 : 5}
									digits={amount.label === "from ×" ? 2 : 0}
									suffix={amount.label === "from ×" ? "×" : amount.label}
									onCommit={(v) => change(i, { amount: v })}
								/>
							)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

/** The Animation area of the layer inspector: keys by property, then enter and exit presets. */
export function AnimationFields({
	spec,
	layer,
	atMs,
	onSeekMs,
	picked,
	onPick,
	apply,
}: {
	spec: Json;
	layer: Json;
	atMs: number;
	onSeekMs: (ms: number) => void;
	picked: PickedKey;
	onPick: (picked: PickedKey) => void;
	apply: (patch: Json) => Promise<void>;
}) {
	return (
		<>
			<p className="text-[11px] leading-relaxed text-muted">
				Add keys at the playhead; each key's ease shapes the move to the next one.
			</p>
			<AddKeyMenu spec={spec} layer={layer} atMs={atMs} apply={apply} onPick={onPick} />
			{animatedProps(layer).map((prop) => (
				<KeyList
					key={prop}
					spec={spec}
					layer={layer}
					prop={prop}
					atMs={atMs}
					onSeekMs={onSeekMs}
					picked={picked}
					onPick={onPick}
					apply={apply}
				/>
			))}
			<PresetList spec={spec} layer={layer} side="enter" apply={apply} />
			<PresetList spec={spec} layer={layer} side="exit" apply={apply} />
		</>
	);
}

function SmallAction({
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
			aria-label={label}
			title={label}
			onClick={onPress}
			className="flex size-5 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
		>
			{children}
		</button>
	);
}
