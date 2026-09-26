import { useRef, useState } from "react";
import { useEditorCommands } from "../../hooks/useEditorCommands";
import { useShortcuts } from "../../hooks/useShortcuts";
import { editor } from "../../lib/state";
import { ExportDialog } from "../ExportDialog";
import { OfflineBanner, RelinkDialog } from "../RelinkMedia";
import { Timeline } from "../timeline/Timeline";
import { EditorHeader } from "./EditorHeader";
import { EditorSidebar } from "./EditorSidebar";
import { Inspector } from "./Inspector";
import { PreviewPanel } from "./PreviewPanel";

/** Flush panes separated by hairlines, the layout used by most desktop editors. */
export function EditorShell() {
	useEditorCommands();
	useShortcuts();
	const inspectorOpen = editor.use((s) => s.inspectorOpen);
	const [timelineHeight, setTimelineHeight] = useState(320);
	const dragStart = useRef<{ y: number; h: number } | null>(null);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
			<EditorHeader />
			<OfflineBanner />
			<div className="flex min-h-0 flex-1">
				<EditorSidebar />
				<PreviewPanel />
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
					setTimelineHeight(
						Math.min(640, Math.max(180, dragStart.current.h - (e.clientY - dragStart.current.y))),
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
		</div>
	);
}
