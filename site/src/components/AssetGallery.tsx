"use client";

import { MagnifyingGlass } from "@phosphor-icons/react";
import Image from "next/image";
import { useState } from "react";
import assets from "../../../resources/assets/catalog.json";

const categories = ["All", ...new Set(assets.map((asset) => asset.category))];

export function AssetGallery() {
	const [category, setCategory] = useState("All");
	const [query, setQuery] = useState("");
	const visible = assets.filter((asset) =>
		(category === "All" || asset.category === category) &&
		`${asset.name} ${asset.description} ${asset.category} ${asset.tags.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
	);
	return <>
		<div className="mt-12 flex flex-col gap-5 border-y border-line py-5 lg:flex-row lg:items-center lg:justify-between">
			<fieldset className="flex flex-wrap gap-1.5 border-0"><legend className="sr-only">Filter assets by category</legend>
				{categories.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${category === name ? "bg-white text-black" : "text-neutral-300 hover:bg-card hover:text-white"}`}>{name}</button>)}
			</fieldset>
			<label className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-muted focus-within:border-accent">
				<MagnifyingGlass size={17} aria-hidden="true" />
				<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search subjects or motion" aria-label="Search assets" className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-muted lg:w-48" />
			</label>
		</div>
		<p className="mt-5 text-[13px] text-muted">{visible.length} of {assets.length} assets</p>
		{visible.length === 0 ? <p className="py-20 text-center text-muted">No matching footage. Try another subject.</p> :
			<div className="mt-6 grid gap-x-6 gap-y-11 sm:grid-cols-2 lg:grid-cols-3">
				{visible.map((asset) => <article id={asset.id} key={asset.id} className="min-w-0 scroll-mt-8">
					{"downloadUrl" in asset ? <video src={asset.downloadUrl} poster={`/assets/${asset.id}.jpg`} controls muted playsInline preload="none" className="aspect-video w-full rounded-xl bg-black object-cover" aria-label={`${asset.name} footage preview`} /> : <Image src={`/assets/${asset.id}.jpg`} alt="" width={640} height={360} className="aspect-video w-full rounded-xl object-cover" />}
					<div className="mt-4 flex items-start justify-between gap-4"><div><p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{asset.category}</p><h2 className="mt-1 text-[22px] font-semibold tracking-[-0.02em]">{asset.name}</h2></div><span className="rounded-full border border-line px-2 py-1 text-[11px] text-muted">{"downloadUrl" in asset ? "Video" : "Graphic"}</span></div>
				<p className="mt-2 text-[14px] leading-relaxed text-neutral-300">{asset.description}</p>
				<p className="mt-3 text-[12px] text-muted">{asset.tags.join(" · ")}</p>
				<div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-4 text-[12px]">
					{"sourcePage" in asset && <a className="text-neutral-200 underline underline-offset-4 hover:text-white" href={asset.sourcePage} target="_blank" rel="noreferrer">Source ↗</a>}
					<a className="text-neutral-200 underline underline-offset-4 hover:text-white" href={asset.licenseUrl} target="_blank" rel="noreferrer">License ↗</a>
				</div>
				</article>)}
			</div>}
	</>;
}
