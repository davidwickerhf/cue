import { Button } from "@heroui/react";
import { CheckCircle } from "@phosphor-icons/react";
import { useState } from "react";
import { notify, run } from "../../lib/api";
import { useApp, useProject } from "../../lib/state";
import { ColorInput, Field, NumberInput, Section, Segmented, TextInput, Toggle } from "../ui/controls";

const SIZES = [
	{ label: "1080p", w: 1920, h: 1080 },
	{ label: "Vertical", w: 1080, h: 1920 },
	{ label: "Square", w: 1080, h: 1080 },
	{ label: "4K", w: 3840, h: 2160 },
];

export function SettingsPanel() {
	const project = useProject();
	const aiReady = useApp((s) => s.ai.configured);
	const [key, setKey] = useState("");
	if (!project) return null;
	const { canvas, settings, export: out } = project.data;
	const setSettings = (patch: Record<string, unknown>) => void run("update_settings", { settings: patch });
	const setExport = (patch: Record<string, unknown>) => void run("update_export", { export: patch });

	return (
		<div className="flex flex-col divide-y divide-separator">
			<Section title="Canvas">
				<div className="flex flex-wrap gap-1.5">
					{SIZES.map((s) => (
						<Button key={s.label} size="sm" variant={canvas.width === s.w && canvas.height === s.h ? "primary" : "secondary"} className="h-7 text-[12px]" onPress={() => void run("set_canvas", { width: s.w, height: s.h })}>
							{s.label}
						</Button>
					))}
				</div>
				<div className="grid grid-cols-3 gap-2">
					<Field label="Width">
						<NumberInput value={canvas.width} min={16} max={7680} onCommit={(width) => void run("set_canvas", { width: Math.round(width) })} />
					</Field>
					<Field label="Height">
						<NumberInput value={canvas.height} min={16} max={4320} onCommit={(height) => void run("set_canvas", { height: Math.round(height) })} />
					</Field>
					<Field label="FPS">
						<NumberInput value={canvas.fps} min={1} max={120} onCommit={(fps) => void run("set_canvas", { fps })} />
					</Field>
				</div>
				<Field label="Background">
					<ColorInput value={canvas.background} onCommit={(background) => background && void run("set_canvas", { background })} />
				</Field>
			</Section>

			<Section title="Recording">
				<div className="grid grid-cols-2 gap-2">
					<Field label="Pre-roll">
						<NumberInput value={settings.prerollMs} scale={1000} digits={1} step={0.5} min={0} suffix="s" onCommit={(v) => setSettings({ prerollMs: Math.round(v) })} />
					</Field>
					<Field label="Post-roll">
						<NumberInput value={settings.postrollMs} scale={1000} digits={1} step={0.5} min={0} suffix="s" onCommit={(v) => setSettings({ postrollMs: Math.round(v) })} />
					</Field>
					<Field label="Trim padding">
						<NumberInput value={settings.padMs} min={0} max={2000} step={50} suffix="ms" onCommit={(v) => setSettings({ padMs: Math.round(v) })} />
					</Field>
					<Field label="Silence below">
						<NumberInput value={settings.silenceDb} min={-80} max={-10} suffix="dB" onCommit={(v) => setSettings({ silenceDb: Math.round(v) })} />
					</Field>
				</div>
				<Toggle label="Stop after the line's max length" checked={settings.autoStop} onChange={(autoStop) => setSettings({ autoStop })} />
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
				<Field label="Video file" hint="{name} is the project name. Relative to the project folder.">
					<TextInput value={out.videoFile} onCommit={(videoFile) => setExport({ videoFile })} />
				</Field>
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
						<TextInput value={out.stemPattern} onCommit={(stemPattern) => setExport({ stemPattern })} />
					</Field>
				</div>
				<Field label="Voiceover file">
					<TextInput value={out.voiceoverFile} onCommit={(voiceoverFile) => setExport({ voiceoverFile })} />
				</Field>
				<Toggle label="Normalise loudness" checked={out.normalize} onChange={(normalize) => setExport({ normalize })} />
			</Section>

			<Section title="AI provider">
				{aiReady ? (
					<div className="flex items-center justify-between gap-2">
						<p className="flex items-center gap-1.5 text-[13px]">
							<CheckCircle weight="fill" className="size-4 text-success" /> OpenAI is connected
						</p>
						<Button size="sm" variant="ghost" className="text-danger" onPress={() => void window.cue.setApiKey(null).then(() => notify("Key removed"))}>
							Remove key
						</Button>
					</div>
				) : (
					<>
						<Field label="OpenAI API key" hint="Stored encrypted with your macOS keychain. Used for voices, captions and images.">
							<input
								type="password"
								value={key}
								onChange={(e) => setKey(e.target.value)}
								onKeyDown={(e) => e.stopPropagation()}
								placeholder="sk-…"
								className="h-8 w-full rounded-lg border border-border bg-field px-2.5 text-[13px] outline-none focus:border-accent"
							/>
						</Field>
						<Button
							size="sm"
							isDisabled={key.trim().length < 20}
							onPress={async () => {
								await window.cue.setApiKey(key.trim());
								setKey("");
								notify("Key saved", "success");
							}}
						>
							Save key
						</Button>
					</>
				)}
			</Section>
			<p className="px-5 py-4 text-[11px] break-all text-muted select-text">{project.path}</p>
		</div>
	);
}
