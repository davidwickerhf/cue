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
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type Box,
	layerAt,
	layerAtPoint,
	layerBox,
	listLayers,
	moveLayer,
	reorderLayer,
	updateLayer,
} from "../../../electron/core/motionLayers";
import { buildTemplate, MOTION_TEMPLATES } from "../../../electron/core/motionTemplates";
import type { Asset } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { drawMotion, onMotionReady } from "../../lib/motion";
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

type Json = Record<string, unknown>;

const PRESETS = [
	"none",
	"fade",
	"rise",
	"fall",
	"slideLeft",
	"slideRight",
	"grow",
	"pop",
	"draw",
	"type",
	"blur",
	"spin",
];
const FONTS = ["sans", "serif", "display", "mono"] as const;

/**
 * The Motion page: one motion graphic at a time, like an After Effects
 * composition. Its layers on the left, a large preview with its own transport
 * in the middle (click a layer to pick it, drag it to move it), and the chosen
 * layer's properties (or a template's fields) on the right. Every change is one
 * undoable update of the graphic, and clips using it update everywhere.
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: a new graphic starts with nothing picked
	useEffect(() => setSelected(null), [asset?.id]);
	if (!project) return null;

	const canvas = project.data.canvas;
	const source = asset?.motionSource;
	const template = source?.template
		? MOTION_TEMPLATES.find((t) => t.id === source.template)
		: undefined;
	let spec: Json | null = null;
	try {
		spec = source?.spec
			? (source.spec as Json)
			: template
				? (buildTemplate(template.id, source?.params ?? {}, canvas) as unknown as Json)
				: null;
	} catch {
		spec = null;
	}
	const editable = !!source?.spec;
	const save = async (next: Json) => {
		if (!asset) return;
		await run("update_motion_graphic", { assetId: asset.id, spec: next });
	};
	const layer = spec && selected ? layerAt(spec, selected) : undefined;

	return (
		<div className="flex min-h-0 flex-1">
			<aside className="custom-scrollbar flex w-64 shrink-0 flex-col overflow-y-auto border-r border-separator bg-surface">
				<Section title="Graphics">
					{graphics.length === 0 && (
						<p className="text-[12px] leading-relaxed text-muted">
							No motion graphics yet. Make one from a template in the Asset library, or ask your
							agent to design one.
						</p>
					)}
					<div className="custom-scrollbar -mx-1 flex max-h-[32vh] flex-col gap-0.5 overflow-y-auto px-1">
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
				</Section>
				{spec && (
					<Section title="Layers">
						{!editable && template && (
							<p className="text-[11px] leading-relaxed text-muted">
								Made from the {template.name} template. Change its fields on the right, or pick any
								layer to change it directly: the graphic then becomes your own design.
							</p>
						)}
						<div className="flex flex-col gap-0.5">
							{listLayers(spec).map((row) => {
								const on = selected?.join() === row.path.join();
								return (
									<button
										key={row.path.join(".")}
										type="button"
										onClick={() => setSelected(row.path)}
										style={{ paddingLeft: 8 + row.depth * 14 }}
										className={cn(
											"flex h-7 items-center gap-2 rounded-md pr-2 text-left text-[12px] disabled:cursor-default",
											on
												? "bg-accent/20 text-foreground"
												: "text-foreground/80 enabled:hover:bg-default/60",
											row.layer.hidden ? "opacity-50" : "",
										)}
									>
										<span className="w-12 shrink-0 text-[10px] text-muted uppercase">
											{row.type}
										</span>
										<span className="min-w-0 flex-1 truncate">{row.name}</span>
									</button>
								);
							})}
						</div>
					</Section>
				)}
			</aside>

			<main className="flex min-w-0 flex-1 flex-col bg-background">
				{asset ? (
					<Stage
						asset={asset}
						url={project.assetUrls[asset.id]}
						spec={spec}
						selected={selected}
						onSelect={setSelected}
						onMove={(path, dx, dy) => {
							if (spec) void save(moveLayer(spec, path, dx, dy));
						}}
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
						{template && !editable && !layer && <TemplateSection asset={asset} />}
						{editable && spec && !layer && <CompositionFields spec={spec} save={save} />}
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
								save={save}
								onPath={setSelected}
							/>
						)}
						{!spec && (
							<Section title="Imported animation">
								<p className="text-[12px] leading-relaxed text-muted">
									This Lottie file came from outside Cue (After Effects or LottieFiles): change its
									text and colours in the Inspector on the Edit page. Graphics made in Cue can be
									edited layer by layer here.
								</p>
							</Section>
						)}
					</div>
				)}
			</aside>
		</div>
	);
}

function topPictureTrack(tracks: { id: string; kind: string; locked?: boolean }[]) {
	return tracks.find((t) => t.kind === "video" && !t.locked)?.id;
}

/** The preview: the graphic drawn at a frame, a transport, and the chosen layer's box to drag. */
function Stage({
	asset,
	url,
	spec,
	selected,
	onSelect,
	onMove,
}: {
	asset: Asset;
	url: string | undefined;
	spec: Json | null;
	selected: number[] | null;
	onSelect: (path: number[] | null) => void;
	onMove: (path: number[], dx: number, dy: number) => void;
}) {
	const info = asset.motion;
	const inFrame = info?.inFrame ?? 0;
	const outFrame = info?.outFrame ?? 60;
	const fps = info?.fps ?? 30;
	const W = Number(spec?.width ?? 1920);
	const H = Number(spec?.height ?? 1080);
	const [frame, setFrame] = useState(inFrame + (outFrame - inFrame) * 0.6);
	const [playing, setPlaying] = useState(false);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: redraw when loaded (ready) too
	useEffect(() => {
		const ctx = canvas.current?.getContext("2d");
		if (!ctx || !url) return;
		drawMotion(ctx, url, undefined, frame);
	}, [url, frame, w, h, ready]);
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
	}, [playing, fps, inFrame, outFrame]);

	const box: Box | null = spec && selected ? layerBox(spec, layerAt(spec, selected) ?? {}) : null;
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
			<div className="flex h-11 shrink-0 items-center gap-3 border-t border-separator bg-surface px-4">
				<button
					type="button"
					aria-label={playing ? "Pause" : "Play"}
					onClick={() => setPlaying(!playing)}
					className="flex size-7 items-center justify-center rounded-md hover:bg-default"
				>
					{playing ? (
						<Pause weight="fill" className="size-4" />
					) : (
						<Play weight="fill" className="size-4" />
					)}
				</button>
				<input
					type="range"
					aria-label="Time in the graphic"
					min={inFrame}
					max={outFrame}
					step={0.01}
					value={frame}
					onChange={(e) => {
						setPlaying(false);
						setFrame(Number(e.target.value));
					}}
					className="min-w-0 flex-1 accent-[var(--accent)]"
				/>
				<span className="w-24 text-right font-mono text-[11px] text-muted tabular">
					{seconds(frame)} / {seconds(outFrame)} s
				</span>
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
}: {
	spec: Json;
	path: number[];
	layer: Json;
	save: (next: Json) => Promise<void>;
	onPath: (path: number[] | null) => void;
}) {
	const type = String(layer.type);
	const set = (patch: Json) => void save(updateLayer(spec, path, patch));
	const num = (key: string, label: string, fallback: number, step = 1, digits = 0) => (
		<Field label={label} inline>
			<NumberInput
				value={Number(layer[key] ?? fallback)}
				step={step}
				digits={digits}
				onCommit={(v) => set({ [key]: v })}
			/>
		</Field>
	);
	const preset = (key: "enter" | "exit") => {
		const p = (layer[key] ?? null) as {
			preset?: string;
			atMs?: number;
			durationMs?: number;
		} | null;
		return (
			<Field label={key === "enter" ? "Comes in" : "Goes out"}>
				<div className="flex items-center gap-1.5">
					<select
						value={p?.preset ?? "none"}
						onChange={(e) =>
							set({
								[key]:
									e.target.value === "none"
										? undefined
										: {
												preset: e.target.value,
												atMs:
													p?.atMs ??
													(key === "enter"
														? 0
														: Math.max(0, Number(spec.durationMs ?? 3000) - 400)),
												...(p?.durationMs ? { durationMs: p.durationMs } : {}),
											},
							})
						}
						className="h-7 min-w-0 flex-1 rounded-md border border-border bg-field px-1.5 text-[12px]"
					>
						{PRESETS.map((name) => (
							<option key={name} value={name}>
								{name}
							</option>
						))}
					</select>
					{p?.preset && (
						<>
							<NumberInput
								value={Number(p.atMs ?? 0)}
								step={50}
								suffix="ms"
								onCommit={(v) => set({ [key]: { ...p, atMs: Math.max(0, Math.round(v)) } })}
							/>
						</>
					)}
				</div>
			</Field>
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
								options={FONTS.map((f) => ({ value: f, label: f[0].toUpperCase() + f.slice(1) }))}
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
			<Section title="Animation">
				{preset("enter")}
				{preset("exit")}
				<p className="text-[11px] leading-relaxed text-muted">
					Keyframes and effects beyond these are in the graphic's spec (get_motion_graphic); an
					agent can write them.
				</p>
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
