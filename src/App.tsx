import { useEffect } from "react";
import { EditorShell } from "./components/layout/EditorShell";
import { Welcome } from "./components/Welcome";
import { Toaster } from "./components/ui/Toaster";
import { playback } from "./lib/playback";
import { startSync, useApp, useProject } from "./lib/state";

export function App() {
	useEffect(() => {
		const stop = startSync();
		return () => {
			stop();
		};
	}, []);
	const project = useProject();
	const loaded = useApp(() => true);

	useEffect(() => {
		playback.setProject(project);
	}, [project]);

	useEffect(() => {
		window.cue.reportRecorder({ uiReady: true });
		return () => window.cue.reportRecorder({ uiReady: false });
	}, []);

	if (!loaded) return <div className="h-full bg-background" />;
	return (
		<>
			{project ? <EditorShell /> : <Welcome />}
			<Toaster />
		</>
	);
}
