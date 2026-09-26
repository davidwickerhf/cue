import { Button } from "@heroui/react";
import { ArrowSquareOut, DownloadSimple } from "@phosphor-icons/react";
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
	const selected = librarySelection.use((state) => state.id);
	const [busy, setBusy] = useState<string | null>(null);
	useEffect(() => {
		void run<LibraryAsset[]>("list_library_assets").then((items) => items && setAssets(items));
	}, []);
	const visible = assets.filter((asset) =>
		`${asset.name} ${asset.description} ${asset.tags.join(" ")}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	);
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
			<p className="text-[12px] leading-relaxed text-muted">
				Stock footage and original graphics for your edits. Import one to add it to this project.
			</p>
			<input
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search assets"
				aria-label="Search library assets"
				className="h-8 w-full rounded-md border border-border bg-field px-2.5 text-[12px] outline-none focus:border-accent"
			/>
			{visible.map((asset) => (
				<article
					key={asset.id}
					className="overflow-hidden rounded-lg border border-border bg-default"
				>
					<button
						type="button"
						onClick={() => librarySelection.set({ id: selected === asset.id ? null : asset.id })}
						aria-expanded={selected === asset.id}
						className="w-full text-left"
					>
						<img
							src={poster(asset.id)}
							alt=""
							loading="lazy"
							className="aspect-video w-full object-cover"
						/>
						<span className="block px-3 pt-2 text-[13px] font-semibold">{asset.name}</span>
						<span className="block px-3 pb-3 text-[11px] text-muted">
							{asset.category} · {asset.tags.join(" · ")}
						</span>
					</button>
					{selected === asset.id && (
						<div className="space-y-2 border-t border-border px-3 py-3 text-[12px]">
							<p className="leading-relaxed text-muted">{asset.description}</p>
							<p className="text-muted">{asset.license}</p>
							<div className="flex items-center gap-3">
								<Button
									size="sm"
									isDisabled={busy !== null}
									onPress={() => void importAsset(asset)}
								>
									<DownloadSimple size={14} /> {busy === asset.id ? "Importing…" : "Import"}
								</Button>
								{asset.sourcePage && (
									<a
										href={asset.sourcePage}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 text-accent hover:underline"
									>
										Source <ArrowSquareOut size={13} />
									</a>
								)}
							</div>
						</div>
					)}
				</article>
			))}
			{visible.length === 0 && (
				<p className="py-4 text-center text-[12px] text-muted">No matching assets.</p>
			)}
		</div>
	);
}
