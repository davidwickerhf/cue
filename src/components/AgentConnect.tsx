import { Button } from "@heroui/react";
import { Check, Copy, Plugs, X } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { McpClient } from "../../electron/core/mcpClients";
import { createStore, useApp } from "../lib/state";
import { cn } from "../lib/utils";

const CHOICE_KEY = "cue.agentClient";

/** The Connect an agent dialog (opened from the projects overview). */
export const agentConnectDialog = createStore({ open: false });

/**
 * How to connect an outside agent to this copy of Cue: pick the client (Claude
 * Code, Codex, Gemini CLI, VS Code, Cursor, Claude Desktop, other) and copy its
 * command or config. The choice is remembered.
 */
export function AgentConnect() {
	const [clients, setClients] = useState<McpClient[]>([]);
	const [id, setId] = useState(() => localStorage.getItem(CHOICE_KEY) ?? "claude");
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		void window.cue.mcpClients().then(setClients);
	}, []);
	const client = clients.find((c) => c.id === id) ?? clients[0];
	const choose = (next: string) => {
		setId(next);
		setCopied(false);
		localStorage.setItem(CHOICE_KEY, next);
	};
	return (
		<div className="flex flex-col gap-3">
			<div role="tablist" aria-label="Agent" className="flex flex-wrap gap-1.5">
				{clients.map((c) => (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={c.id === client?.id}
						onClick={() => choose(c.id)}
						className={cn(
							"h-7 rounded-md px-2.5 text-[12px] transition-colors",
							c.id === client?.id
								? "bg-foreground font-medium text-background"
								: "bg-default/60 text-foreground/80 hover:bg-default hover:text-foreground",
						)}
					>
						{c.label}
					</button>
				))}
			</div>
			{client && (
				<>
					<div className="relative rounded-lg border border-border bg-background">
						<pre className="custom-scrollbar max-h-56 overflow-auto p-3 pr-24 font-mono text-[12px] leading-relaxed break-all whitespace-pre-wrap text-foreground/90 select-text">
							{client.text}
						</pre>
						<Button
							size="sm"
							variant="secondary"
							className="absolute top-2 right-2 h-7 gap-1.5 text-[12px]"
							onPress={() => {
								void navigator.clipboard.writeText(client.text);
								setCopied(true);
								setTimeout(() => setCopied(false), 1800);
							}}
						>
							{copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
							{copied ? "Copied" : "Copy"}
						</Button>
					</div>
					<p className="text-[12px] leading-relaxed text-muted">{client.note}</p>
				</>
			)}
		</div>
	);
}

/** A small status-bar button: whether an agent is connected, and the dialog to connect one. */
export function AgentConnectButton() {
	const agent = useApp((s) => s.agent);
	const active = !!agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 5 * 60 * 1000;
	return (
		<button
			type="button"
			onClick={() => agentConnectDialog.set({ open: true })}
			className="flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted hover:bg-default hover:text-foreground"
		>
			<span className={cn("size-1.5 rounded-full", active ? "bg-success" : "bg-foreground/30")} />
			<Plugs className="size-3.5" />
			{active ? "Agent connected" : "Connect an agent…"}
		</button>
	);
}

export function AgentConnectDialog() {
	const open = agentConnectDialog.use((s) => s.open);
	const agent = useApp((s) => s.agent);
	useEffect(() => {
		if (!open) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			e.stopPropagation();
			agentConnectDialog.set({ open: false });
		};
		window.addEventListener("keydown", onKey, true);
		return () => window.removeEventListener("keydown", onKey, true);
	}, [open]);
	if (!open) return null;
	const close = () => agentConnectDialog.set({ open: false });
	return (
		<div
			className="fixed inset-0 z-[150] flex bg-black/40 backdrop-blur-[2px]"
			onPointerDown={close}
		>
			<div
				role="dialog"
				aria-label="Connect an agent"
				onPointerDown={(e) => e.stopPropagation()}
				className="m-auto flex w-[min(600px,92vw)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/50"
			>
				<header className="flex items-start justify-between gap-4 border-b border-separator px-5 py-4">
					<div>
						<h2 className="text-[15px] font-semibold">Connect an agent</h2>
						<p className="mt-1 text-[12px] leading-relaxed text-muted">
							Your agent gets every editing, recording and export tool and works on the same project
							you see. It connects on this Mac only, with a key that changes every launch.
						</p>
					</div>
					<button
						type="button"
						onClick={close}
						aria-label="Close"
						className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
					>
						<X className="size-4" />
					</button>
				</header>
				<div className="p-5">
					<AgentConnect />
				</div>
				<footer className="flex items-center gap-2 border-t border-separator px-5 py-3 text-[12px] text-muted">
					<span
						className={cn(
							"size-2 rounded-full",
							agent?.lastSeenAt ? "bg-success" : "bg-foreground/25",
						)}
					/>
					{agent?.requests
						? `An agent has made ${agent.requests} request${agent.requests === 1 ? "" : "s"} this session.`
						: "No agent has connected yet this session."}
					<span className="flex-1" />
					<span>Or use the Agent panel inside a project.</span>
				</footer>
			</div>
		</div>
	);
}
