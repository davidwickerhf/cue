import { Button, Spinner } from "@heroui/react";
import {
	ArrowClockwise,
	ArrowUp,
	CheckCircle,
	Microphone,
	NotePencil,
	Robot,
	Stop,
	User,
	WarningCircle,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HarnessInfo } from "../../../electron/agents/harness";
import { notify } from "../../lib/api";
import {
	agentDraft,
	type ChatItem,
	chat,
	newChat,
	send,
	setHarness,
	stop,
	switchProjectChat,
} from "../../lib/chat";
import { appSettings, useApp, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { AgentConnect } from "../AgentConnect";
import { Section, Segmented } from "../ui/controls";
import { Markdown } from "../ui/Markdown";

const SUGGESTIONS = [
	"Tighten the edit: cut pauses longer than a second.",
	"Add captions to the voiceover and keep them to two short lines.",
	"Look at the frame at the playhead and tell me what could look better.",
	"Which script lines are over their time slot?",
	"Put a title card at the start with the project name.",
];

/** The agent panel: chat with Claude Code, Codex or Gemini working inside Cue, or connect your own. */
export function AgentPanel() {
	const [tab, setTab] = useState<"chat" | "connect">("chat");
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-separator px-4 py-2">
				<Segmented
					size="xs"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "chat", label: "Chat" },
						{ value: "connect", label: "Connect & activity" },
					]}
				/>
			</div>
			{tab === "chat" ? <ChatView /> : <ConnectView />}
		</div>
	);
}

function ChatView() {
	const project = useProject();
	const projectPath = project?.path ?? null;
	useEffect(() => switchProjectChat(projectPath), [projectPath]);
	const current = chat.use((s) => s.chat);
	const [harnesses, setHarnesses] = useState<HarnessInfo[] | null>(null);
	const [draft, setDraft] = useState("");
	const list = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	// "Ask the agent about this…" from the clip menu starts a message here.
	const pending = agentDraft.use((s) => s.text);
	useEffect(() => {
		if (pending === null) return;
		setDraft(pending);
		agentDraft.set({ text: null });
		requestAnimationFrame(() => input.current?.focus());
	}, [pending]);

	const refresh = (force = false) => void window.cue.harnesses(force).then(setHarnesses);
	// biome-ignore lint/correctness/useExhaustiveDependencies: load once
	useEffect(() => refresh(), []);
	useEffect(() => {
		if (!harnesses) return;
		const active = harnesses.find((h) => h.id === current.harness);
		const first = harnesses.find((h) => h.installed);
		if (!active?.installed && first) setHarness(first.id);
	}, [harnesses, current.harness]);
	// biome-ignore lint/correctness/useExhaustiveDependencies: follow new messages
	useLayoutEffect(() => {
		const el = list.current;
		if (el) el.scrollTop = el.scrollHeight;
	}, [current.items.length, current.items.at(-1)]);

	const installed = harnesses?.filter((h) => h.installed) ?? [];
	const active = harnesses?.find((h) => h.id === current.harness);
	if (harnesses && installed.length === 0)
		return <NoHarness harnesses={harnesses} onRefresh={() => refresh(true)} />;

	const submit = (text = draft) => {
		if (!text.trim() || current.running) return;
		setDraft("");
		void send(text);
	};

	return (
		<div className="flex min-h-0 flex-1 flex-col">
			<div className="flex items-center gap-1.5 border-b border-separator px-3 py-2">
				<select
					value={current.harness}
					onChange={(e) => setHarness(e.target.value as HarnessInfo["id"])}
					className="h-7 min-w-0 flex-1 rounded-md border border-border bg-field px-1.5 text-[12px] outline-none focus:border-accent"
					aria-label="Agent"
				>
					{(harnesses ?? []).map((h) => (
						<option key={h.id} value={h.id} disabled={!h.installed}>
							{h.name}
							{h.installed ? "" : " (not installed)"}
						</option>
					))}
				</select>
				<select
					value={current.model}
					onChange={(e) => setHarness(current.harness, e.target.value)}
					className="h-7 w-[92px] rounded-md border border-border bg-field px-1.5 text-[12px] outline-none focus:border-accent"
					aria-label="Model"
				>
					{(active?.models ?? [{ id: "", label: "Default" }]).map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
				</select>
				<button
					type="button"
					onClick={newChat}
					title="New conversation"
					aria-label="New conversation"
					className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground"
				>
					<NotePencil className="size-4" />
				</button>
			</div>

			<div ref={list} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
				{current.items.length === 0 ? (
					<div className="flex flex-col gap-3">
						<p className="text-[12px] leading-relaxed text-muted">
							{active?.name ?? "The agent"} edits this project with Cue's tools only: no shell,
							files or web. It sees the playhead and your selection, and every change can be undone.
						</p>
						<div className="flex flex-col gap-1">
							{SUGGESTIONS.map((s) => (
								<button
									key={s}
									type="button"
									onClick={() => submit(s)}
									className="rounded-md border border-border px-2.5 py-1.5 text-left text-[12px] leading-snug text-foreground/85 hover:border-foreground/30 hover:bg-default/50"
								>
									{s}
								</button>
							))}
						</div>
					</div>
				) : (
					<div className="flex flex-col gap-2.5">
						{current.items.map((item, i) => (
							// biome-ignore lint/suspicious/noArrayIndexKey: the transcript only ever grows
							<Message key={i} item={item} />
						))}
						{current.running && current.items.at(-1)?.role !== "tool" && (
							<span className="flex items-center gap-2 text-[11px] text-muted">
								<Spinner size="sm" /> Working…
							</span>
						)}
					</div>
				)}
			</div>

			<div className="border-t border-separator p-2.5">
				<div className="flex items-end gap-1.5 rounded-lg border border-border bg-field p-1.5 focus-within:border-accent">
					<textarea
						ref={input}
						value={draft}
						onChange={(e) => setDraft(e.target.value)}
						onKeyDown={(e) => {
							e.stopPropagation();
							// Enter while composing (Japanese, Chinese…) confirms the text, it doesn't send.
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								submit();
							}
						}}
						rows={Math.min(6, Math.max(1, draft.split("\n").length))}
						placeholder={`Ask ${active?.name ?? "the agent"} to edit…`}
						className="max-h-40 min-w-0 flex-1 resize-none bg-transparent px-1 py-1 text-[12px] leading-snug outline-none"
					/>
					{current.running ? (
						<button
							type="button"
							onClick={stop}
							aria-label="Stop"
							title="Stop"
							className="flex size-7 shrink-0 items-center justify-center rounded-md bg-default text-foreground hover:bg-default/70"
						>
							<Stop weight="fill" className="size-3.5" />
						</button>
					) : (
						<>
							<VoiceButton onText={(text) => submit(text)} />
							<button
								type="button"
								onClick={() => submit()}
								disabled={!draft.trim()}
								aria-label="Send"
								title="Send (Enter)"
								className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-30"
							>
								<ArrowUp weight="bold" className="size-3.5" />
							</button>
						</>
					)}
				</div>
				<p className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted">
					<span>{active?.version ? `${active.name} ${active.version}` : ""}</span>
					<ReviewToggle />
					{current.costUsd > 0 && <span>${current.costUsd.toFixed(3)} this chat</span>}
				</p>
			</div>
		</div>
	);
}

/**
 * Talk to the agent: hold the button (or click to start and again to stop),
 * say what you want ("cut the pause after the intro", "make this slower"),
 * and it is transcribed and sent. Transcription uses the provider in Settings
 * (Whisper on this Mac, or OpenAI).
 */
function VoiceButton({ onText }: { onText: (text: string) => void }) {
	const [state, setState] = useState<"idle" | "listening" | "working">("idle");
	const recorder = useRef<MediaRecorder | null>(null);
	const started = useRef(0);
	const stopOnUp = useRef(false);
	const start = async () => {
		if (state !== "idle") return;
		try {
			const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
			const chunks: Blob[] = [];
			const rec = new MediaRecorder(stream);
			rec.ondataavailable = (e) => chunks.push(e.data);
			rec.onstop = async () => {
				for (const t of stream.getTracks()) t.stop();
				if (Date.now() - started.current < 400) return setState("idle");
				setState("working");
				try {
					const text = await window.cue.transcribeSpeech(await new Blob(chunks).arrayBuffer());
					if (text) onText(text);
					else notify("Didn't catch that.");
				} catch (error) {
					notify((error as Error).message, "danger");
				}
				setState("idle");
			};
			recorder.current = rec;
			started.current = Date.now();
			rec.start();
			setState("listening");
		} catch {
			notify("Cue can't use the microphone. Allow it in System Settings → Privacy.", "danger");
		}
	};
	const stop = () => {
		if (recorder.current?.state === "recording") recorder.current.stop();
	};
	return (
		<button
			type="button"
			aria-label={state === "listening" ? "Stop and send" : "Speak to the agent"}
			title="Hold to speak (or click to start and stop)"
			// Hold to talk and release to send; or click once to start and again to send.
			onPointerDown={() => {
				stopOnUp.current = state === "listening";
				if (state === "idle") void start();
			}}
			onPointerUp={() => {
				if (stopOnUp.current || Date.now() - started.current > 600) stop();
			}}
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-md transition-colors",
				state === "listening"
					? "rec-pulse bg-danger text-white"
					: "bg-default text-muted hover:text-foreground",
			)}
		>
			{state === "working" ? (
				<Spinner size="sm" />
			) : (
				<Microphone weight="fill" className="size-3.5" />
			)}
		</button>
	);
}

/** Whether the agent's edits wait for the user (shown on the timeline as a proposal). */
function ReviewToggle() {
	const settings = appSettings.use((s) => s.settings);
	if (!settings) return null;
	const on = settings.agent.review;
	return (
		<label
			className="ml-auto flex cursor-pointer items-center gap-1 hover:text-foreground"
			title="Show the agent's edits as a proposal to keep or undo"
		>
			<input
				type="checkbox"
				className="size-3"
				checked={on}
				onChange={(e) =>
					void window.cue.setAppSettings({ agent: { ...settings.agent, review: e.target.checked } })
				}
			/>
			Review edits
		</label>
	);
}

function Message({ item }: { item: ChatItem }) {
	if (item.role === "user")
		return (
			<p className="ml-6 self-end rounded-lg bg-default px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap select-text">
				{item.text}
			</p>
		);
	if (item.role === "assistant")
		return (
			<Markdown
				text={item.text}
				className="flex flex-col gap-1.5 text-[12px] leading-relaxed select-text [&_li]:mt-0.5"
			/>
		);
	if (item.role === "error")
		return (
			<p className="flex items-start gap-1.5 rounded-md bg-danger/10 px-2.5 py-1.5 text-[12px] text-danger select-text">
				<WarningCircle className="mt-0.5 size-3.5 shrink-0" /> {item.text}
			</p>
		);
	return (
		<p className="flex items-center gap-1.5 font-mono text-[11px] text-muted" title={item.detail}>
			{item.status === "running" ? (
				<Spinner size="sm" className="scale-75" />
			) : item.status === "error" ? (
				<WarningCircle className="size-3.5 text-danger" />
			) : (
				<CheckCircle weight="fill" className="size-3.5 text-success/80" />
			)}
			<span className="truncate">{item.name}</span>
			{item.status === "error" && item.detail && (
				<span className="truncate text-danger/80">{item.detail}</span>
			)}
		</p>
	);
}

function NoHarness({ harnesses, onRefresh }: { harnesses: HarnessInfo[]; onRefresh: () => void }) {
	return (
		<Section title="Chat with an agent">
			<p className="text-[12px] leading-relaxed text-muted">
				Cue runs the coding agents you already use, signed in with your own account. Install one,
				then refresh.
			</p>
			<ul className="flex flex-col gap-2">
				{harnesses.map((h) => (
					<li key={h.id} className="flex flex-col gap-1">
						<span className="text-[12px] font-medium">{h.name}</span>
						<code className="rounded-md border border-border bg-field px-2 py-1 text-[11px] select-text">
							{h.install}
						</code>
					</li>
				))}
			</ul>
			<Button size="sm" variant="secondary" className="h-7 gap-1.5 text-[12px]" onPress={onRefresh}>
				<ArrowClockwise className="size-3.5" /> Refresh
			</Button>
		</Section>
	);
}

function ConnectView() {
	const agent = useApp((s) => s.agent);
	const activity = useApp((s) => s.activity) ?? [];
	const active = agent?.lastSeenAt && Date.now() - Date.parse(agent.lastSeenAt) < 5 * 60 * 1000;

	return (
		<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
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
									: "No outside agent connected"}
						</p>
						<p className="text-[11px] text-muted">
							{agent?.requests
								? `${agent.requests} request${agent.requests === 1 ? "" : "s"} this session`
								: "Use Cue from your own terminal agent."}
						</p>
					</div>
				</div>
			</Section>
			<Section title="Connect from your agent">
				<p className="text-[12px] leading-relaxed text-muted">
					Pick your agent and run its command once (or add its config). It gets every editing,
					recording and export tool and sees the same project you do.
				</p>
				<AgentConnect />
			</Section>
			<Section title="Activity">
				<ol className="flex flex-col gap-2">
					{activity.slice(0, 60).map((entry) => (
						<li key={entry.id} className="flex items-start gap-2">
							<span
								className={cn(
									"mt-0.5 flex size-4 shrink-0 items-center justify-center",
									entry.actor === "agent" ? "text-violet-400" : "text-muted",
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
