import { Tooltip } from "@heroui/react";
import {
	ClockCounterClockwise,
	Faders,
	Gear,
	Images,
	Microphone,
	Robot,
	Sparkle,
	Subtitles,
	TextT,
} from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { editor, type SidebarPanel, useApp } from "../../lib/state";
import { cn } from "../../lib/utils";
import { layout } from "../../lib/workspace";
import { AgentPanel } from "../panels/AgentPanel";
import { GeneratePanel } from "../panels/GeneratePanel";
import { HistoryPanel } from "../panels/HistoryPanel";
import { MediaPanel } from "../panels/MediaPanel";
import { MixerPanel } from "../panels/MixerPanel";
import { ScriptPanel } from "../panels/ScriptPanel";
import { SettingsPanel } from "../panels/SettingsPanel";
import { TextPanel } from "../panels/TextPanel";
import { TranscriptPanel } from "../panels/TranscriptPanel";

const ITEMS: { id: SidebarPanel; label: string; icon: ReactNode }[] = [
	{ id: "media", label: "Media", icon: <Images className="size-[18px]" /> },
	{ id: "script", label: "Voiceover", icon: <Microphone className="size-[18px]" /> },
	{ id: "transcript", label: "Transcript", icon: <Subtitles className="size-[18px]" /> },
	{ id: "text", label: "Text", icon: <TextT className="size-[18px]" /> },
	{ id: "mixer", label: "Mixer", icon: <Faders className="size-[18px]" /> },
	{ id: "generate", label: "Generate", icon: <Sparkle className="size-[18px]" /> },
	{ id: "history", label: "History", icon: <ClockCounterClockwise className="size-[18px]" /> },
	{ id: "agent", label: "Agent", icon: <Robot className="size-[18px]" /> },
];

const TITLES: Record<SidebarPanel, string> = {
	media: "Media",
	script: "Voiceover",
	transcript: "Transcript",
	text: "Text",
	mixer: "Mixer",
	generate: "Generate",
	history: "History",
	agent: "Agent",
	settings: "Project",
};

export function EditorSidebar() {
	const panel = editor.use((s) => s.panel);
	const sidebarWidth = layout.use((s) => s.sidebarWidth);
	const open = layout.use((s) => s.sidebarOpen);
	// Clicking the open panel's icon folds the sidebar away; any icon opens it.
	const choose = (id: SidebarPanel) => {
		if (open && panel === id) layout.set({ sidebarOpen: false });
		else {
			editor.set({ panel: id });
			layout.set({ sidebarOpen: true });
		}
	};
	const agentSeen = useApp((s) => s.agent.lastSeenAt);
	return (
		<div className={cn("flex min-h-0 shrink-0 bg-surface", open && "border-r border-separator")}>
			<nav
				className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-separator py-2"
				aria-label="Panels"
			>
				{ITEMS.map((item) => (
					<RailButton
						key={item.id}
						label={item.label}
						active={open && panel === item.id}
						onPress={() => choose(item.id)}
						dot={item.id === "agent" && !!agentSeen}
					>
						{item.icon}
					</RailButton>
				))}
				<div className="mt-auto">
					<RailButton
						label="Project settings"
						active={open && panel === "settings"}
						onPress={() => choose("settings")}
					>
						<Gear className="size-[18px]" />
					</RailButton>
				</div>
			</nav>
			<div
				className={cn("flex min-h-0 flex-col", !open && "hidden")}
				style={{ width: sidebarWidth, maxWidth: "25vw" }}
			>
				<header className="flex h-10 shrink-0 items-center border-b border-separator px-4">
					<h2 className="text-[12px] font-semibold">{TITLES[panel]}</h2>
				</header>
				<div key={panel} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
					{panel === "media" && <MediaPanel />}
					{panel === "script" && <ScriptPanel />}
					{panel === "transcript" && <TranscriptPanel />}
					{panel === "text" && <TextPanel />}
					{panel === "mixer" && <MixerPanel />}
					{panel === "generate" && <GeneratePanel />}
					{panel === "history" && <HistoryPanel />}
					{panel === "agent" && <AgentPanel />}
					{panel === "settings" && <SettingsPanel />}
				</div>
			</div>
		</div>
	);
}

function RailButton({
	label,
	active,
	onPress,
	children,
	dot,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
	children: ReactNode;
	dot?: boolean;
}) {
	return (
		<Tooltip delay={300} closeDelay={0}>
			<Tooltip.Trigger>
				<button
					type="button"
					aria-label={label}
					aria-pressed={active}
					onClick={onPress}
					className={cn(
						"relative flex size-8 items-center justify-center rounded-md transition-colors",
						active
							? "bg-default text-foreground"
							: "text-muted hover:bg-default/60 hover:text-foreground",
					)}
				>
					{children}
					{dot && <span className="absolute top-1 right-1 size-1.5 rounded-full bg-success" />}
				</button>
			</Tooltip.Trigger>
			<Tooltip.Content placement="right" className="text-xs">
				{label}
			</Tooltip.Content>
		</Tooltip>
	);
}
