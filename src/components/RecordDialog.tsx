import { Button } from "@heroui/react";
import { ArrowClockwise, Monitor, Pause, Play, Stop, X } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { type CaptureSources, SCREEN_ACCESS_HELP } from "../../electron/core/capture";
import { type CaptureChoice, capture } from "../lib/capture";
import { createStore } from "../lib/state";
import { cn, formatTime } from "../lib/utils";
import { Toggle } from "./ui/controls";

export const recordDialog = createStore({ open: false });

/** Plays a MediaStream in a <video> (streams can't be set as an attribute). */
function StreamView({ stream, className }: { stream: MediaStream | null; className?: string }) {
	const ref = useRef<HTMLVideoElement>(null);
	useEffect(() => {
		if (ref.current) ref.current.srcObject = stream;
	}, [stream]);
	if (!stream) return null;
	return <video ref={ref} autoPlay muted playsInline className={className} />;
}

/** Record the screen, a window and/or the camera: choose, preview, then record. */
export function RecordDialog() {
	const open = recordDialog.use((s) => s.open);
	const [sources, setSources] = useState<CaptureSources | null>(null);
	const [loading, setLoading] = useState(false);
	const [choice, setChoice] = useState<CaptureChoice>({
		sourceId: null,
		camera: false,
		microphone: true,
		bubble: true,
	});
	const [error, setError] = useState<string | null>(null);
	const screen = capture.streams.use((s) => s.screen);
	const camera = capture.streams.use((s) => s.camera);
	const close = () => {
		recordDialog.set({ open: false });
		capture.release();
	};

	const load = async () => {
		setLoading(true);
		try {
			const found = await window.cue.captureSources();
			setSources(found);
			setChoice((c) => ({
				...c,
				sourceId:
					c.sourceId && found.sources.some((s) => s.id === c.sourceId)
						? c.sourceId
						: (found.sources.find((s) => s.kind === "screen")?.id ?? null),
			}));
		} finally {
			setLoading(false);
		}
	};

	// biome-ignore lint/correctness/useExhaustiveDependencies: load and close only matter when it opens
	useEffect(() => {
		if (!open) return;
		setError(null);
		void load();
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				close();
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);

	// Live preview of what will be recorded.
	useEffect(() => {
		if (!open || !sources) return;
		let alive = true;
		setError(null);
		capture.preview(choice).catch((e: Error) => alive && setError(e.message));
		return () => {
			alive = false;
		};
	}, [open, sources, choice]);

	if (!open) return null;
	const set = (patch: Partial<CaptureChoice>) => setChoice((c) => ({ ...c, ...patch }));
	const screenBlocked =
		sources?.screenAccess === "denied" || sources?.screenAccess === "restricted";
	const screens = sources?.sources.filter((s) => s.kind === "screen") ?? [];
	const windows = sources?.sources.filter((s) => s.kind === "window") ?? [];
	const canRecord = (!!choice.sourceId || choice.camera) && !error;

	const record = () => {
		recordDialog.set({ open: false });
		void capture.start(choice);
	};

	const tile = (s: CaptureSources["sources"][number]) => (
		<button
			key={s.id}
			type="button"
			onClick={() => set({ sourceId: s.id })}
			className={cn(
				"flex flex-col overflow-hidden rounded-lg border text-left",
				choice.sourceId === s.id ? "border-accent ring-1 ring-accent" : "border-border",
			)}
			title={s.name}
		>
			<div className="flex aspect-video items-center justify-center bg-default">
				{s.thumbnail ? (
					<img src={s.thumbnail} alt="" className="size-full object-contain" />
				) : (
					<Monitor className="size-5 text-muted" />
				)}
			</div>
			<span className="truncate px-2 py-1 text-[11px]">{s.name}</span>
		</button>
	);

	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<div
				role="dialog"
				aria-label="Record screen or camera"
				onPointerDown={(e) => e.stopPropagation()}
				className="m-auto flex max-h-[90vh] w-[min(760px,94vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-5">
					<h2 className="text-[14px] font-semibold">Record screen or camera</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="grid min-h-0 flex-1 grid-cols-[1fr_260px] gap-5 overflow-hidden p-5">
					<div className="flex min-h-0 flex-col gap-3 overflow-y-auto pr-1">
						<div className="flex items-center justify-between">
							<p className="text-[12px] font-medium">What to record</p>
							<button
								type="button"
								onClick={() => void load()}
								className="flex items-center gap-1 text-[11px] text-muted hover:text-foreground"
							>
								<ArrowClockwise className={cn("size-3", loading && "animate-spin")} /> Refresh
							</button>
						</div>
						{screenBlocked && (
							<p className="rounded-lg border border-warning/40 bg-warning/10 p-2.5 text-[12px] text-warning">
								{SCREEN_ACCESS_HELP}
							</p>
						)}
						<button
							type="button"
							onClick={() => set({ sourceId: null, camera: true })}
							className={cn(
								"h-8 rounded-lg border px-3 text-left text-[12px]",
								choice.sourceId === null
									? "border-accent bg-accent/10"
									: "border-border text-muted hover:border-foreground/30",
							)}
						>
							Camera only (no screen)
						</button>
						{screens.length > 0 && (
							<>
								<p className="text-[11px] text-muted">Screens</p>
								<div className="grid grid-cols-3 gap-2">{screens.map(tile)}</div>
							</>
						)}
						{windows.length > 0 && (
							<>
								<p className="text-[11px] text-muted">Windows</p>
								<div className="grid grid-cols-3 gap-2">{windows.map(tile)}</div>
							</>
						)}
						{sources && sources.sources.length === 0 && (
							<p className="text-[12px] text-muted">
								No screens or windows were found. If macOS asked for permission, allow it and press
								Refresh. {screenBlocked ? "" : SCREEN_ACCESS_HELP}
							</p>
						)}
					</div>
					<div className="flex flex-col gap-3">
						<div className="relative aspect-video overflow-hidden rounded-lg bg-black">
							{screen ? (
								<StreamView stream={screen} className="size-full object-contain" />
							) : (
								<StreamView stream={camera} className="size-full object-cover" />
							)}
							{screen && camera && (
								<StreamView
									stream={camera}
									className={cn(
										"absolute object-cover",
										choice.bubble
											? "right-2 bottom-2 w-[30%] rounded-md shadow-lg"
											: "right-1 top-1 w-[22%] rounded-sm opacity-80",
									)}
								/>
							)}
							{!screen && !camera && (
								<p className="absolute inset-0 flex items-center justify-center p-3 text-center text-[11px] text-white/60">
									{error ? "No preview" : "Preview"}
								</p>
							)}
						</div>
						{error && <p className="text-[11px] text-danger">{error}</p>}
						<Toggle
							label="Camera"
							checked={choice.camera}
							onChange={(on) => set({ camera: on || choice.sourceId === null })}
						/>
						{choice.camera && (sources?.cameras.length ?? 0) > 0 && (
							<select
								className="h-8 rounded-md border border-border bg-default px-2 text-[12px]"
								value={choice.cameraId ?? ""}
								onChange={(e) => set({ cameraId: e.target.value || undefined })}
							>
								<option value="">System default camera</option>
								{sources?.cameras.map((d) => (
									<option key={d.id} value={d.id}>
										{d.label}
									</option>
								))}
							</select>
						)}
						{choice.camera && choice.sourceId && (
							<>
								<Toggle
									label="Camera as a bubble"
									checked={choice.bubble}
									onChange={(bubble) => set({ bubble })}
								/>
								<p className="-mt-1.5 text-[11px] text-muted">
									{choice.bubble
										? "The camera sits small in the bottom-right corner of the screen."
										: "The camera goes full size on the track above; arrange it later."}
								</p>
							</>
						)}
						<Toggle
							label="Microphone"
							checked={choice.microphone}
							onChange={(microphone) => set({ microphone })}
						/>
						{choice.microphone && (sources?.microphones.length ?? 0) > 0 && (
							<select
								className="h-8 rounded-md border border-border bg-default px-2 text-[12px]"
								value={choice.microphoneId ?? ""}
								onChange={(e) => set({ microphoneId: e.target.value || undefined })}
							>
								<option value="">System default microphone</option>
								{sources?.microphones.map((d) => (
									<option key={d.id} value={d.id}>
										{d.label}
									</option>
								))}
							</select>
						)}
					</div>
				</div>
				<footer className="flex shrink-0 items-center justify-between gap-2 border-t border-separator px-5 py-3">
					<p className="text-[11px] text-muted">
						Lands at the playhead. Stop from the bar at the top of the window.
					</p>
					<div className="flex gap-2">
						<Button size="sm" variant="ghost" className="h-8 text-[12px]" onPress={close}>
							Cancel
						</Button>
						<Button
							size="sm"
							className="h-8 px-4 text-[12px] font-semibold"
							isDisabled={!canRecord}
							onPress={record}
						>
							Record
						</Button>
					</div>
				</footer>
			</div>
		</div>
	);
}

/** The 3-2-1 countdown, then a small bar with the time, pause and stop. */
export function CaptureBar() {
	const phase = capture.status.use((s) => s.phase);
	const count = capture.status.use((s) => s.count);
	const elapsed = capture.status.use((s) => Math.floor(s.elapsedMs / 1000) * 1000);
	const max = capture.status.use((s) => s.maxSeconds);
	useEffect(() => {
		if (phase !== "countdown") return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			capture.cancel();
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [phase]);
	if (phase === "idle") return null;
	if (phase === "countdown")
		return count === 0 ? null : (
			<div
				role="alertdialog"
				aria-label="Recording starts in"
				className="fixed inset-0 z-[160] flex flex-col items-center justify-center gap-4 bg-black/50"
			>
				<span className="text-[120px] font-semibold text-white tabular-nums">{count || ""}</span>
				<Button size="sm" variant="secondary" onPress={() => capture.cancel()}>
					Cancel
				</Button>
			</div>
		);
	return (
		<div className="fixed top-3 left-1/2 z-[160] flex -translate-x-1/2 items-center gap-3 rounded-full border border-border bg-surface/95 py-1.5 pr-1.5 pl-4 shadow-xl shadow-black/40">
			<span
				className={cn(
					"size-2.5 rounded-full bg-danger",
					phase === "recording" && "rec-pulse",
					phase === "paused" && "opacity-40",
				)}
			/>
			<span className="font-mono text-[13px] tabular-nums">
				{phase === "saving" ? "Saving…" : formatTime(elapsed, false)}
				{max && phase !== "saving" ? (
					<span className="text-muted"> / {formatTime(max * 1000, false)}</span>
				) : null}
			</span>
			{phase !== "saving" && (
				<>
					<button
						type="button"
						aria-label={phase === "paused" ? "Resume" : "Pause"}
						title={phase === "paused" ? "Resume" : "Pause"}
						onClick={() => (phase === "paused" ? capture.resume() : capture.pause())}
						className="flex size-7 items-center justify-center rounded-full hover:bg-default"
					>
						{phase === "paused" ? (
							<Play weight="fill" className="size-3.5" />
						) : (
							<Pause weight="fill" className="size-3.5" />
						)}
					</button>
					<button
						type="button"
						aria-label="Stop recording"
						title="Stop and add to the timeline"
						onClick={() => void capture.stop()}
						className="flex h-7 items-center gap-1.5 rounded-full bg-danger px-3 text-[12px] font-medium text-white"
					>
						<Stop weight="fill" className="size-3" /> Stop
					</button>
				</>
			)}
		</div>
	);
}
