import { Button } from "@heroui/react";
import { Microphone, Stop, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify } from "../lib/api";
import { recorder, voiceoverPrompt } from "../lib/recorder";
import { useProject } from "../lib/state";
import { formatSeconds } from "../lib/utils";

/** A deliberate start step, visible script and countdown for microphone takes. */
export function VoiceoverDialog() {
	const lineId = voiceoverPrompt.use((state) => state.lineId);
	const project = useProject();
	const status = recorder.status.use((state) => state);
	const [started, setStarted] = useState(false);
	const line = project?.lines.find((item) => item.id === lineId);
	useEffect(() => {
		if (started && status.phase === "idle") {
			voiceoverPrompt.set({ lineId: null });
			setStarted(false);
		}
	}, [started, status.phase]);
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
				<p className="mt-4 rounded-lg border border-border bg-default p-4 text-[17px] leading-relaxed">
					{line.text}
				</p>
				<p className="mt-3 text-[12px] leading-relaxed text-muted">
					You have up to {formatSeconds(line.maxMs)} to read this line. Choose Start, wait for the
					three-second count, then speak when the playhead reaches the line. Cue saves a new take
					and keeps previous takes available.
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
