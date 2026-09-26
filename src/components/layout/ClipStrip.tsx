import { ArrowLeft, ClipboardText, Copy } from "@phosphor-icons/react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Asset, MediaClip, ProjectSnapshot } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { cssFilter, playback } from "../../lib/playback";
import { app, createStore, useApp } from "../../lib/state";
import { cn } from "../../lib/utils";
import { loadThumbs } from "../timeline/ClipVisuals";

/** The clip whose grade "Copy grade" took, until the next copy. */
const copied = createStore<{ clipId: string | null }>({ clipId: null });

/** A clip counts as graded when its colour, LUT or picture effects differ from neutral. */
export function isGraded(clip: MediaClip): boolean {
	const c = clip.color;
	const color =
		!!c &&
		(c.brightness !== 0 ||
			c.contrast !== 1 ||
			c.saturation !== 1 ||
			c.temperature !== 0 ||
			!!c.lut);
	const e = clip.effects;
	const effects = !!e && (e.blur > 0 || e.sharpen > 0 || e.vignette > 0 || e.glow > 0);
	return color || effects;
}

/** Picture clips of the open timeline in the order they play (upper tracks first at a tie). */
function shots(project: ProjectSnapshot): MediaClip[] {
	const order = new Map(project.data.tracks.map((t, i) => [t.id, i]));
	const assets = new Map(project.data.assets.map((a) => [a.id, a]));
	const video = new Set(project.data.tracks.filter((t) => t.kind === "video").map((t) => t.id));
	return project.data.clips
		.filter(
			(c): c is MediaClip =>
				c.type === "media" &&
				video.has(c.trackId) &&
				["video", "image"].includes(assets.get(c.assetId)?.kind ?? ""),
		)
		.sort(
			(a, b) => a.startMs - b.startMs || (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0),
		);
}

/**
 * The Colour workspace's clip strip: every shot of the timeline as a
 * thumbnail, to grade one after the other as in Resolve's Color page.
 */
export function ClipStrip({ project }: { project: ProjectSnapshot }) {
	const list = useMemo(() => shots(project), [project]);
	const selected = useApp((s) => s.selectedClipIds) ?? [];
	const copiedId = copied.use((s) => s.clipId);
	// The shot under the playhead (the top one where several play at once).
	const currentId = playback.clock.use((s) => {
		const at = list.filter(
			(c) => s.currentMs >= c.startMs && s.currentMs < c.startMs + c.durationMs,
		);
		const order = new Map(project.data.tracks.map((t, i) => [t.id, i]));
		return at.sort((a, b) => (order.get(a.trackId) ?? 0) - (order.get(b.trackId) ?? 0))[0]?.id;
	});
	const scroller = useRef<HTMLDivElement>(null);

	useEffect(() => {
		// Keep the current shot in view while playing or stepping through.
		const el = scroller.current?.querySelector<HTMLElement>(`[data-shot="${currentId}"]`);
		el?.scrollIntoView({ block: "nearest", inline: "nearest" });
	}, [currentId]);

	if (!list.length) return null;
	const picked = list.filter((c) => selected.includes(c.id));
	// The shot the buttons work on: the selected one, else the one under the playhead.
	const target = picked[0] ?? list.find((c) => c.id === currentId);
	const index = target ? list.indexOf(target) : -1;
	const previous = index > 0 ? list[index - 1] : undefined;
	const source = list.find((c) => c.id === copiedId);
	const pasteTo = picked.filter((c) => c.id !== copiedId);
	const name = (c: MediaClip) =>
		c.name ?? project.data.assets.find((a) => a.id === c.assetId)?.name ?? c.id;

	const btn =
		"flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] text-foreground/85 hover:bg-default hover:text-foreground disabled:pointer-events-none disabled:opacity-40";
	return (
		<div className="shrink-0 border-t border-separator bg-surface">
			<div className="flex h-8 items-center gap-1 px-2">
				<span className="mr-1 px-1 text-[11px] font-semibold text-muted">
					Shots · {list.length}
				</span>
				<button
					type="button"
					className={btn}
					disabled={!target}
					title="Copy the grade of the selected shot (or the one under the playhead)"
					onClick={() => {
						if (!target) return;
						copied.set({ clipId: target.id });
						notify(`Copied the grade of ${name(target)}.`);
					}}
				>
					<Copy className="size-3.5" />
					Copy grade
				</button>
				<button
					type="button"
					className={btn}
					disabled={!source || !pasteTo.length}
					title={
						source
							? `Paste the grade of ${name(source)} (colour and effects) to the selected shots`
							: "Copy a grade first"
					}
					onClick={() =>
						source &&
						void run("copy_grade", {
							fromClipId: source.id,
							toClipIds: pasteTo.map((c) => c.id),
						})
					}
				>
					<ClipboardText className="size-3.5" />
					Paste grade to selected
				</button>
				<button
					type="button"
					className={btn}
					disabled={!target || !previous}
					title="Give this shot the grade of the shot before it"
					onClick={() =>
						target &&
						previous &&
						void run("copy_grade", { fromClipId: previous.id, toClipIds: [target.id] })
					}
				>
					<ArrowLeft className="size-3.5" />
					Match previous
				</button>
				{source && (
					<span className="ml-auto truncate pr-1 text-[11px] text-muted">
						Copied: {name(source)}
					</span>
				)}
			</div>
			<div
				ref={scroller}
				className="custom-scrollbar flex gap-1.5 overflow-x-auto px-2 pb-2"
				role="listbox"
				aria-label="Shots"
			>
				{list.map((c, i) => (
					<Shot
						key={c.id}
						clip={c}
						number={i + 1}
						name={name(c)}
						asset={project.data.assets.find((a) => a.id === c.assetId)}
						url={project.assetUrls[c.assetId]}
						current={c.id === currentId}
						selected={selected.includes(c.id)}
						copied={c.id === copiedId}
					/>
				))}
			</div>
		</div>
	);
}

function Shot({
	clip,
	number,
	name,
	asset,
	url,
	current,
	selected,
	copied,
}: {
	clip: MediaClip;
	number: number;
	name: string;
	asset: Asset | undefined;
	url: string | undefined;
	current: boolean;
	selected: boolean;
	copied: boolean;
}) {
	const [thumb, setThumb] = useState<string | null>(asset?.kind === "image" ? (url ?? null) : null);
	// The frame from the middle of the part the clip plays.
	const middleMs = clip.inMs + (clip.durationMs * clip.speed) / 2;
	useEffect(() => {
		if (asset?.kind !== "video") return;
		let alive = true;
		void loadThumbs(asset.id, asset.path).then((t) => {
			if (!alive || !t.urls.length) return;
			const i = Math.min(t.urls.length - 1, Math.max(0, Math.floor(middleMs / t.intervalMs)));
			setThumb(t.urls[i]);
		});
		return () => {
			alive = false;
		};
	}, [asset, middleMs]);
	const graded = isGraded(clip);
	return (
		<button
			type="button"
			role="option"
			aria-selected={selected}
			data-shot={clip.id}
			title={`${number}. ${name}${graded ? " · graded" : ""}${clip.disabled ? " (disabled)" : ""}`}
			onClick={(e) => {
				const ids =
					e.shiftKey || e.metaKey
						? [...new Set([...(app.get().state?.selectedClipIds ?? []), clip.id])]
						: [clip.id];
				window.cue.selectClips(ids);
				// Into the middle of the shot, the frame its thumbnail shows.
				playback.seek(clip.startMs + Math.floor(clip.durationMs / 2));
			}}
			className={cn(
				"group relative w-[104px] shrink-0 overflow-hidden rounded-md bg-black text-left ring-2 transition-shadow",
				current
					? "ring-accent"
					: selected
						? "ring-white/60"
						: "ring-transparent hover:ring-white/25",
				clip.disabled && "opacity-50",
			)}
		>
			<div className="aspect-video w-full">
				{thumb && (
					<img
						src={thumb}
						alt=""
						draggable={false}
						className="size-full object-cover"
						// Thumbnails show the shot's colour grade, so shots can be compared at a glance.
						style={{ filter: cssFilter(clip.color) }}
					/>
				)}
			</div>
			<div className="flex items-center gap-1 bg-black/70 px-1.5 py-0.5 text-[10px] text-white/80">
				<span className="font-mono text-white/55 tabular">{number}</span>
				<span className="min-w-0 flex-1 truncate">{name}</span>
				{copied && <ClipboardText className="size-3 shrink-0 text-white/70" />}
			</div>
			{graded && (
				<span
					className="absolute top-1 right-1 size-2 rounded-full bg-accent ring-1 ring-black/60"
					title="Graded"
				/>
			)}
		</button>
	);
}
