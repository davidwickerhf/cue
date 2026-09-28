import { useRef } from "react";
import { useEditorCommands } from "../../hooks/useEditorCommands";
import { useShortcuts } from "../../hooks/useShortcuts";
import { hasViewer, pageState } from "../../lib/pages";
import { editor } from "../../lib/state";
import { clampLayout, layout } from "../../lib/workspace";
import { ExportDialog } from "../ExportDialog";
import { MotionPage } from "../pages/MotionPage";
import { PageBar } from "../pages/PageBar";
import { CaptureBar, RecordDialog } from "../RecordDialog";
import { OfflineBanner, RelinkDialog } from "../RelinkMedia";
import { Timeline } from "../timeline/Timeline";
import { ErrorBoundary } from "../ui/ErrorBoundary";
import { VoiceoverDialog } from "../VoiceoverDialog";
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
	const timelineOpen = layout.use((s) => s.timelineOpen);
	const sidebarOpen = layout.use((s) => s.sidebarOpen);
	const dock = layout.use((s) => s.dock);
	const dragStart = useRef<{ y: number; h: number } | null>(null);
	const page = pageState.use((s) => s.page);
	// The editor stays mounted on the Motion and Deliver pages (hidden), so the viewer
	// and playback keep their place; those pages show their own screen instead.
	const viewer = hasViewer(page);

	return (
		<div className="flex h-full flex-col overflow-hidden bg-background text-foreground">
			<EditorHeader />
			<OfflineBanner />
			{page === "motion" && (
				<ErrorBoundary name="Motion page">
					<MotionPage />
				</ErrorBoundary>
			)}
			{page === "deliver" && (
				<ErrorBoundary name="Deliver page">
					<ExportDialog inline />
				</ErrorBoundary>
			)}
			<div className={viewer ? "contents" : "hidden"}>
				<div className="flex min-h-0 flex-1">
					<ErrorBoundary name="sidebar">
						<EditorSidebar />
					</ErrorBoundary>
					{sidebarOpen && <Splitter edge="sidebarWidth" />}
					<ErrorBoundary name="viewer">
						<PreviewPanel />
					</ErrorBoundary>
					{dock !== "none" && <Splitter edge="dockWidth" invert />}
					<ErrorBoundary name="panel">
						<Dock />
					</ErrorBoundary>
					{inspectorOpen && <Splitter edge="inspectorWidth" invert />}
					{inspectorOpen && (
						<ErrorBoundary name="inspector">
							<Inspector />
						</ErrorBoundary>
					)}
				</div>
				{timelineOpen && (
					<hr
						aria-orientation="horizontal"
						aria-label="Timeline height"
						aria-valuenow={timelineHeight}
						tabIndex={0}
						// Arrow keys resize, like dragging.
						onKeyDown={(e) => {
							const step = e.shiftKey ? 64 : 16;
							if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
							e.preventDefault();
							e.stopPropagation();
							layout.set(
								clampLayout({
									timelineHeight: timelineHeight + (e.key === "ArrowUp" ? step : -step),
								}),
							);
						}}
						className="relative m-0 h-px shrink-0 cursor-row-resize border-0 bg-separator after:absolute after:inset-x-0 after:-top-1.5 after:-bottom-1.5 after:content-[''] hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
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
				)}
				{timelineOpen && (
					<div
						style={{ height: `min(${timelineHeight}px, max(120px, calc(100dvh - 260px)))` }}
						className="shrink-0"
					>
						<ErrorBoundary name="timeline">
							<Timeline />
						</ErrorBoundary>
					</div>
				)}
			</div>
			<PageBar />
			<RelinkDialog />
			<ExportDialog />
			<RecordDialog />
			<VoiceoverDialog />
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
		<hr
			aria-orientation="vertical"
			aria-label={
				edge === "sidebarWidth"
					? "Sidebar width"
					: edge === "dockWidth"
						? "Pane width"
						: "Inspector width"
			}
			aria-valuenow={layout.get()[edge]}
			tabIndex={0}
			// Arrow keys resize, like dragging.
			onKeyDown={(e) => {
				if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
				e.preventDefault();
				e.stopPropagation();
				const step = (e.shiftKey ? 64 : 16) * (e.key === "ArrowRight" ? 1 : -1) * (invert ? -1 : 1);
				layout.set(clampLayout({ [edge]: layout.get()[edge] + step }));
			}}
			className="relative z-10 -mx-[3px] my-0 w-[6px] shrink-0 cursor-col-resize border-0 after:absolute after:inset-y-0 after:left-[2.5px] after:w-px after:bg-transparent hover:after:bg-accent focus-visible:outline-none focus-visible:after:bg-accent"
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
