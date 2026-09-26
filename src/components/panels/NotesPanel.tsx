import { Button } from "@heroui/react";
import {
	ArrowClockwise,
	CheckCircle,
	Lightbulb,
	SpeakerHigh,
	Warning,
	WarningOctagon,
} from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { Note, NoteSeverity } from "../../../electron/core/notes";
import { notify, run } from "../../lib/api";
import { clearNotes, notes, refreshNotes } from "../../lib/notes";
import { playback } from "../../lib/playback";
import { useProject } from "../../lib/state";
import { cn, formatTime } from "../../lib/utils";
import { MarkerList } from "../layout/Inspector";

const GROUPS: { severity: NoteSeverity; title: string; icon: typeof Warning; tone: string }[] = [
	{ severity: "problem", title: "Problems", icon: WarningOctagon, tone: "text-danger" },
	{ severity: "warning", title: "Worth fixing", icon: Warning, tone: "text-warning" },
	{ severity: "tip", title: "Ideas", icon: Lightbulb, tone: "text-accent" },
];

/**
 * Director's notes: what an editor would point out on a first watch, checked
 * on this Mac after every edit. Click a note to go there; Fix applies it.
 */
export function NotesPanel() {
	const project = useProject();
	const revision = project?.revision;
	const list = notes.use((s) => s.list);
	const loading = notes.use((s) => s.loading);
	const measured = notes.use((s) => s.measured);
	const [fixing, setFixing] = useState<string | null>(null);

	// Review again after every edit (it's cheap: it only reads the project).
	// biome-ignore lint/correctness/useExhaustiveDependencies: runs when the project changes
	useEffect(() => {
		const timer = setTimeout(() => void refreshNotes(), 250);
		return () => clearTimeout(timer);
	}, [revision, project?.path]);
	// The ruler shows notes only while this pane is open.
	useEffect(() => clearNotes, []);

	if (!project) return null;

	const jump = (note: Note) => {
		playback.seek(note.atMs);
		if (note.clipId && project.data.clips.some((c) => c.id === note.clipId))
			window.cue.selectClips([note.clipId]);
	};
	const fix = async (note: Note) => {
		if (!note.fix) return;
		setFixing(note.id);
		const result = await run(note.fix.tool, note.fix.params);
		setFixing(null);
		if (result !== undefined) notify(`${note.fix.label}: done. ⌘Z to undo.`, "success");
		await refreshNotes(measured);
	};

	return (
		<div className="flex flex-col">
			<div className="flex items-center justify-between gap-2 border-b border-separator px-4 py-2">
				<span className="text-[11px] text-muted">
					{loading
						? "Reviewing…"
						: list.length === 0
							? "Nothing to note"
							: `${list.length} note${list.length === 1 ? "" : "s"}`}
				</span>
				<div className="flex items-center gap-1">
					<Button
						size="sm"
						variant="ghost"
						className="h-6 gap-1 text-[11px]"
						isDisabled={loading}
						onPress={() => void refreshNotes(true)}
					>
						<SpeakerHigh className="size-3.5" /> Check loudness
					</Button>
					<Button
						size="sm"
						variant="ghost"
						isIconOnly
						aria-label="Refresh"
						className="size-6 min-w-6"
						isDisabled={loading}
						onPress={() => void refreshNotes(measured)}
					>
						<ArrowClockwise className={cn("size-3.5", loading && "animate-spin")} />
					</Button>
				</div>
			</div>
			{list.length === 0 && !loading ? (
				<p className="flex items-center gap-2 p-4 text-[12px] text-muted">
					<CheckCircle className="size-4 text-success" /> No flash frames, jump cuts, rushed titles
					or abrupt music found.
				</p>
			) : (
				GROUPS.map(({ severity, title, icon: Icon, tone }) => {
					const group = list.filter((n) => n.severity === severity);
					if (group.length === 0) return null;
					return (
						<section key={severity} className="px-2 pt-3 pb-1">
							<h3 className="flex items-center gap-1.5 px-2 pb-1 text-[11px] font-medium text-muted">
								<Icon weight="fill" className={cn("size-3.5", tone)} />
								{title} · {group.length}
							</h3>
							<ul className="flex flex-col">
								{group.map((n) => (
									<li
										key={n.id}
										className="group flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-default/60"
									>
										<button
											type="button"
											onClick={() => jump(n)}
											title="Go there"
											className="flex min-w-0 flex-1 items-start gap-2 text-left"
										>
											<span className="mt-px w-10 shrink-0 text-[11px] text-muted tabular">
												{formatTime(n.atMs, false)}
											</span>
											<span className="min-w-0 flex-1 text-[12px] leading-snug">{n.message}</span>
										</button>
										{n.fix && (
											<Button
												size="sm"
												variant="secondary"
												className="h-6 shrink-0 px-2 text-[11px]"
												isDisabled={fixing !== null}
												onPress={() => void fix(n)}
											>
												{fixing === n.id ? "Fixing…" : n.fix.label}
											</Button>
										)}
									</li>
								))}
							</ul>
						</section>
					);
				})
			)}
			<div className="mt-2 border-t border-separator">
				<MarkerList markers={project.data.markers} />
			</div>
		</div>
	);
}
