import type { ProjectSnapshot, Track } from "../../../electron/core/types";
import { run } from "../../lib/api";
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

/** An audio mixer, one strip per track: level, pan, mute, solo and a live meter. */
export function MixerPanel() {
	const project = useProject();
	const levels = playback.trackMeters.use((s) => s.levels);
	const left = playback.meter.use((s) => s.left);
	const right = playback.meter.use((s) => s.right);
	if (!project) return null;
	const tracks = soundTracks(project);
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
				<p className="text-[11px] text-muted">
					Loudness is normalised on export when that is on in Project settings.
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
		</Section>
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
