import { X } from "@phosphor-icons/react";
import { useProject } from "../../lib/state";
import { type Dock as DockKind, layout } from "../../lib/workspace";
import { AgentPanel } from "../panels/AgentPanel";
import { HistoryPanel } from "../panels/HistoryPanel";
import { MixerPanel } from "../panels/MixerPanel";
import { MarkerList } from "./Inspector";
import { Scopes } from "./Scopes";

const TITLES: Record<Exclude<DockKind, "none">, string> = {
	mixer: "Mixer",
	scopes: "Scopes",
	agent: "Agent",
	history: "History",
	markers: "Markers",
};

/** The pane a workspace docks beside the viewer (mixer, scopes, markers…). */
export function Dock() {
	const dock = layout.use((s) => s.dock);
	const width = layout.use((s) => s.dockWidth);
	const project = useProject();
	if (dock === "none" || !project) return null;
	return (
		<aside
			className="flex shrink-0 flex-col border-l border-separator bg-surface"
			style={{ width }}
		>
			<header className="flex h-10 shrink-0 items-center justify-between border-b border-separator pr-2 pl-4">
				<h2 className="text-[12px] font-semibold">{TITLES[dock]}</h2>
				<button
					type="button"
					aria-label="Close pane"
					onClick={() => layout.set({ dock: "none" })}
					className="flex size-6 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
				>
					<X className="size-3.5" />
				</button>
			</header>
			<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
				{dock === "mixer" && <MixerPanel />}
				{dock === "scopes" && <Scopes />}
				{dock === "agent" && <AgentPanel />}
				{dock === "history" && <HistoryPanel />}
				{dock === "markers" && <MarkerList markers={project.data.markers} />}
			</div>
		</aside>
	);
}
