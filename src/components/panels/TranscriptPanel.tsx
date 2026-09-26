import { Button } from "@heroui/react";
import { Scissors, Subtitles } from "@phosphor-icons/react";
import { useEffect, useMemo, useState } from "react";
import type { Asset, MediaClip, ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Section } from "../ui/controls";

const FILLERS = new Set(["um", "uh", "uhm", "erm", "er", "ah", "hmm", "mm"]);

/** Where a source time of this asset sits on the timeline, if it is used at all. */
function toTimeline(clips: MediaClip[], sourceMs: number): number | null {
	for (const c of clips) {
		if (sourceMs >= c.inMs && sourceMs < c.inMs + c.durationMs * c.speed)
			return c.startMs + (sourceMs - c.inMs) / c.speed;
	}
	return null;
}

/**
 * Text-based editing, as in Descript or Premiere's transcript panel: click a
 * word to jump to it, drag or shift-click to select, press Delete to cut
 * those words from every track.
 */
export function TranscriptPanel() {
	const project = useProject();
	const candidates = useMemo(() => (project ? usedSpeechAssets(project) : []), [project]);
	const [assetId, setAssetId] = useState<string | null>(null);
	const asset = candidates.find((a) => a.id === assetId) ?? candidates[0];
	if (!project) return null;
	if (!asset)
		return (
			<p className="flex items-start gap-2 p-4 text-[12px] text-muted">
				<Subtitles className="mt-0.5 size-4 shrink-0" /> Add a video or audio clip with speech to
				the timeline to edit it by its words.
			</p>
		);
	return (
		<div className="flex min-h-full flex-col">
			{candidates.length > 1 && (
				<div className="border-b border-separator px-4 py-2.5">
					<select
						value={asset.id}
						onChange={(e) => setAssetId(e.target.value)}
						className="h-7 w-full rounded-md border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
					>
						{candidates.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				</div>
			)}
			{asset.transcript?.words.length ? (
				<Words key={asset.id} asset={asset} project={project} />
			) : (
				<Untranscribed asset={asset} />
			)}
		</div>
	);
}

function usedSpeechAssets(project: ProjectSnapshot): Asset[] {
	const used = new Set(project.data.clips.flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
	return project.data.assets.filter(
		(a) => used.has(a.id) && (a.kind === "audio" || (a.kind === "video" && a.hasAudio)),
	);
}

function Untranscribed({ asset }: { asset: Asset }) {
	const [busy, setBusy] = useState(false);
	return (
		<Section title="Transcript">
			<p className="text-[12px] text-muted">
				Transcribe {asset.name} to cut it by editing its text and remove filler words in one go.
			</p>
			<Button
				size="sm"
				variant="primary"
				isDisabled={busy}
				onPress={async () => {
					setBusy(true);
					await run("transcribe_media", { assetId: asset.id });
					setBusy(false);
				}}
			>
				{busy ? "Transcribing…" : "Transcribe"}
			</Button>
		</Section>
	);
}

function Words({ asset, project }: { asset: Asset; project: ProjectSnapshot }) {
	const words = asset.transcript?.words ?? [];
	const clips = useMemo(
		() =>
			project.data.clips
				.filter((c): c is MediaClip => c.type === "media" && c.assetId === asset.id)
				.sort((a, b) => a.startMs - b.startMs),
		[project, asset.id],
	);
	const positions = useMemo(
		() => words.map((w) => toTimeline(clips, (w.startMs + w.endMs) / 2)),
		[words, clips],
	);
	const [anchor, setAnchor] = useState<number | null>(null);
	const [focus, setFocus] = useState<number | null>(null);
	const [dragging, setDragging] = useState(false);
	const range =
		anchor === null
			? null
			: { from: Math.min(anchor, focus ?? anchor), to: Math.max(anchor, focus ?? anchor) };
	const fillerCount = useMemo(
		() =>
			words.filter(
				(w, i) =>
					positions[i] !== null && FILLERS.has(w.text.toLowerCase().replace(/[^a-z']/g, "")),
			).length,
		[words, positions],
	);

	// Highlight the word under the playhead (re-renders only when it changes).
	const current = playback.clock.use((s) => {
		for (let i = 0; i < words.length; i++) {
			const at = positions[i];
			if (at === null) continue;
			const w = words[i];
			const start = at - (w.endMs - w.startMs) / 2;
			if (s.currentMs >= start && s.currentMs < start + (w.endMs - w.startMs)) return i;
		}
		return -1;
	});

	useEffect(() => {
		const up = () => setDragging(false);
		window.addEventListener("pointerup", up);
		return () => window.removeEventListener("pointerup", up);
	}, []);

	const cut = async () => {
		if (!range) return;
		await run("cut_words", { assetId: asset.id, ranges: [range] });
		setAnchor(null);
		setFocus(null);
	};

	return (
		<>
			<div className="flex items-center gap-1.5 border-b border-separator px-4 py-2">
				<Button
					size="sm"
					variant="secondary"
					className="h-7 text-[12px]"
					isDisabled={!range}
					onPress={cut}
				>
					<Scissors className="size-3.5" /> Cut selection
				</Button>
				<Button
					size="sm"
					variant="ghost"
					className="h-7 text-[12px]"
					isDisabled={fillerCount === 0}
					onPress={() => void run("remove_filler_words", { assetId: asset.id })}
				>
					Remove fillers{fillerCount ? ` · ${fillerCount}` : ""}
				</Button>
			</div>
			{/* biome-ignore lint/a11y/noNoninteractiveTabindex: the transcript takes Delete like the timeline does */}
			<div
				tabIndex={0}
				onKeyDown={(e) => {
					if ((e.key === "Backspace" || e.key === "Delete") && range) {
						e.preventDefault();
						e.stopPropagation();
						void cut();
					} else if (e.key === "Escape") {
						e.stopPropagation();
						setAnchor(null);
						setFocus(null);
					}
				}}
				className="flex-1 select-none px-4 py-3 text-[13px] leading-[1.9] outline-none"
			>
				{words.map((w, i) => {
					const at = positions[i];
					const removed = at === null;
					const selected = range && i >= range.from && i <= range.to;
					const filler = FILLERS.has(w.text.toLowerCase().replace(/[^a-z']/g, ""));
					return (
						<span key={`${i}-${w.startMs}`}>
							<span
								onPointerDown={(e) => {
									if (e.shiftKey && anchor !== null) setFocus(i);
									else {
										setAnchor(i);
										setFocus(i);
										setDragging(true);
									}
									if (at !== null) playback.seek(at - (w.endMs - w.startMs) / 2);
								}}
								onPointerEnter={() => dragging && setFocus(i)}
								className={cn(
									"cursor-text rounded-[3px] px-[1px]",
									removed && "text-muted/50 line-through",
									filler && !removed && "text-warning",
									i === current && !selected && "bg-accent/25 text-foreground",
									selected && "bg-accent text-accent-foreground",
								)}
							>
								{w.text}
							</span>{" "}
						</span>
					);
				})}
			</div>
			<p className="border-t border-separator px-4 py-2 text-[11px] text-muted">
				Click a word to jump to it. Drag or shift-click to select, then press Delete to cut it from
				every track.
			</p>
		</>
	);
}
