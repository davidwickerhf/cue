import { ArrowCircleUp, CheckCircle, CircleNotch, WarningCircle, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { CHANGELOG } from "../../site/src/content/changelog";
import { appSettings, createStore } from "../lib/state";
import { cn } from "../lib/utils";
import { Markdown } from "./ui/Markdown";

type UpdateStatus = Awaited<ReturnType<typeof window.cue.updateStatus>>;

/** Check for Updates…: open from the menu, Settings or the header badge. */
export const updatesDialog = createStore<{ open: boolean }>({ open: false });

export function openUpdates() {
	updatesDialog.set({ open: true });
	void window.cue.checkForUpdates();
}

const RELEASES = "https://github.com/davidwickerhf/cue/releases";

/** What a version brought, from the changelog that ships with Cue. */
function notesFor(version: string | undefined) {
	const release = CHANGELOG.find((r) => r.version === version);
	return release
		? [release.summary, "", ...release.changes.map((c) => `- ${c}`)].join("\n")
		: undefined;
}

const ago = (iso?: string) => {
	if (!iso) return "";
	const s = (Date.now() - Date.parse(iso)) / 1000;
	return s < 60
		? "just now"
		: s < 3600
			? `${Math.floor(s / 60)} min ago`
			: new Date(iso).toLocaleString();
};

/**
 * Cue's updates dialog: whether this is the newest version, what's new, and the
 * download and restart, all in one place and live.
 */
export function UpdateDialog() {
	const open = updatesDialog.use((s) => s.open);
	const [status, setStatus] = useState<UpdateStatus | null>(null);
	const [version, setVersion] = useState("");
	const [installing, setInstalling] = useState(false);
	const auto = appSettings.use((s) => s.settings?.autoUpdate ?? true);

	useEffect(() => window.cue.onShowUpdates(openUpdates), []);
	useEffect(() => {
		void window.cue.updateStatus().then(setStatus);
		void window.cue.appInfo().then((info) => setVersion(info.version));
		return window.cue.onUpdateStatus(setStatus);
	}, []);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			updatesDialog.set({ open: false });
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open) return null;

	const close = () => updatesDialog.set({ open: false });
	const state = status?.state ?? "checking";
	const next = status?.version;
	// A found update's notes, otherwise those of the version running now.
	const incoming = state === "available" || state === "downloading" || state === "ready";
	const notes = incoming ? (status?.notes ?? notesFor(next)) : notesFor(version);

	let icon = <CircleNotch className="size-7 animate-spin text-muted" />;
	let title = "Looking for a new version…";
	let detail = `You have Cue ${version}.`;
	if (state === "idle") {
		icon = <CheckCircle weight="fill" className="size-7 text-success" />;
		title = "Cue is up to date";
		detail = `You have the newest version, ${version}${status?.checkedAt ? ` · checked ${ago(status.checkedAt)}` : ""}.`;
	} else if (state === "available") {
		icon = <ArrowCircleUp weight="fill" className="size-7 text-accent" />;
		title = `Cue ${next} is available`;
		detail = `You have ${version}. It downloads only when you choose to.`;
	} else if (state === "downloading") {
		icon = <ArrowCircleUp weight="fill" className="size-7 text-accent" />;
		title = `Downloading Cue ${next}`;
		detail = `${status?.percent ?? 0}% · keep working, it downloads in the background.`;
	} else if (state === "ready") {
		icon = <ArrowCircleUp weight="fill" className="size-7 text-accent" />;
		title = `Cue ${next} is ready`;
		detail = status?.installOnQuit
			? "It installs when you quit, or restart now. Your project is saved first."
			: "Restart to install it. Your project is saved first.";
	} else if (state === "error" || state === "unsupported") {
		icon = <WarningCircle weight="fill" className="size-7 text-warning" />;
		title =
			state === "error" ? "Couldn't check for updates" : "This copy of Cue can't update itself";
		detail = status?.message ?? "";
	}

	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<div
				role="dialog"
				aria-label="Updates"
				onPointerDown={(e) => e.stopPropagation()}
				onKeyDown={(e) => e.stopPropagation()}
				className="m-auto flex max-h-[80vh] w-[min(460px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-11 shrink-0 items-center justify-between border-b border-separator px-4">
					<h2 className="text-[13px] font-semibold">Updates</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="flex items-start gap-3.5 px-5 pt-5 pb-4">
					<span className="mt-0.5 shrink-0">{icon}</span>
					<div className="flex min-w-0 flex-col gap-1">
						<p className="text-[15px] font-semibold">{title}</p>
						<p className="text-[12px] leading-relaxed break-words text-muted select-text">
							{detail}
						</p>
						{state === "downloading" && (
							<div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-default">
								<div
									className="h-full rounded-full bg-accent transition-[width]"
									style={{ width: `${status?.percent ?? 0}%` }}
								/>
							</div>
						)}
					</div>
				</div>
				{notes && (
					<div className="custom-scrollbar mx-5 mb-4 min-h-0 overflow-y-auto rounded-lg border border-border bg-background/40 px-3.5 py-3">
						<p className="mb-1.5 text-[11px] font-medium tracking-wide text-muted uppercase">
							{incoming ? `What's new in ${next}` : `New in ${version}`}
						</p>
						<Markdown
							text={notes}
							className="flex flex-col gap-1.5 text-[12px] leading-relaxed select-text [&_li]:mt-0.5"
						/>
					</div>
				)}
				<footer className="flex items-center gap-2 border-t border-separator px-4 py-3">
					<label className="mr-auto flex cursor-pointer items-center gap-1.5 text-[11px] text-muted hover:text-foreground">
						<input
							type="checkbox"
							className="size-3"
							checked={auto}
							onChange={(e) => void window.cue.setAppSettings({ autoUpdate: e.target.checked })}
						/>
						Check automatically
					</label>
					{(state === "error" || state === "unsupported") && (
						<Action onPress={() => void window.open(`${RELEASES}/latest`)}>Open releases</Action>
					)}
					{state === "idle" && (
						<Action onPress={() => void window.cue.checkForUpdates()}>Check again</Action>
					)}
					{state === "available" && (
						<>
							<Action onPress={close}>Later</Action>
							<Action primary onPress={() => void window.cue.downloadUpdate()}>
								Download
							</Action>
						</>
					)}
					{state === "ready" && (
						<>
							<Action onPress={close}>Later</Action>
							<Action
								primary
								disabled={installing}
								onPress={() => {
									setInstalling(true);
									void window.cue.installUpdate().finally(() => setInstalling(false));
								}}
							>
								{installing ? "Restarting…" : "Restart now"}
							</Action>
						</>
					)}
					{(state === "idle" ||
						state === "downloading" ||
						state === "checking" ||
						state === "error" ||
						state === "unsupported") && (
						<Action primary={state !== "error" && state !== "unsupported"} onPress={close}>
							{state === "downloading" ? "Hide" : "Done"}
						</Action>
					)}
				</footer>
			</div>
		</div>
	);
}

function Action({
	children,
	onPress,
	primary,
	disabled,
}: {
	children: React.ReactNode;
	onPress: () => void;
	primary?: boolean;
	disabled?: boolean;
}) {
	return (
		<button
			type="button"
			onClick={onPress}
			disabled={disabled}
			className={cn(
				"h-8 rounded-md px-3 text-[12px] font-medium disabled:opacity-60",
				primary
					? "bg-accent text-accent-foreground"
					: "bg-default text-foreground hover:bg-default/70",
			)}
		>
			{children}
		</button>
	);
}
