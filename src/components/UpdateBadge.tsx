import { ArrowCircleUp } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { openUpdates } from "./UpdateDialog";

type UpdateStatus = Awaited<ReturnType<typeof window.cue.updateStatus>>;

/** An available or downloaded update in the editor header. */
export function UpdateBadge() {
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [installing, setInstalling] = useState(false);
	useEffect(() => {
		void window.cue.updateStatus().then(setStatus);
		return window.cue.onUpdateStatus(setStatus);
	}, []);
	if (status?.state !== "ready" && status?.state !== "available" && status?.state !== "downloading")
		return null;
	const ready = status.state === "ready";
	return (
		<button
			type="button"
			disabled={installing}
			onClick={() => {
				if (!ready) return openUpdates();
				setInstalling(true);
				void window.cue.installUpdate().finally(() => setInstalling(false));
			}}
			className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-60"
			title={
				ready
					? `Cue ${status.version} has downloaded. Your project is saved before Cue restarts.`
					: status.state === "downloading"
						? `Downloading Cue ${status.version}. Click for progress.`
						: `Cue ${status.version} is available. Click to see what's new and download it.`
			}
		>
			<ArrowCircleUp weight="fill" className="size-3.5" />
			{installing
				? "Restarting…"
				: ready
					? status.installOnQuit
						? "Update ready — installs on quit"
						: "Update ready — restart to install"
					: status.state === "downloading"
						? `Downloading update ${status.percent ?? 0}%`
						: `Cue ${status.version} available — download`}
		</button>
	);
}
