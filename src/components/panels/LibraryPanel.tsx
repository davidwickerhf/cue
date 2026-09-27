import { Button } from "@heroui/react";
import { ArrowSquareOut, DownloadSimple, Pause, Play } from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import type { LibraryAsset } from "../../../electron/core/assetLibrary";
import { notify, run } from "../../lib/api";
import { librarySelection } from "../../lib/assetLibrary";
import { editor } from "../../lib/state";
import { Segmented } from "../ui/controls";
import { MotionGallery } from "./MotionGallery";

const posters = import.meta.glob("../../../resources/assets/posters/*.jpg", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;
const poster = (id: string) => posters[`../../../resources/assets/posters/${id}.jpg`];

/** Bundled sounds and texture loops, played in place (stock footage streams from its source). */
const bundled = import.meta.glob(
	["../../../resources/assets/sounds/*", "../../../resources/assets/textures/*.mp4"],
	{ eager: true, query: "?url", import: "default" },
) as Record<string, string>;
const bundledUrl = (asset: LibraryAsset) =>
	asset.localPath ? bundled[`../../../${asset.localPath}`] : undefined;

type Scope = "footage" | "textures" | "sounds";
const TEXTURES = "Textures";
const SOUNDS = "Sound effects";
const scopeOf = (asset: LibraryAsset): Scope =>
	asset.category === TEXTURES ? "textures" : asset.category === SOUNDS ? "sounds" : "footage";

const COPY: Record<Scope, { title: string; blurb: string; search: string }> = {
	footage: {
		title: "Find a shot for the story",
		blurb: "curated clips and graphics. Pick one to preview, then import it into your project.",
		search: "Try: research, route, people…",
	},
	textures: {
		title: "Paper and overlays",
		blurb:
			"textures. Paper boards go on the bottom track; dust, light leaks and halftone go on top with a blend mode.",
		search: "Try: paper, kraft, dust, leak…",
	},
	sounds: {
		title: "Sound effects",
		blurb: "sounds for landings, cuts and titles. Play one to hear it, then import it.",
		search: "Try: whoosh, paper, typewriter…",
	},
};

/** Cue's own motion graphics, curated footage, textures and sound effects. */
export function LibraryPanel() {
	const [tab, setTab] = useState<"motion" | Scope>("motion");
	const [assets, setAssets] = useState<LibraryAsset[]>([]);
	const selected = librarySelection.use((state) => state.id);
	useEffect(() => {
		void run<LibraryAsset[]>("list_library_assets").then((items) => items && setAssets(items));
	}, []);
	// An agent showing an asset opens the view it belongs to.
	useEffect(() => {
		const asset = assets.find((item) => item.id === selected);
		if (asset) setTab(scopeOf(asset));
	}, [assets, selected]);
	return (
		<div className="flex flex-col gap-3 p-3">
			<Segmented
				size="xs"
				value={tab}
				options={[
					{ value: "motion", label: "Motion", title: "Motion graphics" },
					{ value: "footage", label: "Footage" },
					{ value: "textures", label: "Textures" },
					{ value: "sounds", label: "Sounds", title: "Sound effects" },
				]}
				onChange={setTab}
			/>
			{tab === "motion" ? (
				<MotionGallery />
			) : (
				<AssetLibrary key={tab} scope={tab} assets={assets.filter((a) => scopeOf(a) === tab)} />
			)}
		</div>
	);
}

function AssetLibrary({ scope, assets }: { scope: Scope; assets: LibraryAsset[] }) {
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("All");
	const selected = librarySelection.use((state) => state.id);
	const [busy, setBusy] = useState<string | null>(null);
	const [playing, setPlaying] = useState<string | null>(null);
	const audio = useRef<HTMLAudioElement | null>(null);
	useEffect(() => () => audio.current?.pause(), []);
	const categories =
		scope === "footage" ? ["All", ...new Set(assets.map((asset) => asset.category))] : [];
	const visible = assets.filter(
		(asset) =>
			(category === "All" || asset.category === category) &&
			`${asset.name} ${asset.description} ${asset.category} ${asset.tags.join(" ")}`
				.toLowerCase()
				.includes(query.toLowerCase()),
	);
	const detail = visible.find((asset) => asset.id === selected);
	const importAsset = async (asset: LibraryAsset) => {
		setBusy(asset.id);
		const result = await run("import_library_asset", { id: asset.id });
		setBusy(null);
		if (result) {
			notify(`${asset.name} added to Media`, "success");
			editor.set({ panel: "media" });
		}
	};
	const toggleSound = (asset: LibraryAsset) => {
		audio.current?.pause();
		if (playing === asset.id) {
			setPlaying(null);
			return;
		}
		const url = bundledUrl(asset);
		if (!url) return;
		const player = new Audio(url);
		player.onended = () => setPlaying((id) => (id === asset.id ? null : id));
		audio.current = player;
		setPlaying(asset.id);
		void player.play().catch(() => setPlaying(null));
	};
	const copy = COPY[scope];
	return (
		<div className="flex flex-col gap-3">
			<div>
				<p className="text-[13px] font-semibold">{copy.title}</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted">
					{assets.length} {copy.blurb}
				</p>
			</div>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder={copy.search}
				aria-label="Search library assets"
				className="h-8 w-full rounded-md border border-border bg-field px-2.5 text-[12px] outline-none focus:border-accent"
			/>
			{categories.length > 2 && (
				<fieldset className="flex gap-1 overflow-x-auto border-0 pb-1">
					<legend className="sr-only">Asset categories</legend>
					{categories.map((name) => (
						<button
							key={name}
							type="button"
							onClick={() => setCategory(name)}
							aria-pressed={category === name}
							className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] ${category === name ? "bg-accent font-semibold text-white" : "bg-default text-muted hover:text-foreground"}`}
						>
							{name}
						</button>
					))}
				</fieldset>
			)}
			<p className="text-[11px] text-muted">{visible.length} shown</p>
			{detail && (
				<section
					className="overflow-hidden rounded-lg border border-accent bg-default"
					aria-label={`${detail.name} details`}
				>
					{scope !== "sounds" &&
						(detail.downloadUrl || detail.file.endsWith(".mp4") ? (
							<video
								key={detail.id}
								src={detail.downloadUrl ?? bundledUrl(detail)}
								poster={poster(detail.id)}
								controls
								muted
								loop={!!detail.use?.loop}
								playsInline
								preload="none"
								className="aspect-video w-full bg-black object-cover"
								aria-label={`${detail.name} preview`}
							/>
						) : (
							<img src={poster(detail.id)} alt="" className="aspect-video w-full object-cover" />
						))}
					<div className="space-y-2 p-3 text-[12px]">
						<p className="font-semibold">{detail.name}</p>
						<p className="leading-relaxed text-muted">{detail.description}</p>
						{detail.use && (
							<p className="leading-relaxed">
								{detail.use.blend && detail.use.blend !== "normal" && (
									<span className="mr-1 rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-semibold text-accent">
										{detail.use.blend}
									</span>
								)}
								{detail.use.note}
							</p>
						)}
						<p className="text-[11px] text-muted">
							{detail.credit ? `${detail.credit}. ` : ""}
							{detail.license}
						</p>
						<div className="flex items-center gap-3">
							{scope === "sounds" && (
								<Button size="sm" variant="secondary" onPress={() => toggleSound(detail)}>
									{playing === detail.id ? <Pause size={14} /> : <Play size={14} />}
									{playing === detail.id ? "Stop" : "Play"}
								</Button>
							)}
							<Button size="sm" isDisabled={busy !== null} onPress={() => void importAsset(detail)}>
								<DownloadSimple size={14} /> {busy === detail.id ? "Importing…" : "Import"}
							</Button>
							{detail.sourcePage && (
								<a
									href={detail.sourcePage}
									target="_blank"
									rel="noreferrer"
									className="inline-flex items-center gap-1 text-accent hover:underline"
								>
									Source <ArrowSquareOut size={13} />
								</a>
							)}
							<a
								href={detail.licenseUrl}
								target="_blank"
								rel="noreferrer"
								className="text-muted hover:text-foreground hover:underline"
							>
								License
							</a>
						</div>
					</div>
				</section>
			)}
			{scope === "sounds" ? (
				<ul className="flex flex-col gap-1">
					{visible.map((asset) => (
						<li
							key={asset.id}
							className={`flex items-center gap-2 rounded-lg border px-2 py-1.5 ${selected === asset.id ? "border-accent bg-accent/10" : "border-border bg-default hover:border-accent/60"}`}
						>
							<button
								type="button"
								onClick={() => toggleSound(asset)}
								aria-label={`${playing === asset.id ? "Stop" : "Play"} ${asset.name}`}
								className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-white"
							>
								{playing === asset.id ? (
									<Pause weight="fill" size={12} />
								) : (
									<Play weight="fill" size={12} />
								)}
							</button>
							<button
								type="button"
								onClick={() =>
									librarySelection.set({ id: selected === asset.id ? null : asset.id })
								}
								aria-pressed={selected === asset.id}
								className="min-w-0 flex-1 text-left"
							>
								<span className="block truncate text-[11px] font-semibold">{asset.name}</span>
								<span className="block text-[10px] text-muted">
									{((asset.durationMs ?? 0) / 1000).toFixed(1)} s ·{" "}
									{asset.tags.slice(0, 2).join(", ")}
								</span>
							</button>
						</li>
					))}
				</ul>
			) : (
				<div className="grid grid-cols-2 gap-2">
					{visible.map((asset) => (
						<button
							key={asset.id}
							type="button"
							onClick={() => librarySelection.set({ id: selected === asset.id ? null : asset.id })}
							aria-pressed={selected === asset.id}
							className={`group min-w-0 overflow-hidden rounded-lg border text-left ${selected === asset.id ? "border-accent bg-accent/10" : "border-border bg-default hover:border-accent/60"}`}
						>
							<span className="relative block aspect-video overflow-hidden bg-black">
								<img
									src={poster(asset.id)}
									alt=""
									loading="lazy"
									className="size-full object-cover transition-transform group-hover:scale-105"
								/>
								{(asset.downloadUrl || asset.file.endsWith(".mp4")) && (
									<Play
										weight="fill"
										className="absolute right-2 bottom-2 size-3.5 text-white drop-shadow-md"
									/>
								)}
							</span>
							<span className="block truncate px-2 pt-1.5 text-[11px] font-semibold">
								{asset.name}
							</span>
							<span className="block px-2 pb-2 text-[10px] text-muted">
								{scope === "textures" ? (asset.use?.blend ?? "normal") : asset.category}
							</span>
						</button>
					))}
				</div>
			)}
			{visible.length === 0 && (
				<p className="py-4 text-center text-[12px] text-muted">
					No matching assets. Try another word.
				</p>
			)}
		</div>
	);
}
