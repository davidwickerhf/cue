import { Button } from "@heroui/react";
import { ArrowsOutLineHorizontal, Copy, Scissors, TextAlignCenter, TextAlignLeft, TextAlignRight, Trash } from "@phosphor-icons/react";
import type { MediaClip, ProjectSnapshot, TextClip } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { useApp, useProject } from "../../lib/state";
import { formatTime } from "../../lib/utils";
import { ColorInput, Field, IconButton, NumberInput, Range, Section, Segmented, TextInput, Toggle } from "../ui/controls";

const FONTS = ["DM Sans Variable", "SF Pro Display", "Helvetica Neue", "Avenir Next", "Georgia", "Times New Roman", "Menlo", "Futura", "Impact"];
const ANIMATIONS = [
	{ value: "none", label: "None" },
	{ value: "fade", label: "Fade" },
	{ value: "pop", label: "Pop" },
	{ value: "slide-up", label: "Slide" },
	{ value: "typewriter", label: "Type" },
] as const;

export function Inspector() {
	const project = useProject();
	const selected = useApp((s) => s.selectedClipIds) ?? [];
	if (!project) return null;
	const clips = project.data.clips.filter((c) => selected.includes(c.id));
	const clip = clips.length === 1 ? clips[0] : null;

	return (
		<aside className="flex w-[288px] shrink-0 flex-col border-l border-separator bg-surface">
			<header className="flex h-10 shrink-0 items-center justify-between border-b border-separator pr-2 pl-4">
				<h2 className="truncate text-[12px] font-semibold">{clip ? (clip.type === "text" ? "Text" : (clip.name ?? "Clip")) : clips.length > 1 ? `${clips.length} clips` : "Inspector"}</h2>
				{clips.length > 0 && (
					<div className="flex gap-0.5">
						<IconButton label="Split at playhead" shortcut="S" onPress={() => void run("split_at", { atMs: playback.currentMs, trackIds: [...new Set(clips.map((c) => c.trackId))] })}>
							<Scissors className="size-4" />
						</IconButton>
						<IconButton label="Duplicate" shortcut="⌘D" onPress={() => void run("duplicate_clips", { ids: selected })}>
							<Copy className="size-4" />
						</IconButton>
						<IconButton label="Delete" shortcut="⌫" onPress={() => void run("delete_clips", { ids: selected })}>
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
				<p className="text-[12px] text-muted">Drag to move them together, or use split, duplicate and delete above.</p>
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
			<Section title="Shortcuts">
				<dl className="grid grid-cols-[1fr_auto] gap-y-1.5 text-[12px]">
					{(
						[
							["Play / pause", "Space"],
							["Split at playhead", "S"],
							["Blade · select", "B · V"],
							["Delete · ripple", "⌫ · ⇧⌫"],
							["Duplicate", "⌘D"],
							["Record line", "R"],
							["Step frame · second", "← · ⇧←"],
							["Marker", "M"],
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
					<NumberInput value={clip.startMs} scale={1000} digits={2} step={0.1} min={0} suffix="s" onCommit={(v) => patch({ startMs: Math.round(v) })} />
				</Field>
				<Field label="Duration">
					<NumberInput value={clip.durationMs} scale={1000} digits={2} step={0.1} min={10} suffix="s" onCommit={(v) => patch({ durationMs: Math.round(v) })} />
				</Field>
			</div>
			<p className="text-[11px] text-muted tabular-nums">
				{formatTime(clip.startMs)} → {formatTime(clip.startMs + clip.durationMs)}
			</p>
		</Section>
	);
}

function MediaInspector({ clip, project }: { clip: MediaClip; project: ProjectSnapshot }) {
	const asset = project.data.assets.find((a) => a.id === clip.assetId);
	const track = project.data.tracks.find((t) => t.id === clip.trackId);
	const patch = (p: Record<string, unknown>) => void run("update_clip", { id: clip.id, patch: p });
	const visual = track?.kind === "video";
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
			{asset?.kind !== "image" && (
				<Section title="Source">
					<div className="grid grid-cols-2 gap-2">
						<Field label="In point">
							<NumberInput value={clip.inMs} scale={1000} digits={2} step={0.1} min={0} suffix="s" onCommit={(v) => patch({ inMs: Math.round(v) })} />
						</Field>
						<Field label="Speed">
							<NumberInput value={clip.speed} digits={2} step={0.05} min={0.1} max={8} suffix="×" onCommit={(speed) => patch({ speed })} />
						</Field>
					</div>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 gap-1.5 text-[12px]"
						onPress={() => asset && patch({ durationMs: Math.floor((asset.durationMs - clip.inMs) / clip.speed) })}
					>
						<ArrowsOutLineHorizontal className="size-3.5" /> Extend to the end of the source
					</Button>
				</Section>
			)}
			{audible && (
				<Section title="Audio">
					<Field label="Volume">
						<Range value={clip.volume} min={0} max={2} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(volume) => patch({ volume })} />
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field label="Fade in">
							<NumberInput value={clip.fadeInMs} scale={1000} digits={2} step={0.1} min={0} suffix="s" onCommit={(v) => patch({ fadeInMs: Math.round(v) })} />
						</Field>
						<Field label="Fade out">
							<NumberInput value={clip.fadeOutMs} scale={1000} digits={2} step={0.1} min={0} suffix="s" onCommit={(v) => patch({ fadeOutMs: Math.round(v) })} />
						</Field>
					</div>
				</Section>
			)}
			{visual && (
				<Section title="Transform">
					<Field label="Scale">
						<Range value={clip.transform.scale} min={0.1} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(scale) => patch({ transform: { scale } })} />
					</Field>
					<Field label="Opacity">
						<Range value={clip.transform.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onCommit={(opacity) => patch({ transform: { opacity } })} />
					</Field>
					<div className="grid grid-cols-2 gap-2">
						<Field label="X">
							<NumberInput value={clip.transform.x} scale={0.01} digits={0} step={1} suffix="%" onCommit={(x) => patch({ transform: { x } })} />
						</Field>
						<Field label="Y">
							<NumberInput value={clip.transform.y} scale={0.01} digits={0} step={1} suffix="%" onCommit={(y) => patch({ transform: { y } })} />
						</Field>
					</div>
					<Button size="sm" variant="ghost" className="h-7 self-start text-[12px]" onPress={() => patch({ transform: { x: 0.5, y: 0.5, scale: 1, opacity: 1 } })}>
						Reset
					</Button>
				</Section>
			)}
		</>
	);
}

function TextInspector({ clip }: { clip: TextClip }) {
	const s = clip.style;
	const patch = (p: Record<string, unknown>) => void run("update_clip", { id: clip.id, patch: p });
	const style = (p: Partial<typeof s>) => patch({ style: p });
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
						{FONTS.map((f) => (
							<option key={f} value={f} style={{ fontFamily: f }}>
								{f.replace(" Variable", "")}
							</option>
						))}
					</select>
				</Field>
				<div className="grid grid-cols-2 gap-2">
					<Field label="Size">
						<NumberInput value={s.fontSize} min={6} max={600} step={2} suffix="px" onCommit={(fontSize) => style({ fontSize: Math.round(fontSize) })} />
					</Field>
					<Field label="Weight">
						<NumberInput value={s.fontWeight} min={100} max={900} step={100} onCommit={(fontWeight) => style({ fontWeight: Math.round(fontWeight / 100) * 100 })} />
					</Field>
				</div>
				<Field label="Colour">
					<ColorInput value={s.color} onCommit={(color) => color && style({ color })} />
				</Field>
				<Field label="Box">
					<ColorInput value={s.background} allowNone onCommit={(background) => style({ background })} />
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
							<input type="checkbox" checked={s.uppercase} onChange={(e) => style({ uppercase: e.target.checked })} className="accent-[var(--accent)]" /> Caps
						</label>
					</div>
				</div>
				<Toggle label="Shadow" checked={s.shadow} onChange={(shadow) => style({ shadow })} />
			</Section>
			<Section title="Layout">
				<div className="grid grid-cols-3 gap-2">
					<Field label="X">
						<NumberInput value={s.x} scale={0.01} digits={0} step={1} suffix="%" onCommit={(x) => style({ x })} />
					</Field>
					<Field label="Y">
						<NumberInput value={s.y} scale={0.01} digits={0} step={1} suffix="%" onCommit={(y) => style({ y })} />
					</Field>
					<Field label="Width">
						<NumberInput value={s.width} scale={0.01} digits={0} step={1} suffix="%" onCommit={(width) => style({ width })} />
					</Field>
					<Field label="Padding">
						<NumberInput value={s.padding} min={0} max={200} step={2} onCommit={(padding) => style({ padding })} />
					</Field>
					<Field label="Radius">
						<NumberInput value={s.radius} min={0} max={200} step={2} onCommit={(radius) => style({ radius })} />
					</Field>
					<Field label="Spacing">
						<NumberInput value={s.letterSpacing} min={-10} max={50} step={0.5} digits={1} onCommit={(letterSpacing) => style({ letterSpacing })} />
					</Field>
				</div>
				<p className="text-[11px] text-muted">Drag the box in the preview to move it.</p>
			</Section>
			<Section title="Animation">
				<Field label="In">
					<Segmented size="xs" value={clip.animationIn} onChange={(animationIn) => patch({ animationIn })} options={[...ANIMATIONS]} />
				</Field>
				<Field label="Out">
					<Segmented size="xs" value={clip.animationOut} onChange={(animationOut) => patch({ animationOut })} options={ANIMATIONS.filter((a) => a.value !== "typewriter")} />
				</Field>
			</Section>
		</>
	);
}
