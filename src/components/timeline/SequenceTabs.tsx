import { GitBranch, Plus, X } from "@phosphor-icons/react";
import { useCallback, useEffect, useState } from "react";
import type { ProjectSnapshot } from "../../../electron/core/types";
import { run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { cn, nameFieldKeys } from "../../lib/utils";
import { sequenceCompare } from "../../lib/workspace";

/** "Main · alt 2" is an alternative of "Main". */
const isBranch = (name: string) => / · alt \d+$/.test(name);

function typing(target: EventTarget | null) {
	const el = target as HTMLElement | null;
	return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
}

/** Timelines in the project as tabs, like Premiere's sequence tabs. */
export function SequenceTabs({ project }: { project: ProjectSnapshot }) {
	const open = project.data.sequence ?? { id: "main", name: "Main" };
	const others = project.data.sequences ?? [];
	const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);
	const [renaming, setRenaming] = useState<string | null>(null);
	// A/B compare lives in the editor only: the two sequences being compared.
	const compare = sequenceCompare.use((c) => c.pair);
	const setCompare = (pair: [string, string] | null) => sequenceCompare.set({ pair });
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
	const ids = all.map((q) => q.id).join("|");
	// A compared sequence that was deleted ends the comparison.
	useEffect(() => {
		if (compare && !compare.every((id) => ids.split("|").includes(id))) setCompare(null);
	}, [compare, ids]);
	const flip = useCallback(async () => {
		if (!compare) return;
		const current = project.data.sequence?.id ?? "main";
		const target = compare[0] === current ? compare[1] : compare[0];
		// Same moment in the other version, so the difference is what you see and hear.
		const at = playback.currentMs;
		await run("open_sequence", { id: target });
		playback.seek(at);
	}, [compare, project.data.sequence?.id]);
	useEffect(() => {
		if (!compare) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.code !== "Backquote" || e.metaKey || e.ctrlKey || e.altKey || typing(e.target)) return;
			e.preventDefault();
			void flip();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [compare, flip]);
	const nameOf = (id: string) => all.find((q) => q.id === id)?.name ?? id;
	// The open sequence can go too: its neighbour opens first. Undo brings it back.
	const remove = async (id: string) => {
		if (all.length < 2) return;
		if (id === open.id) {
			const i = all.findIndex((q) => q.id === id);
			const next = all[i + 1] ?? all[i - 1];
			await run("open_sequence", { id: next.id });
		}
		await run("delete_sequence", { id });
	};
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
							"group flex h-7 max-w-[200px] items-center gap-1 rounded-t-md border border-b-0 pr-1 pl-2.5 text-[12px]",
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
						{all.length > 1 && renaming !== q.id && (
							<button
								type="button"
								onClick={() => void remove(q.id)}
								title={
									nested
										? "Nested in another sequence: delete those clips first"
										: `Delete ${q.name}`
								}
								aria-label={`Delete ${q.name}`}
								className={cn(
									"flex size-4 shrink-0 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground",
									active
										? "opacity-60"
										: "opacity-0 group-hover:opacity-60 focus-visible:opacity-100",
								)}
							>
								<X className="size-2.5" />
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
			<button
				type="button"
				onClick={() => void run("branch_sequence", {})}
				title="Branch: try an alternative cut in a copy, keeping the original"
				aria-label="Branch sequence"
				className="mb-0.5 flex size-6 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
			>
				<GitBranch className="size-3.5" />
			</button>
			{compare && (
				<div className="mb-0.5 ml-auto flex h-6 items-center gap-1 text-[11px]">
					{compare.map((id, i) => (
						<span
							key={id}
							className={cn(
								"max-w-[140px] truncate rounded px-1.5 py-0.5",
								id === open.id ? "bg-accent text-accent-foreground" : "text-muted",
							)}
							title={id === open.id ? `${nameOf(id)} (live)` : nameOf(id)}
						>
							{i === 0 ? "A" : "B"}: {nameOf(id)}
						</span>
					))}
					<button
						type="button"
						onClick={() => void flip()}
						title="Flip between the two versions at the same moment (`)"
						className="rounded border border-separator px-1.5 py-0.5 font-medium hover:bg-default"
					>
						A/B
					</button>
					<button
						type="button"
						onClick={() => setCompare(null)}
						title="Stop comparing"
						aria-label="Stop comparing"
						className="flex size-5 items-center justify-center rounded text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-3" />
					</button>
				</div>
			)}
			{menu && (
				<div
					className="fixed z-[120] min-w-[160px] rounded-lg border border-border bg-overlay p-1 text-[12px] shadow-xl shadow-black/40"
					style={{ left: menu.x, top: menu.y }}
					onPointerDown={(e) => e.stopPropagation()}
				>
					{[
						{ label: "Rename", action: () => setRenaming(menu.id) },
						{ label: "Duplicate", action: () => void run("duplicate_sequence", { id: menu.id }) },
						{
							label: "Branch (try an alternative)",
							action: () => void run("branch_sequence", { from: menu.id }),
						},
						...(menu.id !== open.id
							? [
									{
										label: "A/B compare with this",
										action: () => setCompare([open.id, menu.id]),
									},
								]
							: []),
						...(isBranch(all.find((q) => q.id === menu.id)?.name ?? "")
							? [
									{
										label: "Use this version",
										action: () => void run("promote_branch", { id: menu.id }),
									},
								]
							: []),
						...(all.length > 1
							? [
									{
										label: "Delete",
										action: () => void remove(menu.id),
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
