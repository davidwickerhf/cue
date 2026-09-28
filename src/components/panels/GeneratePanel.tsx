import { Button } from "@heroui/react";
import {
	ArrowLeft,
	CaretRight,
	ClosedCaptioning,
	Crop,
	FilmStrip,
	Image as ImageIcon,
	ListNumbers,
	MagnifyingGlass,
	MusicNotes,
	Scroll,
	Sparkle,
	UserSound,
} from "@phosphor-icons/react";
import { type ReactNode, useState } from "react";
import type { ProjectSnapshot } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { appSettings, createStore, openSettings, useApp, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Field, Section, Segmented, TextInput } from "../ui/controls";
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

type Capability = "tts" | "transcription" | "text" | "image";
type ToolId =
	| "voice"
	| "captions"
	| "image"
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
										{setUp ? "Set up its model in Settings → AI." : (why ?? t.blurb)}
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
	const openaiVoice = settings?.ai.tts !== "macos";
	return (
		<Section title="Voiceover">
			{!tts?.ready && <Problem text={tts?.problem} />}
			{openaiVoice ? (
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

function Problem({ text }: { text?: string }) {
	return (
		<p className="rounded-md bg-warning/10 px-2.5 py-2 text-[12px] text-warning">
			{(text ?? "Not set up").replace(/\.?$/, ".")}{" "}
			<button
				type="button"
				className="underline underline-offset-2"
				onClick={() => openSettings("ai")}
			>
				Set up
			</button>
		</p>
	);
}
