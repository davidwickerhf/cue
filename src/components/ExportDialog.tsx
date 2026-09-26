import { Button } from "@heroui/react";
import { X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify, run } from "../lib/api";
import { createStore, editor, useProject } from "../lib/state";
import { cn, formatTime } from "../lib/utils";

export const exportDialog = createStore({ open: false });

type Patch = {
	codec: "h264" | "hevc" | "prores";
	videoQuality: "draft" | "standard" | "high";
	scale: number;
	hardware: boolean;
};

const PRESETS: {
	id: string;
	label: string;
	sub: string;
	ext: string;
	patch: Patch;
	/** What is exported (video unless set). */
	kind?: "video" | "gif" | "audio";
}[] = [
	{
		id: "web",
		label: "Web & YouTube",
		sub: "H.264 · high quality · full size",
		ext: "mp4",
		patch: { codec: "h264", videoQuality: "high", scale: 1, hardware: true },
	},
	{
		id: "small",
		label: "Smaller file",
		sub: "HEVC · standard · full size",
		ext: "mp4",
		patch: { codec: "hevc", videoQuality: "standard", scale: 1, hardware: true },
	},
	{
		id: "review",
		label: "Quick review",
		sub: "H.264 · draft · half size",
		ext: "mp4",
		patch: { codec: "h264", videoQuality: "draft", scale: 0.5, hardware: true },
	},
	{
		id: "master",
		label: "Master",
		sub: "ProRes · for further editing",
		ext: "mov",
		patch: { codec: "prores", videoQuality: "high", scale: 1, hardware: false },
	},
	{
		id: "gif",
		label: "Animated GIF",
		sub: "15 fps · up to 720 px · short clips",
		ext: "gif",
		kind: "gif",
		patch: { codec: "h264", videoQuality: "high", scale: 1, hardware: false },
	},
	{
		id: "audio",
		label: "Sound only",
		sub: "AAC (.m4a) · the full mix",
		ext: "m4a",
		kind: "audio",
		patch: { codec: "h264", videoQuality: "high", scale: 1, hardware: true },
	},
];

/** Export window: a preset, the whole timeline or just in to out, and where to save. */
export function ExportDialog() {
	const open = exportDialog.use((s) => s.open);
	const project = useProject();
	const inPoint = editor.use((s) => s.inPoint);
	const outPoint = editor.use((s) => s.outPoint);
	const hasRange = inPoint !== null && outPoint !== null && outPoint > inPoint;
	const [preset, setPreset] = useState("web");
	const [range, setRange] = useState<"all" | "inout">("all");
	const [busy, setBusy] = useState(false);
	const [mode, setMode] = useState<"one" | "variants">("one");
	const [aspects, setAspects] = useState<string[]>(["9:16"]);
	const [lengths, setLengths] = useState<number[]>([]);
	const [saveProjects, setSaveProjects] = useState(false);
	useEffect(() => {
		if (!open) return;
		setRange(hasRange ? "inout" : "all");
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				exportDialog.set({ open: false });
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open, hasRange]);
	if (!open || !project) return null;
	const chosen = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
	const close = () => exportDialog.set({ open: false });
	const w = Math.round((project.data.canvas.width * chosen.patch.scale) / 2) * 2;
	const h = Math.round((project.data.canvas.height * chosen.patch.scale) / 2) * 2;
	const length =
		range === "inout" && hasRange ? (outPoint as number) - (inPoint as number) : project.durationMs;

	const start = async () => {
		const kind = chosen.kind ?? "video";
		const out = await window.cue.chooseSave({
			title: kind === "audio" ? "Export sound" : kind === "gif" ? "Export GIF" : "Export video",
			defaultPath: `${project.dir}/export/${project.data.name}${range === "inout" ? " (range)" : ""}.${chosen.ext}`,
			// Sound can also be saved as MP3, WAV or FLAC by changing the extension.
			extensions: kind === "audio" ? [chosen.ext, "mp3", "wav", "flac"] : [chosen.ext],
		});
		if (!out) return;
		setBusy(true);
		if (kind === "video") await run("update_export", { export: chosen.patch });
		close();
		setBusy(false);
		notify("Exporting…");
		const report = await run<{ outputs: string[] }>("export", {
			kind,
			out,
			range: range === "inout" && hasRange ? { startMs: inPoint, endMs: outPoint } : undefined,
		});
		if (report?.outputs[0]) {
			notify("Export finished", "success");
			void window.cue.reveal(report.outputs[0]);
		}
	};

	const variantCount = Math.max(1, aspects.length) * Math.max(1, lengths.length);
	const makeVariants = async () => {
		setBusy(true);
		close();
		setBusy(false);
		notify(`Making ${variantCount} variant${variantCount === 1 ? "" : "s"}…`);
		const report = await run<{ variants: { video?: string }[] }>("make_variants", {
			aspects,
			lengthsSec: lengths,
			saveProjects,
		});
		const first = report?.variants.find((v) => v.video)?.video;
		if (first) {
			notify("Variants finished", "success");
			void window.cue.reveal(first);
		}
	};
	const toggle = <T,>(list: T[], value: T) =>
		list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
	const chip = (on: boolean) =>
		cn(
			"h-8 rounded-lg border px-3 text-[12px]",
			on ? "border-accent bg-accent/10" : "border-border text-muted hover:border-foreground/30",
		);

	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<div
				role="dialog"
				aria-label="Export"
				onPointerDown={(e) => e.stopPropagation()}
				className="m-auto flex w-[min(520px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-12 items-center justify-between border-b border-separator px-5">
					<h2 className="text-[14px] font-semibold">Export</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="flex gap-1 border-b border-separator px-5 py-2">
					{(
						[
							["one", "One video"],
							["variants", "Variants"],
						] as const
					).map(([m, label]) => (
						<button
							key={m}
							type="button"
							onClick={() => setMode(m)}
							className={cn(
								"h-7 rounded-md px-2.5 text-[12px]",
								mode === m ? "bg-default text-foreground" : "text-muted hover:text-foreground",
							)}
						>
							{label}
						</button>
					))}
				</div>
				{mode === "variants" ? (
					<div className="flex flex-col gap-4 p-5">
						<p className="text-[12px] text-muted">
							Other versions of this edit, each exported as its own video. The timeline stays as it
							is.
						</p>
						<div className="flex flex-col gap-2">
							<p className="text-[12px] font-medium">Frame shapes</p>
							<div className="flex flex-wrap gap-2">
								{(["9:16", "1:1", "4:5", "16:9"] as const).map((a) => (
									<button
										key={a}
										type="button"
										className={chip(aspects.includes(a))}
										onClick={() => setAspects(toggle(aspects, a))}
									>
										{a === "9:16"
											? "Vertical 9:16"
											: a === "1:1"
												? "Square 1:1"
												: a === "4:5"
													? "Portrait 4:5"
													: "Wide 16:9"}
									</button>
								))}
							</div>
						</div>
						<div className="flex flex-col gap-2">
							<p className="text-[12px] font-medium">Shorter cuts</p>
							<div className="flex flex-wrap gap-2">
								{[15, 30, 60].map((sec) => (
									<button
										key={sec}
										type="button"
										disabled={sec * 1000 >= project.durationMs}
										className={cn(chip(lengths.includes(sec)), "disabled:opacity-40")}
										onClick={() => setLengths(toggle(lengths, sec))}
									>
										{sec} s
									</button>
								))}
							</div>
							<p className="text-[11px] text-muted">
								A shorter cut ends at the last cut before its length. Ask the agent for one built
								from the best moments.
							</p>
						</div>
						<label className="flex items-center gap-2 text-[12px]">
							<input
								type="checkbox"
								checked={saveProjects}
								onChange={(e) => setSaveProjects(e.target.checked)}
							/>
							Also save each as a project, to fine-tune later
						</label>
					</div>
				) : (
					<div className="flex flex-col gap-4 p-5">
						<div className="grid grid-cols-2 gap-2">
							{PRESETS.map((p) => (
								<button
									key={p.id}
									type="button"
									onClick={() => setPreset(p.id)}
									className={cn(
										"rounded-lg border px-3 py-2.5 text-left",
										preset === p.id
											? "border-accent bg-accent/10"
											: "border-border hover:border-foreground/30",
									)}
								>
									<span className="block text-[13px] font-medium">{p.label}</span>
									<span className="block text-[11px] text-muted">{p.sub}</span>
								</button>
							))}
						</div>
						<div className="flex gap-2">
							{(["all", "inout"] as const).map((r) => (
								<button
									key={r}
									type="button"
									disabled={r === "inout" && !hasRange}
									onClick={() => setRange(r)}
									className={cn(
										"flex-1 rounded-lg border px-3 py-2 text-left text-[12px] disabled:opacity-40",
										range === r
											? "border-accent bg-accent/10"
											: "border-border hover:border-foreground/30",
									)}
								>
									{r === "all"
										? "Whole timeline"
										: hasRange
											? `In to out (${formatTime(inPoint as number)} – ${formatTime(outPoint as number)})`
											: "In to out (mark I and O first)"}
								</button>
							))}
						</div>
						<p className="text-[12px] text-muted">
							{chosen.kind === "audio"
								? `Stereo · 48 kHz · ${formatTime(length)} long`
								: chosen.kind === "gif"
									? `${Math.min(720, w)} px wide · 15 fps · ${formatTime(length)} long`
									: `${w}×${h} · ${project.data.canvas.fps} fps · ${formatTime(length)} long`}
						</p>
					</div>
				)}
				<footer className="flex justify-end gap-2 border-t border-separator px-5 py-3">
					<Button size="sm" variant="ghost" className="h-8 text-[12px]" onPress={close}>
						Cancel
					</Button>
					{mode === "variants" ? (
						<Button
							size="sm"
							className="h-8 px-4 text-[12px] font-semibold"
							isDisabled={busy || (aspects.length === 0 && lengths.length === 0)}
							onPress={() => void makeVariants()}
						>
							Make {variantCount} variant{variantCount === 1 ? "" : "s"}
						</Button>
					) : (
						<Button
							size="sm"
							className="h-8 px-4 text-[12px] font-semibold"
							isDisabled={busy}
							onPress={() => void start()}
						>
							Export…
						</Button>
					)}
				</footer>
			</div>
		</div>
	);
}
