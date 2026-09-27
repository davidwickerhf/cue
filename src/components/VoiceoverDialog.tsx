import { Button } from "@heroui/react";
import { Microphone, Stop, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify, run } from "../lib/api";
import { recorder, voiceoverPrompt } from "../lib/recorder";
import { useProject } from "../lib/state";
import { reviewTake } from "../lib/takeReview";
import { formatSeconds } from "../lib/utils";

/** A deliberate start step, visible script and countdown for microphone takes. */
export function VoiceoverDialog() {
	const lineId = voiceoverPrompt.use((state) => state.lineId);
	const project = useProject();
	const status = recorder.status.use((state) => state);
	const [started, setStarted] = useState(false);
	const line = project?.lines.find((item) => item.id === lineId);
	useEffect(() => {
		if (started && status.phase === "idle" && !status.review) {
			voiceoverPrompt.set({ lineId: null });
			setStarted(false);
		}
	}, [started, status.phase, status.review]);
	if (status.review && project) return <TakeReviewDialog />;
	if (!line || !project) return null;
	const active = status.phase !== "idle";
	const close = () => {
		if (status.phase === "saving") return;
		if (active) recorder.cancel();
		voiceoverPrompt.set({ lineId: null });
		setStarted(false);
	};
	return (
		<div
			className={
				active
					? "pointer-events-none fixed right-5 bottom-5 z-[160] w-[min(420px,calc(100vw-40px))]"
					: "fixed inset-0 z-[160] flex items-center justify-center bg-black/70 px-4"
			}
			onPointerDown={(event) => {
				if (!active && event.target === event.currentTarget) close();
			}}
		>
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Record ${line.id}`}
				className="pointer-events-auto w-full max-w-[520px] rounded-xl border border-border bg-surface p-5 shadow-2xl"
			>
				<div className="flex items-start justify-between gap-4">
					<div>
						<p className="text-[11px] font-semibold uppercase tracking-widest text-accent">
							Voiceover take
						</p>
						<h2 className="mt-1 text-[20px] font-semibold">
							{active
								? status.countdown > 0
									? `Starting in ${status.countdown}…`
									: status.phase === "saving"
										? "Saving take…"
										: status.phase === "recording"
											? "Recording"
											: "Get ready"
								: `Record ${line.id}`}
						</h2>
					</div>
					<button
						type="button"
						aria-label="Close voiceover recording"
						disabled={status.phase === "saving"}
						onClick={close}
						className="rounded-md p-1 text-muted hover:text-foreground"
					>
						<X size={18} />
					</button>
				</div>
				{status.countdown > 0 && (
					<div className="mt-4 flex items-center justify-center">
						<span
							key={status.countdown}
							className="text-[88px] leading-none font-semibold tabular-nums text-accent animate-[pulse_1s_ease-out]"
						>
							{status.countdown}
						</span>
					</div>
				)}
				{status.phase === "recording" && <LiveTimer line={line} elapsedMs={status.elapsedMs} />}
				<p className="mt-4 rounded-lg border border-border bg-default p-4 text-[17px] leading-relaxed">
					{line.text}
				</p>
				<p className="mt-3 text-[12px] leading-relaxed text-muted">
					Aim for {formatSeconds(line.targetMs)} (up to {formatSeconds(line.maxMs)}). Choose Start,
					wait for the three-second count, then speak when the playhead reaches the line. Recording
					runs until you stop it; then you decide whether to use the new take. Earlier takes are
					always kept.
				</p>
				<div className="mt-4 flex items-center gap-3">
					<div className="h-2 flex-1 overflow-hidden rounded-full bg-default">
						<div
							className="h-full bg-success transition-[width] duration-75"
							style={{ width: `${status.level * 100}%` }}
						/>
					</div>
					<span className="text-[11px] text-muted">Mic level</span>
				</div>
				{!active && (
					<div className="mt-3 flex items-center justify-between gap-3 text-[12px]">
						<span className="text-muted">
							{status.micReady ? "Microphone ready" : "Check your microphone before starting"}
						</span>
						{status.micReady ? (
							<select
								value={status.deviceId}
								onChange={(event) => void recorder.setDevice(event.target.value)}
								aria-label="Microphone"
								className="max-w-[180px] bg-field text-foreground"
							>
								<option value="">Default mic</option>
								{status.devices.map((device) => (
									<option key={device.deviceId} value={device.deviceId}>
										{device.label || "Microphone"}
									</option>
								))}
							</select>
						) : (
							<button
								type="button"
								className="text-accent underline underline-offset-2"
								onClick={() =>
									void recorder
										.ensureMic()
										.catch((error) => notify((error as Error).message, "danger"))
								}
							>
								Check mic
							</button>
						)}
					</div>
				)}
				<div className="mt-5 flex items-center justify-end gap-2">
					<Button
						size="sm"
						variant="secondary"
						isDisabled={status.phase === "saving"}
						onPress={close}
					>
						{active ? "Cancel take" : "Cancel"}
					</Button>
					{status.phase === "recording" ? (
						<Button size="sm" onPress={() => void recorder.stop()}>
							<Stop weight="fill" size={14} /> Stop and save
						</Button>
					) : !active ? (
						<Button
							size="sm"
							onPress={() => {
								setStarted(true);
								void recorder.record(project, line);
							}}
						>
							<Microphone size={15} /> Start recording
						</Button>
					) : null}
				</div>
			</div>
		</div>
	);
}

/** Seconds spoken against the line's target and maximum, amber past the target, red past the maximum. */
function LiveTimer({
	line,
	elapsedMs,
}: {
	line: { targetMs: number; maxMs: number };
	elapsedMs: number;
}) {
	const over = elapsedMs > line.maxMs;
	const past = elapsedMs > line.targetMs;
	const scale = Math.max(line.maxMs * 1.3, elapsedMs);
	return (
		<div className="mt-4">
			<div className="flex items-baseline justify-between text-[12px]">
				<span
					className={`text-[28px] font-semibold tabular-nums ${over ? "text-danger" : past ? "text-warning" : "text-foreground"}`}
				>
					{formatSeconds(elapsedMs)}
				</span>
				<span className="text-muted tabular-nums">
					target {formatSeconds(line.targetMs)} · max {formatSeconds(line.maxMs)}
				</span>
			</div>
			<div className="relative mt-1.5 h-2 overflow-hidden rounded-full bg-default">
				<div
					className={`h-full ${over ? "bg-danger" : past ? "bg-warning" : "bg-success"}`}
					style={{ width: `${Math.min(100, (elapsedMs / scale) * 100)}%` }}
				/>
				<div
					className="absolute top-0 h-full w-px bg-foreground/60"
					style={{ left: `${(line.maxMs / scale) * 100}%` }}
				/>
			</div>
			{over && (
				<p className="mt-1.5 text-[11px] text-danger">
					Past this line's time: keep going if you need to, and stop when you're done.
				</p>
			)}
		</div>
	);
}

/** After a take: how it fits, what Cue suggests, and the choice (use, keep the previous, discard, fit). */
function TakeReviewDialog() {
	const review = recorder.status.use((s) => s.review);
	const project = useProject();
	const [busy, setBusy] = useState(false);
	if (!review || !project) return null;
	const line = project.lines.find((l) => l.id === review.lineId);
	if (!line) return null;
	const next = project.lines
		.filter((l) => l.startMs > line.startMs)
		.sort((a, b) => a.startMs - b.startMs)[0];
	const verdict = reviewTake({
		speechMs: review.speechMs,
		peakDb: review.peakDb,
		line,
		nextStartMs: next?.startMs,
	});
	// Other sound under the line (a screen recording's own voice, say) plays with the take.
	const lineEnd = line.startMs + Math.max(line.maxMs, review.speechMs);
	const tracks = new Map(project.data.tracks.map((t) => [t.id, t]));
	const assets = new Map(project.data.assets.map((a) => [a.id, a]));
	const underneath = project.data.clips.filter((c) => {
		if (c.type !== "media" || c.lineId) return false;
		const a = assets.get(c.assetId);
		const t = tracks.get(c.trackId);
		return (
			!!a?.hasAudio &&
			a.kind === "video" &&
			c.volume > 0 &&
			!t?.muted &&
			c.startMs < lineEnd &&
			c.startMs + c.durationMs > line.startMs
		);
	});
	const done = () => {
		recorder.closeReview();
		voiceoverPrompt.set({ lineId: null });
	};
	const act = async (fn: () => Promise<unknown>) => {
		setBusy(true);
		try {
			await fn();
		} finally {
			setBusy(false);
		}
	};
	const tone = {
		fits: "text-success",
		short: "text-success",
		long: "text-warning",
		"too-long": "text-danger",
		silent: "text-danger",
	}[verdict.verdict];
	return (
		<div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/70 px-4">
			<div
				role="dialog"
				aria-modal="true"
				aria-label={`Take for ${line.id}`}
				className="w-full max-w-[520px] rounded-xl border border-border bg-surface p-5 shadow-2xl"
			>
				<p className="text-[11px] font-semibold uppercase tracking-widest text-accent">
					New take · {line.id}
				</p>
				<h2 className={`mt-1 text-[18px] font-semibold ${tone}`}>
					{
						{
							fits: "It fits",
							short: "Shorter than planned",
							long: "A little long",
							"too-long": "Too long",
							silent: "No speech heard",
						}[verdict.verdict]
					}
				</h2>
				<p className="mt-2 text-[13px] leading-relaxed text-foreground/90">{verdict.message}</p>
				<p className="mt-1 text-[12px] text-muted">
					{verdict.recommend === "discard"
						? "Suggested: discard it and record again."
						: verdict.recommend === "fit"
							? "Suggested: use it and fit the edit around it."
							: "Suggested: use it."}
				</p>
				{underneath.length > 0 && (
					<div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-[12px] leading-relaxed">
						<p>
							The video under this line has its own sound (
							{underneath
								.map((c) => assets.get((c as { assetId: string }).assetId)?.name)
								.join(", ")}
							), and it plays together with your take.
						</p>
						<Button
							size="sm"
							variant="secondary"
							className="mt-2"
							isDisabled={busy}
							onPress={() =>
								void act(async () => {
									for (const c of underneath)
										await run("update_clip", { id: c.id, patch: { volume: 0 } });
									notify("Muted the video's own sound", "success");
								})
							}
						>
							Mute the video's sound
						</Button>
					</div>
				)}
				<div className="mt-5 flex flex-wrap items-center justify-end gap-2">
					<Button
						size="sm"
						variant="secondary"
						isDisabled={busy}
						onPress={() =>
							void act(async () => {
								await run("delete_take", { assetId: review.takeId });
								if (review.previousId)
									await run("choose_take", { lineId: line.id, assetId: review.previousId });
								notify("Discarded the new take", "success");
								done();
							})
						}
					>
						Discard
					</Button>
					{review.previousId && (
						<Button
							size="sm"
							variant="secondary"
							isDisabled={busy}
							onPress={() =>
								void act(async () => {
									await run("choose_take", { lineId: line.id, assetId: review.previousId });
									notify("Kept the previous take; the new one is saved in the takes", "success");
									done();
								})
							}
						>
							Keep the previous take
						</Button>
					)}
					{verdict.fit && (
						<Button
							size="sm"
							variant={verdict.recommend === "fit" ? "primary" : "secondary"}
							isDisabled={busy}
							onPress={() =>
								void act(async () => {
									await run("ripple_from", {
										fromMs: verdict.fit?.fromMs,
										deltaMs: verdict.fit?.deltaMs,
									});
									notify("Fitted the edit to the take", "success");
									done();
								})
							}
						>
							{verdict.fit.deltaMs > 0 ? "Use and make room" : "Use and close the gap"}
						</Button>
					)}
					<Button
						size="sm"
						variant={verdict.recommend === "use" || !verdict.fit ? "primary" : "secondary"}
						isDisabled={busy}
						onPress={() => {
							notify(`Using the new take for ${line.id}`, "success");
							done();
						}}
					>
						Use this take
					</Button>
				</div>
				{verdict.fit && (
					<p className="mt-2 text-right text-[11px] text-muted">{verdict.fit.label}.</p>
				)}
			</div>
		</div>
	);
}
