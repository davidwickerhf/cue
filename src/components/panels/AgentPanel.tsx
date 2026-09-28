import { Button, Spinner } from "@heroui/react";
import {
	ArrowClockwise,
	ArrowUp,
	Camera,
	CheckCircle,
	ClockCounterClockwise,
	FilmStrip,
	Microphone,
	NotePencil,
	Paperclip,
	Robot,
	Stop,
	Trash,
	User,
	WarningCircle,
	X,
} from "@phosphor-icons/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { HarnessInfo } from "../../../electron/agents/harness";
import { notify } from "../../lib/api";
import {
	type Attachment,
	activeChat,
	attachFiles,
	attachFrame,
	attachmentUrl,
	type Chat,
	type ChatItem,
	type ClipRef,
	chats,
	composer,
	deleteChat,
	newChat,
	openChat,
	removeAttachment,
	removeRef,
	send,
	sendNow,
	setHarness,
	stop,
	switchProjectChat,
	unqueue,
} from "../../lib/chat";
import { appSettings, useApp, useProject } from "../../lib/state";
import { styleSelection } from "../../lib/styleLibrary";
import { cn } from "../../lib/utils";
import { AgentConnect } from "../AgentConnect";
import { Section, Segmented } from "../ui/controls";
import { Markdown } from "../ui/Markdown";
import { RecipesSection } from "./RecipesSection";

const SUGGESTIONS = [
	"Tighten the edit: cut pauses longer than a second.",
	"Add captions to the voiceover and keep them to two short lines.",
	"Look at the frame at the playhead and tell me what could look better.",
	"Which script lines are over their time slot?",
	"Put a title card at the start with the project name.",
];

/** The agent panel: chat with Claude Code, Codex or Gemini working inside Cue, or connect your own. */
export function AgentPanel() {
	const [tab, setTab] = useState<"chat" | "styles" | "connect">("chat");
	const focus = composer.use((s) => s.focus);
	const style = styleSelection.use((s) => s.id);
	const busy = (useApp((s) => s.jobs) ?? []).some((j) => j.state === "running");
	// Writing to the agent (from a style or a clip) goes to the chat; showing a style, to Styles.
	useEffect(() => {
		if (focus) setTab("chat");
	}, [focus]);
	useEffect(() => {
		if (style) setTab("styles");
	}, [style]);
	return (
		<div className="flex h-full flex-col">
			<div className="border-b border-separator px-4 py-2">
				<Segmented
					size="xs"
					value={tab}
					onChange={setTab}
					options={[
						{ value: "chat", label: "Chat" },
						{ value: "styles", label: "Styles" },
						{ value: "connect", label: "Connect" },
					]}
				/>
			</div>
			{tab === "chat" ? (
				<ChatView />
			) : tab === "styles" ? (
				<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto">
					<RecipesSection busy={busy} />
				</div>
			) : (
				<ConnectView />
			)}
		</div>
	);
}

const guard = (work: Promise<unknown>) =>
	void work.catch((error: Error) =>
		notify(
			error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ""),
			"danger",
		),
	);

function ChatView() {
	const project = useProject();
	const projectPath = project?.path ?? null;
	useEffect(() => void switchProjectChat(projectPath), [projectPath]);
	const current = chats.use((s) => activeChat(s));
	const [harnesses, setHarnesses] = useState<HarnessInfo[] | null>(null);
	const [history, setHistory] = useState(false);
	const [dragging, setDragging] = useState(false);
	const draft = composer.use((s) => s.text);
	const attachments = composer.use((s) => s.attachments);
	const refs = composer.use((s) => s.refs);
	const focus = composer.use((s) => s.focus);
	const list = useRef<HTMLDivElement>(null);
	const input = useRef<HTMLTextAreaElement>(null);
	const picker = useRef<HTMLInputElement>(null);
	// "Ask the agent about this…" and styles put something in the message box: go there.
	useEffect(() => {
		if (!focus) return;
		setHistory(false);
		requestAnimationFrame(() => input.current?.focus());
	}, [focus]);

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
	}, [current.id, current.items.length, current.items.at(-1)]);

	const installed = harnesses?.filter((h) => h.installed) ?? [];
	const active = harnesses?.find((h) => h.id === current.harness);
	if (harnesses && installed.length === 0)
		return <NoHarness harnesses={harnesses} onRefresh={() => refresh(true)} />;

	const canSend = !!draft.trim() || attachments.length > 0;
	const submit = (text?: string) => {
		if (text !== undefined) composer.set({ text });
		guard(send());
	};
	const images = (items: DataTransferItemList | FileList | null) =>
		[...(items ?? [])]
			.map((i) => (i instanceof File ? i : i.kind === "file" ? i.getAsFile() : null))
			.filter((f): f is File => !!f && f.type.startsWith("image/"));

	return (
		// biome-ignore lint/a11y/noStaticElementInteractions: the whole panel takes dropped screenshots; the paperclip button does the same
		<div
			className="relative flex min-h-0 flex-1 flex-col"
			onDragOver={(e) => {
				if (![...e.dataTransfer.items].some((i) => i.type.startsWith("image/"))) return;
				e.preventDefault();
				setDragging(true);
			}}
			onDragLeave={(e) => {
				if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
			}}
			onDrop={(e) => {
				const files = images(e.dataTransfer.files);
				setDragging(false);
				if (!files.length) return;
				e.preventDefault();
				guard(attachFiles(files));
			}}
		>
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
				<IconButton
					label="Conversations in this project"
					active={history}
					onClick={() => setHistory((h) => !h)}
				>
					<ClockCounterClockwise className="size-4" />
				</IconButton>
				<IconButton
					label="New conversation"
					onClick={() => {
						newChat();
						setHistory(false);
						input.current?.focus();
					}}
				>
					<NotePencil className="size-4" />
				</IconButton>
			</div>

			{history ? (
				<History harnesses={harnesses ?? []} onPick={() => setHistory(false)} />
			) : (
				<div ref={list} className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-3 py-3">
					{current.items.length === 0 ? (
						<div className="flex flex-col gap-3">
							<p className="text-[12px] leading-relaxed text-muted">
								{active?.name ?? "The agent"} edits this project with Cue's tools only: no shell,
								files or web. It sees the playhead and your selection, and every change can be
								undone. Paste or drop screenshots to show it what you mean, and keep writing while
								it works to steer it.
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
								// biome-ignore lint/suspicious/noArrayIndexKey: the transcript only grows (queued messages leave from the end)
								<Message key={i} item={item} chat={current} />
							))}
							{current.running && current.items.at(-1)?.role !== "tool" && (
								<span className="flex items-center gap-2 text-[11px] text-muted">
									<Spinner size="sm" /> Working…
								</span>
							)}
						</div>
					)}
				</div>
			)}

			<div className="border-t border-separator p-2.5">
				<div className="flex flex-col gap-1.5 rounded-lg border border-border bg-field p-1.5 focus-within:border-accent">
					{(refs.length > 0 || attachments.length > 0) && (
						<div className="flex flex-wrap gap-1 px-0.5 pt-0.5">
							{refs.map((r) => (
								<RefChip key={r.id} item={r} onRemove={() => removeRef(r.id)} />
							))}
							{attachments.map((a) => (
								<Thumb key={a.path} item={a} onRemove={() => removeAttachment(a.path)} />
							))}
						</div>
					)}
					<textarea
						ref={input}
						value={draft}
						onChange={(e) => composer.set({ text: e.target.value })}
						onPaste={(e) => {
							const files = images(e.clipboardData.items);
							if (!files.length) return;
							e.preventDefault();
							guard(attachFiles(files));
						}}
						onKeyDown={(e) => {
							e.stopPropagation();
							// Enter while composing (Japanese, Chinese…) confirms the text, it doesn't send.
							if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
								e.preventDefault();
								if (canSend) submit();
							}
						}}
						rows={Math.min(6, Math.max(1, draft.split("\n").length))}
						placeholder={
							current.running
								? "Add to it or change course…"
								: `Ask ${active?.name ?? "the agent"} to edit…`
						}
						className="max-h-40 min-w-0 resize-none bg-transparent px-1 py-1 text-[12px] leading-snug outline-none"
					/>
					<div className="flex items-center gap-1">
						<input
							ref={picker}
							type="file"
							accept="image/png,image/jpeg,image/webp,image/gif"
							multiple
							hidden
							onChange={(e) => {
								guard(attachFiles(images(e.target.files)));
								e.target.value = "";
							}}
						/>
						<IconButton
							label="Attach screenshots (or paste / drop them)"
							onClick={() => picker.current?.click()}
						>
							<Paperclip className="size-3.5" />
						</IconButton>
						<IconButton
							label="Attach the frame at the playhead"
							onClick={() => guard(attachFrame())}
						>
							<Camera className="size-3.5" />
						</IconButton>
						<span className="flex-1" />
						{current.running ? (
							<button
								type="button"
								onClick={() => stop(current.id)}
								aria-label="Stop"
								title="Stop"
								className="flex size-7 shrink-0 items-center justify-center rounded-md bg-default text-foreground hover:bg-default/70"
							>
								<Stop weight="fill" className="size-3.5" />
							</button>
						) : (
							<VoiceButton onText={(text) => submit(text)} />
						)}
						<button
							type="button"
							onClick={() => submit()}
							disabled={!canSend}
							aria-label="Send"
							title={current.running ? "Send while it works (Enter)" : "Send (Enter)"}
							className="flex size-7 shrink-0 items-center justify-center rounded-md bg-accent text-accent-foreground disabled:opacity-30"
						>
							<ArrowUp weight="bold" className="size-3.5" />
						</button>
					</div>
				</div>
				<p className="mt-1.5 flex items-center justify-between gap-2 px-0.5 text-[10px] text-muted">
					<span>{active?.version ? `${active.name} ${active.version}` : ""}</span>
					<ReviewToggle />
					{current.costUsd > 0 && <span>${current.costUsd.toFixed(3)} this chat</span>}
				</p>
			</div>
			{dragging && (
				<div className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-background/80 text-[12px] text-foreground">
					Drop screenshots to attach them
				</div>
			)}
		</div>
	);
}

function IconButton({
	label,
	onClick,
	active,
	children,
}: {
	label: string;
	onClick: () => void;
	active?: boolean;
	children: React.ReactNode;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			title={label}
			aria-label={label}
			aria-pressed={active}
			className={cn(
				"flex size-7 shrink-0 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground",
				active && "bg-default text-foreground",
			)}
		>
			{children}
		</button>
	);
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ago = (iso: string) => {
	const s = (Date.now() - Date.parse(iso)) / 1000;
	if (s < 60) return "just now";
	if (s < 3600) return `${Math.floor(s / 60)} min ago`;
	if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
	return new Date(iso).toLocaleDateString([], { day: "numeric", month: "short" });
};

/** This project's conversations, newest first. */
function History({ harnesses, onPick }: { harnesses: HarnessInfo[]; onPick: () => void }) {
	const list = chats.use((s) => s.list);
	const activeId = chats.use((s) => s.activeId);
	const shown = [...list]
		.filter((c) => c.items.length > 0 || c.id === activeId)
		.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
	return (
		<div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto p-2">
			<p className="px-1.5 pb-1.5 text-[11px] text-muted">Conversations in this project</p>
			<ul className="flex flex-col gap-0.5">
				{shown.map((c) => (
					<li key={c.id} className="group relative">
						<button
							type="button"
							onClick={() => {
								openChat(c.id);
								onPick();
							}}
							className={cn(
								"flex w-full flex-col gap-0.5 rounded-md px-2 py-1.5 pr-8 text-left hover:bg-default/60",
								c.id === activeId && "bg-default",
							)}
						>
							<span className="flex items-center gap-1.5 text-[12px] leading-snug">
								{c.running && <Spinner size="sm" className="scale-75" />}
								<span className="truncate">{c.title || "New conversation"}</span>
							</span>
							<span className="text-[10px] text-muted">
								{harnesses.find((h) => h.id === c.harness)?.name ?? c.harness} ·{" "}
								{plural(c.items.filter((i) => i.role === "user").length, "message")} ·{" "}
								{ago(c.updatedAt)}
							</span>
						</button>
						{c.items.length > 0 && (
							<button
								type="button"
								onClick={() => deleteChat(c.id)}
								title="Delete conversation"
								aria-label="Delete conversation"
								className="absolute top-1.5 right-1.5 hidden size-6 items-center justify-center rounded-md text-muted group-hover:flex hover:bg-danger/15 hover:text-danger"
							>
								<Trash className="size-3.5" />
							</button>
						)}
					</li>
				))}
			</ul>
		</div>
	);
}

function RefChip({ item, onRemove }: { item: ClipRef; onRemove?: () => void }) {
	return (
		<span
			title={item.detail}
			className="flex max-w-full items-center gap-1 rounded-md border border-accent/40 bg-accent/10 py-0.5 pr-1 pl-1.5 text-[11px] text-foreground"
		>
			<FilmStrip className="size-3 shrink-0 text-accent" />
			<span className="truncate">{item.label}</span>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label={`Remove ${item.label}`}
					className="flex size-4 items-center justify-center rounded text-muted hover:text-foreground"
				>
					<X className="size-3" />
				</button>
			)}
		</span>
	);
}

function Thumb({
	item,
	onRemove,
	large,
}: {
	item: Attachment;
	onRemove?: () => void;
	large?: boolean;
}) {
	return (
		<span className="group relative block overflow-hidden rounded-md border border-border bg-black">
			<img
				src={attachmentUrl(item.path)}
				alt="Attached screenshot"
				title={`${item.width}×${item.height}`}
				className={cn("block object-cover", large ? "max-h-40 max-w-full" : "h-12 w-16")}
			/>
			{onRemove && (
				<button
					type="button"
					onClick={onRemove}
					aria-label="Remove screenshot"
					className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded bg-black/70 text-white opacity-0 group-hover:opacity-100"
				>
					<X className="size-3" />
				</button>
			)}
		</span>
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

function Message({ item, chat }: { item: ChatItem; chat: Chat }) {
	if (item.role === "user")
		return (
			<div className="ml-6 flex flex-col items-end gap-1 self-end">
				{(item.refs?.length || item.attachments?.length) && (
					<div className="flex flex-wrap justify-end gap-1">
						{item.refs?.map((r) => (
							<RefChip key={r.id} item={r} />
						))}
						{item.attachments?.map((a) => (
							<Thumb key={a.path} item={a} large={item.attachments?.length === 1} />
						))}
					</div>
				)}
				{item.text && (
					<p
						className={cn(
							"rounded-lg bg-default px-2.5 py-1.5 text-[12px] leading-snug whitespace-pre-wrap select-text",
							item.pending && "opacity-70",
						)}
					>
						{item.text}
					</p>
				)}
				{item.pending === "steering" && (
					<span className="text-[10px] text-muted">Sent while it works…</span>
				)}
				{item.pending === "queued" && (
					<span className="flex items-center gap-2 text-[10px] text-muted">
						Queued: sends when it finishes
						<button
							type="button"
							className="text-accent hover:underline"
							onClick={() => sendNow(chat.id)}
						>
							Send now
						</button>
						<button
							type="button"
							className="hover:text-foreground hover:underline"
							onClick={() => item.uuid && unqueue(chat.id, item.uuid)}
						>
							Edit
						</button>
					</span>
				)}
			</div>
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
