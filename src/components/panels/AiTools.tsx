import { Button } from "@heroui/react";
import { Copy, MusicNotes, Sparkle } from "@phosphor-icons/react";
import { useState } from "react";
import type { ProjectSnapshot } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { isMac } from "../../lib/platform";
import { playback } from "../../lib/playback";
import { openSource, seekSource, source } from "../../lib/source";
import { useApp } from "../../lib/state";
import { cn, formatTime } from "../../lib/utils";
import { Section } from "../ui/controls";

const select =
	"h-7 min-w-0 flex-1 rounded-md border border-border bg-field px-1.5 text-[12px] outline-none focus:border-accent";

/** Music on the timeline: beat markers and cutting to the beat. */
export function BeatTools({ project }: { project: ProjectSnapshot }) {
	const used = new Set(project.data.clips.flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
	const music = project.data.assets.filter((a) => used.has(a.id) && a.hasAudio && !a.lineId);
	const videoTracks = project.data.tracks.filter((t) => t.kind === "video");
	const [assetId, setAssetId] = useState<string>("");
	const [trackId, setTrackId] = useState<string>("");
	const [info, setInfo] = useState<string | null>(null);
	// Default to sound on a music track (not the voiceover), since that is what has a beat.
	const onMusicTrack = (id: string) =>
		project.data.clips.some(
			(c) =>
				c.type === "media" &&
				c.assetId === id &&
				project.data.tracks.find((t) => t.id === c.trackId && t.kind === "audio" && !t.voiceover),
		);
	const chosen =
		music.find((a) => a.id === assetId) ??
		music.find((a) => a.kind === "audio" && onMusicTrack(a.id)) ??
		music.find((a) => a.kind === "audio") ??
		music[0];
	const track = videoTracks.find((t) => t.id === trackId) ?? videoTracks.at(-1);
	if (!chosen) return null;
	return (
		<Section title="Music">
			<div className="flex items-center gap-2">
				<MusicNotes className="size-4 shrink-0 text-muted" />
				<select
					value={chosen.id}
					onChange={(e) => setAssetId(e.target.value)}
					className={select}
					aria-label="Music"
				>
					{music.map((a) => (
						<option key={a.id} value={a.id}>
							{a.name}
						</option>
					))}
				</select>
			</div>
			<div className="flex gap-1.5">
				<Button
					size="sm"
					variant="secondary"
					className="h-7 flex-1 text-[12px]"
					onPress={async () => {
						const r = await run<{ bpm: number; markers: number; confidence: number }>(
							"detect_beats",
							{ assetId: chosen.id, addMarkers: true },
						);
						if (r)
							setInfo(
								`${r.bpm} BPM · ${r.markers} beat markers${r.confidence < 0.2 ? " · weak pulse" : ""}`,
							);
					}}
				>
					Mark the beats
				</Button>
				{track && (
					<Button
						size="sm"
						variant="secondary"
						className="h-7 flex-1 text-[12px]"
						onPress={async () => {
							const r = await run<{ cuts: number; moved: number }>("snap_cuts_to_beats", {
								trackId: track.id,
								musicAssetId: chosen.id,
							});
							if (r) notify(`Moved ${r.moved} of ${r.cuts} cuts onto the beat`, "success");
						}}
					>
						Cut to the beat
					</Button>
				)}
			</div>
			{videoTracks.length > 1 && (
				<select
					value={track?.id}
					onChange={(e) => setTrackId(e.target.value)}
					className={select}
					aria-label="Track to cut"
				>
					{videoTracks.map((t) => (
						<option key={t.id} value={t.id}>
							Cut on {t.name}
						</option>
					))}
				</select>
			)}
			{info && <p className="text-[11px] text-muted">{info}</p>}
		</Section>
	);
}

/** Chapters from the transcript, as markers and as text for a video description. */
export function ChapterTools() {
	const busy = useApp((s) => s.jobs.some((j) => j.state === "running")) ?? false;
	const [text, setText] = useState<string | null>(null);
	return (
		<Section title="Chapters">
			<p className="text-[12px] leading-relaxed text-muted">
				Splits the edit into chapters from what is said, adds markers and writes a list for YouTube.
			</p>
			<Button
				size="sm"
				variant="secondary"
				className="h-7 text-[12px]"
				isDisabled={busy}
				onPress={async () => {
					const r = await run<{ description: string }>("generate_chapters", { addMarkers: true });
					if (r) setText(r.description);
				}}
			>
				Make chapters
			</Button>
			{text && (
				<div className="flex items-start gap-2 rounded-md border border-border bg-field p-2">
					<pre className="min-w-0 flex-1 text-[11px] leading-relaxed whitespace-pre-wrap select-text">
						{text}
					</pre>
					<button
						type="button"
						aria-label="Copy chapters"
						onClick={() => {
							void navigator.clipboard.writeText(text);
							notify("Copied", "success");
						}}
						className="text-muted hover:text-foreground"
					>
						<Copy className="size-4" />
					</button>
				</div>
			)}
		</Section>
	);
}

type Broll = { atMs: number; durationMs: number; prompt: string; on: boolean };

/** Cutaway images planned from the transcript, reviewed, then generated. */
export function BrollTools() {
	const [items, setItems] = useState<Broll[] | null>(null);
	const busy = useApp((s) => s.jobs.some((j) => j.state === "running")) ?? false;
	return (
		<Section title="B-roll">
			<p className="text-[12px] leading-relaxed text-muted">
				Plans cutaway images for moments in the transcript. Check the ones you want, then generate
				them onto a B-roll track.
			</p>
			<Button
				size="sm"
				variant="secondary"
				className="h-7 gap-1.5 text-[12px]"
				isDisabled={busy}
				onPress={async () => {
					const r = await run<Omit<Broll, "on">[]>("suggest_broll", { count: 4 });
					if (r) setItems(r.map((b) => ({ ...b, on: true })));
				}}
			>
				<Sparkle className="size-3.5" /> Suggest cutaways
			</Button>
			{items && items.length > 0 && (
				<>
					<ul className="flex flex-col gap-1.5">
						{items.map((b, i) => (
							<li
								key={`${b.atMs}-${i}`}
								className={cn(
									"flex items-start gap-2 rounded-md border border-border p-2",
									!b.on && "opacity-50",
								)}
							>
								<input
									type="checkbox"
									checked={b.on}
									onChange={() =>
										setItems(items.map((x, j) => (j === i ? { ...x, on: !x.on } : x)))
									}
									className="mt-0.5 accent-[var(--accent)]"
								/>
								<button
									type="button"
									className="min-w-0 flex-1 text-left"
									onClick={() => playback.seek(b.atMs)}
								>
									<span className="block text-[11px] text-muted tabular">
										{formatTime(b.atMs)} · {(b.durationMs / 1000).toFixed(1)} s
									</span>
									<span className="block text-[12px] leading-snug">{b.prompt}</span>
								</button>
							</li>
						))}
					</ul>
					<Button
						size="sm"
						className="h-7 text-[12px]"
						isDisabled={busy || !items.some((b) => b.on)}
						onPress={async () => {
							const chosen = items.filter((b) => b.on).map(({ on: _, ...b }) => b);
							const r = await run("add_broll", { items: chosen });
							if (r) {
								notify(
									`Added ${chosen.length} cutaway${chosen.length === 1 ? "" : "s"}`,
									"success",
								);
								setItems(null);
							}
						}}
					>
						Generate {items.filter((b) => b.on).length}
					</Button>
				</>
			)}
		</Section>
	);
}

const FRAMES = [
	{ label: "16:9", w: 1920, h: 1080 },
	{ label: "9:16", w: 1080, h: 1920 },
	{ label: "1:1", w: 1080, h: 1080 },
	{ label: "4:5", w: 1080, h: 1350 },
];

/** Change the frame for another platform, filling the new frame. */
export function ReframeTools({ project }: { project: ProjectSnapshot }) {
	const { width, height } = project.data.canvas;
	return (
		<Section title="Reframe">
			<p className="text-[12px] leading-relaxed text-muted">
				Makes a version for another shape. Full-frame shots are cropped to fill it; nudge X in the
				inspector to follow the subject.
			</p>
			<div className="grid grid-cols-4 gap-1.5">
				{FRAMES.map((f) => (
					<Button
						key={f.label}
						size="sm"
						variant={f.w === width && f.h === height ? "primary" : "secondary"}
						className="h-7 text-[12px]"
						onPress={() => void run("reframe", { width: f.w, height: f.h })}
					>
						{f.label}
					</Button>
				))}
			</div>
		</Section>
	);
}

type Shot = {
	assetId: string;
	name: string;
	startMs: number;
	endMs: number;
	score: number;
	shows: string[];
	text: string[];
};

/** Search the footage by what it shows, text on screen or what is said (on this Mac). */
export function ShotSearch({ project }: { project: ProjectSnapshot }) {
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [shots, setShots] = useState<Shot[] | null>(null);
	const search = async () => {
		if (!query.trim()) return;
		setBusy(true);
		const found = await run<Shot[]>("search_shots", { query: query.trim() });
		setBusy(false);
		setShots(found ?? []);
	};
	const place = (s: Shot) => {
		const video = project.data.tracks.find((t) => t.kind === "video" && !t.locked);
		if (!video) return;
		void run("add_clips", {
			clips: [
				{
					type: "media",
					trackId: video.id,
					assetId: s.assetId,
					startMs: Math.round(playback.currentMs),
					inMs: s.startMs,
					...(s.endMs > s.startMs ? { durationMs: s.endMs - s.startMs } : {}),
				},
			],
		});
	};
	return (
		<Section title="Find shots">
			<form
				className="flex gap-1.5"
				onSubmit={(e) => {
					e.preventDefault();
					void search();
				}}
			>
				<input
					value={query}
					onChange={(e) => setQuery(e.target.value)}
					onKeyDown={(e) => e.stopPropagation()}
					placeholder="a dog on a beach, a whiteboard…"
					className="h-7 min-w-0 flex-1 rounded-md border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
				/>
				<Button
					size="sm"
					className="h-7 text-[12px]"
					isDisabled={busy}
					onPress={() => void search()}
				>
					{busy ? "Looking…" : "Find"}
				</Button>
			</form>
			<p className="text-[11px] text-muted">
				{isMac
					? "Looks at what is in the picture, text on screen and what is said, on this Mac. The first search reads each video once."
					: "Searches what is said in transcribed footage. Looking at the picture itself needs Cue for macOS."}
			</p>
			{shots && shots.length === 0 && <p className="text-[12px] text-muted">Nothing found.</p>}
			{shots && shots.length > 0 && (
				<ul className="-mx-1 flex flex-col gap-0.5">
					{shots.map((s) => (
						<li
							key={`${s.assetId}-${s.startMs}`}
							className="group flex items-center gap-2 rounded-md px-1 py-1 hover:bg-default/60"
						>
							<button
								type="button"
								className="min-w-0 flex-1 text-left"
								title="Show in the source monitor"
								onClick={() => {
									openSource(s.assetId);
									// Picked up when the source loads, or used straight away if it already has.
									source.set({ currentMs: s.startMs });
									seekSource(s.startMs);
								}}
							>
								<span className="block truncate text-[12px]">{s.name}</span>
								<span className="block truncate text-[11px] text-muted">
									{formatTime(s.startMs)}
									{s.endMs > s.startMs ? `–${formatTime(s.endMs)}` : ""} ·{" "}
									{[...s.shows, ...s.text].slice(0, 4).join(", ")}
								</span>
							</button>
							<button
								type="button"
								onClick={() => place(s)}
								className="hidden h-6 shrink-0 rounded px-2 text-[11px] text-accent group-hover:block hover:bg-accent/10"
							>
								Add at playhead
							</button>
						</li>
					))}
				</ul>
			)}
		</Section>
	);
}
