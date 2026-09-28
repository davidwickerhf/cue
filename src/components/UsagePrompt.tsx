import { ChartBar, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { cn } from "../lib/utils";

export const PRIVACY_URL = "https://cue.wicker.life/privacy";

/**
 * Asks once whether to share anonymous usage (Settings → General → Share anonymous usage).
 * Only shown while the setting is "ask" and only by builds that can report at all (release
 * builds with a PostHog token). Any answer, including closing it, is final until changed in
 * Settings; closing counts as "No thanks".
 */
export function UsagePrompt() {
	const [open, setOpen] = useState(false);

	useEffect(() => {
		let cancelled = false;
		// A moment after launch, so it doesn't compete with the window appearing.
		const timer = setTimeout(() => {
			void window.cue.usageInfo().then((info) => {
				if (!cancelled && info.available && info.setting === "ask") setOpen(true);
			});
		}, 1500);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, []);

	const answer = (share: boolean) => {
		setOpen(false);
		void window.cue.setAppSettings({ usage: share ? "on" : "off" });
	};

	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			setOpen(false);
			void window.cue.setAppSettings({ usage: "off" });
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open) return null;

	return (
		<div className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]">
			<div
				role="dialog"
				aria-modal="true"
				aria-labelledby="usage-prompt-title"
				onKeyDown={(e) => e.stopPropagation()}
				className="m-auto flex w-[min(460px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-11 shrink-0 items-center justify-between border-b border-separator px-4">
					<h2 className="text-[13px] font-semibold">Usage</h2>
					<button
						type="button"
						onClick={() => answer(false)}
						aria-label="Close (no thanks)"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="flex items-start gap-3.5 px-5 pt-5 pb-4">
					<span className="mt-0.5 shrink-0">
						<ChartBar weight="fill" className="size-7 text-accent" />
					</span>
					<div className="flex min-w-0 flex-col gap-1.5">
						<p id="usage-prompt-title" className="text-[15px] font-semibold">
							Help improve Cue?
						</p>
						<p className="text-[12px] leading-relaxed text-muted">
							Cue can send anonymous counts of how it's used: its version and system, which features
							are used (exports, generation, agent tools) and whether they worked, with a random
							install ID. It never sends file or project names, paths, your media or project
							content, prompts or API keys. You can change this any time in Settings → General.{" "}
							<a
								href={PRIVACY_URL}
								target="_blank"
								rel="noreferrer"
								className="text-accent hover:underline"
							>
								Exactly what is sent
							</a>
						</p>
					</div>
				</div>
				<footer className="flex items-center justify-end gap-2 border-t border-separator px-4 py-3">
					<Action onPress={() => answer(false)}>No thanks</Action>
					<Action primary onPress={() => answer(true)}>
						Share anonymous usage
					</Action>
				</footer>
			</div>
		</div>
	);
}

function Action({
	children,
	onPress,
	primary,
}: {
	children: React.ReactNode;
	onPress: () => void;
	primary?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onPress}
			className={cn(
				"h-8 rounded-md px-3 text-[12px] font-medium",
				primary
					? "bg-accent text-accent-foreground"
					: "bg-default text-foreground hover:bg-default/70",
			)}
		>
			{children}
		</button>
	);
}
