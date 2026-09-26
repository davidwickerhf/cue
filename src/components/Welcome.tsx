import { Button } from "@heroui/react";
import { Copy, FilmSlate, FolderOpen, Plus } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify, run } from "../lib/api";
import { useApp } from "../lib/state";

function ago(iso: string): string {
	const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	return new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export function Welcome() {
	const recent = useApp((s) => s.recent) ?? [];
	const [command, setCommand] = useState("");
	useEffect(() => {
		void window.cue.mcpCommand().then(setCommand);
	}, []);

	return (
		<div className="flex h-full flex-col bg-background">
			<header className="app-drag flex h-11 shrink-0 items-center gap-2 border-b border-separator bg-surface pr-3 pl-[84px]">
				<Logo />
				<div className="flex-1" />
				<Button size="sm" variant="secondary" className="h-7 gap-1.5 text-[12px]" onPress={() => void window.cue.openProject()}>
					<FolderOpen className="size-3.5" /> Open…
				</Button>
				<Button size="sm" className="h-7 gap-1.5 text-[12px] font-semibold" onPress={() => void window.cue.newProject()}>
					<Plus weight="bold" className="size-3.5" /> New Project
				</Button>
			</header>

			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-5xl px-8 py-8">
					<h1 className="mb-4 text-[13px] font-semibold text-muted">Recent projects</h1>
					{recent.length === 0 ? (
						<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-8">
							<FilmSlate className="size-6 text-muted" />
							<p className="text-[13px]">No projects yet. Start one from a video, or from an empty timeline.</p>
							<Button size="sm" className="h-7 text-[12px]" onPress={() => void window.cue.newProject()}>
								New Project
							</Button>
						</div>
					) : (
						<div className="overflow-hidden rounded-lg border border-border bg-surface">
							{recent.map((item, i) => (
								<button
									key={item.path}
									type="button"
									onClick={() => void run("open_project", { path: item.path })}
									className={`grid w-full grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-default/60 ${i > 0 ? "border-t border-separator" : ""}`}
								>
									<FilmSlate className="size-4 text-muted" />
									<span className="min-w-0">
										<span className="block truncate text-[13px] font-medium">{item.name}</span>
										<span className="block truncate text-[11px] text-muted">{item.path.replace(/^\/Users\/[^/]+/, "~")}</span>
									</span>
									<span className="text-[11px] text-muted">{ago(item.openedAt)}</span>
								</button>
							))}
						</div>
					)}
				</div>
			</main>

			<footer className="flex h-10 shrink-0 items-center gap-3 border-t border-separator bg-surface px-4 text-[11px] text-muted">
				<span className="shrink-0">Agent access</span>
				<code className="min-w-0 flex-1 truncate font-mono select-text">{command}</code>
				<button
					type="button"
					onClick={() => {
						void navigator.clipboard.writeText(command);
						notify("Copied. Run it once in a terminal.", "success");
					}}
					className="flex h-6 items-center gap-1 rounded-md px-2 hover:bg-default hover:text-foreground"
				>
					<Copy className="size-3.5" /> Copy
				</button>
			</footer>
		</div>
	);
}

export function Logo() {
	return (
		<div className="flex items-center gap-1.5">
			<svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
				<rect width="20" height="20" rx="5" fill="currentColor" />
				<path d="M6.5 7v6M10 5v10M13.5 8v4" stroke="var(--surface)" strokeWidth="2" strokeLinecap="round" />
			</svg>
			<span className="text-[13px] font-semibold tracking-tight">Cue</span>
		</div>
	);
}
