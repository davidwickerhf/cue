import { Button } from "@heroui/react";
import {
	Copy,
	DotsThree,
	FilmSlate,
	FolderOpen,
	GearSix,
	MagnifyingGlass,
	Plus,
	Warning,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ProjectSummary } from "../../electron/core/types";
import { notify, run } from "../lib/api";
import { keyLabel } from "../lib/platform";
import { appSettings, dialogs, openSettings, useApp } from "../lib/state";
import { cn } from "../lib/utils";
import { UpdateBadge } from "./UpdateBadge";
import { Segmented } from "./ui/controls";
import { WindowDots } from "./WindowDots";

function ago(iso: string | undefined): string {
	if (!iso) return "";
	const minutes = Math.round((Date.now() - Date.parse(iso)) / 60000);
	if (minutes < 1) return "Just now";
	if (minutes < 60) return `${minutes} min ago`;
	const hours = Math.round(minutes / 60);
	if (hours < 24) return `${hours} h ago`;
	const days = Math.round(hours / 24);
	if (days < 7) return `${days} d ago`;
	return new Date(iso).toLocaleDateString(undefined, {
		day: "numeric",
		month: "short",
		year: "numeric",
	});
}

function length(ms: number) {
	const s = Math.round(ms / 1000);
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function aspect(w: number, h: number) {
	if (!w || !h) return "";
	const r = w / h;
	if (Math.abs(r - 16 / 9) < 0.02) return "16:9";
	if (Math.abs(r - 9 / 16) < 0.02) return "9:16";
	if (Math.abs(r - 1) < 0.02) return "1:1";
	if (Math.abs(r - 4 / 5) < 0.02) return "4:5";
	return `${w}×${h}`;
}

/** The projects overview: every project, newest first, with posters and quick actions. */
export function Welcome() {
	const recent = useApp((s) => s.recent);
	const projectsDir = appSettings.use((s) => s.settings?.projectsDir);
	const [projects, setProjects] = useState<ProjectSummary[] | null>(null);
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"recent" | "name">("recent");
	const [menu, setMenu] = useState<{ project: ProjectSummary; x: number; y: number } | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	const [command, setCommand] = useState("");

	const refresh = useCallback(() => void window.cue.listProjects().then(setProjects), []);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the recent list or folder changes
	useEffect(refresh, [recent, projectsDir]);
	useEffect(() => {
		window.addEventListener("focus", refresh);
		void window.cue.mcpCommand().then(setCommand);
		return () => window.removeEventListener("focus", refresh);
	}, [refresh]);

	const act = async (
		action: "reveal" | "forget" | "rename" | "duplicate" | "trash",
		p: ProjectSummary,
		arg?: string,
	) => {
		setMenu(null);
		try {
			await window.cue.projectAction(action, p.path, arg);
			if (action === "duplicate") notify("Duplicated", "success");
			refresh();
		} catch (error) {
			notify((error as Error).message, "danger");
		}
	};

	const q = query.trim().toLowerCase();
	const shown = (projects ?? [])
		.filter((p) => !q || p.name.toLowerCase().includes(q) || p.path.toLowerCase().includes(q))
		.sort((a, b) =>
			sort === "name"
				? a.name.localeCompare(b.name)
				: Date.parse(b.openedAt ?? b.modifiedAt) - Date.parse(a.openedAt ?? a.modifiedAt),
		);

	return (
		<div className="flex h-full flex-col bg-background">
			<header className="app-drag titlebar relative flex h-11 shrink-0 items-center gap-2 border-b border-separator bg-surface">
				<WindowDots />
				<Logo />
				<div className="flex-1" />
				<UpdateBadge />
				<button
					type="button"
					onClick={() => openSettings()}
					className="flex size-7 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					title={keyLabel("Settings (⌘,)")}
					aria-label="Settings"
				>
					<GearSix className="size-4" />
				</button>
				<Button
					size="sm"
					variant="secondary"
					className="h-7 gap-1.5 text-[12px]"
					onPress={() => void window.cue.openProject()}
				>
					<FolderOpen className="size-3.5" /> Open…
				</Button>
				<Button
					size="sm"
					className="h-7 gap-1.5 text-[12px] font-semibold"
					onPress={() => dialogs.set({ newProject: true })}
				>
					<Plus weight="bold" className="size-3.5" /> New Project
				</Button>
			</header>

			<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
				<div className="mx-auto max-w-6xl px-8 py-6">
					<div className="mb-5 flex items-center gap-3">
						<h1 className="text-[15px] font-semibold">Projects</h1>
						<span className="text-[12px] text-muted tabular">{projects ? shown.length : ""}</span>
						<div className="flex-1" />
						<label className="flex h-7 w-60 items-center gap-1.5 rounded-md border border-border bg-field px-2 focus-within:border-accent">
							<MagnifyingGlass className="size-3.5 text-muted" />
							<input
								value={query}
								onChange={(e) => setQuery(e.target.value)}
								onKeyDown={(e) => e.stopPropagation()}
								placeholder="Search projects"
								className="min-w-0 flex-1 bg-transparent text-[12px] outline-none"
							/>
						</label>
						<Segmented
							size="xs"
							value={sort}
							onChange={setSort}
							options={[
								{ value: "recent", label: "Recent" },
								{ value: "name", label: "Name" },
							]}
						/>
					</div>

					{projects && projects.length === 0 ? (
						<Empty />
					) : (
						<div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-5 gap-y-6">
							<NewCard />
							{shown.map((p) => (
								<Card
									key={p.path}
									project={p}
									renaming={renaming === p.path}
									onRename={(name) => {
										setRenaming(null);
										if (name && name !== p.name) void act("rename", p, name);
									}}
									onMenu={(x, y) => setMenu({ project: p, x, y })}
								/>
							))}
						</div>
					)}
					{projectsDir && (
						<p className="mt-8 text-[11px] text-muted">
							New projects go in{" "}
							<button
								type="button"
								className="underline-offset-2 hover:underline"
								onClick={() => void window.cue.reveal(projectsDir)}
							>
								{projectsDir.replace(/^\/Users\/[^/]+/, "~")}
							</button>
							. Cue also lists any project found there.
						</p>
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

			{menu && (
				<Menu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
					{menu.project.exists && (
						<>
							<MenuItem
								onClick={() => {
									setMenu(null);
									void run("open_project", { path: menu.project.path });
								}}
							>
								Open
							</MenuItem>
							<MenuItem
								onClick={() => {
									setMenu(null);
									setRenaming(menu.project.path);
								}}
							>
								Rename
							</MenuItem>
							<MenuItem onClick={() => void act("duplicate", menu.project)}>Duplicate</MenuItem>
							<MenuItem onClick={() => void act("reveal", menu.project)}>Show in Finder</MenuItem>
							<div className="my-1 h-px bg-separator" />
						</>
					)}
					{menu.project.openedAt && (
						<MenuItem onClick={() => void act("forget", menu.project)}>Remove from Recent</MenuItem>
					)}
					{menu.project.exists && (
						<MenuItem danger onClick={() => void act("trash", menu.project)}>
							Move to Trash…
						</MenuItem>
					)}
				</Menu>
			)}
		</div>
	);
}

function Card({
	project: p,
	renaming,
	onRename,
	onMenu,
}: {
	project: ProjectSummary;
	renaming: boolean;
	onRename: (name: string) => void;
	onMenu: (x: number, y: number) => void;
}) {
	const open = () => p.exists && !p.problem && void run("open_project", { path: p.path });
	const vertical = p.height > p.width;
	return (
		<div
			className={cn("group flex flex-col gap-2", !p.exists && "opacity-60")}
			onContextMenu={(e) => {
				e.preventDefault();
				onMenu(e.clientX, e.clientY);
			}}
		>
			<button
				type="button"
				onClick={open}
				title={p.path}
				className="relative flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-border bg-surface transition-colors hover:border-foreground/30 focus-visible:border-accent focus-visible:outline-none"
			>
				{p.posterUrl ? (
					<img
						src={p.posterUrl}
						alt=""
						draggable={false}
						className={cn("h-full", vertical ? "w-auto" : "w-full object-cover")}
					/>
				) : (
					<FilmSlate className="size-7 text-foreground/20" />
				)}
				{p.exists && p.durationMs > 0 && (
					<span className="absolute right-1.5 bottom-1.5 rounded bg-black/70 px-1.5 py-0.5 font-mono text-[10px] text-white tabular">
						{length(p.durationMs)}
					</span>
				)}
				{(!p.exists || p.problem) && (
					<span className="absolute inset-0 flex items-center justify-center gap-1.5 bg-background/70 text-[12px] text-warning">
						<Warning className="size-4" />{" "}
						{p.exists ? "Can't read this project" : "Moved or deleted"}
					</span>
				)}
			</button>
			<div className="flex items-start gap-1">
				<div className="min-w-0 flex-1">
					{renaming ? (
						<input
							// biome-ignore lint/a11y/noAutofocus: rename starts typing straight away, as in Finder
							autoFocus
							defaultValue={p.name}
							onFocus={(e) => e.target.select()}
							onBlur={(e) => onRename(e.target.value.trim())}
							onKeyDown={(e) => {
								e.stopPropagation();
								if (e.key === "Enter") (e.target as HTMLInputElement).blur();
								if (e.key === "Escape") onRename("");
							}}
							className="h-6 w-full rounded border border-accent bg-field px-1 text-[13px] font-medium outline-none"
						/>
					) : (
						<p className="truncate text-[13px] font-medium">{p.name}</p>
					)}
					<p className="truncate text-[11px] text-muted">
						{p.exists
							? [
									aspect(p.width, p.height),
									p.fps ? `${p.fps} fps` : "",
									ago(p.openedAt ?? p.modifiedAt),
								]
									.filter(Boolean)
									.join(" · ")
							: p.path.replace(/^\/Users\/[^/]+/, "~")}
					</p>
				</div>
				<button
					type="button"
					aria-label={`Actions for ${p.name}`}
					onClick={(e) => {
						const r = e.currentTarget.getBoundingClientRect();
						onMenu(r.left, r.bottom + 4);
					}}
					className="flex size-6 shrink-0 items-center justify-center rounded text-muted opacity-0 group-hover:opacity-100 hover:bg-default hover:text-foreground focus-visible:opacity-100"
				>
					<DotsThree weight="bold" className="size-4" />
				</button>
			</div>
		</div>
	);
}

function NewCard() {
	return (
		<div className="flex flex-col gap-2">
			<button
				type="button"
				onClick={() => dialogs.set({ newProject: true })}
				className="flex aspect-video flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-border text-muted transition-colors hover:border-foreground/40 hover:text-foreground"
			>
				<Plus className="size-5" />
				<span className="text-[12px]">New project</span>
			</button>
		</div>
	);
}

function Empty() {
	return (
		<div className="flex flex-col items-start gap-3 rounded-lg border border-dashed border-border p-8">
			<FilmSlate className="size-6 text-muted" />
			<p className="text-[13px]">No projects yet. Start from a video, or from an empty timeline.</p>
			<Button
				size="sm"
				className="h-7 text-[12px]"
				onPress={() => dialogs.set({ newProject: true })}
			>
				New Project
			</Button>
		</div>
	);
}

function Menu({
	x,
	y,
	onClose,
	children,
}: {
	x: number;
	y: number;
	onClose: () => void;
	children: ReactNode;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const [pos, setPos] = useState({ x, y });
	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const r = el.getBoundingClientRect();
		setPos({
			x: Math.min(x, window.innerWidth - r.width - 8),
			y: y + r.height > window.innerHeight - 8 ? Math.max(8, y - r.height) : y,
		});
	}, [x, y]);
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);
	return (
		<div
			className="fixed inset-0 z-[120]"
			onPointerDown={onClose}
			onContextMenu={(e) => {
				e.preventDefault();
				onClose();
			}}
		>
			<div
				ref={ref}
				role="menu"
				style={{ left: pos.x, top: pos.y }}
				onPointerDown={(e) => e.stopPropagation()}
				className="fixed min-w-[180px] rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/40"
			>
				{children}
			</div>
		</div>
	);
}

function MenuItem({
	children,
	onClick,
	danger,
}: {
	children: ReactNode;
	onClick: () => void;
	danger?: boolean;
}) {
	return (
		<button
			type="button"
			role="menuitem"
			onClick={onClick}
			className={cn(
				"flex h-7 w-full items-center rounded-md px-2.5 text-left text-[13px] hover:bg-default",
				danger && "text-danger",
			)}
		>
			{children}
		</button>
	);
}

export function Logo() {
	return (
		<div className="flex items-center gap-1.5">
			<svg viewBox="0 0 20 20" className="size-[18px]" aria-hidden="true">
				<rect width="20" height="20" rx="5" fill="currentColor" />
				<path
					d="M6.5 7v6M10 5v10M13.5 8v4"
					stroke="var(--surface)"
					strokeWidth="2"
					strokeLinecap="round"
				/>
			</svg>
			<span className="text-[13px] font-semibold tracking-tight">Cue</span>
		</div>
	);
}
