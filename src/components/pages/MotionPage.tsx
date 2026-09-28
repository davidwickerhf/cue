import { Button } from "@heroui/react";
import {
	ArrowDown,
	ArrowUp,
	Copy,
	Pause,
	Play,
	Plus,
	ShootingStar,
	Trash,
} from "@phosphor-icons/react";
import {
	type Dispatch,
	type PointerEvent as ReactPointerEvent,
	type SetStateAction,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	animatedProps,
	type KeyProp,
	keyableProps,
	poseAt,
	setKey,
	valueAt,
} from "../../../electron/core/motionKeys";
import {
	type Box,
	layerAt,
	layerAtPoint,
	layerBox,
	moveLayer,
	reorderLayer,
	updateLayer,
} from "../../../electron/core/motionLayers";
import { compileMotion } from "../../../electron/core/motionSpec";
import { buildTemplate, MOTION_TEMPLATES } from "../../../electron/core/motionTemplates";
import type { KeySel } from "../../../electron/core/motionTimeline";
import type { Asset } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { drawMotion, forgetMotion, onMotionReady, provideMotion } from "../../lib/motion";
import { goToPage, pageState } from "../../lib/pages";
import { playback } from "../../lib/playback";
import { editor, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { TemplateSection } from "../layout/Inspector";
import {
	ColorInput,
	Field,
	NumberInput,
	Section,
	Segmented,
	TextInput,
	Toggle,
} from "../ui/controls";
import { KeyGlyph, KeysSection, PresetSection, type PresetSel } from "./MotionKeys";
import { MotionTimeline } from "./MotionTimeline";

type Json = Record<string, unknown>;

const FONTS = [
	{ value: "sans", label: "Sans" },
	{ value: "ui", label: "UI" },
	{ value: "serif", label: "Serif" },
	{ value: "display", label: "Display" },
	{ value: "mono", label: "Mono" },
] as const;

const HEIGHT_KEY = "cue.motion.timelineHeight";

function storedHeight(): number {
	const v = Number(localStorage.getItem(HEIGHT_KEY));
	return Number.isFinite(v) && v >= 120 ? v : 300;
}

/**
 * The Motion page: one motion graphic at a time, like an After Effects
 * composition. The graphics on the left, a large preview with the picked
 * layer's box to drag in the middle, its still properties (or a template's
 * fields, or the picked keys) on the right, and across the bottom a timeline
 * with the layers, their properties and keys. Every change is one undoable
 * update of the graphic, and clips using it update everywhere.
 */
export function MotionPage() {
	const project = useProject();
	const wanted = pageState.use((s) => s.motionAssetId);
	const graphics = useMemo(
		() => project?.data.assets.filter((a) => a.kind === "lottie") ?? [],
		[project?.data.assets],
	);
	const asset = graphics.find((a) => a.id === wanted) ?? graphics[0];
	const [selected, setSelected] = useState<number[] | null>(null);
	const [keySel, setKeySel] = useState<KeySel[]>([]);
	const [presetSel, setPresetSel] = useState<PresetSel | null>(null);
	const [playing, setPlaying] = useState(false);
	// A drag's result, shown (timeline and preview) until it is saved.
	const [draft, setDraft] = useState<Json | null>(null);
	const [timelineH, setTimelineH] = useState(storedHeight);
	// The preview's time, in the graphic's frames: shared by the preview, the timeline and the inspector.
	const info = asset?.motion;
	const inFrame = info?.inFrame ?? 0;
	const outFrame = info?.outFrame ?? 60;
	const fps = info?.fps ?? 30;
	const [frame, setFrame] = useState(inFrame + (outFrame - inFrame) * 0.6);
	// A new graphic starts with nothing picked, at its own moment (not past its end).
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the graphic changes
	useEffect(() => {
		setSelected(null);
		setKeySel([]);
		setPresetSel(null);
		setDraft(null);
		setPlaying(false);
		setFrame(Math.round(inFrame + (outFrame - inFrame) * 0.6));
	}, [asset?.id]);

	// Stopped playback rests on a whole frame, where keys go.
	useEffect(() => {
		if (!playing) setFrame((f) => Math.round(f));
	}, [playing]);

	const canvas = project?.data.canvas;
	const source = asset?.motionSource;
	const template = source?.template
		? MOTION_TEMPLATES.find((t) => t.id === source.template)
		: undefined;
	const saved = useMemo(() => {
		if (!canvas) return null;
		try {
			return source?.spec
				? (source.spec as Json)
				: template
					? (buildTemplate(template.id, source?.params ?? {}, canvas) as unknown as Json)
					: null;
		} catch {
			return null;
		}
	}, [source, template, canvas]);
	// The saved graphic changed (a save landed, or an undo): drafts are done.
	// biome-ignore lint/correctness/useExhaustiveDependencies: only when the saved graphic changes
	useEffect(() => setDraft(null), [saved]);
	const save = useCallback(
		async (next: Json) => {
			if (!asset) return;
			await run("update_motion_graphic", { assetId: asset.id, spec: next });
		},
		[asset],
	);
	const commit = useCallback(
		async (next: Json) => {
			setDraft(next);
			await save(next);
			setDraft(null);
		},
		[save],
	);
	if (!project || !canvas) return null;

	const spec = draft ?? saved;
	const editable = !!source?.spec;
	const layer = spec && selected ? layerAt(spec, selected) : undefined;
	// Edits happen on whole frames, where keys sit.
	const atMs = (Math.round(frame) / fps) * 1000;
	const seekMs = (ms: number) => {
		setPlaying(false);
		setFrame(Math.min(outFrame, Math.max(inFrame, Math.round((ms / 1000) * fps))));
	};
	const pick = (path: number[] | null) => {
		if (path?.join(".") !== selected?.join(".")) setPresetSel(null);
		setSelected(path);
	};

	const startResize = (e: ReactPointerEvent) => {
		e.preventDefault();
		const y0 = e.clientY;
		const h0 = timelineH;
		let h = h0;
		const onMove = (ev: PointerEvent) => {
			h = Math.round(Math.min(window.innerHeight - 220, Math.max(120, h0 - (ev.clientY - y0))));
			setTimelineH(h);
		};
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			localStorage.setItem(HEIGHT_KEY, String(h));
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex min-h-0 flex-1">
				<aside className="custom-scrollbar flex w-60 shrink-0 flex-col overflow-y-auto border-r border-separator bg-surface">
					<Section title="Graphics">
						{graphics.length === 0 && (
							<p className="text-[12px] leading-relaxed text-muted">
								No motion graphics yet. Make one from a template in the Asset library, or ask your
								agent to design one.
							</p>
						)}
						<div className="flex flex-col gap-0.5">
							{graphics.map((g) => (
								<button
									key={g.id}
									type="button"
									onClick={() => pageState.set({ motionAssetId: g.id })}
									className={cn(
										"flex h-7 items-center gap-2 rounded-md px-2 text-left text-[12px]",
										g.id === asset?.id
											? "bg-default text-foreground"
											: "text-foreground/80 hover:bg-default/60",
									)}
								>
									<ShootingStar className="size-3.5 shrink-0 text-muted" />
									<span className="min-w-0 flex-1 truncate">{g.name}</span>
								</button>
							))}
						</div>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 w-full gap-1.5 text-[12px]"
							onPress={() => {
								editor.set({ panel: "library" });
								goToPage("edit");
							}}
						>
							<Plus className="size-3.5" /> New from a template…
						</Button>
						{spec && !editable && template && (
							<p className="text-[11px] leading-relaxed text-muted">
								Made from the {template.name} template. Change its fields on the right, or change
								any layer in the timeline: the graphic then becomes your own design.
							</p>
						)}
					</Section>
				</aside>

				<main className="flex min-w-0 flex-1 flex-col bg-background">
					{asset ? (
						<Stage
							asset={asset}
							url={project.assetUrls[asset.id]}
							spec={spec}
							draft={draft}
							canvas={canvas}
							selected={selected}
							onSelect={pick}
							onMove={(path, dx, dy) => {
								if (spec) void commit(moveLayer(spec, path, dx, dy));
							}}
							frame={frame}
							setFrame={setFrame}
							playing={playing}
							setPlaying={setPlaying}
						/>
					) : (
						<div className="flex flex-1 items-center justify-center text-[13px] text-muted">
							Pick or make a motion graphic to design it here.
						</div>
					)}
				</main>

				<aside className="custom-scrollbar w-80 shrink-0 overflow-y-auto border-l border-separator bg-surface">
					{asset && (
						<div className="flex flex-col">
							<Section title={asset.name}>
								<div className="flex flex-wrap gap-1.5">
									<Button
										size="sm"
										variant="secondary"
										className="h-7 text-[12px]"
										onPress={() => {
											void run("add_clips", {
												clips: [
													{
														type: "media",
														assetId: asset.id,
														trackId: topPictureTrack(project.data.tracks) ?? "V1",
														startMs: Math.round(playback.currentMs),
													},
												],
											}).then(() => notify("Placed at the playhead", "success"));
										}}
									>
										Place at playhead
									</Button>
									{spec && (
										<Button
											size="sm"
											variant="ghost"
											className="h-7 gap-1.5 text-[12px]"
											onPress={() =>
												void run<Asset>("create_motion_graphic", {
													spec,
													name: `${asset.name} copy`,
												}).then((made) => made && pageState.set({ motionAssetId: made.id }))
											}
										>
											<Copy className="size-3.5" /> Duplicate
										</Button>
									)}
								</div>
							</Section>
							{spec && keySel.length > 0 && (
								<KeysSection
									spec={spec}
									sel={keySel}
									fps={fps}
									commit={(next) => void commit(next)}
									onSel={setKeySel}
								/>
							)}
							{spec && presetSel && (
								<PresetSection spec={spec} sel={presetSel} commit={(next) => void commit(next)} />
							)}
							{template && !editable && !layer && <TemplateSection asset={asset} />}
							{editable && spec && !layer && <CompositionFields spec={spec} save={commit} />}
							{spec && layer && selected && !editable && template && (
								<p className="mx-4 mt-3 rounded-lg border border-border bg-default/40 p-3 text-[11px] leading-relaxed text-muted">
									Changing a layer makes this graphic your own design: the {template.name}{" "}
									template&apos;s fields stop applying to it (clips using it keep working). Pick
									nothing to see the template&apos;s fields again.
								</p>
							)}
							{spec && layer && selected && (
								<LayerFields
									key={selected.join(".")}
									spec={spec}
									path={selected}
									layer={layer}
									save={commit}
									onPath={(path) => {
										setKeySel([]);
										pick(path);
									}}
									atMs={atMs}
									onKeyed={(prop, ms) => setKeySel([{ path: selected, prop, ms }])}
								/>
							)}
							{!spec && (
								<Section title="Imported animation">
									<p className="text-[12px] leading-relaxed text-muted">
										This Lottie file came from outside Cue (After Effects or LottieFiles): change
										its text and colours in the Inspector on the Edit page. Graphics made in Cue can
										be edited layer by layer here.
									</p>
								</Section>
							)}
						</div>
					)}
				</aside>
			</div>

			{asset && spec && (
				<>
					<hr
						aria-orientation="horizontal"
						aria-label="Timeline height"
						aria-valuenow={timelineH}
						tabIndex={0}
						onKeyDown={(e) => {
							if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
							e.preventDefault();
							e.stopPropagation();
							const h = Math.min(
								window.innerHeight - 220,
								Math.max(120, timelineH + (e.key === "ArrowUp" ? 32 : -32)),
							);
							setTimelineH(h);
							localStorage.setItem(HEIGHT_KEY, String(h));
						}}
						onPointerDown={startResize}
						className="relative m-0 h-px shrink-0 cursor-row-resize border-0 bg-separator after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 after:content-[''] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
					/>
					<div className="flex shrink-0 flex-col" style={{ height: timelineH }}>
						<MotionTimeline
							spec={spec}
							fps={fps}
							atMs={atMs}
							onSeekMs={seekMs}
							playing={playing}
							onTogglePlay={() => setPlaying((p) => !p)}
							selected={selected}
							onSelect={pick}
							keySel={keySel}
							onKeySel={setKeySel}
							presetSel={presetSel}
							onPresetSel={setPresetSel}
							commit={commit}
							preview={setDraft}
						/>
					</div>
				</>
			)}
		</div>
	);
}

function topPictureTrack(tracks: { id: string; kind: string; locked?: boolean }[]) {
	return tracks.find((t) => t.kind === "video" && !t.locked)?.id;
}

const DRAFT_PREFIX = "motion-draft:";
let draftCount = 0;

function hasImages(layers: unknown): boolean {
	return (
		Array.isArray(layers) && layers.some((l: Json) => l?.type === "image" || hasImages(l?.layers))
	);
}

/**
 * An unsaved version of the graphic compiled here, so the preview follows a
 * drag live (at most every few frames); saved versions come from the file.
 * Graphics with pictures wait for the save (their files are read by the app).
 */
function useDraftMotion(
	draft: Json | null,
	comp: { width: number; height: number; fps: number },
): string | null {
	const [key, setKey] = useState<string | null>(null);
	const pending = useRef<Json | null>(null);
	const timer = useRef<number | null>(null);
	const lastAt = useRef(0);
	const made = useRef<string[]>([]);
	useEffect(() => {
		pending.current = draft;
		if (!draft || hasImages(draft.layers)) {
			if (timer.current !== null) window.clearTimeout(timer.current);
			timer.current = null;
			setKey(null);
			return;
		}
		if (timer.current !== null) return;
		const build = () => {
			timer.current = null;
			lastAt.current = performance.now();
			const next = pending.current;
			if (!next) return;
			try {
				// Only the size and rate: the project's own background is not the graphic's.
				const { width, height, fps } = comp;
				const json = compileMotion({ width, height, fps, ...next });
				const k = `${DRAFT_PREFIX}${++draftCount}`;
				provideMotion(k, json);
				// Keep the last few (the preview shows the newest that has loaded), free the rest.
				made.current.push(k);
				while (made.current.length > 3) forgetMotion(made.current.shift() as string);
				setKey(k);
			} catch {
				// A draft that doesn't compile keeps showing the last one that did.
			}
		};
		const wait = Math.max(0, 70 - (performance.now() - lastAt.current));
		timer.current = window.setTimeout(build, wait);
	}, [draft, comp]);
	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);
	return key;
}

/** The preview: the graphic drawn at a frame, a transport, and the chosen layer's box to drag. */
function Stage({
	asset,
	url,
	spec,
	draft,
	canvas: comp,
	selected,
	onSelect,
	onMove,
	frame,
	setFrame,
	playing,
	setPlaying,
}: {
	asset: Asset;
	url: string | undefined;
	spec: Json | null;
	/** An unsaved change (a drag on the timeline): drawn from a local compile until it is saved. */
	draft: Json | null;
	canvas: { width: number; height: number; fps: number };
	selected: number[] | null;
	onSelect: (path: number[] | null) => void;
	onMove: (path: number[], dx: number, dy: number) => void;
	frame: number;
	setFrame: Dispatch<SetStateAction<number>>;
	playing: boolean;
	setPlaying: Dispatch<SetStateAction<boolean>>;
}) {
	const info = asset.motion;
	const inFrame = info?.inFrame ?? 0;
	const outFrame = info?.outFrame ?? 60;
	const fps = info?.fps ?? 30;
	const W = Number(spec?.width ?? 1920);
	const H = Number(spec?.height ?? 1080);
	const [area, setArea] = useState({ w: 800, h: 450 });
	const [drag, setDrag] = useState<{ x: number; y: number; dx: number; dy: number } | null>(null);
	const holder = useRef<HTMLDivElement>(null);
	const canvas = useRef<HTMLCanvasElement>(null);
	const [ready, setReady] = useState(0);
	const [backdrop, setBackdrop] = useState<"checker" | "paper" | "white" | "black">("checker");

	useEffect(() => onMotionReady(() => setReady((n) => n + 1)), []);
	useEffect(() => {
		const el = holder.current;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) =>
			setArea({ w: entry.contentRect.width, h: entry.contentRect.height }),
		);
		observer.observe(el);
		return () => observer.disconnect();
	}, []);
	const scale = Math.min(area.w / W, area.h / H) * 0.94;
	const w = Math.max(2, Math.round(W * scale));
	const h = Math.max(2, Math.round(H * scale));
	const draftKey = useDraftMotion(draft, comp);
	// What was drawn last: shown while a new version loads, so edits never blink.
	const lastGood = useRef<string | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: redraw when loaded (ready) too
	useEffect(() => {
		const ctx = canvas.current?.getContext("2d");
		const src = draftKey ?? url;
		if (!ctx || !src) return;
		if (drawMotion(ctx, src, undefined, frame)) {
			if (lastGood.current !== src) {
				const old = lastGood.current;
				lastGood.current = src;
				if (old?.startsWith(DRAFT_PREFIX)) forgetMotion(old);
			}
		} else if (lastGood.current && lastGood.current !== src)
			drawMotion(ctx, lastGood.current, undefined, frame);
	}, [url, draftKey, frame, w, h, ready]);
	useEffect(() => {
		if (!playing) return;
		let raf = 0;
		let last = performance.now();
		const tick = (now: number) => {
			const step = ((now - last) / 1000) * fps;
			last = now;
			setFrame((f) => (f + step >= outFrame ? inFrame : f + step));
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, fps, inFrame, outFrame, setFrame]);

	// The picked layer's box where its keys have it now.
	const box: Box | null =
		spec && selected
			? layerBox(spec, poseAt(spec, layerAt(spec, selected) ?? {}, (frame / fps) * 1000))
			: null;
	const toComp = (e: { clientX: number; clientY: number }) => {
		const r = canvas.current?.getBoundingClientRect();
		if (!r) return { x: 0, y: 0 };
		return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
	};
	const seconds = (f: number) => ((f - inFrame) / fps).toFixed(2);

	return (
		<>
			<div ref={holder} className="relative flex min-h-0 flex-1 items-center justify-center p-4">
				<div
					className="relative"
					style={{
						width: w,
						height: h,
						// A checkerboard shows what is see-through; paper, white or black show it as it will sit.
						...(backdrop === "checker"
							? {
									backgroundImage:
										"linear-gradient(45deg,#2a2a2e 25%,transparent 25%),linear-gradient(-45deg,#2a2a2e 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#2a2a2e 75%),linear-gradient(-45deg,transparent 75%,#2a2a2e 75%)",
									backgroundSize: "20px 20px",
									backgroundPosition: "0 0,0 10px,10px -10px,-10px 0",
									backgroundColor: "#1d1d21",
								}
							: {
									backgroundColor:
										backdrop === "paper" ? "#f2ede4" : backdrop === "white" ? "#ffffff" : "#000000",
								}),
					}}
				>
					<canvas
						ref={canvas}
						width={w}
						height={h}
						aria-label={`Preview of ${asset.name}`}
						className="block size-full"
						onPointerDown={(e) => {
							if (!spec) return;
							const p = toComp(e);
							onSelect(layerAtPoint(spec, p.x, p.y)?.path ?? null);
						}}
					/>
					{box && selected && (
						<div
							role="presentation"
							className="absolute cursor-move border border-accent bg-accent/5"
							style={{
								left: (box.left + (drag?.dx ?? 0)) * scale,
								top: (box.top + (drag?.dy ?? 0)) * scale,
								width: (box.right - box.left) * scale,
								height: (box.bottom - box.top) * scale,
							}}
							onPointerDown={(e: ReactPointerEvent) => {
								(e.target as HTMLElement).setPointerCapture(e.pointerId);
								const p = toComp(e);
								setDrag({ x: p.x, y: p.y, dx: 0, dy: 0 });
							}}
							onPointerMove={(e) => {
								if (!drag) return;
								const p = toComp(e);
								setDrag({ ...drag, dx: p.x - drag.x, dy: p.y - drag.y });
							}}
							onPointerUp={() => {
								if (drag && (Math.abs(drag.dx) > 1 || Math.abs(drag.dy) > 1))
									onMove(selected, drag.dx, drag.dy);
								setDrag(null);
							}}
						>
							{["-left-1 -top-1", "-right-1 -top-1", "-left-1 -bottom-1", "-right-1 -bottom-1"].map(
								(c) => (
									<span
										key={c}
										className={cn(
											"absolute size-2 rounded-[2px] border border-accent bg-background",
											c,
										)}
									/>
								),
							)}
						</div>
					)}
				</div>
			</div>
			<div className="flex h-9 shrink-0 items-center gap-3 border-t border-separator bg-surface px-3">
				<button
					type="button"
					aria-label={playing ? "Pause" : "Play"}
					title={playing ? "Pause (Space)" : "Play (Space)"}
					onClick={() => setPlaying(!playing)}
					className="flex size-7 items-center justify-center rounded-md hover:bg-default"
				>
					{playing ? (
						<Pause weight="fill" className="size-4" />
					) : (
						<Play weight="fill" className="size-4" />
					)}
				</button>
				<span className="font-mono text-[11px] text-muted tabular">
					{seconds(frame)} / {seconds(outFrame)} s
				</span>
				<span className="flex-1" />
				<Segmented
					size="xs"
					value={backdrop}
					onChange={setBackdrop}
					options={[
						{ value: "checker", label: "Clear" },
						{ value: "paper", label: "Paper" },
						{ value: "white", label: "White" },
						{ value: "black", label: "Black" },
					]}
				/>
			</div>
		</>
	);
}

/** Size, length and background of the whole graphic, when no layer is picked. */
function CompositionFields({ spec, save }: { spec: Json; save: (next: Json) => Promise<void> }) {
	return (
		<Section title="Composition">
			<p className="text-[11px] leading-relaxed text-muted">
				Pick a layer in the list or on the preview to change it; drag it on the preview to move it.
			</p>
			<Field label="Length (s)">
				<NumberInput
					value={Math.round(Number(spec.durationMs ?? 3000) / 100) / 10}
					min={0.2}
					max={600}
					step={0.1}
					digits={1}
					onCommit={(v) => void save({ ...spec, durationMs: Math.round(v * 1000) })}
				/>
			</Field>
			<Field label="Size">
				<p className="text-[12px] text-muted tabular">
					{String(spec.width ?? 1920)} × {String(spec.height ?? 1080)}
				</p>
			</Field>
		</Section>
	);
}

/** The picked layer's properties; each change is one update of the graphic. */
function LayerFields({
	spec,
	path,
	layer,
	save,
	onPath,
	atMs,
	onKeyed,
}: {
	spec: Json;
	path: number[];
	layer: Json;
	save: (next: Json) => Promise<void>;
	onPath: (path: number[] | null) => void;
	atMs: number;
	/** A change landed on a key (of an animated property): pick it on the timeline. */
	onKeyed: (prop: KeyProp, ms: number) => void;
}) {
	const type = String(layer.type);
	const apply = (patch: Json) => save(updateLayer(spec, path, patch));
	const set = (patch: Json) => void apply(patch);
	const animated = animatedProps(layer);
	const num = (key: string, label: string, fallback: number, step = 1, digits = 0) => {
		// An animated property shows its value at the playhead, and a change keys it there.
		const keyed = animated.includes(key as KeyProp) && keyableProps(layer).includes(key as KeyProp);
		const input = (
			<NumberInput
				className={keyed ? "w-28" : undefined}
				value={
					keyed
						? Number(valueAt(spec, layer, key as KeyProp, atMs))
						: Number(layer[key] ?? fallback)
				}
				step={step}
				digits={digits}
				onCommit={(v) => {
					if (!keyed) return set({ [key]: v });
					const r = setKey(layer, key as KeyProp, atMs, v);
					void apply(r.patch).then(() => onKeyed(key as KeyProp, Math.round(atMs)));
				}}
			/>
		);
		if (!keyed)
			return (
				<Field label={label} inline>
					{input}
				</Field>
			);
		return (
			// biome-ignore lint/a11y/noLabelWithoutControl: the input is inside
			<label className="flex items-center justify-between gap-1 text-[12px]">
				<span
					className="flex items-center gap-1.5 text-muted"
					title="Animated: this is its value at the playhead, and a change sets a key there"
				>
					{label}
					<KeyGlyph glyph={{ in: "linear", out: "linear" }} selected className="scale-75" />
				</span>
				{input}
			</label>
		);
	};
	return (
		<>
			<Section
				title={String(layer.name ?? type)}
				action={
					<div className="flex gap-0.5">
						<IconAction
							label="Bring forward"
							onPress={() => {
								const r = reorderLayer(spec, path, 1);
								void save(r.spec).then(() => onPath(r.path));
							}}
						>
							<ArrowUp className="size-3.5" />
						</IconAction>
						<IconAction
							label="Send backward"
							onPress={() => {
								const r = reorderLayer(spec, path, -1);
								void save(r.spec).then(() => onPath(r.path));
							}}
						>
							<ArrowDown className="size-3.5" />
						</IconAction>
						<IconAction
							label="Delete layer"
							onPress={() => {
								const parent = path.slice(0, -1);
								const i = path[path.length - 1];
								const siblings =
									(parent.length
										? (layerAt(spec, parent)?.layers as Json[])
										: (spec.layers as Json[])) ?? [];
								const kept = siblings.filter((_, j) => j !== i);
								void save(
									parent.length
										? updateLayer(spec, parent, { layers: kept })
										: { ...spec, layers: kept },
								).then(() => onPath(null));
							}}
						>
							<Trash className="size-3.5" />
						</IconAction>
					</div>
				}
			>
				<Field label="Name">
					<TextInput
						value={String(layer.name ?? "")}
						onCommit={(v) => set({ name: v || undefined })}
					/>
				</Field>
				<Toggle
					label="Hidden"
					checked={!!layer.hidden}
					onChange={(v) => set({ hidden: v || undefined })}
				/>
				{type === "text" && (
					<>
						<Field label="Text">
							<TextInput
								value={String(layer.text ?? "")}
								multiline
								rows={2}
								onCommit={(v) => set({ text: v })}
							/>
						</Field>
						<Field label="Font">
							<Segmented
								size="xs"
								value={String(layer.font ?? "sans")}
								options={FONTS.map((f) => ({ value: f.value, label: f.label }))}
								onChange={(v) => set({ font: v })}
							/>
						</Field>
						{num("size", "Size", 48)}
						{num("weight", "Weight", 600, 100)}
						<Toggle
							label="Italic"
							checked={!!layer.italic}
							onChange={(v) => set({ italic: v || undefined })}
						/>
						<Field label="Colour">
							<ColorInput
								value={String(layer.color ?? "#ffffff")}
								onCommit={(v) => v && set({ color: v })}
							/>
						</Field>
					</>
				)}
				{(type === "rect" || type === "ellipse" || type === "path" || type === "line") && (
					<>
						{type !== "line" && (
							<Field label="Fill">
								<ColorInput
									value={(layer.fill as string | null) ?? null}
									allowNone
									onCommit={(v) => set({ fill: v })}
								/>
							</Field>
						)}
						<Field label="Stroke">
							<ColorInput
								value={(layer.stroke as string | null) ?? null}
								allowNone
								onCommit={(v) => set({ stroke: v })}
							/>
						</Field>
						{(layer.stroke || type === "line") && num("strokeWidth", "Stroke width", 4)}
					</>
				)}
			</Section>
			<Section title="Transform">
				{"x" in layer || type !== "line" ? (
					<>
						{num("x", "X", Number(spec.width ?? 1920) / 2)}
						{num("y", "Y", Number(spec.height ?? 1080) / 2)}
					</>
				) : null}
				{(type === "rect" || type === "ellipse" || type === "image") && (
					<>
						{num("width", "Width", 100)}
						{num("height", "Height", 100)}
					</>
				)}
				{num("rotation", "Rotation", 0, 1, 1)}
				{num("opacity", "Opacity", 1, 0.05, 2)}
			</Section>
		</>
	);
}

function IconAction({
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
			className="flex size-6 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
		>
			{children}
		</button>
	);
}
