import { Button } from "@heroui/react";
import {
	ArrowsOutLineHorizontal,
	Copy,
	Scissors,
	TextAlignCenter,
	TextAlignLeft,
	TextAlignRight,
	Trash,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { valueAt } from "../../../electron/core/anim";
import type { MediaClip, ProjectSnapshot, TextClip } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { editor, useApp, useProject } from "../../lib/state";
import { cn, formatTime, nameFieldKeys } from "../../lib/utils";
import { layout } from "../../lib/workspace";
import {
	ColorInput,
	Field,
	IconButton,
	NumberInput,
	Range,
	Section,
	Segmented,
	TextInput,
	Toggle,
} from "../ui/controls";

const FONTS = [
	"DM Sans Variable",
	"SF Pro Display",
	"Helvetica Neue",
	"Avenir Next",
	"Georgia",
	"Times New Roman",
	"Menlo",
	"Futura",
	"Impact",
];
const ANIMATIONS = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "pop", label: "Pop" },
	{ value: "zoom", label: "Zoom" },
	{ value: "slide-up", label: "Slide up" },
	{ value: "slide-left", label: "Slide from right" },
	{ value: "typewriter", label: "Typewriter" },
] as const;

let installedFonts: Promise<string[]> | null = null;
/** Every font family on this Mac (Chromium's Local Font Access), falling back to a short list. */
function useFonts(): string[] {
	const [fonts, setFonts] = useState<string[]>(FONTS);
	useEffect(() => {
		const query = (window as unknown as { queryLocalFonts?: () => Promise<{ family: string }[]> })
			.queryLocalFonts;
		if (!query) return;
		installedFonts ??= query()
			.then((list) =>
				[...new Set([...FONTS, ...list.map((f) => f.family)])].sort((a, b) => a.localeCompare(b)),
			)
			.catch(() => FONTS);
		void installedFonts.then(setFonts);
	}, []);
	return fonts;
}

export function Inspector() {
	const project = useProject();
	const selected = useApp((s) => s.selectedClipIds) ?? [];
	const inspectorWidth = layout.use((s) => s.inspectorWidth);
	if (!project) return null;
	const clips = project.data.clips.filter((c) => selected.includes(c.id));
	const clip = clips.length === 1 ? clips[0] : null;

	return (
		<aside
			className="flex shrink-0 flex-col border-l border-separator bg-surface"
			style={{ width: inspectorWidth }}
		>
			<header className="flex h-10 shrink-0 items-center justify-between border-b border-separator pr-2 pl-4">
				<h2 className="truncate text-[12px] font-semibold">
					{clip
						? clip.type === "text"
							? "Text"
							: (clip.name ?? "Clip")
						: clips.length > 1
							? `${clips.length} clips`
							: "Inspector"}
				</h2>
				{clips.length > 0 && (
					<div className="flex gap-0.5">
						<IconButton
							label="Split at playhead"
							shortcut="⌘K"
							onPress={() =>
								void run("split_at", {
									atMs: playback.currentMs,
									trackIds: [...new Set(clips.map((c) => c.trackId))],
								})
							}
						>
							<Scissors className="size-4" />
						</IconButton>
						<IconButton
							label="Duplicate"
							shortcut="⌥ drag"
							onPress={() => void run("duplicate_clips", { ids: selected })}
						>
							<Copy className="size-4" />
						</IconButton>
						<IconButton
							label="Delete"
							shortcut="⌫"
							onPress={() => void run("delete_clips", { ids: selected })}
						>
							<Trash className="size-4" />
						</IconButton>
					</div>
				)}
			</header>
			<div className="custom-scrollbar min-h-0 flex-1 divide-y divide-separator overflow-y-auto">
				{!clip ? (
					<Nothing count={clips.length} />
				) : clip.type === "text" ? (
					<TextInspector clip={clip} />
				) : (
					<MediaInspector clip={clip} project={project} />
				)}
			</div>
		</aside>
	);
}

function Nothing({ count }: { count: number }) {
	const project = useProject();
	if (count > 1)
		return (
			<Section>
				<p className="text-[12px] text-muted">
					Drag to move them together, or use split, duplicate and delete above.
				</p>
			</Section>
		);
	if (!project) return null;
	const { canvas } = project.data;
	const rows: [string, string][] = [
		["Resolution", `${canvas.width} × ${canvas.height}`],
		["Frame rate", `${canvas.fps} fps`],
		["Duration", formatTime(project.durationMs)],
		["Tracks", String(project.data.tracks.length)],
		["Clips", String(project.data.clips.length)],
		["Media", String(project.data.assets.length)],
	];
	return (
		<>
			<Section title="Project">
				<dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[12px]">
					{rows.map(([k, v]) => (
						<div key={k} className="contents">
							<dt className="text-muted">{k}</dt>
							<dd className="text-right tabular">{v}</dd>
						</div>
					))}
				</dl>
			</Section>
			<MarkerList markers={project.data.markers} />
			<Section title="Shortcuts">
				<dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[12px]">
					{(
						[
							["Play / pause", "Space"],
							["Split at playhead", "⌘K"],
							["Select · blade", "V · C"],
							["Slip · roll · slide", "Y · N · U"],
							["Delete · ripple", "⌫ · ⇧⌫"],
							["Crossfade", "⌘D"],
							["Snapping", "S"],
							["Record line", "R"],
							["Frame · 5 frames", "← · ⇧←"],
							["Edit points", "↑ · ↓"],
							["Marker", "M"],
							["Shuttle", "J · K · L"],
							["In · out · play range", "I · O · /"],
							["All shortcuts", "⌘,"],
						] as const
					).map(([label, keys]) => (
						<div key={label} className="contents">
							<dt className="text-muted">{label}</dt>
							<dd className="text-right font-mono text-[11px]">{keys}</dd>
						</div>
					))}
				</dl>
			</Section>
		</>
	);
}

function Timing({ clip }: { clip: MediaClip | TextClip }) {
	const patch = (p: Record<string, unknown>) => void run("update_clip", { id: clip.id, patch: p });
	return (
		<Section title="Timing">
			<div className="grid grid-cols-2 gap-2">
				<Field label="Start">
					<NumberInput
						value={clip.startMs}
						scale={1000}
						digits={2}
						step={0.1}
						min={0}
						suffix="s"
						onCommit={(v) => patch({ startMs: Math.round(v) })}
					/>
				</Field>
				<Field label="Duration">
					<NumberInput
						value={clip.durationMs}
						scale={1000}
						digits={2}
						step={0.1}
						min={10}
						suffix="s"
						onCommit={(v) => patch({ durationMs: Math.round(v) })}
					/>
				</Field>
			</div>
			<p className="text-[11px] text-muted tabular-nums">
				{formatTime(clip.startMs)} → {formatTime(clip.startMs + clip.durationMs)}
			</p>
		</Section>
	);
}

type Prop = "x" | "y" | "scale" | "volume";

/** Diamond that keys a property at the playhead, like the stopwatch in other editors. */
function KeyButton({
	clip,
	prop,
	value,
	local,
}: {
	clip: MediaClip;
	prop: Prop;
	value: number;
	local: number;
}) {
	const keys = clip.keyframes?.[prop] ?? [];
	const here = keys.find((k) => Math.abs(k.atMs - local) <= 20);
	const inside = useInside(clip);
	return (
		<button
			type="button"
			disabled={!inside}
			title={
				here
					? "Remove keyframe"
					: keys.length
						? "Add keyframe at playhead"
						: "Animate: add a keyframe at the playhead"
			}
			onClick={() =>
				here
					? void run("remove_keyframe", { clipId: clip.id, prop, atMs: here.atMs })
					: void run("set_keyframe", {
							clipId: clip.id,
							prop,
							// Where the playhead is now, not when this last rendered.
							atMs: Math.round(Math.max(0, Math.min(clip.durationMs, localNow(clip)))),
							value,
							ease: "ease",
						})
			}
			className={cn(
				"flex size-5 items-center justify-center rounded text-muted transition-colors hover:bg-default disabled:opacity-30",
				keys.length && "text-amber-300",
			)}
		>
			<span className={cn("size-2 rotate-45 border border-current", here && "bg-current")} />
		</button>
	);
}

/** The playhead in the clip's own time, read when needed (e.g. on click). */
function localNow(clip: MediaClip) {
	return playback.currentMs - clip.startMs;
}

/** Whether the playhead is over the clip; re-renders only when that changes. */
function useInside(clip: MediaClip) {
	return playback.clock.use(
		(s) => s.currentMs >= clip.startMs && s.currentMs <= clip.startMs + clip.durationMs,
	);
}

function MediaInspector({ clip, project }: { clip: MediaClip; project: ProjectSnapshot }) {
	const asset = project.data.assets.find((a) => a.id === clip.assetId);
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	const patch = (p: Record<string, unknown>) => void run("update_clip", { id: clip.id, patch: p });
	const animated = !!clip.keyframes && Object.values(clip.keyframes).some((k) => k?.length);
	// Only follow the playhead (per frame) when the clip has keyframes.
	const frame = playback.clock.use((s) =>
		animated ? Math.round((s.currentMs - clip.startMs) / 33) : 0,
	);
	const local = animated ? frame * 33 : playback.currentMs - clip.startMs;
	const current = (prop: Prop, fallback: number) =>
		valueAt(clip.keyframes?.[prop], local, fallback);
	/** Edits key the value at the playhead once a property is animated. */
	const setProp = (prop: Prop, value: number) => {
		if (clip.keyframes?.[prop]?.length)
			void run("set_keyframe", {
				clipId: clip.id,
				prop,
				atMs: Math.round(Math.max(0, Math.min(clip.durationMs, localNow(clip)))),
				value,
				ease: "ease",
			});
		else if (prop === "volume") patch({ volume: value });
		else patch({ transform: { [prop]: value } });
	};
	const adjustment = asset?.kind === "adjustment";
	// Adjustment layers only have timing, colour and a mask.
	const visual = track?.kind === "video" && !adjustment;
	const audible = asset?.hasAudio && asset.kind !== "image";
	return (
		<>
			<Section>
				<p className="truncate text-[12px] text-muted">
					{asset?.name} · {track?.name}
					{clip.lineId && ` · line ${clip.lineId}`}
				</p>
			</Section>
			<Timing clip={clip} />
			{adjustment && (
				<Section>
					<p className="text-[12px] leading-relaxed text-muted">
						Grades every track below it while it lasts. Fade it in and out with the colour controls
						and opacity.
					</p>
				</Section>
			)}
			{adjustment && <ColorSection clip={clip} />}
			{adjustment && <EffectsSection clip={clip} adjustment />}
			{adjustment && <MaskSection clip={clip} />}
			{asset?.kind !== "image" && !adjustment && (
				<Section title="Source">
					<div className="grid grid-cols-2 gap-2">
						<Field label="In point">
							<NumberInput
								value={clip.inMs}
								scale={1000}
								digits={2}
								step={0.1}
								min={0}
								suffix="s"
								onCommit={(v) => patch({ inMs: Math.round(v) })}
							/>
						</Field>
						<Field label="Speed">
							<NumberInput
								value={clip.speed}
								digits={2}
								step={0.05}
								min={0.1}
								max={8}
								suffix="×"
								onCommit={(speed) => patch({ speed })}
							/>
						</Field>
					</div>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 gap-1.5 text-[12px]"
						onPress={() =>
							asset &&
							patch({ durationMs: Math.floor((asset.durationMs - clip.inMs) / clip.speed) })
						}
					>
						<ArrowsOutLineHorizontal className="size-3.5" /> Extend to the end of the source
					</Button>
				</Section>
			)}
			{asset && asset.kind !== "image" && asset.kind !== "adjustment" && (
				<RampSection clip={clip} />
			)}
			{audible && (
				<Section title="Audio">
					<Field label="Volume">
						<div className="flex items-center gap-1.5">
							<div className="flex-1">
								<Range
									value={current("volume", clip.volume)}
									min={0}
									max={2}
									step={0.01}
									format={(v) => `${Math.round(v * 100)}%`}
									onCommit={(v) => setProp("volume", v)}
								/>
							</div>
							<KeyButton
								clip={clip}
								prop="volume"
								value={current("volume", clip.volume)}
								local={local}
							/>
						</div>
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field label="Fade in">
							<NumberInput
								value={clip.fadeInMs}
								scale={1000}
								digits={2}
								step={0.1}
								min={0}
								suffix="s"
								onCommit={(v) => patch({ fadeInMs: Math.round(v) })}
							/>
						</Field>
						<Field label="Fade out">
							<NumberInput
								value={clip.fadeOutMs}
								scale={1000}
								digits={2}
								step={0.1}
								min={0}
								suffix="s"
								onCommit={(v) => patch({ fadeOutMs: Math.round(v) })}
							/>
						</Field>
					</div>
				</Section>
			)}
			{visual && (
				<Section title="Transform">
					<Field label="Scale">
						<div className="flex items-center gap-1.5">
							<div className="flex-1">
								<Range
									value={current("scale", clip.transform.scale)}
									min={0.1}
									max={3}
									step={0.01}
									format={(v) => `${Math.round(v * 100)}%`}
									onCommit={(v) => setProp("scale", v)}
								/>
							</div>
							<KeyButton
								clip={clip}
								prop="scale"
								value={current("scale", clip.transform.scale)}
								local={local}
							/>
						</div>
					</Field>
					<Field label="Opacity">
						<Range
							value={clip.transform.opacity}
							min={0}
							max={1}
							step={0.01}
							format={(v) => `${Math.round(v * 100)}%`}
							onCommit={(opacity) => patch({ transform: { opacity } })}
						/>
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field label="X">
							<div className="flex items-center gap-1">
								<NumberInput
									className="flex-1"
									value={current("x", clip.transform.x)}
									scale={0.01}
									digits={0}
									step={1}
									suffix="%"
									onCommit={(v) => setProp("x", v)}
								/>
								<KeyButton
									clip={clip}
									prop="x"
									value={current("x", clip.transform.x)}
									local={local}
								/>
							</div>
						</Field>
						<Field label="Y">
							<div className="flex items-center gap-1">
								<NumberInput
									className="flex-1"
									value={current("y", clip.transform.y)}
									scale={0.01}
									digits={0}
									step={1}
									suffix="%"
									onCommit={(v) => setProp("y", v)}
								/>
								<KeyButton
									clip={clip}
									prop="y"
									value={current("y", clip.transform.y)}
									local={local}
								/>
							</div>
						</Field>
					</div>
					<Button
						size="sm"
						variant="ghost"
						className="h-7 self-start text-[12px]"
						onPress={() =>
							patch({
								transform: {
									x: 0.5,
									y: 0.5,
									scale: 1,
									opacity: 1,
									crop: { left: 0, top: 0, right: 0, bottom: 0 },
								},
							})
						}
					>
						Reset
					</Button>
				</Section>
			)}
			{visual && (
				<Section title="Crop">
					<div className="grid grid-cols-2 gap-2">
						{(["left", "right", "top", "bottom"] as const).map((edge) => (
							<Field key={edge} label={edge[0].toUpperCase() + edge.slice(1)}>
								<NumberInput
									value={clip.transform.crop[edge]}
									scale={0.01}
									digits={0}
									step={1}
									min={0}
									max={0.45}
									suffix="%"
									onCommit={(v) => patch({ transform: { crop: { [edge]: v } } })}
								/>
							</Field>
						))}
					</div>
				</Section>
			)}
			{visual && <ZoomSection clip={clip} />}
			{visual && <ColorSection clip={clip} />}
			{visual && <EffectsSection clip={clip} video={asset?.kind === "video"} />}
			{visual && <MaskSection clip={clip} />}
			{visual && asset?.kind === "video" && <KeySection clip={clip} />}
			{clip.transitionIn && (
				<Section title="Transition in">
					<div className="flex items-center justify-between gap-2">
						<span className="text-[12px]">
							{clip.transitionIn.kind === "crossfade" ? "Crossfade" : "Dip to black"}
						</span>
						<span className="text-[12px] text-muted tabular">
							{(clip.transitionIn.durationMs / 1000).toFixed(2)} s
						</span>
						<Button
							size="sm"
							variant="ghost"
							className="h-7 text-[12px]"
							onPress={() => void run("remove_transition", { clipId: clip.id })}
						>
							Remove
						</Button>
					</div>
				</Section>
			)}
			{visual && asset?.kind === "video" && asset.hasAudio && clip.volume > 0 && (
				<Section>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 text-[12px]"
						onPress={() => void run("detach_audio", { id: clip.id })}
					>
						Detach audio to its own track
					</Button>
				</Section>
			)}
		</>
	);
}

function ZoomSection({ clip }: { clip: MediaClip }) {
	const zooms = clip.zooms ?? [];
	const inside = useInside(clip);
	return (
		<Section
			title="Zoom"
			action={
				<Button
					size="sm"
					variant="ghost"
					className="h-6 text-[11px]"
					isDisabled={!inside}
					onPress={() => {
						const local = Math.max(0, localNow(clip));
						void run("add_zoom", {
							clipId: clip.id,
							startMs: Math.round(local),
							endMs: Math.round(Math.min(clip.durationMs, local + 2500)),
							scale: 1.8,
						});
					}}
				>
					Add at playhead
				</Button>
			}
		>
			{zooms.length === 0 ? (
				<p className="text-[11px] text-muted">
					Push in on a detail, like a screen recorder's auto-zoom.
				</p>
			) : (
				zooms.map((z) => {
					const update = (patch: Record<string, number>) =>
						void run("update_zoom", { clipId: clip.id, zoomId: z.id, patch });
					return (
						<div key={z.id} className="flex flex-col gap-2 rounded-md border border-border p-2">
							<div className="grid grid-cols-3 gap-1.5">
								<Field label="From">
									<NumberInput
										value={z.startMs}
										scale={1000}
										digits={2}
										step={0.1}
										min={0}
										suffix="s"
										onCommit={(v) => update({ startMs: Math.round(v) })}
									/>
								</Field>
								<Field label="To">
									<NumberInput
										value={z.endMs}
										scale={1000}
										digits={2}
										step={0.1}
										min={0}
										suffix="s"
										onCommit={(v) => update({ endMs: Math.round(v) })}
									/>
								</Field>
								<Field label="Amount">
									<NumberInput
										value={z.scale}
										digits={1}
										step={0.1}
										min={1}
										max={6}
										suffix="×"
										onCommit={(scale) => update({ scale })}
									/>
								</Field>
								<Field label="Focus X">
									<NumberInput
										value={z.x}
										scale={0.01}
										digits={0}
										step={1}
										min={0}
										max={1}
										suffix="%"
										onCommit={(x) => update({ x })}
									/>
								</Field>
								<Field label="Focus Y">
									<NumberInput
										value={z.y}
										scale={0.01}
										digits={0}
										step={1}
										min={0}
										max={1}
										suffix="%"
										onCommit={(y) => update({ y })}
									/>
								</Field>
								<Field label="Ease">
									<NumberInput
										value={z.easeMs}
										scale={1000}
										digits={2}
										step={0.05}
										min={0}
										suffix="s"
										onCommit={(v) => update({ easeMs: Math.round(v) })}
									/>
								</Field>
							</div>
							<div className="flex justify-between">
								<Button
									size="sm"
									variant="ghost"
									className="h-6 text-[11px]"
									onPress={() =>
										playback.play({
											fromMs: clip.startMs + Math.max(0, z.startMs - 500),
											toMs: clip.startMs + z.endMs + 500,
										})
									}
								>
									Preview
								</Button>
								<Button
									size="sm"
									variant="ghost"
									className="h-6 text-[11px] text-danger"
									onPress={() => void run("remove_zoom", { clipId: clip.id, zoomId: z.id })}
								>
									Remove
								</Button>
							</div>
						</div>
					);
				})
			)}
		</Section>
	);
}

function ColorSection({ clip }: { clip: MediaClip }) {
	const c = { brightness: 0, contrast: 1, saturation: 1, temperature: 0, ...clip.color };
	const set = (color: Record<string, unknown>) =>
		void run("update_clip", { id: clip.id, patch: { color } });
	return (
		<Section
			title="Colour"
			action={
				clip.color ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px]"
						onPress={() =>
							set({ brightness: 0, contrast: 1, saturation: 1, temperature: 0, lut: undefined })
						}
					>
						Reset
					</Button>
				) : null
			}
		>
			<Field label="Brightness">
				<Range
					value={c.brightness}
					min={-0.5}
					max={0.5}
					step={0.01}
					format={(v) => `${v > 0 ? "+" : ""}${Math.round(v * 100)}`}
					onCommit={(brightness) => set({ brightness })}
				/>
			</Field>
			<Field label="Contrast">
				<Range
					value={c.contrast}
					min={0.5}
					max={2}
					step={0.01}
					format={(v) => `${Math.round(v * 100)}%`}
					onCommit={(contrast) => set({ contrast })}
				/>
			</Field>
			<Field label="Saturation">
				<Range
					value={c.saturation}
					min={0}
					max={2}
					step={0.01}
					format={(v) => `${Math.round(v * 100)}%`}
					onCommit={(saturation) => set({ saturation })}
				/>
			</Field>
			<Field label="Temperature">
				<Range
					value={c.temperature}
					min={-1}
					max={1}
					step={0.01}
					format={(v) =>
						v === 0 ? "0" : v > 0 ? `+${Math.round(v * 100)}` : `${Math.round(v * 100)}`
					}
					onCommit={(temperature) => set({ temperature })}
				/>
			</Field>
			<div className="flex items-center justify-between gap-2">
				<span className="truncate text-[11px] text-muted">
					{clip.color?.lut ? clip.color.lut.split("/").pop() : "No LUT"}
				</span>
				<Button
					size="sm"
					variant="secondary"
					className="h-6 shrink-0 text-[11px]"
					onPress={async () => {
						const file = await window.cue.chooseFile({
							title: "Choose a .cube LUT",
							extensions: ["cube"],
						});
						if (file) set({ lut: file });
					}}
				>
					LUT…
				</Button>
			</div>
			{clip.color?.lut && (
				<p className="text-[11px] text-muted">
					LUTs apply in the export; the preview shows the other adjustments.
				</p>
			)}
		</Section>
	);
}

function TextInspector({ clip }: { clip: TextClip }) {
	const s = clip.style;
	const patch = (p: Record<string, unknown>) => void run("update_clip", { id: clip.id, patch: p });
	const style = (p: Partial<typeof s>) => patch({ style: p });
	const fonts = useFonts();
	return (
		<>
			<Section title="Text">
				<TextInput multiline rows={3} value={clip.text} onCommit={(text) => patch({ text })} />
			</Section>
			<Timing clip={clip} />
			<Section title="Style">
				<Field label="Font">
					<select
						value={s.fontFamily}
						onChange={(e) => style({ fontFamily: e.target.value })}
						className="h-8 rounded-lg border border-border bg-field px-2 text-[13px] outline-none focus:border-accent"
						style={{ fontFamily: s.fontFamily }}
					>
						{(fonts.includes(s.fontFamily) ? fonts : [s.fontFamily, ...fonts]).map((f) => (
							<option key={f} value={f} style={{ fontFamily: f }}>
								{f.replace(" Variable", "")}
							</option>
						))}
					</select>
				</Field>
				<div className="grid grid-cols-2 gap-2">
					<Field label="Size">
						<NumberInput
							value={s.fontSize}
							min={6}
							max={600}
							step={2}
							suffix="px"
							onCommit={(fontSize) => style({ fontSize: Math.round(fontSize) })}
						/>
					</Field>
					<Field label="Weight">
						<NumberInput
							value={s.fontWeight}
							min={100}
							max={900}
							step={100}
							onCommit={(fontWeight) => style({ fontWeight: Math.round(fontWeight / 100) * 100 })}
						/>
					</Field>
				</div>
				<Field label="Colour">
					<ColorInput value={s.color} onCommit={(color) => color && style({ color })} />
				</Field>
				<Field label="Box">
					<ColorInput
						value={s.background}
						allowNone
						onCommit={(background) => style({ background })}
					/>
				</Field>
				<div className="flex items-center justify-between">
					<Segmented
						size="xs"
						value={s.align}
						onChange={(align) => style({ align })}
						options={[
							{ value: "left", label: <TextAlignLeft className="size-3.5" />, title: "Left" },
							{ value: "center", label: <TextAlignCenter className="size-3.5" />, title: "Centre" },
							{ value: "right", label: <TextAlignRight className="size-3.5" />, title: "Right" },
						]}
					/>
					<div className="flex gap-3">
						<label className="flex items-center gap-1.5 text-[12px]">
							<input
								type="checkbox"
								checked={s.uppercase}
								onChange={(e) => style({ uppercase: e.target.checked })}
								className="accent-[var(--accent)]"
							/>{" "}
							Caps
						</label>
						<label className="flex items-center gap-1.5 text-[12px] italic">
							<input
								type="checkbox"
								checked={!!s.italic}
								onChange={(e) => style({ italic: e.target.checked })}
								className="accent-[var(--accent)]"
							/>{" "}
							Italic
						</label>
					</div>
				</div>
				<Toggle label="Shadow" checked={s.shadow} onChange={(shadow) => style({ shadow })} />
				<div className="grid grid-cols-2 gap-2">
					<Field label="Gradient to">
						<ColorInput
							value={s.gradientTo ?? null}
							allowNone
							onCommit={(gradientTo) => style({ gradientTo })}
						/>
					</Field>
					<Field label="Outline">
						<ColorInput
							value={s.strokeColor ?? null}
							allowNone
							onCommit={(strokeColor) =>
								style({ strokeColor, strokeWidth: strokeColor ? s.strokeWidth || 4 : 0 })
							}
						/>
					</Field>
				</div>
				{s.strokeColor && (
					<Field label="Outline width">
						<Range
							value={s.strokeWidth ?? 4}
							min={0}
							max={24}
							step={1}
							format={(v) => `${v}px`}
							onCommit={(strokeWidth) => style({ strokeWidth })}
						/>
					</Field>
				)}
				<div className="grid grid-cols-2 gap-2">
					<Field label="Letter spacing">
						<NumberInput
							value={s.letterSpacing}
							min={-10}
							max={50}
							step={1}
							suffix="px"
							onCommit={(letterSpacing) => style({ letterSpacing })}
						/>
					</Field>
					<Field label="Line height">
						<NumberInput
							value={s.lineHeight}
							min={0.6}
							max={3}
							step={0.05}
							digits={2}
							onCommit={(lineHeight) => style({ lineHeight })}
						/>
					</Field>
				</div>
				<Field label="Rotation">
					<Range
						value={s.rotation ?? 0}
						min={-45}
						max={45}
						step={1}
						format={(v) => `${v}°`}
						onCommit={(rotation) => style({ rotation })}
					/>
				</Field>
			</Section>
			<Section title="Layout">
				<div className="grid grid-cols-3 gap-2">
					<Field label="X">
						<NumberInput
							value={s.x}
							scale={0.01}
							digits={0}
							step={1}
							suffix="%"
							onCommit={(x) => style({ x })}
						/>
					</Field>
					<Field label="Y">
						<NumberInput
							value={s.y}
							scale={0.01}
							digits={0}
							step={1}
							suffix="%"
							onCommit={(y) => style({ y })}
						/>
					</Field>
					<Field label="Width">
						<NumberInput
							value={s.width}
							scale={0.01}
							digits={0}
							step={1}
							suffix="%"
							onCommit={(width) => style({ width })}
						/>
					</Field>
					<Field label="Padding">
						<NumberInput
							value={s.padding}
							min={0}
							max={200}
							step={2}
							onCommit={(padding) => style({ padding })}
						/>
					</Field>
					<Field label="Radius">
						<NumberInput
							value={s.radius}
							min={0}
							max={200}
							step={2}
							onCommit={(radius) => style({ radius })}
						/>
					</Field>
					<Field label="Spacing">
						<NumberInput
							value={s.letterSpacing}
							min={-10}
							max={50}
							step={0.5}
							digits={1}
							onCommit={(letterSpacing) => style({ letterSpacing })}
						/>
					</Field>
				</div>
				<p className="text-[11px] text-muted">Drag the box in the preview to move it.</p>
			</Section>
			<Section title="Animation">
				<div className="grid grid-cols-2 gap-2">
					<Field label="In">
						<select
							value={clip.animationIn}
							onChange={(e) => patch({ animationIn: e.target.value as TextClip["animationIn"] })}
							className="h-8 rounded-lg border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
						>
							{ANIMATIONS.map((a) => (
								<option key={a.value} value={a.value}>
									{a.label}
								</option>
							))}
						</select>
					</Field>
					<Field label="Out">
						<select
							value={clip.animationOut}
							onChange={(e) => patch({ animationOut: e.target.value as TextClip["animationOut"] })}
							className="h-8 rounded-lg border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
						>
							{ANIMATIONS.filter((a) => a.value !== "typewriter").map((a) => (
								<option key={a.value} value={a.value}>
									{a.label}
								</option>
							))}
						</select>
					</Field>
				</div>
			</Section>
		</>
	);
}

const MARKER_TONE = {
	accent: "bg-accent",
	success: "bg-success",
	warning: "bg-warning",
	danger: "bg-danger",
} as const;

/** Every marker in time order: click to jump, rename in place, delete. ⇧M / ⇧⌘M step through them. */
function MarkerList({ markers }: { markers: ProjectSnapshot["data"]["markers"] }) {
	const sorted = [...markers].sort((a, b) => a.atMs - b.atMs);
	const labels = [...new Set(markers.map((m) => m.label))];
	return (
		<Section
			title={`Markers · ${markers.length}`}
			action={
				markers.length > 0 ? (
					<Button
						size="sm"
						variant="ghost"
						className="h-6 text-[11px]"
						onPress={() =>
							void run(
								"clear_markers",
								labels.includes("Beat") && labels.length > 1 ? { label: "Beat" } : {},
							)
						}
					>
						{labels.includes("Beat") && labels.length > 1 ? "Clear beats" : "Clear"}
					</Button>
				) : null
			}
		>
			{sorted.length === 0 ? (
				<p className="text-[11px] text-muted">Press M to drop a marker at the playhead.</p>
			) : (
				<ul className="-mx-1 flex max-h-56 flex-col overflow-y-auto">
					{sorted.slice(0, 300).map((m) => (
						<li
							key={m.id}
							className="group flex items-center gap-2 rounded-md px-1 py-0.5 hover:bg-default/60"
						>
							<span className={cn("size-2 shrink-0 rotate-45", MARKER_TONE[m.color])} />
							<button
								type="button"
								onClick={() => playback.seek(m.atMs)}
								className="w-12 shrink-0 text-left text-[11px] text-muted tabular"
							>
								{formatTime(m.atMs, false)}
							</button>
							<input
								key={m.label}
								defaultValue={m.label}
								onBlur={(e) =>
									e.target.value.trim() &&
									e.target.value !== m.label &&
									void run("update_marker", { id: m.id, patch: { label: e.target.value.trim() } })
								}
								onKeyDown={nameFieldKeys(m.label)}
								className="min-w-0 flex-1 truncate rounded bg-transparent px-1 text-[12px] outline-none focus:bg-default"
							/>
							<button
								type="button"
								aria-label="Delete marker"
								onClick={() => void run("remove_marker", { id: m.id })}
								className="text-[11px] text-muted opacity-0 group-hover:opacity-100 hover:text-danger"
							>
								✕
							</button>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
}

const RAMPS = [
	{ label: "Speed up", shape: "up", peak: 3 },
	{ label: "Slow down", shape: "down", peak: 3 },
	{ label: "Montage", shape: "inOut", peak: 4 },
	{ label: "Slow-mo hit", shape: "outIn", peak: 0.3 },
] as const;

/** Speed ramps in one click: over the in–out range if it falls inside the clip, else the whole clip. */
function RampSection({ clip }: { clip: MediaClip }) {
	const inPoint = editor.use((s) => s.inPoint);
	const outPoint = editor.use((s) => s.outPoint);
	const inside =
		inPoint !== null &&
		outPoint !== null &&
		inPoint >= clip.startMs &&
		outPoint <= clip.startMs + clip.durationMs &&
		outPoint - inPoint > 200;
	return (
		<Section title="Speed ramp">
			<div className="grid grid-cols-2 gap-1.5">
				{RAMPS.map((r) => (
					<Button
						key={r.label}
						size="sm"
						variant="secondary"
						className="h-7 text-[12px]"
						onPress={() =>
							void run("speed_ramp", {
								clipId: clip.id,
								shape: r.shape,
								peak: r.peak,
								...(inside
									? {
											fromMs: (inPoint as number) - clip.startMs,
											toMs: (outPoint as number) - clip.startMs,
										}
									: {}),
							})
						}
					>
						{r.label}
					</Button>
				))}
			</div>
			<p className="text-[11px] text-muted">
				{inside
					? "Applies between the in and out points."
					: "Applies to the whole clip. Mark in and out inside it to ramp just a part."}
			</p>
		</Section>
	);
}

/** A rectangle or ellipse that limits what shows of the clip, with a soft edge. */
function MaskSection({ clip }: { clip: MediaClip }) {
	const set = (mask: Record<string, unknown> | null) =>
		void run("update_clip", { id: clip.id, patch: { mask } });
	const m = clip.mask;
	if (!m)
		return (
			<Section title="Mask">
				<div className="flex gap-1.5">
					<Button
						size="sm"
						variant="secondary"
						className="h-7 flex-1 text-[12px]"
						onPress={() => set({ shape: "ellipse" })}
					>
						Ellipse
					</Button>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 flex-1 text-[12px]"
						onPress={() => set({ shape: "rectangle", feather: 0.02 })}
					>
						Rectangle
					</Button>
				</div>
			</Section>
		);
	const pct = (v: number) => `${Math.round(v * 100)}%`;
	return (
		<Section
			title={`Mask · ${m.shape}`}
			action={
				<Button size="sm" variant="ghost" className="h-6 text-[11px]" onPress={() => set(null)}>
					Remove
				</Button>
			}
		>
			<div className="grid grid-cols-2 gap-x-3 gap-y-1">
				<Field label="Centre X">
					<Range value={m.x} min={0} max={1} format={pct} onCommit={(x) => set({ x })} />
				</Field>
				<Field label="Centre Y">
					<Range value={m.y} min={0} max={1} format={pct} onCommit={(y) => set({ y })} />
				</Field>
				<Field label="Width">
					<Range
						value={m.width}
						min={0.02}
						max={1.5}
						format={pct}
						onCommit={(width) => set({ width })}
					/>
				</Field>
				<Field label="Height">
					<Range
						value={m.height}
						min={0.02}
						max={1.5}
						format={pct}
						onCommit={(height) => set({ height })}
					/>
				</Field>
			</div>
			<Field label="Feather">
				<Range
					value={m.feather}
					min={0}
					max={1}
					format={pct}
					onCommit={(feather) => set({ feather })}
				/>
			</Field>
			<Toggle
				label="Invert (show outside the shape)"
				checked={m.invert}
				onChange={(invert) => set({ invert })}
			/>
		</Section>
	);
}

/** Blur, sharpen, vignette, glow and stabilisation, previewed live and matched on export. */
function EffectsSection({
	clip,
	video,
	adjustment,
}: {
	clip: MediaClip;
	video?: boolean;
	adjustment?: boolean;
}) {
	const e = { blur: 0, sharpen: 0, vignette: 0, glow: 0, stabilize: false, ...clip.effects };
	const set = (effects: Record<string, unknown> | null) =>
		void run("update_clip", { id: clip.id, patch: { effects } });
	const pct = (v: number) => (v ? `${Math.round(v * 100)}` : "Off");
	const slider = (name: "blur" | "sharpen" | "vignette" | "glow", label: string) => (
		<Field label={label}>
			<Range
				value={e[name]}
				min={0}
				max={1}
				step={0.01}
				format={pct}
				onCommit={(v) => set({ [name]: v })}
			/>
		</Field>
	);
	return (
		<Section
			title="Effects"
			action={
				clip.effects ? (
					<Button size="sm" variant="ghost" className="h-6 text-[11px]" onPress={() => set(null)}>
						Reset
					</Button>
				) : null
			}
		>
			{slider("blur", "Blur")}
			{slider("sharpen", "Sharpen")}
			{slider("vignette", "Vignette")}
			{/* Glow needs the picture itself, so an adjustment layer can't glow what's below it. */}
			{!adjustment && slider("glow", "Glow")}
			{video && (
				<Toggle
					label="Stabilise (analysed on export)"
					checked={e.stabilize}
					onChange={(stabilize) => set({ stabilize })}
				/>
			)}
		</Section>
	);
}

/** Green or blue screen: pick the screen colour (the eyedropper samples the screen) and tune the edge. */
function KeySection({ clip }: { clip: MediaClip }) {
	const set = (key: Record<string, unknown> | null) =>
		void run("update_clip", { id: clip.id, patch: { key } });
	const k = clip.key;
	const pick = async () => {
		const Dropper = (
			window as unknown as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }
		).EyeDropper;
		if (!Dropper) return;
		try {
			const { sRGBHex } = await new Dropper().open();
			set({ color: sRGBHex.length === 7 ? sRGBHex : "#00ff00" });
		} catch {}
	};
	if (!k)
		return (
			<Section title="Chroma key">
				<div className="flex gap-1.5">
					<Button
						size="sm"
						variant="secondary"
						className="h-7 flex-1 text-[12px]"
						onPress={() => set({ color: "#00ff00" })}
					>
						Green screen
					</Button>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 flex-1 text-[12px]"
						onPress={() => set({ color: "#0000ff" })}
					>
						Blue screen
					</Button>
				</div>
			</Section>
		);
	return (
		<Section
			title="Chroma key"
			action={
				<Button size="sm" variant="ghost" className="h-6 text-[11px]" onPress={() => set(null)}>
					Remove
				</Button>
			}
		>
			<div className="flex items-center gap-2">
				<ColorInput value={k.color} onCommit={(color) => color && set({ color })} />
				<Button
					size="sm"
					variant="secondary"
					className="h-7 text-[12px]"
					onPress={() => void pick()}
				>
					Pick from screen
				</Button>
			</div>
			<Field label="Similarity">
				<Range
					value={k.similarity}
					min={0.01}
					max={0.6}
					format={(v) => `${Math.round(v * 100)}`}
					onCommit={(similarity) => set({ similarity })}
				/>
			</Field>
			<Field label="Edge softness">
				<Range
					value={k.blend}
					min={0}
					max={0.5}
					format={(v) => `${Math.round(v * 100)}`}
					onCommit={(blend) => set({ blend })}
				/>
			</Field>
		</Section>
	);
}
