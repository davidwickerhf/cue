import {
	ArrowCounterClockwise,
	ArrowClockwise,
	ClockCounterClockwise,
	Gear,
	Robot,
	User,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { HistoryEntry } from "../../../electron/core/history";
import { notify, run } from "../../lib/api";
import { useProject } from "../../lib/state";
import { cn } from "../../lib/utils";

const day = (iso: string) => {
	const d = new Date(iso);
	const today = new Date();
	const yesterday = new Date(Date.now() - 86400000);
	if (d.toDateString() === today.toDateString()) return "Today";
	if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
	return d.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" });
};

const ICON = { user: User, agent: Robot, system: Gear } as const;

/** Every change ever made to the project, by you or an agent; click one to go back to it. */
export function HistoryPanel() {
	const project = useProject();
	const revision = project?.revision;
	const [entries, setEntries] = useState<HistoryEntry[]>([]);
	const [filter, setFilter] = useState<"all" | "user" | "agent">("all");
	const [more, setMore] = useState(true);

	// biome-ignore lint/correctness/useExhaustiveDependencies: refetch whenever the project changes
	useEffect(() => {
		void run<HistoryEntry[]>("get_history", { limit: 300 }).then((list) => {
			if (!list) return;
			setEntries(list);
			setMore(list.length === 300);
		});
	}, [revision, project?.path]);

	const loadMore = async () => {
		const before = entries.at(-1)?.n;
		const list = await run<HistoryEntry[]>("get_history", { limit: 300, before });
		if (list) {
			setEntries([...entries, ...list]);
			setMore(list.length === 300);
		}
	};

	const shown = entries.filter((e) => filter === "all" || e.actor === filter);
	const current = entries[0]?.n;
	let lastDay = "";
	return (
		<div className="flex flex-col">
			<div className="flex items-center gap-1 border-b border-separator px-4 py-2">
				{(["all", "user", "agent"] as const).map((f) => (
					<button
						key={f}
						type="button"
						onClick={() => setFilter(f)}
						className={cn(
							"h-6 rounded-md px-2 text-[11px]",
							filter === f ? "bg-default text-foreground" : "text-muted hover:text-foreground",
						)}
					>
						{f === "all" ? "Everything" : f === "user" ? "You" : "Agents"}
					</button>
				))}
			</div>
			{shown.length === 0 ? (
				<p className="flex items-center gap-2 p-4 text-[12px] text-muted">
					<ClockCounterClockwise className="size-4" /> Changes to the project appear here and are
					kept between sessions.
				</p>
			) : (
				<ol className="flex flex-col px-2 py-2">
					{shown.map((e) => {
						const heading = day(e.at);
						const showDay = heading !== lastDay;
						lastDay = heading;
						const Icon =
							e.kind === "undo"
								? ArrowCounterClockwise
								: e.kind === "redo"
									? ArrowClockwise
									: ICON[e.actor];
						return (
							<li key={e.n}>
								{showDay && (
									<p className="px-2 pt-3 pb-1 text-[11px] font-medium text-muted">{heading}</p>
								)}
								<button
									type="button"
									disabled={e.n === current}
									onClick={async () => {
										const r = await run<{ summary: string }>("restore_history", { n: e.n });
										if (r) notify("Restored. ⌘Z to go back.", "success");
									}}
									title={e.n === current ? "Where the project is now" : "Go back to this point"}
									className={cn(
										"group flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left",
										e.n === current ? "bg-accent/10" : "hover:bg-default/60",
									)}
								>
									<Icon
										weight={e.actor === "agent" ? "fill" : "regular"}
										className={cn(
											"mt-0.5 size-3.5 shrink-0",
											e.actor === "agent" ? "text-violet-400" : "text-muted",
										)}
									/>
									<span className="min-w-0 flex-1">
										<span
											className={cn(
												"block text-[12px] leading-snug",
												e.kind === "restore" && "italic",
											)}
										>
											{e.summary}
										</span>
										<span className="block text-[10px] text-muted tabular">
											{new Date(e.at).toLocaleTimeString([], {
												hour: "2-digit",
												minute: "2-digit",
											})}
											{e.sequence && e.sequence !== "Main" ? ` · ${e.sequence}` : ""} · #{e.n}
										</span>
									</span>
									{e.n === current ? (
										<span className="text-[10px] text-accent">Now</span>
									) : (
										<span className="text-[10px] text-muted opacity-0 group-hover:opacity-100">
											Go back
										</span>
									)}
								</button>
							</li>
						);
					})}
					{more && (
						<button
							type="button"
							onClick={() => void loadMore()}
							className="mt-2 h-7 rounded-md text-[12px] text-muted hover:bg-default hover:text-foreground"
						>
							Older changes
						</button>
					)}
				</ol>
			)}
		</div>
	);
}
