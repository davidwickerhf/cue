import { useEffect } from "react";
import { EditorShell } from "./components/layout/EditorShell";
import { NewProjectDialog } from "./components/NewProjectDialog";
import { recordDialog } from "./components/RecordDialog";
import { SettingsView } from "./components/settings/SettingsView";
import { Toaster } from "./components/ui/Toaster";
import { Welcome } from "./components/Welcome";
import { notify } from "./lib/api";
import { startChatSync } from "./lib/chat";
import { playback } from "./lib/playback";
import { app, appSettings, startSettingsSync, startSync, useApp, useProject } from "./lib/state";

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
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
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
		<>
			{project ? <EditorShell /> : <Welcome />}
			<SettingsView />
			<NewProjectDialog />
			<Toaster />
		</>
	);
}
