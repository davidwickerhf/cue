import { useEffect, useMemo, useRef, useState } from "react";
import type { LottieJson } from "../../../electron/core/motion";
import { compileMotion } from "../../../electron/core/motionSpec";
import {
	buildTemplate,
	MOTION_TEMPLATES,
	MOTION_THEMES,
	type MotionTemplate,
} from "../../../electron/core/motionTemplates";
import { notify, run } from "../../lib/api";
import { drawMotion, provideMotion } from "../../lib/motion";
import { playback } from "../../lib/playback";
import { useProject } from "../../lib/state";
import { cn } from "../../lib/utils";

const CATEGORIES = ["All", "Titles", "Charts", "Callouts", "Lists", "Transitions"] as const;
const GROUP: Record<MotionTemplate["category"], (typeof CATEGORIES)[number]> = {
	"lower third": "Titles",
	title: "Titles",
	quote: "Titles",
	chart: "Charts",
	stat: "Charts",
	callout: "Callouts",
	list: "Lists",
	transition: "Transitions",
};

/**
 * Cue's motion graphics: live previews of every template in the chosen theme.
 * Clicking one adds it at the playhead (transitions centre on it); its text,
 * data and colours are then edited in the inspector.
 */
export function MotionGallery() {
	const project = useProject();
	const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
	const [theme, setTheme] = useState("midnight");
	const [busy, setBusy] = useState<string | null>(null);
	const canvas = project?.data.canvas ?? { width: 1920, height: 1080, fps: 30 };
	const visible = MOTION_TEMPLATES.filter(
		(t) => category === "All" || GROUP[t.category] === category,
	);
	const add = async (t: MotionTemplate) => {
		setBusy(t.id);
		const at = Math.round(playback.currentMs);
		const result = await run("create_motion_graphic", {
			template: t.id,
			params: { ...t.example, theme },
			...(t.category === "transition" ? { atCutMs: Math.max(at, 600) } : { startMs: at }),
		});
		setBusy(null);
		if (result) notify(`${t.name} added — edit it in the inspector`, "success");
	};
	return (
		<div className="flex flex-col gap-3">
			<div>
				<p className="text-[13px] font-semibold">Motion graphics</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted">
					Titles, charts from your numbers, callouts and transitions. Hover to play; click to add at
					the playhead. Agents can make new ones with create_motion_graphic.
				</p>
			</div>
			<fieldset className="flex gap-1 overflow-x-auto border-0 pb-1">
				<legend className="sr-only">Categories</legend>
				{CATEGORIES.map((name) => (
					<button
						key={name}
						type="button"
						onClick={() => setCategory(name)}
						aria-pressed={category === name}
						className={cn(
							"shrink-0 rounded-full px-2.5 py-1 text-[11px]",
							category === name
								? "bg-accent font-semibold text-white"
								: "bg-default text-muted hover:text-foreground",
						)}
					>
						{name}
					</button>
				))}
			</fieldset>
			<fieldset className="flex flex-wrap items-center gap-1.5 border-0">
				<legend className="sr-only">Theme</legend>
				{MOTION_THEMES.map((t) => (
					<button
						key={t.id}
						type="button"
						title={t.label}
						aria-label={`${t.label} theme`}
						aria-pressed={theme === t.id}
						onClick={() => setTheme(t.id)}
						className={cn(
							"flex h-6 overflow-hidden rounded-md ring-1",
							theme === t.id ? "ring-2 ring-accent" : "ring-border",
						)}
					>
						<span className="w-3" style={{ background: t.bg }} />
						<span className="w-2" style={{ background: t.accent }} />
						<span className="w-2" style={{ background: t.accent2 }} />
					</button>
				))}
			</fieldset>
			<div className="grid grid-cols-2 gap-2">
				{visible.map((t) => (
					<button
						key={t.id}
						type="button"
						disabled={busy !== null}
						onClick={() => void add(t)}
						title={t.description}
						className="group min-w-0 overflow-hidden rounded-lg border border-border bg-default text-left hover:border-accent/60 disabled:opacity-60"
					>
						<TemplatePreview template={t} theme={theme} canvas={canvas} />
						<span className="block truncate px-2 pt-1.5 text-[11px] font-semibold">
							{busy === t.id ? "Adding…" : t.name}
						</span>
						<span className="block px-2 pb-2 text-[10px] text-muted capitalize">{t.category}</span>
					</button>
				))}
			</div>
		</div>
	);
}

/** A template drawn live: a still of its settled moment, playing while hovered. */
function TemplatePreview({
	template,
	theme,
	canvas,
}: {
	template: MotionTemplate;
	theme: string;
	canvas: { width: number; height: number; fps: number };
}) {
	const ref = useRef<HTMLCanvasElement>(null);
	const [hover, setHover] = useState(false);
	// Previews are drawn small, at a 16:9 reference size, so they compile quickly.
	const doc = useMemo(() => {
		const size = { width: 640, height: Math.round((640 * canvas.height) / canvas.width), fps: 30 };
		try {
			return compileMotion(
				buildTemplate(template.id, { ...template.example, theme }, size),
			) as LottieJson;
		} catch {
			return null;
		}
	}, [template, theme, canvas.width, canvas.height]);
	const key = `preview:${template.id}:${theme}:${canvas.width}x${canvas.height}`;
	useEffect(() => {
		const el = ref.current;
		if (!el || !doc) return;
		provideMotion(key, doc);
		const ctx = el.getContext("2d");
		if (!ctx) return;
		const dpr = window.devicePixelRatio || 1;
		el.width = Math.round(el.clientWidth * dpr);
		el.height = Math.round(el.clientHeight * dpr);
		const frames = doc.op - doc.ip;
		const settled = doc.ip + frames * (template.category === "transition" ? 0.35 : 0.6);
		let raf = 0;
		let start = performance.now();
		let drawn = false;
		const tick = () => {
			const frame = hover
				? doc.ip + ((((performance.now() - start) / 1000) * doc.fr) % frames)
				: settled;
			// Until the player is ready drawMotion returns false; keep trying.
			const ok = drawMotion(ctx, key, undefined, frame);
			if (hover || !ok || !drawn) {
				drawn = ok;
				raf = requestAnimationFrame(tick);
			}
		};
		start = performance.now();
		tick();
		return () => cancelAnimationFrame(raf);
	}, [doc, key, hover, template.category]);
	return (
		<span
			className="relative block overflow-hidden bg-[#0d0f14]"
			style={{ aspectRatio: `${canvas.width} / ${canvas.height}` }}
			onPointerEnter={() => setHover(true)}
			onPointerLeave={() => setHover(false)}
		>
			{template.overlay && (
				<span
					aria-hidden
					className="absolute inset-0 bg-[linear-gradient(135deg,#3a4250,#1d222b)]"
				/>
			)}
			<canvas ref={ref} className="absolute inset-0 size-full" />
		</span>
	);
}
