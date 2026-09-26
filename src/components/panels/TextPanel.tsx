import { TextAa, TextT } from "@phosphor-icons/react";
import { useEffect, useRef } from "react";
import { DEFAULT_TEXT_STYLE } from "../../../electron/core/project";
import { TITLE_IDS, TITLE_TEMPLATES, type TitleId } from "../../../electron/core/titles";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { editor, useProject } from "../../lib/state";
import { drawTextClip } from "../../lib/textDraw";
import { Section } from "../ui/controls";

/** A template drawn with the real text renderer, so the thumbnail is what you get. */
function TemplateThumb({ id }: { id: TitleId }) {
	const ref = useRef<HTMLCanvasElement>(null);
	useEffect(() => {
		const canvas = ref.current;
		const ctx = canvas?.getContext("2d");
		if (!canvas || !ctx) return;
		const t = TITLE_TEMPLATES[id];
		// A smaller virtual frame than 1080p, so small templates stay legible as thumbnails.
		const W = 1100;
		const H = 619;
		const scale = canvas.width / W;
		const style = {
			...DEFAULT_TEXT_STYLE,
			...t.style,
			x: 0.5,
			y: 0.5,
			width: Math.max(0.6, t.style.width ?? 0.8),
		};
		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, canvas.width, canvas.height);
		ctx.scale(scale, scale);
		const draw = () =>
			drawTextClip(
				ctx,
				{
					id,
					type: "text",
					trackId: "",
					startMs: 0,
					durationMs: 1,
					text: t.sample,
					style,
					animationIn: "none",
					animationOut: "none",
				},
				W,
				H,
			);
		void document.fonts.ready.then(draw);
	}, [id]);
	return <canvas ref={ref} width={384} height={216} className="size-full" />;
}

export function TextPanel() {
	const project = useProject();
	if (!project) return null;
	const textClips = project.data.clips
		.filter((c) => c.type === "text")
		.sort((a, b) => a.startMs - b.startMs);
	return (
		<div className="flex flex-col">
			<Section title="Titles">
				<div className="grid grid-cols-2 gap-2">
					{TITLE_IDS.map((id) => (
						<button
							key={id}
							type="button"
							title={`Add “${TITLE_TEMPLATES[id].label}” at the playhead`}
							onClick={async () => {
								const result = await run<{ created?: string[] }>("add_text", {
									text: TITLE_TEMPLATES[id].sample,
									startMs: Math.round(playback.currentMs),
									preset: id,
								});
								if (result?.created) {
									window.cue.selectClips(result.created);
									editor.set({ inspectorOpen: true });
								}
							}}
							className="group flex flex-col gap-1 text-left"
						>
							<span className="block aspect-video overflow-hidden rounded-lg border border-border bg-[linear-gradient(135deg,#334155,#0f172a)] transition-colors group-hover:border-accent">
								<TemplateThumb id={id} />
							</span>
							<span className="px-0.5 text-[11px] text-muted group-hover:text-foreground">
								{TITLE_TEMPLATES[id].label}
							</span>
						</button>
					))}
				</div>
				<p className="text-[11px] text-muted">
					Double-click a title in the viewer to type into it.
				</p>
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
									<span className="truncate text-[13px]">
										{clip.type === "text" ? clip.text : ""}
									</span>
									<span className="ml-auto text-[11px] text-muted tabular-nums">
										{(clip.startMs / 1000).toFixed(1)}s
									</span>
								</button>
							</li>
						))}
					</ul>
				)}
			</Section>
		</div>
	);
}
