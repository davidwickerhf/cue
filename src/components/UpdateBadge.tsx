import { ArrowCircleUp } from "@phosphor-icons/react";
import { useEffect, useState } from "react";

type UpdateStatus = Awaited<ReturnType<typeof window.cue.updateStatus>>;

/** "Update ready — restart to install" in the header, only once an update has downloaded. */
export function UpdateBadge() {
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [installing, setInstalling] = useState(false);
	useEffect(() => {
		void window.cue.updateStatus().then(setStatus);
		return window.cue.onUpdateStatus(setStatus);
	}, []);
	if (status?.state !== "ready") return null;
	return (
		<button
			type="button"
			disabled={installing}
			onClick={() => {
				setInstalling(true);
				void window.cue.installUpdate().finally(() => setInstalling(false));
			}}
			className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-accent hover:bg-accent/10 disabled:opacity-60"
			title={`Cue ${status.version} has downloaded. Your project is saved before Cue restarts.`}
		>
			<ArrowCircleUp weight="fill" className="size-3.5" />
			{installing ? "Restarting…" : "Update ready — restart to install"}
		</button>
	);
}
