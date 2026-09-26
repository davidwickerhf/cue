import { TextAa, TextT } from "@phosphor-icons/react";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { editor, useProject } from "../../lib/state";
import { Section } from "../ui/controls";

const PRESETS = [
	{ id: "title", label: "Title", sample: "Big title", className: "text-[22px] font-extrabold" },
	{ id: "lower-third", label: "Lower third", sample: "Name · Role", className: "text-[14px] font-bold" },
	{ id: "caption", label: "Caption", sample: "Subtitle text", className: "text-[13px] font-semibold" },
	{ id: "label", label: "Label", sample: "Label", className: "text-[12px] font-semibold" },
] as const;

export function TextPanel() {
	const project = useProject();
	if (!project) return null;
	const textClips = project.data.clips.filter((c) => c.type === "text").sort((a, b) => a.startMs - b.startMs);
	return (
		<div className="flex flex-col">
			<Section title="Add at the playhead">
				<div className="grid grid-cols-2 gap-2.5">
					{PRESETS.map((preset) => (
						<button
							key={preset.id}
							type="button"
							onClick={async () => {
								const result = await run<{ created?: string[] }>("add_text", { text: preset.sample, startMs: Math.round(playback.currentMs), preset: preset.id });
								if (result?.created) {
									window.cue.selectClips(result.created);
									editor.set({ inspectorOpen: true });
								}
							}}
							className="flex aspect-video flex-col items-center justify-center gap-1 rounded-xl border border-border bg-gradient-to-br from-slate-800 to-slate-900 text-white transition hover:border-accent hover:shadow-md"
						>
							<span className={preset.className}>{preset.sample}</span>
							<span className="text-[10px] text-white/60">{preset.label}</span>
						</button>
					))}
				</div>
			</Section>
			<Section title={`On the timeline · ${textClips.length}`}>
				{textClips.length === 0 ? (
					<p className="flex items-center gap-2 text-[12px] text-muted">
						<TextAa className="size-4" /> Titles, captions and labels you add appear here.
					</p>
				) : (
					<ul className="-mx-1 flex flex-col gap-0.5">
						{textClips.map((clip) => (
							<li key={clip.id}>
								<button
									type="button"
									onClick={() => {
										window.cue.selectClips([clip.id]);
										playback.seek(clip.startMs + 10);
										editor.set({ inspectorOpen: true });
									}}
									className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-default/70"
								>
									<TextT className="size-3.5 shrink-0 text-track-text" />
									<span className="truncate text-[13px]">{clip.type === "text" ? clip.text : ""}</span>
									<span className="ml-auto text-[11px] text-muted tabular-nums">{(clip.startMs / 1000).toFixed(1)}s</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</Section>
		</div>
	);
}
