import { Button, Spinner } from "@heroui/react";
import {
	ArrowLeft,
	CaretRight,
	ClosedCaptioning,
	Crop,
	FilmStrip,
	Image as ImageIcon,
	ListNumbers,
	MagnifyingGlass,
	MusicNote,
	MusicNotes,
	Pause,
	Play,
	Scroll,
	Sparkle,
	UserSound,
	VideoCamera,
	Waveform,
} from "@phosphor-icons/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { CLIP_MODELS, DEFAULT_CLIP_MODEL } from "../../../electron/core/clipModels";
import { ELEVEN_MODELS } from "../../../electron/core/elevenlabs";
import type { ProjectSnapshot } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { appSettings, createStore, openSettings, useApp, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Field, Section, Segmented, TextInput, Toggle } from "../ui/controls";
import { BeatTools, BrollTools, ChapterTools, ReframeTools, ShotSearch } from "./AiTools";

const VOICES = [
	"cedar",
	"marin",
	"alloy",
	"ash",
	"ballad",
	"coral",
	"echo",
	"fable",
	"nova",
	"onyx",
	"sage",
	"shimmer",
	"verse",
];

/** OpenAI speech models. The undated name follows OpenAI's newest version. */
const TTS_MODELS = [
	{ id: "gpt-4o-mini-tts", label: "Newest (steerable)" },
	{ id: "tts-1-hd", label: "tts-1-hd" },
	{ id: "tts-1", label: "tts-1 (fast)" },
];

type Capability = "tts" | "transcription" | "text" | "image" | "sound" | "video";
type ToolId =
	| "voice"
	| "captions"
	| "image"
	| "sound"
	| "score"
	| "clip"
	| "script"
	| "shots"
	| "broll"
	| "music"
	| "chapters"
	| "reframe";

interface Tool {
	id: ToolId;
	group: "Make" | "Find" | "Shape";
	label: string;
	/** One line: what it gives you. */
	blurb: string;
	icon: ReactNode;
	/** The model it needs (shown as "Set up" when it isn't ready). */
	needs?: Capability;
	/** The optional service behind it, which the user connects with their own key. */
	service?: "ElevenLabs" | "Higgsfield";
	/** Why it can't be used in this project yet, if it can't. */
	unavailable?: (project: ProjectSnapshot) => string | null;
}

const icon = "size-4";
const TOOLS: Tool[] = [
	{
		id: "voice",
		group: "Make",
		label: "Voiceover",
		blurb: "Voice the script's lines.",
		icon: <UserSound className={icon} />,
		needs: "tts",
		unavailable: (p) => (p.lines.length ? null : "Write script lines first (Voiceover panel)."),
	},
	{
		id: "captions",
		group: "Make",
		label: "Captions",
		blurb: "Timed captions from the voiceover.",
		icon: <ClosedCaptioning className={icon} />,
		needs: "transcription",
	},
	{
		id: "image",
		group: "Make",
		label: "Image",
		blurb: "A picture from a description, at the playhead.",
		icon: <ImageIcon className={icon} />,
		needs: "image",
	},
	{
		id: "sound",
		group: "Make",
		label: "Sound effect",
		blurb: "A realistic sound from a description, at the playhead.",
		icon: <Waveform className={icon} />,
		needs: "sound",
		service: "ElevenLabs",
	},
	{
		id: "score",
		group: "Make",
		label: "Music",
		blurb: "A music bed from a description, on the music track.",
		icon: <MusicNote className={icon} />,
		needs: "sound",
		service: "ElevenLabs",
	},
	{
		id: "clip",
		group: "Make",
		label: "Video clip",
		blurb: "A short shot from a prompt or a still, at the playhead.",
		icon: <VideoCamera className={icon} />,
		needs: "video",
		service: "Higgsfield",
	},
	{
		id: "script",
		group: "Make",
		label: "Script from footage",
		blurb: "Turn what's said in a video into script lines.",
		icon: <Scroll className={icon} />,
		needs: "transcription",
		unavailable: (p) => (spokenVideo(p) ? null : "Needs a video with sound."),
	},
	{
		id: "shots",
		group: "Find",
		label: "Shots",
		blurb: "Search your footage by what's in it.",
		icon: <MagnifyingGlass className={icon} />,
	},
	{
		id: "broll",
		group: "Find",
		label: "B-roll",
		blurb: "Cutaway ideas for the moments in the transcript.",
		icon: <FilmStrip className={icon} />,
	},
	{
		id: "music",
		group: "Shape",
		label: "Cut to the music",
		blurb: "Beat markers, and cuts on the beat.",
		icon: <MusicNotes className={icon} />,
		unavailable: (p) => (musicIn(p) ? null : "Put music on the timeline first."),
	},
	{
		id: "chapters",
		group: "Shape",
		label: "Chapters",
		blurb: "Chapter markers and a list for YouTube.",
		icon: <ListNumbers className={icon} />,
	},
	{
		id: "reframe",
		group: "Shape",
		label: "Reframe",
		blurb: "Vertical, square or 4:5 versions that follow the subject.",
		icon: <Crop className={icon} />,
	},
];

const spokenVideo = (p: ProjectSnapshot) =>
	p.data.assets.find((a) => a.kind === "video" && a.hasAudio);
const musicIn = (p: ProjectSnapshot) => {
	const used = new Set(p.data.clips.flatMap((c) => (c.type === "media" ? [c.assetId] : [])));
	return p.data.assets.some((a) => used.has(a.id) && a.hasAudio && !a.lineId);
};

/** The tool open in the panel (kept while switching panels). */
const openTool = createStore<{ id: ToolId | null }>({ id: null });

/**
 * Generate: AI tools that make, find and shape material, as a short list. Each
 * opens on its own with just its controls. Models are set up in Settings → AI;
 * the style library is in the Agent panel.
 */
export function GeneratePanel() {
	const project = useProject();
	const status = useApp((s) => s.ai.status) ?? [];
	const id = openTool.use((s) => s.id);
	if (!project) return null;
	const ready = (c?: Capability) => !c || !!status.find((x) => x.capability === c)?.ready;
	const tool = TOOLS.find((t) => t.id === id);

	if (tool)
		return (
			<div className="flex flex-col">
				<button
					type="button"
					onClick={() => openTool.set({ id: null })}
					className="flex items-center gap-1.5 border-b border-separator px-4 py-2 text-[12px] text-muted hover:text-foreground"
				>
					<ArrowLeft className="size-3.5" /> All tools
				</button>
				<ToolView id={tool.id} project={project} />
			</div>
		);

	return (
		<div className="flex flex-col gap-4 px-3 py-3">
			{(["Make", "Find", "Shape"] as const).map((group) => (
				<div key={group} className="flex flex-col gap-0.5">
					<p className="px-2 pb-1 text-[11px] font-medium text-muted">{group}</p>
					{TOOLS.filter((t) => t.group === group).map((t) => {
						const why = t.unavailable?.(project) ?? null;
						const setUp = !ready(t.needs);
						return (
							<button
								key={t.id}
								type="button"
								onClick={() => openTool.set({ id: t.id })}
								className="group flex items-center gap-2.5 rounded-md px-2 py-2 text-left hover:bg-default/60"
							>
								<span
									className={cn(
										"flex size-8 shrink-0 items-center justify-center rounded-md bg-default text-foreground/80",
										(why || setUp) && "opacity-50",
									)}
								>
									{t.icon}
								</span>
								<span className="flex min-w-0 flex-1 flex-col">
									<span className="text-[12px] font-medium">{t.label}</span>
									<span className="truncate text-[11px] text-muted">
										{setUp
											? t.service
												? `Connect ${t.service} in Settings → AI.`
												: "Set up its model in Settings → AI."
											: (why ?? t.blurb)}
									</span>
								</span>
								<CaretRight className="size-3.5 shrink-0 text-muted opacity-0 group-hover:opacity-100" />
							</button>
						);
					})}
				</div>
			))}
			<div className="flex items-center justify-between gap-2 px-2 text-[11px] text-muted">
				<span className="flex items-center gap-1.5">
					<Sparkle className="size-3" /> Generated media is marked AI.
				</span>
				<button type="button" onClick={() => openSettings("ai")} className="hover:text-foreground">
					Models…
				</button>
			</div>
		</div>
	);
}

function ToolView({ id, project }: { id: ToolId; project: ProjectSnapshot }) {
	switch (id) {
		case "voice":
			return <VoiceTool project={project} />;
		case "captions":
			return <CaptionsTool />;
		case "image":
			return <ImageTool project={project} />;
		case "sound":
			return <SoundTool />;
		case "score":
			return <MusicTool />;
		case "clip":
			return <ClipTool project={project} />;
		case "script":
			return <ScriptTool project={project} />;
		case "shots":
			return <ShotSearch project={project} />;
		case "broll":
			return <BrollTools />;
		case "music":
			return <BeatTools project={project} />;
		case "chapters":
			return <ChapterTools />;
		case "reframe":
			return <ReframeTools project={project} />;
	}
}

function useCapability(c: Capability) {
	const status = useApp((s) => s.ai.status) ?? [];
	return status.find((x) => x.capability === c);
}

const useBusy = () => (useApp((s) => s.jobs) ?? []).some((j) => j.state === "running");

function VoiceTool({ project }: { project: ProjectSnapshot }) {
	const tts = useCapability("tts");
	const busy = useBusy();
	const settings = appSettings.use((s) => s.settings);
	const ai = project.data.ai;
	const missing = project.lines.filter((l) => l.status === "empty").length;
	const provider = settings?.ai.tts ?? "openai";
	return (
		<Section title="Voiceover">
			{!tts?.ready && (
				<Problem text={tts?.problem} action={provider === "elevenlabs" ? "Connect" : undefined} />
			)}
			{provider === "elevenlabs" ? (
				<ElevenVoice project={project} ready={!!tts?.ready} />
			) : provider === "openai" ? (
				<>
					<div className="grid grid-cols-2 gap-2">
						<Field label="Voice">
							<select
								value={ai.voice}
								onChange={(e) => void run("update_ai", { ai: { voice: e.target.value } })}
								className="h-8 rounded-lg border border-border bg-field px-2 text-[13px] outline-none focus:border-accent"
							>
								{VOICES.map((v) => (
									<option key={v} value={v}>
										{v}
									</option>
								))}
							</select>
						</Field>
						<Field label="Model">
							<select
								value={ai.ttsModel}
								onChange={(e) => void run("update_ai", { ai: { ttsModel: e.target.value } })}
								className="h-8 rounded-lg border border-border bg-field px-2 text-[13px] outline-none focus:border-accent"
							>
								{TTS_MODELS.map((m) => (
									<option key={m.id} value={m.id}>
										{m.label}
									</option>
								))}
								{!TTS_MODELS.some((m) => m.id === ai.ttsModel) && (
									<option value={ai.ttsModel}>{ai.ttsModel} (pinned)</option>
								)}
							</select>
						</Field>
					</div>
					<Field label="Delivery" hint="How the voice should sound. Applies to new takes.">
						<TextInput
							multiline
							rows={2}
							value={ai.voiceInstructions}
							onCommit={(voiceInstructions) => void run("update_ai", { ai: { voiceInstructions } })}
						/>
					</Field>
				</>
			) : (
				<p className="text-[12px] text-muted">
					Speaking with the macOS voice {settings?.ai.macVoice || "set in your system"}, on this
					Mac. Change it in Settings.
				</p>
			)}
			<Button
				variant="primary"
				className="w-full gap-2"
				isDisabled={busy || project.lines.length === 0 || !tts?.ready}
				onPress={async () => {
					const result = await run<unknown[]>("generate_voiceover", { onlyMissing: missing > 0 });
					if (result) notify(`Generated ${result.length} take(s)`, "success");
				}}
			>
				<UserSound className="size-4" />
				{project.lines.length === 0
					? "No script lines yet"
					: missing > 0
						? `Voice ${missing} missing line${missing === 1 ? "" : "s"}`
						: "Regenerate every line"}
			</Button>
		</Section>
	);
}

function CaptionsTool() {
	const stt = useCapability("transcription");
	const busy = useBusy();
	return (
		<Section title="Captions">
			<p className="text-[12px] leading-relaxed text-muted">
				Transcribes the voiceover track and adds timed captions on a new track. Edit them like any
				text clip.
			</p>
			{!stt?.ready && <Problem text={stt?.problem} />}
			<Button
				variant="primary"
				className="w-full gap-2"
				isDisabled={busy || !stt?.ready}
				onPress={async () => {
					const result = await run<{ count: number }>("auto_captions", { source: "voiceover" });
					if (result) notify(`Added ${result.count} captions`, "success");
				}}
			>
				<ClosedCaptioning className="size-4" /> Caption the voiceover
			</Button>
		</Section>
	);
}

function ImageTool({ project }: { project: ProjectSnapshot }) {
	const image = useCapability("image");
	const busy = useBusy();
	const [prompt, setPrompt] = useState("");
	const [orientation, setOrientation] = useState<"landscape" | "portrait" | "square">("landscape");
	return (
		<Section title="Image">
			{!image?.ready && <Problem text={image?.problem} />}
			<TextInput
				multiline
				rows={3}
				value={prompt}
				onCommit={setPrompt}
				placeholder="A clean title card with a film reel on a soft blue gradient…"
			/>
			<div className="flex items-center justify-between gap-2">
				<Segmented
					size="xs"
					value={orientation}
					onChange={setOrientation}
					options={[
						{ value: "landscape", label: "16:9" },
						{ value: "portrait", label: "9:16" },
						{ value: "square", label: "1:1" },
					]}
				/>
				<Button
					size="sm"
					variant="primary"
					className="gap-1.5"
					isDisabled={busy || prompt.trim().length < 3 || !image?.ready}
					onPress={async () => {
						const track = project.data.tracks.find((t) => t.kind === "video" && !t.locked);
						const result = await run("generate_image", {
							prompt,
							orientation,
							trackId: track?.id,
							startMs: Math.round(playback.currentMs),
						});
						if (result) notify("Image added at the playhead", "success");
					}}
				>
					<ImageIcon className="size-4" /> Generate
				</Button>
			</div>
		</Section>
	);
}

function ScriptTool({ project }: { project: ProjectSnapshot }) {
	const stt = useCapability("transcription");
	const busy = useBusy();
	const video = spokenVideo(project);
	return (
		<Section title="Script from footage">
			{!video ? (
				<p className="text-[12px] text-muted">Import a video with sound first.</p>
			) : (
				<>
					<p className="text-[12px] leading-relaxed text-muted">
						Turns the speech in {video.name} into script lines, timed where they are spoken, so you
						can re-record them.
					</p>
					{!stt?.ready && <Problem text={stt?.problem} />}
					<Button
						variant="primary"
						className="w-full gap-2"
						isDisabled={busy || !stt?.ready}
						onPress={async () => {
							const result = await run<{ lines: number }>("script_from_media", {
								assetId: video.id,
								replace: project.lines.length === 0,
							});
							if (result) notify(`Created ${result.lines} lines`, "success");
						}}
					>
						<Scroll className="size-4" /> Transcribe into a script
					</Button>
				</>
			)}
		</Section>
	);
}

function Problem({ text, action = "Set up" }: { text?: string; action?: string }) {
	return (
		<p className="rounded-md bg-warning/10 px-2.5 py-2 text-[12px] text-warning">
			{(text ?? "Not set up").replace(/\.?$/, ".")}{" "}
			<button
				type="button"
				className="underline underline-offset-2"
				onClick={() => openSettings("ai")}
			>
				{action}
			</button>
		</p>
	);
}

const selectClass =
	"h-8 rounded-lg border border-border bg-field px-2 text-[13px] outline-none focus:border-accent";

/** The running job whose label matches, as a thin progress bar with its label. */
function JobProgress({ match }: { match: RegExp }) {
	const job = (useApp((s) => s.jobs) ?? []).find(
		(j) => j.state === "running" && match.test(j.label),
	);
	if (!job) return null;
	return (
		<div className="flex flex-col gap-1">
			<div className="h-1 overflow-hidden rounded-full bg-default">
				<div
					className={cn(
						"h-full rounded-full bg-accent transition-[width] duration-500",
						job.progress === null && "w-1/3 animate-pulse",
					)}
					style={job.progress !== null ? { width: `${Math.round(job.progress * 100)}%` } : {}}
				/>
			</div>
			<p className="text-[11px] text-muted">{job.label}…</p>
		</div>
	);
}

type Voice = {
	id: string;
	name: string;
	category?: string;
	labels: Record<string, string>;
	previewUrl?: string;
	chosen?: boolean;
};

/** Voiceover with ElevenLabs: search the account's voices, hear a preview, pick one and a model. */
function ElevenVoice({ project, ready }: { project: ProjectSnapshot; ready: boolean }) {
	const ai = project.data.ai;
	const [search, setSearch] = useState("");
	const [voices, setVoices] = useState<Voice[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [playing, setPlaying] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);
	useEffect(() => {
		if (!ready) return;
		let stale = false;
		setLoading(true);
		// Wait for typing to pause before asking ElevenLabs.
		const timer = setTimeout(async () => {
			const result = await run<{ voices: Voice[] }>("list_voices", {
				search: search.trim() || undefined,
			});
			if (!stale) {
				setVoices(result?.voices ?? []);
				setLoading(false);
			}
		}, 300);
		return () => {
			stale = true;
			clearTimeout(timer);
		};
	}, [search, ready]);
	useEffect(() => () => audio.current?.pause(), []);
	const preview = (v: Voice) => {
		audio.current?.pause();
		if (playing === v.id || !v.previewUrl) return setPlaying(null);
		const a = new Audio(v.previewUrl);
		a.onended = () => setPlaying(null);
		audio.current = a;
		setPlaying(v.id);
		void a.play().catch(() => setPlaying(null));
	};
	return (
		<>
			<Field label="Model">
				<select
					value={ai.elevenModel}
					onChange={(e) => void run("update_ai", { ai: { elevenModel: e.target.value } })}
					className={selectClass}
				>
					{ELEVEN_MODELS.map((m) => (
						<option key={m.id} value={m.id}>
							{m.label}
						</option>
					))}
					{!ELEVEN_MODELS.some((m) => m.id === ai.elevenModel) && (
						<option value={ai.elevenModel}>{ai.elevenModel}</option>
					)}
				</select>
			</Field>
			<Field
				label={`Voice: ${ai.elevenVoiceName ?? ai.elevenVoice}`}
				hint="Steer the delivery with audio tags in the line itself, e.g. [whispers] or [excited] (v3)."
			>
				<input
					type="search"
					value={search}
					placeholder="Search voices…"
					onChange={(e) => setSearch(e.target.value)}
					onKeyDown={(e) => e.stopPropagation()}
					className={selectClass}
					disabled={!ready}
				/>
				<div className="custom-scrollbar mt-1.5 flex max-h-56 flex-col overflow-y-auto rounded-lg border border-border">
					{loading && !voices?.length ? (
						<span className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-muted">
							<Spinner size="sm" /> Loading voices…
						</span>
					) : voices?.length ? (
						voices.map((v) => (
							<div
								key={v.id}
								className={cn(
									"flex items-center gap-2 px-1.5 py-1",
									v.id === ai.elevenVoice ? "bg-accent/15" : "hover:bg-default/60",
								)}
							>
								<button
									type="button"
									aria-label={playing === v.id ? `Stop ${v.name}` : `Hear ${v.name}`}
									disabled={!v.previewUrl}
									onClick={() => preview(v)}
									className="flex size-6 shrink-0 items-center justify-center rounded-md text-muted hover:bg-default hover:text-foreground disabled:opacity-30"
								>
									{playing === v.id ? (
										<Pause weight="fill" className="size-3.5" />
									) : (
										<Play weight="fill" className="size-3.5" />
									)}
								</button>
								<button
									type="button"
									onClick={() =>
										void run("update_ai", {
											ai: { elevenVoice: v.id, elevenVoiceName: v.name.slice(0, 120) },
										})
									}
									className="flex min-w-0 flex-1 flex-col text-left"
								>
									<span className="truncate text-[12px]">{v.name}</span>
									<span className="truncate text-[11px] text-muted">
										{[
											v.labels.gender,
											v.labels.age,
											v.labels.accent,
											v.labels.use_case ?? v.labels.use,
										]
											.filter(Boolean)
											.join(" · ") || v.category}
									</span>
								</button>
							</div>
						))
					) : (
						<span className="px-2.5 py-2 text-[12px] text-muted">
							{ready ? "No voices matched." : "Connect ElevenLabs to choose a voice."}
						</span>
					)}
				</div>
			</Field>
		</>
	);
}

const SOUND_LENGTHS = [
	{ value: "auto", label: "Auto" },
	{ value: "1", label: "1 s" },
	{ value: "3", label: "3 s" },
	{ value: "5", label: "5 s" },
	{ value: "10", label: "10 s" },
];

/** A sound effect from a description (ElevenLabs), placed at the playhead on an SFX track. */
function SoundTool() {
	const sound = useCapability("sound");
	const busy = useBusy();
	const [prompt, setPrompt] = useState("");
	const [length, setLength] = useState("auto");
	const [variants, setVariants] = useState("1");
	return (
		<Section title="Sound effect">
			{!sound?.ready && <Problem text={sound?.problem} action="Connect" />}
			<TextInput
				multiline
				rows={3}
				value={prompt}
				onCommit={setPrompt}
				placeholder="A heavy wooden door slams shut in a stone hallway, short echo…"
			/>
			<p className="text-[11px] leading-relaxed text-muted">
				Describe it concretely: what makes the sound, the material, the space.
			</p>
			<Field label="Length">
				<Segmented size="xs" value={length} onChange={setLength} options={SOUND_LENGTHS} />
			</Field>
			<div className="flex items-center justify-between gap-2">
				<Segmented
					size="xs"
					value={variants}
					onChange={setVariants}
					options={["1", "2", "3", "4"].map((n) => ({
						value: n,
						label: n === "1" ? "1 take" : `${n} takes`,
					}))}
				/>
				<Button
					size="sm"
					variant="primary"
					className="gap-1.5"
					isDisabled={busy || prompt.trim().length < 3 || !sound?.ready}
					onPress={async () => {
						const result = await run<{ sounds: unknown[] }>("generate_sound", {
							prompt,
							durationSeconds: length === "auto" ? undefined : Number(length),
							variants: Number(variants),
							atMs: Math.round(playback.currentMs),
						});
						if (result)
							notify(
								result.sounds.length > 1
									? `Sound added at the playhead; ${result.sounds.length - 1} more take(s) in the media`
									: "Sound added at the playhead",
								"success",
							);
					}}
				>
					<Waveform className="size-4" /> Generate
				</Button>
			</div>
			<JobProgress match={/^Generating (a sound|\d+ sounds)/} />
		</Section>
	);
}

const MUSIC_LENGTHS = [
	{ value: "15000", label: "15 s" },
	{ value: "30000", label: "30 s" },
	{ value: "60000", label: "1 min" },
	{ value: "end", label: "To the end" },
];

/** Music from a description (ElevenLabs), laid on the music track from the playhead. */
function MusicTool() {
	const sound = useCapability("sound");
	const busy = useBusy();
	const [prompt, setPrompt] = useState("");
	const [length, setLength] = useState("30000");
	const [instrumental, setInstrumental] = useState(true);
	return (
		<Section title="Music">
			{!sound?.ready && <Problem text={sound?.problem} action="Connect" />}
			<TextInput
				multiline
				rows={3}
				value={prompt}
				onCommit={setPrompt}
				placeholder="Warm acoustic guitar and soft piano, hopeful, 90 bpm, builds gently at the end…"
			/>
			<p className="text-[11px] leading-relaxed text-muted">
				Genre, mood, instruments, tempo and how it develops. It ducks under the voiceover.
			</p>
			<Field label="Length">
				<Segmented size="xs" value={length} onChange={setLength} options={MUSIC_LENGTHS} />
			</Field>
			<Toggle label="Instrumental (no vocals)" checked={instrumental} onChange={setInstrumental} />
			<Button
				variant="primary"
				className="w-full gap-2"
				isDisabled={busy || prompt.trim().length < 3 || !sound?.ready}
				onPress={async () => {
					const result = await run("generate_music", {
						prompt,
						instrumental,
						startMs: Math.round(playback.currentMs),
						...(length === "end" ? {} : { durationMs: Number(length) }),
					});
					if (result) notify("Music added on the music track", "success");
				}}
			>
				<MusicNote className="size-4" /> Compose
			</Button>
			<JobProgress match={/^Composing music/} />
		</Section>
	);
}

/** A video clip from a prompt and optionally a still (Higgsfield), placed at the playhead. */
function ClipTool({ project }: { project: ProjectSnapshot }) {
	const video = useCapability("video");
	const busy = useBusy();
	const images = project.data.assets.filter((a) => a.kind === "image");
	const [prompt, setPrompt] = useState("");
	const [start, setStart] = useState<"none" | "media" | "frame">("none");
	const [imageId, setImageId] = useState(images[0]?.id ?? "");
	const [modelId, setModelId] = useState(DEFAULT_CLIP_MODEL);
	const withImage = start !== "none";
	const models = CLIP_MODELS.filter((m) => (withImage ? m.imageToVideo : m.textToVideo));
	const model = models.find((m) => m.id === modelId) ?? models[0];
	const [duration, setDuration] = useState(String(model?.durations[0] ?? 5));
	const seconds = model?.durations.includes(Number(duration))
		? Number(duration)
		: (model?.durations[0] ?? 5);
	return (
		<Section title="Video clip">
			{!video?.ready && <Problem text={video?.problem} action="Connect" />}
			<TextInput
				multiline
				rows={3}
				value={prompt}
				onCommit={setPrompt}
				placeholder="Slow dolly-in on a steaming coffee cup on a wooden table, morning light, shallow depth of field…"
			/>
			<Field label="Start from">
				<Segmented
					size="xs"
					value={start}
					onChange={setStart}
					options={[
						{ value: "none", label: "Prompt only" },
						{ value: "media", label: "A picture" },
						{ value: "frame", label: "Frame at playhead" },
					]}
				/>
			</Field>
			{start === "media" &&
				(images.length ? (
					<select
						value={imageId}
						onChange={(e) => setImageId(e.target.value)}
						className={selectClass}
					>
						{images.map((a) => (
							<option key={a.id} value={a.id}>
								{a.name}
							</option>
						))}
					</select>
				) : (
					<p className="text-[12px] text-muted">No pictures in the media yet.</p>
				))}
			<div className="grid grid-cols-2 gap-2">
				<Field label="Model">
					<select
						value={model?.id}
						onChange={(e) => setModelId(e.target.value)}
						className={selectClass}
					>
						{models.map((m) => (
							<option key={m.id} value={m.id}>
								{m.label}
							</option>
						))}
					</select>
				</Field>
				<Field label="Length">
					<Segmented
						size="xs"
						value={String(seconds)}
						onChange={setDuration}
						options={(model?.durations ?? [5]).map((d) => ({ value: String(d), label: `${d} s` }))}
					/>
				</Field>
			</div>
			<Button
				variant="primary"
				className="w-full gap-2"
				isDisabled={
					busy ||
					prompt.trim().length < 3 ||
					!video?.ready ||
					!model ||
					(start === "media" && !imageId)
				}
				onPress={async () => {
					const at = Math.round(playback.currentMs);
					const result = await run("generate_clip", {
						prompt,
						model: model?.id,
						durationSec: seconds,
						atMs: at,
						...(start === "media" ? { imageAssetId: imageId } : {}),
						...(start === "frame" ? { frameAtMs: at } : {}),
					});
					if (result) notify("Clip added at the playhead", "success");
				}}
			>
				<VideoCamera className="size-4" /> Generate
			</Button>
			<JobProgress match={/^Generating a video clip/} />
			<p className="text-[11px] leading-relaxed text-muted">
				Takes one to a few minutes. Clips are silent and are saved in the project's generated
				folder.
			</p>
		</Section>
	);
}
