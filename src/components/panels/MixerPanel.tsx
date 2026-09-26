import { Button } from "@heroui/react";
import { ArrowCounterClockwise } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import { AUDIO_PRESETS, FLAT_EQ, hasTrackProcessing } from "../../../electron/core/audio";
import type { ProjectSnapshot, Track, TrackEq } from "../../../electron/core/types";
import { notify, run } from "../../lib/api";
import { playback } from "../../lib/playback";
import { useProject } from "../../lib/state";
import { cn } from "../../lib/utils";
import { Range, Section } from "../ui/controls";

const db = (gain: number) => (gain <= 0.0001 ? "-∞" : `${(20 * Math.log10(gain)).toFixed(1)} dB`);
const panLabel = (pan: number) =>
	Math.abs(pan) < 0.02 ? "C" : pan < 0 ? `L${Math.round(-pan * 100)}` : `R${Math.round(pan * 100)}`;

/** Peak meter drawn from -48 dBFS to 0, green to red. */
function Meter({ level }: { level: number }) {
	const n = level <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(level) + 48) / 48));
	return (
		<div className="h-1.5 overflow-hidden rounded-full bg-default">
			<div
				className={cn(
					"h-full rounded-full transition-[width] duration-75",
					n > 0.95 ? "bg-danger" : n > 0.8 ? "bg-warning" : "bg-success",
				)}
				style={{ width: `${n * 100}%` }}
			/>
		</div>
	);
}

/** Tracks that can make sound: every audio track, and video tracks with sound on them. */
function soundTracks(project: ProjectSnapshot): Track[] {
	return project.data.tracks.filter(
		(t) =>
			t.kind === "audio" ||
			(t.kind === "video" &&
				project.data.clips.some(
					(c) =>
						c.type === "media" &&
						c.trackId === t.id &&
						project.data.assets.find((a) => a.id === c.assetId)?.hasAudio,
				)),
	);
}

interface AutoMixResult {
	summary: string;
	note?: string;
	tracks: { name: string; measuredLufs: number | null; volume: { from: number; to: number } }[];
}

/** An audio mixer, one strip per track: level, pan, EQ, compressor, mute, solo and a live meter. */
export function MixerPanel() {
	const project = useProject();
	const levels = playback.trackMeters.use((s) => s.levels);
	const left = playback.meter.use((s) => s.left);
	const right = playback.meter.use((s) => s.right);
	const [loudness, setLoudness] = useState<{ lufs: number | null; peak: number | null } | null>(
		null,
	);
	const [busy, setBusy] = useState<"measure" | "mix" | null>(null);
	// A reading is for the mix it measured; any edit makes it stale.
	const revision = project?.revision;
	useEffect(() => {
		if (revision !== undefined) setLoudness(null);
	}, [revision]);
	if (!project) return null;
	const tracks = soundTracks(project);
	const measure = async () => {
		setBusy("measure");
		const r = await run<{ integratedLufs: number | null; truePeakDb: number | null }>(
			"measure_loudness",
		);
		setBusy(null);
		if (r) setLoudness({ lufs: r.integratedLufs, peak: r.truePeakDb });
	};
	const autoMix = async () => {
		setBusy("mix");
		const r = await run<AutoMixResult>("auto_mix");
		setBusy(null);
		if (r) notify(r.note ? `${r.summary}. ${r.note}` : r.summary, "success");
	};
	return (
		<div className="flex flex-col">
			{tracks.map((track) => (
				<Strip key={track.id} track={track} level={levels[track.id] ?? 0} />
			))}
			<Section title="Master">
				<div className="flex flex-col gap-1">
					<Meter level={left} />
					<Meter level={right} />
				</div>
				<div className="flex items-center gap-2">
					<p className="min-w-0 flex-1 text-[12px] tabular-nums">
						{loudness ? (
							loudness.lufs === null ? (
								<span className="text-muted">Silent</span>
							) : (
								<>
									<span className="font-medium">{loudness.lufs.toFixed(1)} LUFS</span>
									{loudness.peak !== null && (
										<span className="text-muted"> · peak {loudness.peak.toFixed(1)} dB</span>
									)}
								</>
							)
						) : (
							<span className="text-muted">Loudness not measured</span>
						)}
					</p>
					<Button
						size="sm"
						variant="secondary"
						className="h-7 text-[12px]"
						isDisabled={!!busy || tracks.length === 0}
						onPress={measure}
					>
						{busy === "measure" ? "Measuring…" : "Measure"}
					</Button>
				</div>
				<Button
					size="sm"
					variant="secondary"
					className="h-7 text-[12px]"
					isDisabled={!!busy || tracks.length === 0}
					onPress={autoMix}
				>
					{busy === "mix" ? "Mixing…" : "Auto-mix"}
				</Button>
				<p className="text-[11px] text-muted">
					Auto-mix sets dialogue to about -16 LUFS and music 8 dB under it. Loudness is normalised
					on export when that is on in Project settings.
				</p>
			</Section>
		</div>
	);
}

function Strip({ track, level }: { track: Track; level: number }) {
	const patch = (p: Partial<Track>) => void run("update_track", { id: track.id, patch: p });
	const pan = track.pan ?? 0;
	return (
		<Section>
			<div className="flex items-center gap-2">
				<p
					className={cn(
						"min-w-0 flex-1 truncate text-[12px] font-medium",
						track.muted && "text-muted",
					)}
				>
					{track.name}
				</p>
				<Toggle
					on={track.muted}
					tone="danger"
					label="M"
					title="Mute"
					onPress={() => patch({ muted: !track.muted })}
				/>
				<Toggle
					on={!!track.solo}
					tone="warning"
					label="S"
					title="Solo"
					onPress={() => patch({ solo: !track.solo })}
				/>
			</div>
			<Meter level={level} />
			<div className="grid grid-cols-[34px_1fr] items-center gap-x-2 gap-y-1">
				<span className="text-[11px] text-muted">Level</span>
				<Range
					value={track.volume}
					min={0}
					max={2}
					step={0.01}
					format={db}
					onChange={(volume) => playback.previewTrackMix(track.id, { volume })}
					onCommit={(volume) => patch({ volume })}
				/>
				<span className="text-[11px] text-muted">Pan</span>
				<Range
					value={pan}
					min={-1}
					max={1}
					step={0.01}
					format={panLabel}
					onChange={(value) => playback.previewTrackMix(track.id, { pan: value })}
					onCommit={(value) => patch({ pan: Math.abs(value) < 0.03 ? 0 : value })}
				/>
			</div>
			<Tone track={track} />
		</Section>
	);
}

const dbLabel = (v: number) => `${v > 0 ? "+" : ""}${v.toFixed(v % 1 ? 1 : 0)}`;
const select =
	"h-6 min-w-0 flex-1 rounded-md border border-border bg-field px-1 text-[11px] outline-none focus:border-accent";

/** Three EQ bands, the compressor knob, presets and a reset. */
function Tone({ track }: { track: Track }) {
	const eq = track.eq ?? FLAT_EQ;
	const amount = track.compressor?.amount ?? 0;
	const patch = (p: Record<string, unknown>) =>
		void run("update_track", { id: track.id, patch: p });
	const preset =
		AUDIO_PRESETS.find(
			(p) =>
				p.eq.low === eq.low &&
				p.eq.mid === eq.mid &&
				p.eq.high === eq.high &&
				p.compressor.amount === amount,
		)?.name ?? "";
	const bands: { key: keyof TrackEq; label: string; title: string }[] = [
		{ key: "low", label: "Low", title: "Low shelf at 120 Hz" },
		{ key: "mid", label: "Mid", title: "Mid band at 1.2 kHz" },
		{ key: "high", label: "High", title: "High shelf at 8 kHz" },
	];
	return (
		<div className="flex flex-col gap-1.5">
			<div className="flex items-center gap-1.5">
				<span className="w-[34px] shrink-0 text-[11px] text-muted">Tone</span>
				<select
					value={preset}
					onChange={(e) => {
						const p = AUDIO_PRESETS.find((x) => x.name === e.target.value);
						if (p) patch({ eq: p.eq, compressor: p.compressor });
					}}
					className={select}
					aria-label={`Preset for ${track.name}`}
				>
					<option value="" disabled>
						{hasTrackProcessing(track) ? "Custom" : "Flat"}
					</option>
					{AUDIO_PRESETS.map((p) => (
						<option key={p.name} value={p.name}>
							{p.name}
						</option>
					))}
				</select>
				<button
					type="button"
					title="Reset EQ and compressor"
					aria-label="Reset EQ and compressor"
					disabled={!track.eq && !track.compressor}
					onClick={() => patch({ eq: null, compressor: null })}
					className="flex size-6 items-center justify-center rounded text-muted hover:text-foreground disabled:opacity-40 disabled:hover:text-muted"
				>
					<ArrowCounterClockwise className="size-3.5" />
				</button>
			</div>
			<div className="grid grid-cols-3 gap-2 pl-[42px]">
				{bands.map((b) => (
					<Mini
						key={b.key}
						label={b.label}
						title={b.title}
						value={eq[b.key]}
						min={-12}
						max={12}
						step={0.5}
						format={dbLabel}
						onChange={(v) => playback.previewTrackTone(track.id, { eq: { [b.key]: v } })}
						onCommit={(v) => patch({ eq: { [b.key]: v } })}
					/>
				))}
			</div>
			<div className="grid grid-cols-[34px_1fr] items-center gap-x-2">
				<span className="text-[11px] text-muted" title="Compressor: evens out loud and quiet parts">
					Comp
				</span>
				<Range
					value={amount}
					min={0}
					max={1}
					step={0.05}
					format={(v) => (v === 0 ? "Off" : `${Math.round(v * 100)}%`)}
					onChange={(v) => playback.previewTrackTone(track.id, { compressor: v })}
					onCommit={(v) => patch({ compressor: v === 0 ? null : { amount: v } })}
				/>
			</div>
		</div>
	);
}

/** A small labelled slider for one EQ band; double-click sets it back to 0. */
function Mini({
	label,
	title,
	value,
	min,
	max,
	step,
	format,
	onChange,
	onCommit,
}: {
	label: string;
	title: string;
	value: number;
	min: number;
	max: number;
	step: number;
	format: (v: number) => string;
	onChange: (v: number) => void;
	onCommit: (v: number) => void;
}) {
	const [draft, setDraft] = useState(value);
	useEffect(() => setDraft(value), [value]);
	const pct = ((draft - min) / (max - min)) * 100;
	const mid = ((0 - min) / (max - min)) * 100;
	const from = Math.min(pct, mid);
	const to = Math.max(pct, mid);
	return (
		<label className="flex min-w-0 flex-col gap-0.5" title={title}>
			<span className="flex justify-between text-[10px] text-muted tabular-nums">
				<span>{label}</span>
				<span className={cn(draft !== 0 && "text-foreground")}>{format(draft)}</span>
			</span>
			<input
				type="range"
				min={min}
				max={max}
				step={step}
				value={draft}
				onChange={(e) => {
					const next = Number(e.target.value);
					setDraft(next);
					onChange(next);
				}}
				onPointerUp={() => onCommit(draft)}
				onKeyUp={() => onCommit(draft)}
				onDoubleClick={() => {
					setDraft(0);
					onChange(0);
					onCommit(0);
				}}
				className="h-1 w-full cursor-pointer appearance-none rounded-full accent-[var(--accent)]"
				style={{
					background: `linear-gradient(to right, color-mix(in srgb, var(--foreground) 12%, transparent) ${from}%, var(--accent) ${from}%, var(--accent) ${to}%, color-mix(in srgb, var(--foreground) 12%, transparent) ${to}%)`,
				}}
			/>
		</label>
	);
}

function Toggle({
	on,
	tone,
	label,
	title,
	onPress,
}: {
	on: boolean;
	tone: "danger" | "warning";
	label: string;
	title: string;
	onPress: () => void;
}) {
	return (
		<button
			type="button"
			title={title}
			aria-pressed={on}
			onClick={onPress}
			className={cn(
				"flex size-6 items-center justify-center rounded text-[11px] font-bold",
				on
					? tone === "danger"
						? "bg-danger/20 text-danger"
						: "bg-warning/20 text-warning"
					: "bg-default text-muted hover:text-foreground",
			)}
		>
			{label}
		</button>
	);
}
