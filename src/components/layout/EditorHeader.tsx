import { Button, Dropdown, Spinner } from "@heroui/react";
import { ArrowClockwise, ArrowCounterClockwise, CaretLeft, SidebarSimple } from "@phosphor-icons/react";
import { notify, run } from "../../lib/api";
import { editor, useApp, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { IconButton } from "../ui/controls";

export function EditorHeader() {
	const project = useProject();
	const agent = useApp((s) => s.agent);
	const jobs = useApp((s) => s.jobs) ?? [];
	const inspectorOpen = editor.use((s) => s.inspectorOpen);
	const running = jobs.find((j) => j.state === "running");
	const failed = jobs.find((j) => j.state === "failed");
	if (!project) return null;
	const agentActive = !!agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 5 * 60 * 1000;

	const exportAs = async (kind: "video" | "voiceover" | "stems" | "audio") => {
		notify(`Exporting ${kind}…`);
		const report = await run<{ outputs: string[]; missing: string[] }>("export", { kind });
		if (!report) return;
		notify(`Exported ${kind}${report.missing.length ? `. No take yet for ${report.missing.join(", ")}` : ""}`, "success");
		if (report.outputs[0]) void window.cue.reveal(report.outputs[0]);
	};

	return (
		<header className="app-drag relative z-50 flex h-11 shrink-0 items-center border-b border-separator bg-surface pr-3 pl-[84px]">
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<button
					type="button"
					onClick={() => void run("list_recent_projects").then(() => window.cue.openProject())}
					className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-default hover:text-foreground"
					title="Open another project"
				>
					<CaretLeft className="size-3.5" /> Projects
				</button>
			</div>

			<div className="absolute left-1/2 flex max-w-[40%] -translate-x-1/2 items-center gap-2">
				<input
					key={project.data.name}
					defaultValue={project.data.name}
					size={Math.max(8, project.data.name.length)}
					onBlur={(e) => {
						const name = e.target.value.trim();
						if (name && name !== project.data.name) void run("rename_project", { name });
					}}
					onKeyDown={(e) => {
						e.stopPropagation();
						if (e.key === "Enter") (e.target as HTMLInputElement).blur();
					}}
					className="h-7 min-w-0 truncate rounded-md bg-transparent px-1.5 text-center text-[13px] font-semibold outline-none hover:bg-default/60 focus:bg-default"
					aria-label="Project name"
				/>
				{project.dirty && <span className="text-[11px] text-muted">Saving…</span>}
			</div>

			<div className="flex flex-1 items-center justify-end gap-1">
				{running ? (
					<span className="mr-2 flex max-w-[280px] items-center gap-2 truncate text-[12px] text-muted">
						<Spinner size="sm" />
						{running.label}
						{running.progress !== null && ` ${Math.round((running.progress ?? 0) * 100)}%`}
					</span>
				) : failed ? (
					<span className="mr-2 max-w-[320px] truncate text-[12px] text-danger" title={failed.message}>
						{failed.label} failed
					</span>
				) : null}
				<button
					type="button"
					onClick={() => editor.set({ panel: "agent" })}
					className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-default hover:text-foreground"
					title={agentActive ? "An agent is connected" : "Connect an agent"}
				>
					<span className={cn("size-1.5 rounded-full", agentActive ? "bg-success" : "bg-foreground/25")} />
					Agent
				</button>
				<IconButton label="Undo" shortcut="⌘Z" disabled={!project.canUndo} onPress={() => void run("undo")}>
					<ArrowCounterClockwise className="size-4" />
				</IconButton>
				<IconButton label="Redo" shortcut="⇧⌘Z" disabled={!project.canRedo} onPress={() => void run("redo")}>
					<ArrowClockwise className="size-4" />
				</IconButton>
				<IconButton label={inspectorOpen ? "Hide inspector" : "Show inspector"} active={inspectorOpen} onPress={() => editor.set({ inspectorOpen: !inspectorOpen })}>
					<SidebarSimple className="size-4 -scale-x-100" />
				</IconButton>
				<Dropdown>
					<Button size="sm" className="ml-1.5 h-7 px-3 text-[12px] font-semibold">
						Export
					</Button>
					<Dropdown.Popover placement="bottom end" className="min-w-[240px]">
						<Dropdown.Menu aria-label="Export" onAction={(key) => void exportAs(key as "video")}>
							<Dropdown.Item id="video" textValue="Video">
								<ExportItem title="Video" body={`MP4 · ${project.data.canvas.width}×${project.data.canvas.height} · ${project.data.export.videoQuality}`} />
							</Dropdown.Item>
							<Dropdown.Item id="voiceover" textValue="Voiceover">
								<ExportItem title="Voiceover track" body="WAV, full length" />
							</Dropdown.Item>
							<Dropdown.Item id="stems" textValue="Stems">
								<ExportItem title="Line stems" body={`WAV per line → ${project.data.export.stemsDir}`} />
							</Dropdown.Item>
							<Dropdown.Item id="audio" textValue="Audio mix">
								<ExportItem title="Audio mix" body="WAV, every audible track" />
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</header>
	);
}

function ExportItem({ title, body }: { title: string; body: string }) {
	return (
		<span className="block py-0.5">
			<span className="block text-[13px]">{title}</span>
			<span className="block text-[11px] text-muted">{body}</span>
		</span>
	);
}
