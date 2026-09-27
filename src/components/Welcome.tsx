import { Button } from "@heroui/react";
import {
	Copy,
	DotsThree,
	FilmSlate,
	Folder,
	FolderOpen,
	FolderSimpleDashed,
	GearSix,
	MagnifyingGlass,
	Plus,
	SquaresFour,
	Warning,
} from "@phosphor-icons/react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Collection } from "../../electron/core/collections";
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
	const [collections, setCollections] = useState<Collection[]>([]);
	/** The collection shown: "all", "loose" (in no collection) or a collection id. */
	const [place, setPlace] = useState<string>("all");
	const [folderMenu, setFolderMenu] = useState<{
		collection: Collection;
		x: number;
		y: number;
	} | null>(null);
	const [naming, setNaming] = useState<string | null>(null);

	const refresh = useCallback(() => {
		void window.cue.listProjects().then(setProjects);
		void window.cue
			.call<Collection[]>("list_collections")
			.then(setCollections)
			.catch(() => {});
	}, []);
	const file = async (paths: string[], collectionId: string | null) => {
		setMenu(null);
		await run("move_to_collection", { projects: paths, collectionId });
		refresh();
	};
	const newCollection = async (paths: string[] = []) => {
		setMenu(null);
		const made = await run<Collection>("create_collection", {
			name: "New collection",
			projects: paths,
		});
		if (!made) return;
		refresh();
		setPlace(made.id);
		setNaming(made.id);
	};
	const collectionsVersion = useApp((s) => s.collectionsVersion);
	// biome-ignore lint/correctness/useExhaustiveDependencies: reload when the recent list, folder or collections change
	useEffect(refresh, [recent, projectsDir, collectionsVersion]);
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
	// Searching looks in every collection.
	const inPlace = (p: ProjectSummary) =>
		q || place === "all" ? true : place === "loose" ? !p.collectionId : p.collectionId === place;
	const current = collections.find((c) => c.id === place);
	if (place !== "all" && place !== "loose" && !current && collections.length) setPlace("all");
	const shown = (projects ?? [])
		.filter(inPlace)
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

			<div className="flex min-h-0 flex-1">
				<nav
					aria-label="Collections"
					className="custom-scrollbar flex w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-separator bg-surface px-2 py-4"
				>
					<Place
						icon={<SquaresFour className="size-4" />}
						label="All projects"
						count={projects?.length}
						active={place === "all"}
						onClick={() => setPlace("all")}
					/>
					<Place
						icon={<FolderSimpleDashed className="size-4" />}
						label="Not in a collection"
						count={projects?.filter((p) => !p.collectionId).length}
						active={place === "loose"}
						onClick={() => setPlace("loose")}
						onDropProjects={(paths) => void file(paths, null)}
					/>
					<div className="mt-4 mb-1 flex items-center justify-between px-2">
						<span className="text-[11px] font-medium text-muted">Collections</span>
						<button
							type="button"
							aria-label="New collection"
							title="New collection"
							onClick={() => void newCollection()}
							className="flex size-5 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
						>
							<Plus className="size-3.5" />
						</button>
					</div>
					{collections.map((c) => (
						<Place
							key={c.id}
							icon={<Folder className="size-4" />}
							label={c.name}
							count={projects?.filter((p) => p.collectionId === c.id).length}
							active={place === c.id}
							naming={naming === c.id}
							onName={(name) => {
								setNaming(null);
								if (name && name !== c.name)
									void run("rename_collection", { id: c.id, name }).then(refresh);
							}}
							onClick={() => setPlace(c.id)}
							onMenu={(x, y) => setFolderMenu({ collection: c, x, y })}
							onDropProjects={(paths) => void file(paths, c.id)}
						/>
					))}
					{collections.length === 0 && (
						<p className="px-2 text-[11px] leading-relaxed text-muted">
							Group the projects of one video (the edit, its graphics, other versions): make a
							collection, then drag projects onto it.
						</p>
					)}
				</nav>
				<main className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
					<div className="mx-auto max-w-6xl px-8 py-6">
						<div className="mb-5 flex items-center gap-3">
							<h1 className="truncate text-[15px] font-semibold">
								{q
									? "Search"
									: place === "all"
										? "Projects"
										: place === "loose"
											? "Not in a collection"
											: (current?.name ?? "Projects")}
							</h1>
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
			</div>

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
							<p className="px-2.5 pt-1 pb-0.5 text-[11px] text-muted">Move to collection</p>
							{collections
								.filter((c) => c.id !== menu.project.collectionId)
								.map((c) => (
									<MenuItem key={c.id} onClick={() => void file([menu.project.path], c.id)}>
										{c.name}
									</MenuItem>
								))}
							<MenuItem onClick={() => void newCollection([menu.project.path])}>
								New collection…
							</MenuItem>
							{menu.project.collectionId && (
								<MenuItem onClick={() => void file([menu.project.path], null)}>
									Remove from collection
								</MenuItem>
							)}
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
			{folderMenu && (
				<Menu x={folderMenu.x} y={folderMenu.y} onClose={() => setFolderMenu(null)}>
					<MenuItem
						onClick={() => {
							setNaming(folderMenu.collection.id);
							setFolderMenu(null);
						}}
					>
						Rename
					</MenuItem>
					<MenuItem
						danger
						onClick={() => {
							const c = folderMenu.collection;
							setFolderMenu(null);
							if (place === c.id) setPlace("all");
							void run("delete_collection", { id: c.id }).then(refresh);
						}}
					>
						Delete collection
					</MenuItem>
					<p className="max-w-[220px] px-2.5 py-1 text-[11px] leading-snug text-muted">
						Its projects are kept; they go back to “Not in a collection”.
					</p>
				</Menu>
			)}
		</div>
	);
}

/** A place in the collections sidebar; projects dropped on it are filed there. */
function Place({
	icon,
	label,
	count,
	active,
	naming,
	onName,
	onClick,
	onMenu,
	onDropProjects,
}: {
	icon: ReactNode;
	label: string;
	count?: number;
	active: boolean;
	naming?: boolean;
	onName?: (name: string) => void;
	onClick: () => void;
	onMenu?: (x: number, y: number) => void;
	onDropProjects?: (paths: string[]) => void;
}) {
	const [over, setOver] = useState(false);
	if (naming)
		return (
			<input
				// biome-ignore lint/a11y/noAutofocus: naming starts typing straight away, as in Finder
				autoFocus
				defaultValue={label}
				onFocus={(e) => e.target.select()}
				onBlur={(e) => onName?.(e.target.value.trim())}
				onKeyDown={(e) => {
					e.stopPropagation();
					if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					if (e.key === "Escape") onName?.("");
				}}
				className="h-7 w-full rounded-md border border-accent bg-field px-2 text-[13px] outline-none"
			/>
		);
	return (
		<button
			type="button"
			onClick={onClick}
			onContextMenu={(e) => {
				if (!onMenu) return;
				e.preventDefault();
				onMenu(e.clientX, e.clientY);
			}}
			onDragOver={(e) => {
				if (!onDropProjects || !e.dataTransfer.types.includes(PROJECT_DRAG)) return;
				e.preventDefault();
				e.dataTransfer.dropEffect = "move";
				setOver(true);
			}}
			onDragLeave={() => setOver(false)}
			onDrop={(e) => {
				setOver(false);
				const paths = e.dataTransfer.getData(PROJECT_DRAG);
				if (onDropProjects && paths) {
					e.preventDefault();
					onDropProjects(JSON.parse(paths) as string[]);
				}
			}}
			className={cn(
				"group flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors",
				active ? "bg-default text-foreground" : "text-foreground/80 hover:bg-default/60",
				over && "bg-accent/20 ring-1 ring-accent",
			)}
		>
			<span className={cn("shrink-0", active ? "text-foreground" : "text-muted")}>{icon}</span>
			<span className="min-w-0 flex-1 truncate">{label}</span>
			{count !== undefined && <span className="text-[11px] text-muted tabular">{count}</span>}
		</button>
	);
}

/** Drag data type for projects dragged from a card to a collection. */
const PROJECT_DRAG = "application/x-cue-projects";

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
			draggable={!renaming}
			onDragStart={(e) => {
				e.dataTransfer.setData(PROJECT_DRAG, JSON.stringify([p.path]));
				e.dataTransfer.effectAllowed = "move";
			}}
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
