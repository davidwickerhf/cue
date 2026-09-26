import type { ChatEvent, HarnessId } from "../../electron/agents/harness";
import { playback } from "./playback";
import { app, createStore, editor } from "./state";

export type ChatItem =
	| { role: "user"; text: string }
	| { role: "assistant"; text: string }
	| {
			role: "tool";
			id: string;
			name: string;
			status: "running" | "done" | "error";
			detail?: string;
	  }
	| { role: "error"; text: string };

export interface Chat {
	id: string;
	harness: HarnessId;
	model: string;
	sessionId?: string;
	items: ChatItem[];
	running: boolean;
	costUsd: number;
}

const blank = (harness: HarnessId = "claude", model = ""): Chat => ({
	id: `chat_${Date.now().toString(36)}`,
	harness,
	model,
	items: [],
	running: false,
	costUsd: 0,
});

/** The in-app agent conversation for the open project (kept per project). */
export const chat = createStore<{ chat: Chat; projectPath: string | null }>({
	chat: blank(),
	projectPath: null,
});

const storageKey = (projectPath: string) => `cue.chat.${projectPath}`;

function save() {
	const { chat: c, projectPath } = chat.get();
	if (!projectPath) return;
	try {
		localStorage.setItem(
			storageKey(projectPath),
			JSON.stringify({ ...c, running: false, items: c.items.slice(-200) }),
		);
	} catch {}
}

function update(fn: (c: Chat) => Chat) {
	chat.set({ chat: fn(chat.get().chat) });
	save();
}

/** Switches the conversation when another project opens. */
export function switchProjectChat(projectPath: string | null) {
	if (chat.get().projectPath === projectPath) return;
	let restored: Chat | null = null;
	try {
		const raw = projectPath ? localStorage.getItem(storageKey(projectPath)) : null;
		if (raw) restored = { ...(JSON.parse(raw) as Chat), running: false };
	} catch {}
	const current = chat.get().chat;
	chat.set({ projectPath, chat: restored ?? blank(current.harness, current.model) });
}

export function newChat() {
	const c = chat.get().chat;
	if (c.running) void window.cue.chatStop(c.id);
	update(() => blank(c.harness, c.model));
}

export function setHarness(harness: HarnessId, model = "") {
	const c = chat.get().chat;
	// Sessions belong to one harness; switching starts a fresh conversation.
	if (c.harness !== harness) update(() => blank(harness, model));
	else update((x) => ({ ...x, model }));
}

const clock = (ms: number) => {
	const s = Math.max(0, ms) / 1000;
	return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** What the user is looking at, so "this clip" and "here" mean something. */
function editorContext(): string {
	const state = app.get().state;
	const project = state?.project;
	if (!project) return "";
	const ids = state.selectedClipIds ?? [];
	const selected = project.data.clips
		.filter((c) => ids.includes(c.id))
		.slice(0, 8)
		.map(
			(c) =>
				`${c.id} (${c.type === "text" ? `text "${c.text.slice(0, 30)}"` : "media"} on ${c.trackId}, ${clock(c.startMs)}–${clock(c.startMs + c.durationMs)})`,
		);
	const { inPoint, outPoint } = editor.get();
	return [
		`[Editor: playhead ${clock(playback.currentMs)}`,
		selected.length ? `; selected ${selected.join(", ")}` : "; nothing selected",
		inPoint !== null || outPoint !== null
			? `; in ${inPoint === null ? "-" : clock(inPoint)} out ${outPoint === null ? "-" : clock(outPoint)}`
			: "",
		"]",
	].join("");
}

export async function send(text: string) {
	const c = chat.get().chat;
	if (c.running || !text.trim()) return;
	update((x) => ({
		...x,
		running: true,
		items: [...x.items, { role: "user", text: text.trim() }],
	}));
	const context = editorContext();
	try {
		await window.cue.chatSend(c.id, {
			harness: c.harness,
			prompt: context ? `${context}\n\n${text.trim()}` : text.trim(),
			sessionId: c.sessionId,
			model: c.model || undefined,
		});
	} catch (error) {
		const message = (error as Error).message.replace(
			/^Error invoking remote method '[^']+': (Error: )?/,
			"",
		);
		update((x) => ({
			...x,
			running: false,
			items: [...x.items, { role: "error", text: message }],
		}));
	}
}

export function stop() {
	void window.cue.chatStop(chat.get().chat.id);
}

function apply(event: ChatEvent) {
	update((c) => {
		const items = [...c.items];
		const last = items.at(-1);
		switch (event.kind) {
			case "session":
				return { ...c, sessionId: event.sessionId };
			case "text":
				if (last?.role === "assistant")
					items[items.length - 1] = {
						role: "assistant",
						text: event.delta ? last.text + event.text : `${last.text}\n\n${event.text}`,
					};
				else items.push({ role: "assistant", text: event.text });
				return { ...c, items };
			case "tool": {
				const at = items.findIndex((i) => i.role === "tool" && i.id === event.id);
				if (at >= 0) {
					const prev = items[at] as Extract<ChatItem, { role: "tool" }>;
					items[at] = {
						...prev,
						status: event.status,
						detail: event.detail ?? prev.detail,
						name: event.name || prev.name,
					};
				} else
					items.push({
						role: "tool",
						id: event.id,
						name: event.name,
						status: event.status,
						detail: event.detail,
					});
				return { ...c, items };
			}
			case "done": {
				// Anything still marked running when the turn ends did not report back.
				const settled = items.map((i) =>
					i.role === "tool" && i.status === "running"
						? { ...i, status: event.error ? ("error" as const) : ("done" as const) }
						: i,
				);
				if (event.error && event.error !== "Stopped")
					settled.push({ role: "error", text: event.error });
				return { ...c, items: settled, running: false, costUsd: c.costUsd + (event.costUsd ?? 0) };
			}
		}
	});
}

export function startChatSync() {
	return window.cue.onChatEvent((chatId, event) => {
		if (chatId === chat.get().chat.id) apply(event);
	});
}
