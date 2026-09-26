import { Button } from "@heroui/react";
import { Copy, Robot, User } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { notify } from "../../lib/api";
import { useApp } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Section } from "../ui/controls";

const PROMPTS = [
	"Look at the project and tell me which lines still need a take.",
	"Record line B4 with me, then check whether it fits.",
	"Add captions for the voiceover and fix any that are too long.",
	"Render the frame at 1:15 and check the text is readable.",
	"Export the stems to ../audio and tell me the durations.",
];

export function AgentPanel() {
	const agent = useApp((s) => s.agent);
	const activity = useApp((s) => s.activity) ?? [];
	const [command, setCommand] = useState("");
	useEffect(() => {
		void window.cue.mcpCommand().then(setCommand);
	}, []);
	const active = agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 5 * 60 * 1000;

	return (
		<div className="flex flex-col">
			<Section>
				<div className="flex items-center gap-2.5">
					<span
						className={cn(
							"size-2 shrink-0 rounded-full",
							active ? "bg-success" : "bg-foreground/25",
						)}
					/>
					<div className="min-w-0">
						<p className="text-[12px] font-medium">
							{active
								? "An agent is working in this project"
								: agent?.requests
									? "Agent idle"
									: "No agent connected yet"}
						</p>
						<p className="text-[11px] text-muted">
							{agent?.requests
								? `${agent.requests} request${agent.requests === 1 ? "" : "s"} this session`
								: "Connect Claude Code (or any MCP client) below."}
						</p>
					</div>
				</div>
			</Section>
			<Section title="Connect">
				<p className="text-[12px] leading-relaxed text-muted">
					Run this once in a terminal. The agent gets every editing, recording and export tool, and
					sees the same project you do.
				</p>
				<div className="flex items-start gap-2 rounded-md border border-border bg-field p-2">
					<code className="min-w-0 flex-1 text-[11px] leading-relaxed break-all select-text">
						{command}
					</code>
					<Button
						isIconOnly
						size="sm"
						variant="ghost"
						aria-label="Copy"
						onPress={() => {
							void navigator.clipboard.writeText(command);
							notify("Copied", "success");
						}}
					>
						<Copy className="size-4" />
					</Button>
				</div>
			</Section>
			<Section title="Examples">
				<ul className="flex flex-col gap-1.5">
					{PROMPTS.map((prompt) => (
						<li key={prompt}>
							<button
								type="button"
								onClick={() => {
									void navigator.clipboard.writeText(prompt);
									notify("Prompt copied", "success");
								}}
								className="w-full rounded-md px-2 py-1.5 text-left text-[12px] leading-snug text-foreground/85 transition-colors hover:bg-default"
							>
								{prompt}
							</button>
						</li>
					))}
				</ul>
			</Section>
			<Section title="Activity">
				<ol className="flex flex-col gap-2">
					{activity.slice(0, 40).map((entry) => (
						<li key={entry.id} className="flex items-start gap-2">
							<span
								className={cn(
									"mt-0.5 flex size-4 shrink-0 items-center justify-center",
									entry.actor === "agent"
										? "text-violet-400"
										: entry.actor === "user"
											? "text-muted"
											: "text-muted/60",
								)}
							>
								{entry.actor === "agent" ? (
									<Robot weight="fill" className="size-3" />
								) : (
									<User weight="fill" className="size-3" />
								)}
							</span>
							<div className="min-w-0">
								<p className="text-[12px] leading-snug">{entry.summary}</p>
								<p className="text-[10px] text-muted">
									{new Date(entry.at).toLocaleTimeString([], {
										hour: "2-digit",
										minute: "2-digit",
										second: "2-digit",
									})}
								</p>
							</div>
						</li>
					))}
				</ol>
			</Section>
		</div>
	);
}
