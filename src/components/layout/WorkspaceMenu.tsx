import { Check, Layout as LayoutIcon, Trash } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import {
	applyWorkspace,
	BUILT_IN,
	deleteWorkspace,
	type Layout,
	layout,
	saveWorkspace,
	savedWorkspaces,
} from "../../lib/workspace";

const same = (a: Layout, b: Layout) => JSON.stringify(a) === JSON.stringify(b);

/** Switch between window layouts, or save the current one under a name. */
export function WorkspaceMenu() {
	const [open, setOpen] = useState(false);
	const [name, setName] = useState("");
	const current = layout.use((s) => s);
	const saved = savedWorkspaces.use((s) => s.list);
	const ref = useRef<HTMLDivElement>(null);
	useEffect(() => {
		if (!open) return;
		const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
		const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
		window.addEventListener("pointerdown", close);
		window.addEventListener("keydown", onKey);
		return () => {
			window.removeEventListener("pointerdown", close);
			window.removeEventListener("keydown", onKey);
		};
	}, [open]);
	const item =
		"flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[12px] hover:bg-default";
	return (
		<div ref={ref} className="relative">
			<button
				type="button"
				onClick={() => setOpen(!open)}
				title="Workspace"
				aria-label="Workspace"
				className="flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-default hover:text-foreground"
			>
				<LayoutIcon className="size-4" />
			</button>
			{open && (
				<div className="absolute top-9 right-0 z-[120] w-60 rounded-lg border border-border bg-overlay p-1 shadow-xl shadow-black/40">
					<p className="px-2 pt-1 pb-1 text-[11px] text-muted">Workspaces</p>
					{Object.entries(BUILT_IN).map(([id, w]) => (
						<button
							key={id}
							type="button"
							className={item}
							onClick={() => (applyWorkspace(w.layout), setOpen(false))}
						>
							<span className="w-3.5">
								{same(current, w.layout) && <Check className="size-3.5" />}
							</span>
							{w.label}
						</button>
					))}
					{Object.keys(saved).length > 0 && <div className="my-1 h-px bg-separator" />}
					{Object.entries(saved).map(([n, l]) => (
						<div key={n} className="group flex items-center">
							<button
								type="button"
								className={cn(item, "flex-1")}
								onClick={() => (applyWorkspace(l), setOpen(false))}
							>
								<span className="w-3.5">{same(current, l) && <Check className="size-3.5" />}</span>
								<span className="truncate">{n}</span>
							</button>
							<button
								type="button"
								aria-label={`Delete ${n}`}
								onClick={() => deleteWorkspace(n)}
								className="mr-1 hidden size-6 items-center justify-center rounded text-muted group-hover:flex hover:text-danger"
							>
								<Trash className="size-3.5" />
							</button>
						</div>
					))}
					<div className="my-1 h-px bg-separator" />
					<form
						className="flex gap-1 p-1"
						onSubmit={(e) => {
							e.preventDefault();
							if (!name.trim()) return;
							saveWorkspace(name.trim());
							setName("");
						}}
					>
						<input
							value={name}
							onChange={(e) => setName(e.target.value)}
							onKeyDown={(e) => e.stopPropagation()}
							placeholder="Save current as…"
							className="h-7 min-w-0 flex-1 rounded-md border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
						/>
						<button
							type="submit"
							disabled={!name.trim()}
							className="h-7 rounded-md bg-accent px-2 text-[12px] text-accent-foreground disabled:opacity-40"
						>
							Save
						</button>
					</form>
				</div>
			)}
		</div>
	);
}
