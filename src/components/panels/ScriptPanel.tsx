import { Button, Dropdown } from "@heroui/react";
import {
	DotsThree,
	FileArrowUp,
	Microphone,
	Play,
	Plus,
	Sparkle,
	Stop,
	Trash,
	UploadSimple,
	UserSound,
} from "@phosphor-icons/react";
import type { Asset, LineView } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { recorder } from "../../lib/recorder";
import { useApp, useProject } from "../../lib/state";
import { cn, formatSeconds, formatTime } from "../../lib/utils";
import { Empty, Field, IconButton, NumberInput, Section, TextInput } from "../ui/controls";

export const STATUS_STYLE = {
	empty: { dot: "bg-foreground/20", text: "text-muted", label: "No take" },
	ok: { dot: "bg-success", text: "text-success", label: "Fits" },
	tight: { dot: "bg-warning", text: "text-warning", label: "Tight" },
	over: { dot: "bg-danger", text: "text-danger", label: "Too long" },
} as const;

export function ScriptPanel() {
	const project = useProject();
	const selectedId = useApp((s) => s.selectedLineId);
	const aiReady = useApp((s) => s.ai.status.some((x) => x.capability === "tts" && x.ready));
	const phase = recorder.status.use((s) => s.phase);
	if (!project) return null;
	const lines = project.lines;
	const done = lines.filter((l) => l.status !== "empty").length;
	const selected = lines.find((l) => l.id === selectedId) ?? lines[0];

	const importScript = async () => {
		const file = await window.cue.chooseFile({
			title: "Import a script (.srt or .json)",
			extensions: ["srt", "json"],
		});
		if (file) await run("import_script", { file, replace: lines.length === 0 });
	};

	const addLine = () => {
		const at = Math.round(playback.currentMs);
		let n = lines.length + 1;
		while (lines.some((l) => l.id === `L${String(n).padStart(2, "0")}`)) n++;
		void run("add_line", {
			line: { id: `L${String(n).padStart(2, "0")}`, text: "New line", startMs: at, targetMs: 4000 },
		});
	};

	return (
		<div className="flex flex-col">
			<MicBar />
			<Section
				title={lines.length ? `Script · ${done}/${lines.length} recorded` : "Script"}
				action={
					<div className="flex items-center gap-0.5">
						<IconButton label="Add line at playhead" onPress={addLine}>
							<Plus className="size-4" />
						</IconButton>
						<IconButton label="Import .srt or .json" onPress={importScript}>
							<FileArrowUp className="size-4" />
						</IconButton>
					</div>
				}
			>
				{lines.length > 0 && (
					<div className="h-1 overflow-hidden rounded-full bg-default">
						<div
							className="h-full rounded-full bg-success transition-all"
							style={{ width: `${(done / lines.length) * 100}%` }}
						/>
					</div>
				)}
				{lines.length === 0 ? (
					<Empty icon={<Microphone className="size-5" />} title="No script yet">
						Import subtitles, add lines at the playhead, or ask your agent to write the script.
					</Empty>
				) : (
					<ol className="-mx-2 flex flex-col">
						{lines.map((line) => (
							<LineRow
								key={line.id}
								line={line}
								selected={line.id === selected?.id}
								aiReady={!!aiReady}
								busy={phase !== "idle"}
							/>
						))}
					</ol>
				)}
			</Section>
			{selected && <LineDetail line={selected} aiReady={!!aiReady} />}
		</div>
	);
}

function MicBar() {
	const status = recorder.status.use((s) => s);
	const project = useProject();
	const selectedId = useApp((s) => s.selectedLineId);
	const line = project?.lines.find((l) => l.id === selectedId) ?? project?.lines[0];
	const recording = status.phase !== "idle";
	return (
		<div className="flex items-center gap-3 border-b border-separator px-4 py-3">
			<button
				type="button"
				aria-label={recording ? "Stop recording" : "Record the selected line"}
				disabled={!line && !recording}
				onClick={() => (recording ? void recorder.stop() : line && recorder.prepare(line.id))}
				className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-field transition-colors hover:border-danger/60 disabled:opacity-40"
			>
				{recording ? (
					<Stop weight="fill" className="rec-pulse size-3.5 text-danger" />
				) : (
					<span className="size-3.5 rounded-full bg-danger" />
				)}
			</button>
			<div className="min-w-0 flex-1">
				<p className="truncate text-[12px] font-medium">
					{recording
						? `${status.phase === "countdown" ? "Get ready" : status.phase === "saving" ? "Saving" : "Recording"} · ${status.lineId}`
						: line
							? `Record ${line.id}`
							: "Record"}
				</p>
				<div className="mt-1.5 flex items-center gap-2">
					<div className="h-1.5 flex-1 overflow-hidden rounded-full bg-default">
						<div
							className={cn(
								"h-full rounded-full transition-[width] duration-75",
								status.level > 0.9 ? "bg-danger" : status.level > 0.6 ? "bg-warning" : "bg-success",
							)}
							style={{ width: `${status.level * 100}%` }}
						/>
					</div>
					{status.micReady ? (
						<select
							value={status.deviceId}
							onChange={(e) => void recorder.setDevice(e.target.value)}
							className="max-w-[120px] truncate bg-transparent text-[11px] text-muted outline-none"
							aria-label="Microphone"
						>
							<option value="">Default mic</option>
							{status.devices.map((d) => (
								<option key={d.deviceId} value={d.deviceId}>
									{d.label || "Microphone"}
								</option>
							))}
						</select>
					) : (
						<button
							type="button"
							onClick={() => void recorder.ensureMic().catch(() => {})}
							className="text-[11px] font-medium text-accent"
						>
							Enable mic
						</button>
					)}
				</div>
			</div>
		</div>
	);
}

function LineRow({
	line,
	selected,
	aiReady,
	busy,
}: {
	line: LineView;
	selected: boolean;
	aiReady: boolean;
	busy: boolean;
}) {
	const status = STATUS_STYLE[line.status];
	return (
		<li>
			<div
				role="button"
				tabIndex={0}
				onClick={() => {
					window.cue.selectLine(line.id);
					if (!playback.playing) playback.seek(Math.max(0, line.startMs - 300));
				}}
				onKeyDown={(e) => e.key === "Enter" && window.cue.selectLine(line.id)}
				className={cn(
					"group flex w-full cursor-default items-start gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors",
					selected ? "bg-default" : "hover:bg-default/50",
				)}
			>
				<span
					className={cn("mt-1.5 size-2 shrink-0 rounded-full", status.dot)}
					title={status.label}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-1.5 text-[11px] text-muted">
						<span className="font-semibold text-foreground/80">{line.id}</span>
						<span className="tabular-nums">{formatTime(line.startMs)}</span>
						{line.speechMs !== null && (
							<span className={cn("ml-auto tabular-nums", status.text)}>
								{formatSeconds(line.speechMs)} / {formatSeconds(line.maxMs)}
							</span>
						)}
					</div>
					<p
						className={cn(
							"mt-0.5 text-[12px] leading-snug text-foreground/90",
							selected ? "" : "line-clamp-2",
						)}
					>
						{line.text}
					</p>
				</div>
				<div
					className={cn(
						"flex shrink-0 flex-col gap-0.5 opacity-0 transition group-hover:opacity-100",
						selected && "opacity-100",
					)}
				>
					<IconButton
						label="Record this line"
						shortcut="R"
						disabled={busy}
						onPress={() => recorder.prepare(line.id)}
					>
						<Microphone className="size-3.5" />
					</IconButton>
					{aiReady && (
						<IconButton
							label="Generate a voice take"
							onPress={() => void run("generate_take", { lineId: line.id })}
						>
							<Sparkle className="size-3.5" />
						</IconButton>
					)}
				</div>
			</div>
		</li>
	);
}

function LineDetail({ line, aiReady }: { line: LineView; aiReady: boolean }) {
	const textReady = useApp((s) => s.ai.status.some((x) => x.capability === "text" && x.ready));
	const project = useProject();
	if (!project) return null;
	const update = (patch: Record<string, unknown>) =>
		void run("update_line", { id: line.id, patch });
	return (
		<div className="border-t border-separator">
			<Section
				title={`Line ${line.id}`}
				action={
					<Dropdown>
						<Button isIconOnly size="sm" variant="ghost" aria-label="Line actions">
							<DotsThree weight="bold" className="size-4" />
						</Button>
						<Dropdown.Popover placement="bottom end">
							<Dropdown.Menu
								aria-label="Line actions"
								onAction={async (key) => {
									if (key === "play")
										playback.play({
											fromMs: Math.max(0, line.startMs - 500),
											toMs: line.startMs + line.maxMs + 500,
										});
									if (key === "import") {
										const file = await window.cue.chooseFile({
											title: `Audio for ${line.id}`,
											extensions: ["wav", "mp3", "m4a", "aac", "flac", "ogg"],
										});
										if (file) void run("import_take", { lineId: line.id, file });
									}
									if (key === "delete") void run("remove_line", { id: line.id });
									if (key === "fit" || key === "shorter" || key === "clearer") {
										const r = await run<{ before: string; after: string }>("rewrite_line", {
											id: line.id,
											goal: key,
										});
										if (r) notify("Line rewritten. Undo (⌘Z) to go back.", "success");
									}
								}}
							>
								<Dropdown.Item id="play" textValue="Play">
									Play this part of the timeline
								</Dropdown.Item>
								<Dropdown.Item id="import" textValue="Import">
									Use an audio file as a take…
								</Dropdown.Item>
								{textReady && (
									<Dropdown.Item id="fit" textValue="Fit">
										Rewrite to fit {(line.maxMs / 1000).toFixed(1)} s
									</Dropdown.Item>
								)}
								{textReady && (
									<Dropdown.Item id="shorter" textValue="Shorter">
										Rewrite shorter
									</Dropdown.Item>
								)}
								{textReady && (
									<Dropdown.Item id="clearer" textValue="Clearer">
										Rewrite clearer
									</Dropdown.Item>
								)}
								<Dropdown.Item id="delete" textValue="Delete" className="text-danger">
									Delete line
								</Dropdown.Item>
							</Dropdown.Menu>
						</Dropdown.Popover>
					</Dropdown>
				}
			>
				<TextInput multiline rows={3} value={line.text} onCommit={(text) => update({ text })} />
				<div className="grid grid-cols-3 gap-2">
					<Field label="Starts">
						<NumberInput
							value={line.startMs}
							scale={1000}
							digits={2}
							step={0.1}
							min={0}
							suffix="s"
							onCommit={(v) => update({ startMs: Math.round(v) })}
						/>
					</Field>
					<Field label="Target">
						<NumberInput
							value={line.targetMs}
							scale={1000}
							digits={1}
							step={0.1}
							min={0}
							suffix="s"
							onCommit={(v) => update({ targetMs: Math.round(v) })}
						/>
					</Field>
					<Field label="Max">
						<NumberInput
							value={line.maxMs}
							scale={1000}
							digits={1}
							step={0.1}
							min={100}
							suffix="s"
							onCommit={(v) => update({ maxMs: Math.round(v) })}
						/>
					</Field>
				</div>
			</Section>
			<Section
				title={`Takes · ${line.takes.length}`}
				action={
					aiReady ? (
						<Button
							size="sm"
							variant="secondary"
							className="h-7 gap-1.5 text-[12px]"
							onPress={() => void run("generate_take", { lineId: line.id })}
						>
							<Sparkle className="size-3.5" /> Generate
						</Button>
					) : null
				}
			>
				{line.takes.length === 0 ? (
					<p className="text-[12px] text-muted">
						Press record (R) to review the line, then start a take when ready. Cue counts down
						before rolling and stops after the max length.
					</p>
				) : (
					<ul className="-mx-1 flex flex-col gap-1">
						{[...line.takes].reverse().map((take) => (
							<TakeRow key={take.id} take={take} line={line} url={project.assetUrls[take.id]} />
						))}
					</ul>
				)}
			</Section>
		</div>
	);
}

function TakeRow({ take, line, url }: { take: Asset; line: LineView; url: string }) {
	const chosen = line.chosenAssetId === take.id;
	const speech = (take.speechEndMs ?? take.durationMs) - (take.speechStartMs ?? 0);
	const fit = speech > line.maxMs ? "over" : speech > line.maxMs - 300 ? "tight" : "ok";
	const Icon =
		take.origin === "tts"
			? Sparkle
			: take.origin === "import"
				? UploadSimple
				: take.actor === "agent"
					? UserSound
					: Microphone;
	return (
		<li
			className={cn(
				"group flex items-center gap-2 rounded-md border px-2 py-1.5 transition-colors",
				chosen ? "border-border bg-default/60" : "border-transparent hover:bg-default/50",
			)}
		>
			<button
				type="button"
				onClick={() => void run("choose_take", { lineId: line.id, assetId: take.id })}
				className={cn(
					"flex size-4 shrink-0 items-center justify-center rounded-full border-2",
					chosen ? "border-accent" : "border-foreground/25",
				)}
				aria-label={chosen ? "In use" : "Use this take"}
			>
				{chosen && <span className="size-2 rounded-full bg-accent" />}
			</button>
			<Icon className="size-3.5 shrink-0 text-muted" />
			<div className="min-w-0 flex-1">
				<p className="truncate text-[12px]">{take.name}</p>
				<p className={cn("text-[11px] tabular-nums", STATUS_STYLE[fit].text)}>
					{formatSeconds(speech)} of {formatSeconds(line.maxMs)}
					{take.peakDb !== undefined && take.peakDb !== null && (
						<span className="text-muted"> · peak {take.peakDb.toFixed(0)} dB</span>
					)}
				</p>
			</div>
			<IconButton label="Listen" onPress={() => playback.previewAsset(url)}>
				<Play weight="fill" className="size-3.5" />
			</IconButton>
			<IconButton
				label="Delete take"
				onPress={() => void run("delete_take", { assetId: take.id })}
				className="opacity-0 group-hover:opacity-100"
			>
				<Trash className="size-3.5" />
			</IconButton>
		</li>
	);
}
