"use client";

import { useState } from "react";
import { CopyBlock } from "@/components/CopyBlock";
import { mcpClients } from "@/lib/mcpClients";
import { MCP_SCRIPT } from "@/lib/site";

const CLIENTS = mcpClients(MCP_SCRIPT);

/** The command (or config) that connects an agent to Cue, for the client the visitor picks. */
export function AgentConnect({ initial = "claude" }: { initial?: string }) {
	const [id, setId] = useState(initial);
	const client = CLIENTS.find((c) => c.id === id) ?? CLIENTS[0];
	return (
		<div className="flex flex-col gap-3">
			<div role="tablist" aria-label="Agent" className="flex flex-wrap gap-1.5">
				{CLIENTS.map((c) => (
					<button
						key={c.id}
						type="button"
						role="tab"
						aria-selected={c.id === client.id}
						onClick={() => setId(c.id)}
						className={
							c.id === client.id
								? "rounded-lg bg-white px-3 py-1.5 text-[13px] font-semibold text-black"
								: "rounded-lg bg-page px-3 py-1.5 text-[13px] text-neutral-300 hover:bg-[#1f1f1f] hover:text-white"
						}
					>
						{c.label}
					</button>
				))}
			</div>
			<CopyBlock text={client.text} label="Copy" analytics={{ event: "agent_connect_copied", client: client.id }} />
			<p className="text-[13px] text-muted">{client.note}</p>
		</div>
	);
}
