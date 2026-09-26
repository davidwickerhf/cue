import { Button } from "@heroui/react";
import {
	ClosedCaptioning,
	Image as ImageIcon,
	Scroll,
	Sparkle,
	UserSound,
} from "@phosphor-icons/react";
import { useState } from "react";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { appSettings, openSettings, useApp, useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Field, Section, Segmented, TextInput } from "../ui/controls";
import { BeatTools, BrollTools, ChapterTools, ReframeTools } from "./AiTools";

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

export function GeneratePanel() {
	const project = useProject();
	const status = useApp((s) => s.ai.status) ?? [];
	const settings = appSettings.use((s) => s.settings);
	const jobs = useApp((s) => s.jobs) ?? [];
	const busy = jobs.some((j) => j.state === "running");
	const [prompt, setPrompt] = useState("");
	const [orientation, setOrientation] = useState<"landscape" | "portrait" | "square">("landscape");
	if (!project) return null;
	const ai = project.data.ai;
	const missing = project.lines.filter((l) => l.status === "empty").length;
	const videoAsset = project.data.assets.find((a) => a.kind === "video" && a.hasAudio);

	const cap = (c: "tts" | "transcription" | "text" | "image") =>
		status.find((x) => x.capability === c);
	const tts = cap("tts");
	const stt = cap("transcription");
	const image = cap("image");
	const openaiVoice = settings?.ai.tts !== "macos";
	return (
		<div className="flex flex-col">
			<Section title="Models" action={<SettingsLink />}>
				<ul className="flex flex-col gap-1">
					{status.map((s) => (
						<li key={s.capability} className="flex items-center justify-between gap-2 text-[12px]">
							<span className="text-muted">{LABELS[s.capability]}</span>
							<span className="flex min-w-0 items-center gap-1.5" title={s.problem}>
								<span className="truncate">
									{s.provider === "none"
										? "Off"
										: `${PROVIDERS[s.provider] ?? s.provider}${s.model ? ` · ${s.model}` : ""}`}
								</span>
								<span
									className={cn(
										"size-1.5 shrink-0 rounded-full",
										s.ready ? "bg-success" : "bg-warning",
									)}
								/>
							</span>
						</li>
					))}
				</ul>
			</Section>
			<Section title="Voice">
				{!tts?.ready && <Problem text={tts?.problem} />}
				{openaiVoice ? (
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
							<TextInput
								value={ai.ttsModel}
								onCommit={(ttsModel) => void run("update_ai", { ai: { ttsModel } })}
							/>
						</Field>
					</div>
				) : (
					<p className="text-[12px] text-muted">
						Speaking with the macOS voice {settings?.ai.macVoice || "set in your system"}, on this
						Mac. Change it in Settings.
					</p>
				)}
				{openaiVoice && (
					<Field label="Delivery" hint="How the voice should sound. Applies to new takes.">
						<TextInput
							multiline
							rows={2}
							value={ai.voiceInstructions}
							onCommit={(voiceInstructions) => void run("update_ai", { ai: { voiceInstructions } })}
						/>
					</Field>
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
					{missing > 0
						? `Voice ${missing} missing line${missing === 1 ? "" : "s"}`
						: "Regenerate every line"}
				</Button>
			</Section>

			<Section title="Captions">
				<p className="text-[12px] leading-relaxed text-muted">
					Transcribes the voiceover track and adds timed captions on a new track. Edit them like any
					text clip.
				</p>
				{!stt?.ready && <Problem text={stt?.problem} />}
				<Button
					variant="secondary"
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
						variant="secondary"
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

			<BeatTools project={project} />
			<ChapterTools />
			<BrollTools />
			<ReframeTools project={project} />
			{videoAsset && (
				<Section title="Script from footage">
					<p className="text-[12px] leading-relaxed text-muted">
						Turns the speech in {videoAsset.name} into script lines, timed where they are spoken, so
						you can re-record them.
					</p>
					<Button
						variant="secondary"
						className="w-full gap-2"
						isDisabled={busy || !stt?.ready}
						onPress={async () => {
							const result = await run<{ lines: number }>("script_from_media", {
								assetId: videoAsset.id,
								replace: project.lines.length === 0,
							});
							if (result) notify(`Created ${result.lines} lines`, "success");
						}}
					>
						<Scroll className="size-4" /> Transcribe into a script
					</Button>
				</Section>
			)}
			<p className="flex items-center gap-1.5 px-5 pb-5 text-[11px] text-muted">
				<Sparkle className="size-3" /> Generated media is marked AI in the library.
			</p>
		</div>
	);
}

const LABELS: Record<string, string> = {
	tts: "Voice",
	transcription: "Transcription",
	text: "Writing",
	image: "Images",
};
const PROVIDERS: Record<string, string> = {
	openai: "OpenAI",
	macos: "macOS",
	whisper: "Whisper (local)",
	ollama: "Ollama",
	lmstudio: "LM Studio",
};

function SettingsLink() {
	return (
		<button
			type="button"
			onClick={() => openSettings("ai")}
			className="text-[11px] text-muted hover:text-foreground"
		>
			Settings
		</button>
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
