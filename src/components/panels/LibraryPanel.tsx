import { Button } from "@heroui/react";
import { ArrowSquareOut, DownloadSimple, Play } from "@phosphor-icons/react";
import { useEffect, useState } from "react";
import type { LibraryAsset } from "../../../electron/core/assetLibrary";
import { notify, run } from "../../lib/api";
import { librarySelection } from "../../lib/assetLibrary";
import { editor } from "../../lib/state";

const posters = import.meta.glob("../../../resources/assets/posters/*.jpg", {
	eager: true,
	query: "?url",
	import: "default",
}) as Record<string, string>;
const poster = (id: string) => posters[`../../../resources/assets/posters/${id}.jpg`];

export function LibraryPanel() {
	const [assets, setAssets] = useState<LibraryAsset[]>([]);
	const [query, setQuery] = useState("");
	const [category, setCategory] = useState("All");
	const selected = librarySelection.use((state) => state.id);
	const [busy, setBusy] = useState<string | null>(null);
	useEffect(() => {
		void run<LibraryAsset[]>("list_library_assets").then((items) => items && setAssets(items));
	}, []);
	const categories = ["All", ...new Set(assets.map((asset) => asset.category))];
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
	return (
		<div className="flex flex-col gap-3 p-3">
			<div>
				<p className="text-[13px] font-semibold">Find a shot for the story</p>
				<p className="mt-1 text-[11px] leading-relaxed text-muted">
					{assets.length} curated clips and graphics. Pick one to preview, then import it into your
					project.
				</p>
			</div>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Try: research, route, people…"
				aria-label="Search library assets"
				className="h-8 w-full rounded-md border border-border bg-field px-2.5 text-[12px] outline-none focus:border-accent"
			/>
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
			<p className="text-[11px] text-muted">{visible.length} shown</p>
			{detail && (
				<section
					className="overflow-hidden rounded-lg border border-accent bg-default"
					aria-label={`${detail.name} details`}
				>
					{detail.downloadUrl ? (
						<video
							key={detail.id}
							src={detail.downloadUrl}
							poster={poster(detail.id)}
							controls
							muted
							playsInline
							preload="none"
							className="aspect-video w-full bg-black object-cover"
							aria-label={`${detail.name} preview`}
						/>
					) : (
						<img src={poster(detail.id)} alt="" className="aspect-video w-full object-cover" />
					)}
					<div className="space-y-2 p-3 text-[12px]">
						<p className="font-semibold">{detail.name}</p>
						<p className="leading-relaxed text-muted">{detail.description}</p>
						<p className="text-[11px] text-muted">{detail.license}</p>
						<div className="flex items-center gap-3">
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
							{asset.downloadUrl && (
								<Play
									weight="fill"
									className="absolute right-2 bottom-2 size-3.5 text-white drop-shadow-md"
								/>
							)}
						</span>
						<span className="block truncate px-2 pt-1.5 text-[11px] font-semibold">
							{asset.name}
						</span>
						<span className="block px-2 pb-2 text-[10px] text-muted">{asset.category}</span>
					</button>
				))}
			</div>
			{visible.length === 0 && (
				<p className="py-4 text-center text-[12px] text-muted">
					No matching assets. Try another subject.
				</p>
			)}
		</div>
	);
}
