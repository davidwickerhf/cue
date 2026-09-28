import { useEffect } from "react";
import { EditorShell } from "./components/layout/EditorShell";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { recordDialog } from "./components/RecordDialog";
import { SettingsView } from "./components/settings/SettingsView";
import { UpdateDialog } from "./components/UpdateDialog";
import { UsagePrompt } from "./components/UsagePrompt";
import { ErrorBoundary } from "./components/ui/ErrorBoundary";
import { Toaster } from "./components/ui/Toaster";
import { Welcome } from "./components/Welcome";
import { notify } from "./lib/api";
import { startChatSync } from "./lib/chat";
import { platform } from "./lib/platform";
import { playback } from "./lib/playback";
import { app, appSettings, startSettingsSync, startSync, useApp, useProject } from "./lib/state";

/** Windows: the window buttons drawn over the header take its background and text colours. */
function matchTitleBar() {
	if (platform !== "win32") return;
	const probe = document.createElement("div");
	probe.className = "bg-surface text-foreground";
	document.body.append(probe);
	const style = getComputedStyle(probe);
	const colors = [style.backgroundColor, style.color].map(toHex);
	probe.remove();
	window.cue.setTitleBarColors(colors[0], colors[1]);
}

/** Any CSS colour (oklch included) as #rrggbb, by painting it. */
function toHex(color: string): string {
	const ctx = document.createElement("canvas").getContext("2d");
	if (!ctx) return "#18181b";
	ctx.fillStyle = color;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function App() {
	useEffect(() => {
		const stop = startSync();
		return () => {
			stop();
		};
	}, []);
	useEffect(() => startSettingsSync(), []);
	useEffect(() => startChatSync(), []);
	const project = useProject();
	const loaded = useApp(() => true);
	const theme = appSettings.use((s) => s.settings?.theme ?? "dark");

	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () =>
			document.documentElement.classList.toggle(
				"dark",
				theme === "dark" || (theme === "system" && media.matches),
			);
		apply();
		matchTitleBar();
		media.addEventListener("change", apply);
		media.addEventListener("change", matchTitleBar);
		return () => {
			media.removeEventListener("change", apply);
			media.removeEventListener("change", matchTitleBar);
		};
	}, [theme]);

	useEffect(() => {
		playback.setProject(project);
	}, [project]);

	// File → Record Screen or Camera… (⇧⌘R)
	useEffect(
		() =>
			window.cue.onOpenRecord(() => {
				if (app.get().state?.project) recordDialog.set({ open: true });
				else notify("Open a project first, then record into it.");
			}),
		[],
	);

	useEffect(() => {
		window.cue.reportRecorder({ uiReady: true });
		return () => window.cue.reportRecorder({ uiReady: false });
	}, []);

	if (!loaded) return <div className="h-full bg-background" />;
	return (
		<ErrorBoundary name="window" whole>
			{project ? <EditorShell /> : <Welcome />}
			<SettingsView />
			<NewProjectDialog />
			<UpdateDialog />
			<UsagePrompt />
			<Toaster />
		</ErrorBoundary>
	);
}
