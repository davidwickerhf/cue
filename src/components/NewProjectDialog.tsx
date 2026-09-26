import { Button } from "@heroui/react";
import { FilmStrip, FolderSimple, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify } from "../lib/api";
import { appSettings, dialogs } from "../lib/state";
import { cn } from "../lib/utils";

const PRESETS = [
	{ id: "1080p", label: "HD 1080p", sub: "1920×1080 · 16:9", w: 1920, h: 1080 },
	{ id: "4k", label: "4K UHD", sub: "3840×2160 · 16:9", w: 3840, h: 2160 },
	{ id: "720p", label: "HD 720p", sub: "1280×720 · 16:9", w: 1280, h: 720 },
	{ id: "vertical", label: "Vertical", sub: "1080×1920 · 9:16", w: 1080, h: 1920 },
	{ id: "square", label: "Square", sub: "1080×1080 · 1:1", w: 1080, h: 1080 },
	{ id: "portrait", label: "Portrait", sub: "1080×1350 · 4:5", w: 1080, h: 1350 },
] as const;

const RATES = [24, 25, 30, 50, 60];

/** New project: name, where it goes, frame size and rate, or start from a video. */
export function NewProjectDialog() {
	const open = dialogs.use((s) => s.newProject);
	const projectsDir = appSettings.use((s) => s.settings?.projectsDir ?? "");
	const [name, setName] = useState("Untitled");
	const [preset, setPreset] = useState<(typeof PRESETS)[number]["id"]>("1080p");
	const [fps, setFps] = useState(30);
	const [folder, setFolder] = useState("");
	const [video, setVideo] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	useEffect(() => window.cue.onNewProject(() => dialogs.set({ newProject: true })), []);
	useEffect(() => {
		if (!open) return;
		setName("Untitled");
		setVideo(null);
		setBusy(false);
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				dialogs.set({ newProject: false });
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open) return null;

	const close = () => dialogs.set({ newProject: false });
	const where = folder || projectsDir;
	const size = PRESETS.find((p) => p.id === preset) ?? PRESETS[0];
	const create = async () => {
		setBusy(true);
		try {
			await window.cue.createProject({
				name,
				folder: where,
				width: size.w,
				height: size.h,
				fps,
				video: video ?? undefined,
			});
			close();
		} catch (error) {
			notify(
				(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
				"danger",
			);
			setBusy(false);
		}
	};

	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<form
				role="dialog"
				aria-label="New project"
				onPointerDown={(e) => e.stopPropagation()}
				onSubmit={(e) => {
					e.preventDefault();
					if (!busy) void create();
				}}
				onKeyDown={(e) => e.stopPropagation()}
				className="m-auto flex w-[min(560px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-12 items-center justify-between border-b border-separator px-5">
					<h2 className="text-[14px] font-semibold">New project</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="flex flex-col gap-5 p-5">
					<label className="flex flex-col gap-1.5">
						<span className="text-[12px] text-muted">Name</span>
						<input
							// biome-ignore lint/a11y/noAutofocus: the name is the first thing to type
							autoFocus
							value={name}
							onChange={(e) => setName(e.target.value)}
							onFocus={(e) => e.target.select()}
							className="h-8 rounded-md border border-border bg-field px-2.5 text-[13px] outline-none focus:border-accent"
						/>
					</label>

					<div className="flex flex-col gap-1.5">
						<span className="text-[12px] text-muted">Frame size</span>
						{video ? (
							<p className="text-[12px] text-muted">Matches the video.</p>
						) : (
							<div className="grid grid-cols-3 gap-2">
								{PRESETS.map((p) => (
									<button
										key={p.id}
										type="button"
										onClick={() => setPreset(p.id)}
										className={cn(
											"flex items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors",
											preset === p.id
												? "border-accent bg-accent/10"
												: "border-border hover:border-foreground/30",
										)}
									>
										<span className="flex size-7 shrink-0 items-center justify-center">
											<span
												className={cn(
													"block rounded-[2px] border",
													preset === p.id ? "border-accent" : "border-foreground/40",
												)}
												style={{
													width: p.w >= p.h ? 26 : (26 * p.w) / p.h,
													height: p.h >= p.w ? 26 : (26 * p.h) / p.w,
												}}
											/>
										</span>
										<span className="min-w-0">
											<span className="block text-[12px] font-medium">{p.label}</span>
											<span className="block truncate text-[10px] text-muted">{p.sub}</span>
										</span>
									</button>
								))}
							</div>
						)}
					</div>

					<div className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3">
						<span className="text-[12px] text-muted">Frame rate</span>
						<div className="flex gap-1">
							{RATES.map((r) => (
								<button
									key={r}
									type="button"
									onClick={() => setFps(r)}
									className={cn(
										"h-7 rounded-md border px-2.5 text-[12px] tabular",
										fps === r
											? "border-accent bg-accent/10"
											: "border-border hover:border-foreground/30",
									)}
								>
									{r}
								</button>
							))}
						</div>
						<span className="text-[12px] text-muted">Start from</span>
						<div className="flex min-w-0 items-center gap-2">
							<Button
								size="sm"
								variant="secondary"
								className="h-7 gap-1.5 text-[12px]"
								onPress={async () => {
									const file = await window.cue.chooseFile({
										title: "Start from a video",
										extensions: ["mp4", "mov", "m4v", "webm", "mkv"],
									});
									if (file) {
										setVideo(file);
										if (name === "Untitled")
											setName(
												file
													.split("/")
													.pop()
													?.replace(/\.[^.]+$/, "") ?? name,
											);
									}
								}}
							>
								<FilmStrip className="size-3.5" /> {video ? "Change video" : "A video (optional)"}
							</Button>
							{video && (
								<>
									<span className="min-w-0 truncate text-[12px]">{video.split("/").pop()}</span>
									<button
										type="button"
										onClick={() => setVideo(null)}
										className="text-[11px] text-muted hover:text-foreground"
									>
										Remove
									</button>
								</>
							)}
						</div>
						<span className="text-[12px] text-muted">Location</span>
						<div className="flex min-w-0 items-center gap-2">
							<span className="min-w-0 truncate text-[12px]" title={where}>
								{where.replace(/^\/Users\/[^/]+/, "~")}/{name.trim() || "Untitled"}
							</span>
							<button
								type="button"
								onClick={async () => {
									const dir = await window.cue.chooseFolder({
										title: "Where to save the project",
										defaultPath: where,
									});
									if (dir) setFolder(dir);
								}}
								className="flex shrink-0 items-center gap-1 text-[11px] text-muted hover:text-foreground"
							>
								<FolderSimple className="size-3.5" /> Change
							</button>
						</div>
					</div>
				</div>
				<footer className="flex justify-end gap-2 border-t border-separator px-5 py-3">
					<Button size="sm" variant="ghost" className="h-8 text-[12px]" onPress={close}>
						Cancel
					</Button>
					<Button
						size="sm"
						type="submit"
						className="h-8 px-4 text-[12px] font-semibold"
						isDisabled={busy || !name.trim()}
					>
						{busy ? "Creating…" : "Create"}
					</Button>
				</footer>
			</form>
		</div>
	);
}
