import { Button } from "@heroui/react";
import { run } from "../../lib/api";
import { openSettings, useProject } from "../../lib/state";
import {
	ColorInput,
	Field,
	NumberInput,
	Section,
	Segmented,
	TextInput,
	Toggle,
} from "../ui/controls";

const SIZES = [
	{ label: "1080p", w: 1920, h: 1080 },
	{ label: "Vertical", w: 1080, h: 1920 },
	{ label: "Square", w: 1080, h: 1080 },
	{ label: "4K", w: 3840, h: 2160 },
];

export function SettingsPanel() {
	const project = useProject();
	if (!project) return null;
	const { canvas, settings, export: out, ai } = project.data;
	const setSettings = (patch: Record<string, unknown>) =>
		void run("update_settings", { settings: patch });
	const setExport = (patch: Record<string, unknown>) =>
		void run("update_export", { export: patch });

	return (
		<div className="flex flex-col divide-y divide-separator">
			<Section title="Generated images">
				<Field
					label="OpenAI model"
					hint="Flare is fast; Sunburst gives finer control. Existing projects keep their saved model."
				>
					<select
						value={ai.imageModel}
						onChange={(event) => void run("update_ai", { ai: { imageModel: event.target.value } })}
						className="h-8 w-full rounded-md border border-border bg-field px-2 text-[12px] outline-none focus:border-accent"
					>
						<option value="gpt-image-2.5-flare">GPT Image 2.5 Flare</option>
						<option value="gpt-image-2.5-sunburst">GPT Image 2.5 Sunburst</option>
						{ai.imageModel !== "gpt-image-2.5-flare" &&
							ai.imageModel !== "gpt-image-2.5-sunburst" && (
								<option value={ai.imageModel}>{ai.imageModel} (saved)</option>
							)}
					</select>
				</Field>
				<p className="text-[11px] leading-relaxed text-muted">
					Uses the OpenAI key already stored in Cue's app settings. Generated stills are added to
					this project's media library.
				</p>
			</Section>
			<Section title="Canvas">
				<div className="flex flex-wrap gap-1.5">
					{SIZES.map((s) => (
						<Button
							key={s.label}
							size="sm"
							variant={canvas.width === s.w && canvas.height === s.h ? "primary" : "secondary"}
							className="h-7 text-[12px]"
							onPress={() => void run("set_canvas", { width: s.w, height: s.h })}
						>
							{s.label}
						</Button>
					))}
				</div>
				<div className="grid grid-cols-3 gap-2">
					<Field label="Width">
						<NumberInput
							value={canvas.width}
							min={16}
							max={7680}
							onCommit={(width) => void run("set_canvas", { width: Math.round(width) })}
						/>
					</Field>
					<Field label="Height">
						<NumberInput
							value={canvas.height}
							min={16}
							max={4320}
							onCommit={(height) => void run("set_canvas", { height: Math.round(height) })}
						/>
					</Field>
					<Field label="FPS">
						<NumberInput
							value={canvas.fps}
							min={1}
							max={120}
							onCommit={(fps) => void run("set_canvas", { fps })}
						/>
					</Field>
				</div>
				<Field label="Background">
					<ColorInput
						value={canvas.background}
						onCommit={(background) => background && void run("set_canvas", { background })}
					/>
				</Field>
			</Section>

			<Section title="Recording">
				<div className="grid grid-cols-2 gap-2">
					<Field label="Pre-roll">
						<NumberInput
							value={settings.prerollMs}
							scale={1000}
							digits={1}
							step={0.5}
							min={0}
							suffix="s"
							onCommit={(v) => setSettings({ prerollMs: Math.round(v) })}
						/>
					</Field>
					<Field label="Post-roll">
						<NumberInput
							value={settings.postrollMs}
							scale={1000}
							digits={1}
							step={0.5}
							min={0}
							suffix="s"
							onCommit={(v) => setSettings({ postrollMs: Math.round(v) })}
						/>
					</Field>
					<Field label="Trim padding">
						<NumberInput
							value={settings.padMs}
							min={0}
							max={2000}
							step={50}
							suffix="ms"
							onCommit={(v) => setSettings({ padMs: Math.round(v) })}
						/>
					</Field>
					<Field label="Silence below">
						<NumberInput
							value={settings.silenceDb}
							min={-80}
							max={-10}
							suffix="dB"
							onCommit={(v) => setSettings({ silenceDb: Math.round(v) })}
						/>
					</Field>
				</div>
				<Toggle
					label="Stop after the line's max length"
					checked={settings.autoStop}
					onChange={(autoStop) => setSettings({ autoStop })}
				/>
				<Field label="While recording, play" inline>
					<Segmented
						size="xs"
						value={settings.monitor}
						onChange={(monitor) => setSettings({ monitor })}
						options={[
							{ value: "mute", label: "Nothing" },
							{ value: "timeline", label: "Other tracks" },
						]}
					/>
				</Field>
			</Section>

			<Section title="Export">
				<Field
					label="Video file"
					hint="{name} is the project name. Relative to the project folder."
				>
					<TextInput value={out.videoFile} onCommit={(videoFile) => setExport({ videoFile })} />
				</Field>
				<Field label="Codec" inline>
					<Segmented
						size="xs"
						value={out.codec}
						onChange={(codec) => setExport({ codec })}
						options={[
							{ value: "h264", label: "H.264" },
							{ value: "hevc", label: "HEVC" },
							{ value: "prores", label: "ProRes" },
						]}
					/>
				</Field>
				<Field label="Size" inline>
					<Segmented
						size="xs"
						value={String(out.scale) as "1"}
						onChange={(v) => setExport({ scale: Number(v) })}
						options={[
							{ value: "1" as "1", label: "100%" },
							{ value: "0.75" as "1", label: "75%" },
							{ value: "0.5" as "1", label: "50%" },
						]}
					/>
				</Field>
				<Toggle
					label="Hardware encoding (faster)"
					checked={out.hardware}
					onChange={(hardware) => setExport({ hardware })}
				/>
				<Field label="Quality" inline>
					<Segmented
						size="xs"
						value={out.videoQuality}
						onChange={(videoQuality) => setExport({ videoQuality })}
						options={[
							{ value: "draft", label: "Draft" },
							{ value: "standard", label: "Standard" },
							{ value: "high", label: "High" },
						]}
					/>
				</Field>
				<div className="grid grid-cols-2 gap-2">
					<Field label="Stems folder">
						<TextInput value={out.stemsDir} onCommit={(stemsDir) => setExport({ stemsDir })} />
					</Field>
					<Field label="Stem names">
						<TextInput
							value={out.stemPattern}
							onCommit={(stemPattern) => setExport({ stemPattern })}
						/>
					</Field>
				</div>
				<Field label="Captions file" hint="SRT; a VTT is written next to it.">
					<TextInput
						value={out.captionsFile}
						onCommit={(captionsFile) => setExport({ captionsFile })}
					/>
				</Field>
				<Field label="Voiceover file">
					<TextInput
						value={out.voiceoverFile}
						onCommit={(voiceoverFile) => setExport({ voiceoverFile })}
					/>
				</Field>
				<Toggle
					label="Normalise loudness"
					checked={out.normalize}
					onChange={(normalize) => setExport({ normalize })}
				/>
			</Section>

			<Section title="Playback">
				<Toggle
					label="Play from lightweight proxies"
					checked={settings.useProxies}
					onChange={(useProxies) => setSettings({ useProxies })}
				/>
				<p className="text-[11px] text-muted">
					Keeps playback smooth with large or 4K footage. Exports always use the originals.
				</p>
			</Section>

			<Section title="Placing video">
				<Toggle
					label="Put a video's sound on an audio track"
					checked={settings.separateAudio}
					onChange={(separateAudio) => setSettings({ separateAudio })}
				/>
				<p className="text-[11px] text-muted">
					The sound is linked to the picture, so they move together; unlink them to edit apart.
				</p>
			</Section>
			<Section>
				<p className="text-[12px] text-muted">
					Models, API keys and agent access apply to every project.{" "}
					<button
						type="button"
						className="text-foreground underline underline-offset-2"
						onClick={() => openSettings("ai")}
					>
						Open app settings
					</button>
				</p>
			</Section>
			<p className="px-5 py-4 text-[11px] break-all text-muted select-text">{project.path}</p>
		</div>
	);
}
