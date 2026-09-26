import {
	ArrowUpRight,
	ChatText,
	Circle,
	Drop,
	Prohibit,
	Square,
	TextAa,
	TextT,
} from "@phosphor-icons/react";
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

/** One-click graphics, placed in the middle of the frame at the playhead. */
const OVERLAYS = [
	{
		kind: "box",
		label: "Box",
		hint: "An outline around something",
		icon: <Square className="size-4" />,
		place: {},
	},
	{
		kind: "circle",
		label: "Circle",
		hint: "Circle something",
		icon: <Circle className="size-4" />,
		place: {},
	},
	{
		kind: "arrow",
		label: "Arrow",
		hint: "Point at something",
		icon: <ArrowUpRight className="size-4" />,
		place: { width: 0.2, height: -0.2 },
	},
	{
		kind: "callout",
		label: "Callout",
		hint: "A box with text",
		icon: <ChatText className="size-4" />,
		place: { width: 0.34, height: 0.16, y: 0.3 },
	},
	{
		kind: "blur",
		label: "Blur",
		hint: "Blur an area (faces, screens, plates)",
		icon: <Drop className="size-4" />,
		place: { width: 0.25, height: 0.25 },
	},
	{
		kind: "redact",
		label: "Redact",
		hint: "Cover an area with a solid box",
		icon: <Prohibit className="size-4" />,
		place: { width: 0.25, height: 0.12 },
	},
] as const;

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
									// Step past the intro animation so the new title is visible straight away.
									playback.seek(playback.currentMs + 450);
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
			<Section title="Shapes and overlays">
				<div className="grid grid-cols-3 gap-1.5">
					{OVERLAYS.map((o) => (
						<button
							key={o.kind}
							type="button"
							title={o.hint}
							onClick={async () => {
								const result = await run<{ clipId?: string }>("add_overlay", {
									kind: o.kind,
									startMs: Math.round(playback.currentMs),
									...o.place,
								});
								if (result?.clipId) {
									window.cue.selectClips([result.clipId]);
									editor.set({ inspectorOpen: true });
									playback.seek(playback.currentMs + 450);
								}
							}}
							className="flex h-14 flex-col items-center justify-center gap-1 rounded-lg border border-border text-[11px] text-muted hover:border-accent hover:text-foreground"
						>
							{o.icon}
							{o.label}
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
