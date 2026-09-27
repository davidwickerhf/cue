import type { ChatEvent, HarnessId } from "../../electron/agents/harness";
import type { Clip } from "../../electron/core/types";
import { playback } from "./playback";
import { app, createStore, editor } from "./state";

/** A picture attached to a message: a PNG kept next to the project (.cue-chat). */
export interface Attachment {
	path: string;
	width: number;
	height: number;
}

/** Something in the edit the message is about, pinned when it was picked (not whatever is selected later). */
export interface ClipRef {
	kind: "clip";
	id: string;
	/** Short, for the chip: "V2 · Hero typing". */
	label: string;
	/** Everything the agent needs to find and understand it. */
	detail: string;
}

export type ChatItem =
	| {
			role: "user";
			text: string;
			attachments?: Attachment[];
			refs?: ClipRef[];
			uuid?: string;
			/** queued: waits for the agent to finish; steering: handed to it mid-turn, not yet read. */
			pending?: "queued" | "steering";
	  }
	| { role: "assistant"; text: string }
	| {
			role: "tool";
			id: string;
			name: string;
			status: "running" | "done" | "error";
			detail?: string;
	  }
	| { role: "error"; text: string };

type UserItem = Extract<ChatItem, { role: "user" }>;

export interface Chat {
	id: string;
	title: string;
	createdAt: string;
	updatedAt: string;
	harness: HarnessId;
	model: string;
	sessionId?: string;
	items: ChatItem[];
	running: boolean;
	costUsd: number;
}

const blank = (harness: HarnessId = "claude", model = ""): Chat => {
	const now = new Date().toISOString();
	return {
		id: `chat_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
		title: "",
		createdAt: now,
		updatedAt: now,
		harness,
		model,
		items: [],
		running: false,
		costUsd: 0,
	};
};

/** The open project's conversations, the one on screen first among equals. */
export const chats = createStore<{ list: Chat[]; activeId: string; dir: string | null }>(
	(() => {
		const first = blank();
		return { list: [first], activeId: first.id, dir: null };
	})(),
);

export const activeChat = (s = chats.get()) => s.list.find((c) => c.id === s.activeId) ?? s.list[0];

/** What is being written: text, pictures and pinned clips. */
export const composer = createStore<{
	text: string;
	attachments: Attachment[];
	refs: ClipRef[];
	/** Bumped to put the cursor in the message box. */
	focus: number;
}>({ text: "", attachments: [], refs: [], focus: 0 });

/** Starts a message with this text (e.g. from a style's "Ask the agent"). */
export function draftMessage(text: string) {
	composer.set((c) => ({ text, focus: c.focus + 1 }));
	editor.set({ panel: "agent" });
}

export const attachmentUrl = (file: string) => `cue-media://local/${encodeURIComponent(file)}`;

// ---------------------------------------------------------------------------
// Saving: .cue-chat/chats.json next to the project
// ---------------------------------------------------------------------------

const KEEP_ITEMS = 400;
const KEEP_CHATS = 60;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function write() {
	saveTimer = undefined;
	const { list, activeId, dir } = chats.get();
	if (!dir) return;
	const kept = list
		.filter((c) => c.items.length > 0)
		.slice(0, KEEP_CHATS)
		.map((c) => ({
			...c,
			running: false,
			items: c.items
				.slice(-KEEP_ITEMS)
				.map((i) => (i.role === "user" ? { ...i, pending: undefined } : i)),
		}));
	void window.cue.chatSave(dir, { version: 1, activeId, chats: kept }).catch(() => {});
}

/** Saves shortly after the last change, not on every streamed word. */
function save() {
	clearTimeout(saveTimer);
	saveTimer = setTimeout(write, 500);
}

function flushSave() {
	if (saveTimer === undefined) return;
	clearTimeout(saveTimer);
	write();
}

window.addEventListener("beforeunload", flushSave);

function updateChat(id: string, fn: (c: Chat) => Chat) {
	chats.set((s) => ({
		list: s.list.map((c) => (c.id === id ? { ...fn(c), updatedAt: new Date().toISOString() } : c)),
	}));
	save();
}

/** The conversation from before history (one per project, kept in the window's storage). */
function legacyChat(projectPath: string | null): Chat | null {
	if (!projectPath) return null;
	try {
		const raw = localStorage.getItem(`cue.chat.${projectPath}`);
		if (!raw) return null;
		const old = JSON.parse(raw) as Chat;
		if (!old.items?.length) return null;
		const now = new Date().toISOString();
		return {
			...blank(old.harness, old.model),
			...old,
			title: old.title || titleOf(old.items),
			createdAt: now,
			updatedAt: now,
			running: false,
		};
	} catch {
		return null;
	}
}

let loading = 0;
/** Loads the conversations of the project that just opened. */
export async function switchProjectChat(projectPath: string | null) {
	const token = ++loading;
	flushSave();
	const current = activeChat();
	const loaded = projectPath ? await window.cue.chatLoad().catch(() => null) : null;
	if (token !== loading) return;
	const dir = loaded?.dir ?? null;
	if (dir && dir === chats.get().dir) return;
	const data = loaded?.data as { activeId?: string; chats?: Chat[] } | null | undefined;
	let list = (data?.chats ?? []).map((c) => ({ ...c, running: false }));
	if (list.length === 0) {
		const old = legacyChat(projectPath);
		if (old) list = [old];
	}
	const fresh = blank(current.harness, current.model);
	const activeId = list.some((c) => c.id === data?.activeId)
		? (data?.activeId as string)
		: (list[0]?.id ?? fresh.id);
	chats.set({ dir, list: list.length ? list : [fresh], activeId });
	composer.set({ text: "", attachments: [], refs: [] });
}

export function newChat() {
	const c = activeChat();
	// An empty conversation is reused rather than stacked.
	if (c.items.length === 0) return;
	const next = blank(c.harness, c.model);
	chats.set((s) => ({ list: [next, ...s.list], activeId: next.id }));
	save();
}

export function openChat(id: string) {
	chats.set((s) => ({
		// Leaving an empty conversation drops it.
		list: s.list.filter((c) => c.id === id || c.items.length > 0 || c.running),
		activeId: id,
	}));
	save();
}

export function deleteChat(id: string) {
	const s = chats.get();
	const doomed = s.list.find((c) => c.id === id);
	if (doomed?.running) void window.cue.chatStop(id);
	const rest = s.list.filter((c) => c.id !== id);
	const list = rest.length ? rest : [blank(doomed?.harness, doomed?.model)];
	chats.set({ list, activeId: s.activeId === id ? list[0].id : s.activeId });
	save();
}

export function setHarness(harness: HarnessId, model = "") {
	const c = activeChat();
	// Sessions belong to one harness: switching in a conversation that has started starts another.
	if (c.harness !== harness && c.items.length > 0) {
		const next = blank(harness, model);
		chats.set((s) => ({ list: [next, ...s.list], activeId: next.id }));
		save();
	} else updateChat(c.id, (x) => ({ ...x, harness, model }));
}

function titleOf(items: ChatItem[]) {
	const first = items.find((i): i is UserItem => i.role === "user");
	const text =
		first?.text.replace(/\s+/g, " ").trim() || (first?.attachments?.length ? "Screenshot" : "");
	return text.length > 60 ? `${text.slice(0, 57)}…` : text;
}

// ---------------------------------------------------------------------------
// What the agent is told besides the words
// ---------------------------------------------------------------------------

const clock = (ms: number) => {
	const s = Math.max(0, ms) / 1000;
	return `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;
};

/** What the user is looking at, so "here" and "now" mean something. */
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

/** A clip pinned to a message: enough for the agent to act on it without looking it up first. */
export function clipRef(clip: Clip): ClipRef {
	const data = app.get().state?.project?.data;
	const track = data?.tracks.find((t) => t.id === clip.trackId);
	const trackName = track
		? `${track.id}${track.name && track.name !== track.id ? ` "${track.name}"` : ""}`
		: clip.trackId;
	const span = `${clock(clip.startMs)}–${clock(clip.startMs + clip.durationMs)} (${(clip.durationMs / 1000).toFixed(2)} s)`;
	if (clip.type === "text") {
		const kind =
			clip.source?.kind === "caption"
				? "caption"
				: clip.infographic
					? "infographic"
					: clip.dataCallout
						? "data callout"
						: clip.shape
							? "shape"
							: "text";
		const words = clip.text.replace(/\s+/g, " ").trim();
		const label =
			clip.name || (words ? `“${words.length > 24 ? `${words.slice(0, 22)}…` : words}”` : kind);
		return {
			kind: "clip",
			id: clip.id,
			label: `${track?.name || clip.trackId} · ${label}`,
			detail: `${clip.id}: ${kind} clip${clip.name ? ` "${clip.name}"` : ""} on track ${trackName}, ${span} on the timeline${words ? `, text "${words.slice(0, 200)}"` : ""}${clip.disabled ? ", disabled" : ""}.`,
		};
	}
	const asset = data?.assets.find((a) => a.id === clip.assetId);
	const name = clip.name || asset?.name || clip.assetId;
	const source = `${clock(clip.inMs)}–${clock(clip.inMs + clip.durationMs * clip.speed)}`;
	const extras = [
		clip.speed !== 1 ? `speed ${+clip.speed.toFixed(3)}×` : "",
		clip.keyframes && Object.keys(clip.keyframes).length
			? `keyframed ${Object.keys(clip.keyframes).join(", ")}`
			: "",
		clip.effects ? "effects" : "",
		clip.color ? "colour grade" : "",
		clip.transitionIn ? `transition in (${clip.transitionIn.kind})` : "",
		clip.groupId ? `grouped (${clip.groupId})` : "",
	].filter(Boolean);
	return {
		kind: "clip",
		id: clip.id,
		label: `${track?.name || clip.trackId} · ${name}`,
		detail: `${clip.id}: ${asset?.kind ?? "media"} clip "${name}" (asset ${clip.assetId}${asset ? `, ${asset.origin}` : ""}) on track ${trackName}, ${span} on the timeline, source ${source}${extras.length ? `; ${extras.join("; ")}` : ""}.`,
	};
}

/** "Ask the agent about this…": pins the clips to the message being written. */
export function askAbout(ids: string[]) {
	const clips = app.get().state?.project?.data.clips ?? [];
	const picked = ids
		.map((id) => clips.find((c) => c.id === id))
		.filter((c): c is Clip => !!c)
		.slice(0, 12);
	composer.set((c) => ({
		refs: [...c.refs.filter((r) => !ids.includes(r.id)), ...picked.map(clipRef)],
		focus: c.focus + 1,
	}));
	editor.set({ panel: "agent" });
}

function promptFor(text: string, refs: ClipRef[] = [], attachments: Attachment[] = []) {
	const parts = [editorContext()];
	if (refs.length)
		parts.push(
			`[The user is pointing at ${refs.length === 1 ? "this clip" : "these clips"} ("this", "it" and "these" mean ${refs.length === 1 ? "it" : "them"}):\n${refs.map((r) => `- ${r.detail}`).join("\n")}]`,
		);
	if (attachments.length)
		parts.push(
			`[The user attached ${attachments.length === 1 ? "a screenshot" : `${attachments.length} screenshots`} for context.]`,
		);
	parts.push(text.trim() || "(See the attachment.)");
	return parts.filter(Boolean).join("\n\n");
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

const uuid = () => crypto.randomUUID();
const errorText = (error: unknown) =>
	(error as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

async function startTurn(chatId: string, prompt: string, images: string[], id: string) {
	const c = chats.get().list.find((x) => x.id === chatId);
	if (!c) return;
	updateChat(chatId, (x) => ({ ...x, running: true }));
	try {
		await window.cue.chatSend(chatId, {
			harness: c.harness,
			prompt,
			sessionId: c.sessionId,
			model: c.model || undefined,
			images,
			uuid: id,
		});
	} catch (error) {
		updateChat(chatId, (x) => ({
			...x,
			running: false,
			items: [
				...x.items.map((i) => (i.role === "user" && i.pending ? { ...i, pending: undefined } : i)),
				{ role: "error", text: errorText(error) },
			],
		}));
	}
}

/**
 * Sends what is in the composer. While the agent works, the message steers it:
 * Claude reads it at its next step; other agents get it as soon as they finish.
 */
export async function send(text = composer.get().text) {
	const { attachments, refs } = composer.get();
	if (!text.trim() && attachments.length === 0) return;
	const c = activeChat();
	const item: UserItem = {
		role: "user",
		text: text.trim(),
		...(attachments.length ? { attachments } : {}),
		...(refs.length ? { refs } : {}),
		uuid: uuid(),
	};
	composer.set({ text: "", attachments: [], refs: [] });
	const prompt = promptFor(item.text, refs, attachments);
	const images = attachments.map((a) => a.path);
	if (c.running) {
		updateChat(c.id, (x) => ({ ...x, items: [...x.items, { ...item, pending: "steering" }] }));
		const taken = await window.cue
			.chatSteer(c.id, { prompt, images, uuid: item.uuid as string })
			.catch(() => false);
		if (!taken) setPending(c.id, item.uuid as string, "queued");
		return;
	}
	updateChat(c.id, (x) => ({
		...x,
		title: x.title || titleOf([item]),
		items: [...x.items, item],
	}));
	await startTurn(c.id, prompt, images, item.uuid as string);
}

function setPending(chatId: string, id: string, pending: UserItem["pending"]) {
	updateChat(chatId, (x) => ({
		...x,
		items: x.items.map((i) => (i.role === "user" && i.uuid === id ? { ...i, pending } : i)),
	}));
}

/** The queued messages go out together as the next turn. */
function sendQueued(chatId: string) {
	const c = chats.get().list.find((x) => x.id === chatId);
	const queued = (c?.items ?? []).filter((i): i is UserItem => i.role === "user" && !!i.pending);
	if (!c || queued.length === 0) return;
	const text = queued
		.map((q) => q.text)
		.filter(Boolean)
		.join("\n\n");
	const refs = queued.flatMap((q) => q.refs ?? []);
	const attachments = queued.flatMap((q) => q.attachments ?? []);
	const id = uuid();
	updateChat(chatId, (x) => ({
		...x,
		items: x.items.map((i) => (i.role === "user" && i.pending ? { ...i, pending: undefined } : i)),
	}));
	void startTurn(
		chatId,
		promptFor(text, refs, attachments),
		attachments.map((a) => a.path),
		id,
	);
}

export function stop(chatId = activeChat().id) {
	void window.cue.chatStop(chatId);
}

/** Queued messages: stop the current turn and send them now. */
export const sendNow = (chatId = activeChat().id) => stop(chatId);

/** Takes a queued message back into the composer. */
export function unqueue(chatId: string, id: string) {
	const c = chats.get().list.find((x) => x.id === chatId);
	const item = c?.items.find((i): i is UserItem => i.role === "user" && i.uuid === id);
	if (!c || !item || item.pending !== "queued") return;
	updateChat(chatId, (x) => ({ ...x, items: x.items.filter((i) => i !== item) }));
	composer.set((s) => ({
		text: item.text,
		attachments: item.attachments ?? [],
		refs: item.refs ?? [],
		focus: s.focus + 1,
	}));
}

function apply(chatId: string, event: ChatEvent) {
	let flush = false;
	updateChat(chatId, (c) => {
		const items = [...c.items];
		const last = items.at(-1);
		switch (event.kind) {
			case "session":
				return { ...c, sessionId: event.sessionId };
			case "ack":
				return {
					...c,
					items: items.map((i) =>
						i.role === "user" && i.uuid === event.uuid ? { ...i, pending: undefined } : i,
					),
				};
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
				const settled: ChatItem[] = items.map((i) =>
					i.role === "tool" && i.status === "running"
						? { ...i, status: event.error ? ("error" as const) : ("done" as const) }
						: // A message handed over mid-turn that the agent never read waits for the next turn.
							i.role === "user" && i.pending === "steering"
							? { ...i, pending: "queued" as const }
							: i,
				);
				if (event.error && event.error !== "Stopped")
					settled.push({ role: "error", text: event.error });
				flush = settled.some((i) => i.role === "user" && i.pending === "queued");
				return { ...c, items: settled, running: false, costUsd: c.costUsd + (event.costUsd ?? 0) };
			}
		}
	});
	if (flush) sendQueued(chatId);
}

export function startChatSync() {
	return window.cue.onChatEvent((chatId, event) => {
		if (chats.get().list.some((c) => c.id === chatId)) apply(chatId, event);
	});
}

// ---------------------------------------------------------------------------
// Attaching pictures
// ---------------------------------------------------------------------------

const MAX_ATTACHMENTS = 6;

export async function attachFiles(files: Iterable<File>) {
	for (const file of files) {
		if (!file.type.startsWith("image/")) continue;
		if (composer.get().attachments.length >= MAX_ATTACHMENTS) break;
		const saved = await window.cue.chatAttach(await file.arrayBuffer());
		composer.set((c) => ({ attachments: [...c.attachments, saved] }));
	}
}

/** The viewer at the playhead, as the agent would see it with render_frame. */
export async function attachFrame() {
	if (composer.get().attachments.length >= MAX_ATTACHMENTS) return;
	const saved = await window.cue.chatAttachFrame(playback.currentMs);
	composer.set((c) => ({ attachments: [...c.attachments, saved] }));
}

export function removeAttachment(path: string) {
	composer.set((c) => ({ attachments: c.attachments.filter((a) => a.path !== path) }));
}

export function removeRef(id: string) {
	composer.set((c) => ({ refs: c.refs.filter((r) => r.id !== id) }));
}
