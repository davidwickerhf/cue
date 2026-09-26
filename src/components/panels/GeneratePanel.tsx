import { Button } from "@heroui/react";
import { ClosedCaptioning, Image as ImageIcon, Key, Scroll, Sparkle, UserSound } from "@phosphor-icons/react";
import { useState } from "react";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { editor, useApp, useProject } from "../../lib/state";
import { Field, Section, Segmented, TextInput } from "../ui/controls";

const VOICES = ["cedar", "marin", "alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

export function GeneratePanel() {
	const project = useProject();
	const ready = useApp((s) => s.ai.configured);
	const jobs = useApp((s) => s.jobs) ?? [];
	const busy = jobs.some((j) => j.state === "running");
	const [prompt, setPrompt] = useState("");
	const [orientation, setOrientation] = useState<"landscape" | "portrait" | "square">("landscape");
	if (!project) return null;
	const ai = project.data.ai;
	const missing = project.lines.filter((l) => l.status === "empty").length;
	const videoAsset = project.data.assets.find((a) => a.kind === "video" && a.hasAudio);

	if (!ready)
		return (
			<Section>
				<div className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-surface-secondary/60 p-4">
					<Key className="size-5 text-accent" />
					<p className="text-[13px] leading-relaxed">Voices, captions and images use OpenAI. Add an API key in Settings to turn these on. It is stored encrypted in your keychain.</p>
					<Button size="sm" onPress={() => editor.set({ panel: "settings" })}>
						Open settings
					</Button>
				</div>
			</Section>
		);

	return (
		<div className="flex flex-col">
			<Section title="Voice">
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
						<TextInput value={ai.ttsModel} onCommit={(ttsModel) => void run("update_ai", { ai: { ttsModel } })} />
					</Field>
				</div>
				<Field label="Delivery" hint="How the voice should sound. Applies to new takes.">
					<TextInput multiline rows={2} value={ai.voiceInstructions} onCommit={(voiceInstructions) => void run("update_ai", { ai: { voiceInstructions } })} />
				</Field>
				<Button
					variant="primary"
					className="w-full gap-2"
					isDisabled={busy || project.lines.length === 0}
					onPress={async () => {
						const result = await run<unknown[]>("generate_voiceover", { onlyMissing: missing > 0 });
						if (result) notify(`Generated ${result.length} take(s)`, "success");
					}}
				>
					<UserSound className="size-4" />
					{missing > 0 ? `Voice ${missing} missing line${missing === 1 ? "" : "s"}` : "Regenerate every line"}
				</Button>
			</Section>

			<Section title="Captions">
				<p className="text-[12px] leading-relaxed text-muted">Transcribes the voiceover track and adds timed captions on a new track. Edit them like any text clip.</p>
				<Button
					variant="secondary"
					className="w-full gap-2"
					isDisabled={busy}
					onPress={async () => {
						const result = await run<{ count: number }>("auto_captions", { source: "voiceover" });
						if (result) notify(`Added ${result.count} captions`, "success");
					}}
				>
					<ClosedCaptioning className="size-4" /> Caption the voiceover
				</Button>
			</Section>

			<Section title="Image">
				<TextInput multiline rows={3} value={prompt} onCommit={setPrompt} placeholder="A clean title card with a film reel on a soft blue gradient…" />
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
						isDisabled={busy || prompt.trim().length < 3}
						onPress={async () => {
							const track = project.data.tracks.find((t) => t.kind === "video" && !t.locked);
							const result = await run("generate_image", { prompt, orientation, trackId: track?.id, startMs: Math.round(playback.currentMs) });
							if (result) notify("Image added at the playhead", "success");
						}}
					>
						<ImageIcon className="size-4" /> Generate
					</Button>
				</div>
			</Section>

			{videoAsset && (
				<Section title="Script from footage">
					<p className="text-[12px] leading-relaxed text-muted">Turns the speech in {videoAsset.name} into script lines, timed where they are spoken, so you can re-record them.</p>
					<Button
						variant="secondary"
						className="w-full gap-2"
						isDisabled={busy}
						onPress={async () => {
							const result = await run<{ lines: number }>("script_from_media", { assetId: videoAsset.id, replace: project.lines.length === 0 });
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
