import { Button, Dropdown, Spinner } from "@heroui/react";
import {
	ArrowClockwise,
	ArrowCounterClockwise,
	CaretLeft,
	SidebarSimple,
} from "@phosphor-icons/react";
import { notify, run } from "../../lib/api";
import { keyLabel } from "../../lib/platform";
import { playback } from "../../lib/playback";
import { editor, useApp, useProject } from "../../lib/state";
import { cn, nameFieldKeys } from "../../lib/utils";
import { exportDialog } from "../ExportDialog";
import { UpdateBadge } from "../UpdateBadge";
import { IconButton } from "../ui/controls";
import { WindowDots } from "../WindowDots";
import { WorkspaceMenu } from "./WorkspaceMenu";

export function EditorHeader() {
	const project = useProject();
	const agent = useApp((s) => s.agent);
	const jobs = useApp((s) => s.jobs) ?? [];
	const inspectorOpen = editor.use((s) => s.inspectorOpen);
	const running = jobs.find((j) => j.state === "running");
	const failed = jobs.find((j) => j.state === "failed");
	if (!project) return null;
	const agentActive =
		!!agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 5 * 60 * 1000;

	const exportAs = async (kind: ExportKind | "dialog" | "frame") => {
		if (kind === "dialog") return exportDialog.set({ open: true });
		if (kind === "frame") {
			const r = await run<{ path: string }>("export_frame", {
				atMs: Math.round(playback.currentMs),
			});
			if (r) void window.cue.reveal(r.path);
			return;
		}
		notify(`Exporting ${kind}…`);
		const report = await run<{ outputs: string[]; missing: string[] }>("export", { kind });
		if (!report) return;
		notify(
			`Exported ${kind}${report.missing.length ? `. No take yet for ${report.missing.join(", ")}` : ""}`,
			"success",
		);
		if (report.outputs[0]) void window.cue.reveal(report.outputs[0]);
	};

	return (
		<header className="app-drag titlebar relative z-50 flex h-11 shrink-0 items-center border-b border-separator bg-surface">
			<WindowDots />
			<div className="flex min-w-0 flex-1 items-center gap-1">
				<button
					type="button"
					onClick={() => void run("close_project")}
					className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[12px] text-muted hover:bg-default hover:text-foreground"
					title={keyLabel("All projects (⇧⌘O)")}
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
					onKeyDown={nameFieldKeys(project.data.name)}
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
					<span
						className="mr-2 max-w-[320px] truncate text-[12px] text-danger"
						title={failed.message}
					>
						{failed.label} failed
					</span>
				) : null}
				<UpdateBadge />
				<WorkspaceMenu />
				<button
					type="button"
					onClick={() => editor.set({ panel: "agent" })}
					className="mr-1 flex h-7 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-default hover:text-foreground"
					title={agentActive ? "An agent is connected" : "Connect an agent"}
				>
					<span
						className={cn("size-1.5 rounded-full", agentActive ? "bg-success" : "bg-foreground/25")}
					/>
					Agent
				</button>
				<IconButton
					label="Undo"
					shortcut="⌘Z"
					disabled={!project.canUndo}
					onPress={() => void run("undo")}
				>
					<ArrowCounterClockwise className="size-4" />
				</IconButton>
				<IconButton
					label="Redo"
					shortcut="⇧⌘Z"
					disabled={!project.canRedo}
					onPress={() => void run("redo")}
				>
					<ArrowClockwise className="size-4" />
				</IconButton>
				<IconButton
					label={inspectorOpen ? "Hide inspector" : "Show inspector"}
					active={inspectorOpen}
					onPress={() => editor.set({ inspectorOpen: !inspectorOpen })}
				>
					<SidebarSimple className="size-4 -scale-x-100" />
				</IconButton>
				<Dropdown>
					<Button size="sm" className="ml-1.5 h-7 px-3 text-[12px] font-semibold">
						Export
					</Button>
					<Dropdown.Popover placement="bottom end" className="min-w-[240px]">
						<Dropdown.Menu
							aria-label="Export"
							onAction={(key) =>
								void exportAs(key === "video" ? "dialog" : (key as ExportKind | "frame"))
							}
						>
							<Dropdown.Item id="video" textValue="Video">
								<ExportItem
									title="Video"
									body={`${project.data.export.codec === "prores" ? "MOV · ProRes" : `MP4 · ${project.data.export.codec.toUpperCase()}`} · ${Math.round(project.data.canvas.width * project.data.export.scale)}×${Math.round(project.data.canvas.height * project.data.export.scale)} · ${project.data.export.videoQuality}`}
								/>
							</Dropdown.Item>
							<Dropdown.Item id="frame" textValue="Frame">
								<ExportItem title="Frame at the playhead" body="PNG, as the viewer shows it" />
							</Dropdown.Item>
							<Dropdown.Item id="voiceover" textValue="Voiceover">
								<ExportItem title="Voiceover track" body="WAV, full length" />
							</Dropdown.Item>
							<Dropdown.Item id="stems" textValue="Stems">
								<ExportItem
									title="Line stems"
									body={`WAV per line → ${project.data.export.stemsDir}`}
								/>
							</Dropdown.Item>
							<Dropdown.Item id="audio" textValue="Audio mix">
								<ExportItem title="Audio mix" body="WAV, every audible track" />
							</Dropdown.Item>
							<Dropdown.Item id="captions" textValue="Captions">
								<ExportItem title="Captions" body="SRT and VTT from the caption clips" />
							</Dropdown.Item>
							<Dropdown.Item
								id="otio"
								textValue="OpenTimelineIO"
								className="border-t border-separator"
							>
								<ExportItem
									title="Timeline · OpenTimelineIO"
									body="DaVinci Resolve, Premiere, Kdenlive"
								/>
							</Dropdown.Item>
							<Dropdown.Item id="fcpxml" textValue="FCPXML">
								<ExportItem title="Timeline · FCPXML" body="Final Cut Pro, DaVinci Resolve" />
							</Dropdown.Item>
							<Dropdown.Item id="mlt" textValue="MLT">
								<ExportItem title="Timeline · MLT XML" body="Shotcut" />
							</Dropdown.Item>
							<Dropdown.Item id="edl" textValue="EDL">
								<ExportItem
									title="Timeline · EDL"
									body="CMX3600, main video track and two audio tracks"
								/>
							</Dropdown.Item>
						</Dropdown.Menu>
					</Dropdown.Popover>
				</Dropdown>
			</div>
		</header>
	);
}

type ExportKind =
	| "video"
	| "voiceover"
	| "stems"
	| "audio"
	| "captions"
	| "otio"
	| "fcpxml"
	| "mlt"
	| "edl";

function ExportItem({ title, body }: { title: string; body: string }) {
	return (
		<span className="block py-0.5">
			<span className="block text-[13px]">{title}</span>
			<span className="block text-[11px] text-muted">{body}</span>
		</span>
	);
}
