import { Plus, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { cn, nameFieldKeys } from "../../lib/utils";

/** Timelines in the project as tabs, like Premiere's sequence tabs. */
export function SequenceTabs({ project }: { project: ProjectSnapshot }) {
	const open = project.data.sequence ?? { id: "main", name: "Main" };
	const others = project.data.sequences ?? [];
	const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	useEffect(() => {
		if (!menu) return;
		const close = () => setMenu(null);
		window.addEventListener("pointerdown", close);
		return () => window.removeEventListener("pointerdown", close);
	}, [menu]);
	// Tabs keep a stable order: Main first, then by creation.
	const all = [open, ...others].sort((a, b) =>
		a.id === "main" ? -1 : b.id === "main" ? 1 : a.id.localeCompare(b.id),
	);
	return (
		<div className="flex h-8 shrink-0 items-end gap-0.5 border-b border-separator bg-background px-2">
			{all.map((q) => {
				const active = q.id === open.id;
				const nested = project.data.assets.some((a) => a.sequenceId === q.id);
				return (
					<div
						key={q.id}
						onContextMenu={(e) => {
							e.preventDefault();
							setMenu({ id: q.id, x: e.clientX, y: e.clientY });
						}}
						className={cn(
							"flex h-7 max-w-[200px] items-center rounded-t-md border border-b-0 px-2.5 text-[12px]",
							active
								? "border-separator bg-surface text-foreground"
								: "border-transparent text-muted hover:text-foreground",
						)}
					>
						{renaming === q.id ? (
							<input
								// biome-ignore lint/a11y/noAutofocus: renaming starts typing straight away
								autoFocus
								defaultValue={q.name}
								onFocus={(e) => e.target.select()}
								onBlur={(e) => {
									setRenaming(null);
									const name = e.target.value.trim();
									if (name && name !== q.name) void run("rename_sequence", { id: q.id, name });
								}}
								onKeyDown={nameFieldKeys(q.name)}
								className="w-28 rounded bg-field px-1 outline-none"
							/>
						) : (
							<button
								type="button"
								onClick={() => !active && void run("open_sequence", { id: q.id })}
								onDoubleClick={() => setRenaming(q.id)}
								title={nested ? `${q.name} (nested in another sequence)` : q.name}
								className="truncate"
							>
								{q.name}
								{nested && <span className="ml-1 text-[10px] text-muted">nested</span>}
							</button>
						)}
					</div>
				);
			})}
			<button
				type="button"
				onClick={() => void run("new_sequence", { name: `Sequence ${all.length + 1}` })}
				title="New sequence"
				aria-label="New sequence"
				className="mb-0.5 flex size-6 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
			>
				<Plus className="size-3.5" />
			</button>
			{menu && (
				<div
					className="fixed z-[120] min-w-[160px] rounded-lg border border-border bg-overlay p-1 text-[12px] shadow-xl shadow-black/40"
					style={{ left: menu.x, top: menu.y }}
					onPointerDown={(e) => e.stopPropagation()}
				>
					{[
						{ label: "Rename", action: () => setRenaming(menu.id) },
						{ label: "Duplicate", action: () => void run("duplicate_sequence", { id: menu.id }) },
						...(menu.id !== open.id
							? [
									{
										label: "Delete",
										action: () => void run("delete_sequence", { id: menu.id }),
										danger: true,
									},
								]
							: []),
					].map((item) => (
						<button
							key={item.label}
							type="button"
							onClick={() => {
								item.action();
								setMenu(null);
							}}
							className={cn(
								"flex h-7 w-full items-center gap-2 rounded-md px-2 text-left hover:bg-default",
								"danger" in item && "text-danger",
							)}
						>
							{"danger" in item && <X className="size-3" />}
							{item.label}
						</button>
					))}
				</div>
			)}
		</div>
	);
}
