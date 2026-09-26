import { useRef } from "react";
import { useEditorCommands } from "../../hooks/useEditorCommands";
import { useShortcuts } from "../../hooks/useShortcuts";
import { editor } from "../../lib/state";
import { clampLayout, layout } from "../../lib/workspace";
import { ExportDialog } from "../ExportDialog";
import { CaptureBar, RecordDialog } from "../RecordDialog";
import { OfflineBanner, RelinkDialog } from "../RelinkMedia";
import { Timeline } from "../timeline/Timeline";
import { Dock } from "./Dock";
import { EditorHeader } from "./EditorHeader";
import { EditorSidebar } from "./EditorSidebar";
import { Inspector } from "./Inspector";
import { PreviewPanel } from "./PreviewPanel";

/** Flush panes separated by hairlines, the layout used by most desktop editors. */
export function EditorShell() {
	useEditorCommands();
	useShortcuts();
	const inspectorOpen = editor.use((s) => s.inspectorOpen);
	const timelineHeight = layout.use((s) => s.timelineHeight);
	const sidebarOpen = layout.use((s) => s.sidebarOpen);
	const dock = layout.use((s) => s.dock);
	const dragStart = useRef<{ y: number; h: number } | null>(null);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
			<EditorHeader />
			<OfflineBanner />
			<div className="flex min-h-0 flex-1">
				<EditorSidebar />
				{sidebarOpen && <Splitter edge="sidebarWidth" />}
				<PreviewPanel />
				{dock !== "none" && <Splitter edge="dockWidth" invert />}
				<Dock />
				{inspectorOpen && <Splitter edge="inspectorWidth" invert />}
				{inspectorOpen && <Inspector />}
			</div>
			<div
				role="separator"
				aria-orientation="horizontal"
				className="relative h-px shrink-0 cursor-row-resize bg-separator after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 after:content-[''] hover:bg-accent"
				onPointerDown={(e) => {
					dragStart.current = { y: e.clientY, h: timelineHeight };
					(e.target as HTMLElement).setPointerCapture(e.pointerId);
				}}
				onPointerMove={(e) => {
					if (!dragStart.current) return;
					layout.set(
						clampLayout({
							timelineHeight: dragStart.current.h - (e.clientY - dragStart.current.y),
						}),
					);
				}}
				onPointerUp={() => {
					dragStart.current = null;
				}}
			/>
			<div style={{ height: timelineHeight }} className="shrink-0">
				<Timeline />
			</div>
			<RelinkDialog />
			<ExportDialog />
			<RecordDialog />
			<CaptureBar />
		</div>
	);
}

/** Drag handle between side-by-side panes. */
function Splitter({
	edge,
	invert,
}: {
	edge: "sidebarWidth" | "inspectorWidth" | "dockWidth";
	invert?: boolean;
}) {
	const start = useRef<{ x: number; w: number } | null>(null);
	return (
		<div
			role="separator"
			aria-orientation="vertical"
			className="relative z-10 -mx-[3px] w-[6px] shrink-0 cursor-col-resize after:absolute after:inset-y-0 after:left-[2.5px] after:w-px after:bg-transparent hover:after:bg-accent"
			onPointerDown={(e) => {
				start.current = { x: e.clientX, w: layout.get()[edge] };
				(e.target as HTMLElement).setPointerCapture(e.pointerId);
			}}
			onPointerMove={(e) => {
				if (!start.current) return;
				const delta = (e.clientX - start.current.x) * (invert ? -1 : 1);
				layout.set(clampLayout({ [edge]: start.current.w + delta }));
			}}
			onPointerUp={() => {
				start.current = null;
			}}
		/>
	);
}
