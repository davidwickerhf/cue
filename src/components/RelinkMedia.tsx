import { Button } from "@heroui/react";
import { LinkBreak, MagnifyingGlass, X } from "@phosphor-icons/react";
import { useEffect } from "react";
import type { Asset } from "../../electron/core/types";
import { notify, run } from "../lib/api";
import { createStore, useProject } from "../lib/state";

export const relinkDialog = createStore({ open: false });

const EXTENSIONS: Record<Asset["kind"], string[]> = {
	video: ["mp4", "mov", "m4v", "webm", "mkv"],
	audio: ["wav", "mp3", "m4a", "aac", "flac", "ogg"],
	image: ["png", "jpg", "jpeg", "webp", "gif"],
	adjustment: [],
};

type Result = { relinked: string[]; stillOffline: number };

function report(result: Result | undefined) {
	if (!result) return;
	if (result.relinked.length)
		notify(
			`Relinked ${result.relinked.length} file${result.relinked.length === 1 ? "" : "s"}${result.stillOffline ? `, ${result.stillOffline} still offline` : ""}`,
			"success",
		);
	else notify("No matching files found there");
	if (!result.stillOffline) relinkDialog.set({ open: false });
}

/** Pick the new file for one offline item; others in the same folder are found too. */
export async function locate(asset: Asset) {
	const file = await window.cue.chooseFile({
		title: `Locate ${asset.name}`,
		extensions: EXTENSIONS[asset.kind],
	});
	if (file) report(await run<Result>("relink_media", { assetId: asset.id, file }));
}

async function searchFolder() {
	const folder = await window.cue.chooseFolder({ title: "Search a folder for the missing media" });
	if (folder) report(await run<Result>("find_offline_media", { folders: [folder] }));
}

/** Thin bar over the editor while any media is offline. */
export function OfflineBanner() {
	const project = useProject();
	const count = project?.offline.length ?? 0;
	if (!count) return null;
	return (
		<div className="flex h-9 shrink-0 items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 text-[12px] text-warning">
			<LinkBreak className="size-4" />
			<span className="flex-1">
				{count} media file{count === 1 ? " is" : "s are"} offline: moved, renamed or on a drive that
				isn't connected.
			</span>
			<button
				type="button"
				onClick={() => relinkDialog.set({ open: true })}
				className="font-medium underline-offset-2 hover:underline"
			>
				Relink…
			</button>
		</div>
	);
}

export function RelinkDialog() {
	const open = relinkDialog.use((s) => s.open);
	const project = useProject();
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.stopPropagation();
				relinkDialog.set({ open: false });
			}
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open || !project) return null;
	const offline = project.data.assets.filter((a) => project.offline.includes(a.id));
	const close = () => relinkDialog.set({ open: false });
	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<div
				role="dialog"
				aria-label="Relink media"
				onPointerDown={(e) => e.stopPropagation()}
				className="m-auto flex max-h-[80vh] w-[min(620px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex h-12 shrink-0 items-center justify-between border-b border-separator px-5">
					<h2 className="text-[14px] font-semibold">Relink media</h2>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<p className="px-5 pt-4 text-[12px] leading-relaxed text-muted">
					Locate one file and Cue checks the same folder for the rest. Cue already looked next to
					the project and its parent folders.
				</p>
				<ul className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-5 py-3">
					{offline.length === 0 ? (
						<li className="py-3 text-[12px] text-success">Everything is linked.</li>
					) : (
						offline.map((asset) => (
							<li
								key={asset.id}
								className="flex items-center gap-3 border-b border-separator py-2.5 last:border-b-0"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-[13px] font-medium">{asset.name}</p>
									<p className="truncate text-[11px] text-muted" title={asset.path}>
										Was at {asset.path.replace(/^\/Users\/[^/]+/, "~")}
									</p>
								</div>
								<Button
									size="sm"
									variant="secondary"
									className="h-7 shrink-0 text-[12px]"
									onPress={() => void locate(asset)}
								>
									Locate…
								</Button>
							</li>
						))
					)}
				</ul>
				<footer className="flex justify-between gap-2 border-t border-separator px-5 py-3">
					<Button
						size="sm"
						variant="ghost"
						className="h-8 gap-1.5 text-[12px]"
						onPress={() => void searchFolder()}
					>
						<MagnifyingGlass className="size-3.5" /> Search a folder…
					</Button>
					<Button size="sm" className="h-8 px-4 text-[12px]" onPress={close}>
						Done
					</Button>
				</footer>
			</div>
		</div>
	);
}
