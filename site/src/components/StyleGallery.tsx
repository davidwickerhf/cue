"use client";

import { ArrowRight, MagnifyingGlass, Pause, Play } from "@phosphor-icons/react";
import { useRef, useState } from "react";
import { STYLES, type StyleEntry } from "@/content/styles";

const categories = ["All", ...new Set(STYLES.map((style) => style.category))];

export function StyleGallery() {
	const [category, setCategory] = useState("All");
	const [query, setQuery] = useState("");
	const visible = STYLES.filter((style) =>
		(category === "All" || style.category === category) &&
		`${style.name} ${style.description} ${style.category} ${style.guide.goal} ${style.assetIds.join(" ")}`.toLowerCase().includes(query.toLowerCase()),
	);
	return <>
		<div className="mt-12 flex flex-col gap-5 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
			<fieldset className="flex flex-wrap gap-1.5 border-0"><legend className="sr-only">Filter styles by category</legend>
				{categories.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${category === name ? "bg-white text-black" : "text-neutral-300 hover:bg-card hover:text-white"}`}>{name}</button>)}
			</fieldset>
			<label className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-muted focus-within:border-accent">
				<MagnifyingGlass size={17} aria-hidden="true" />
				<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a style" aria-label="Find a style" className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-muted sm:w-32" />
			</label>
		</div>
		<p className="mt-5 text-[13px] text-muted">{visible.length} of {STYLES.length} styles</p>
		{visible.length === 0 ? <p className="py-20 text-center text-muted">No styles match. Try another term or category.</p> :
			<div className="grid gap-x-7 gap-y-14 pt-9 pb-24 md:grid-cols-2">
				{visible.map((style) => <article key={style.id} id={style.id} className="scroll-mt-8 min-w-0">
					<StylePreview style={style} />
					<div className="mt-4 flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-[#a4a4a4]">{style.category}</p><h2 className="mt-1 text-[25px] font-semibold tracking-[-0.025em]">{style.name}</h2></div><span className="rounded-full border border-line px-2 py-1 text-[11px] text-muted">4 sec preview</span></div>
					<p className="mt-2 max-w-[58ch] text-[15px] leading-relaxed text-neutral-300">{style.description}</p>
					<details className="group mt-4 border-t border-line pt-3">
						<summary className="flex cursor-pointer items-center gap-2 py-1 text-[14px] font-semibold text-white focus-visible:outline-2 focus-visible:outline-accent">See the edit plan <ArrowRight size={16} className="transition-transform group-open:rotate-90" /></summary>
						<p className="pt-4 text-[14px] leading-relaxed text-neutral-200">{style.guide.goal}</p>
						<div className="grid gap-5 pt-5 text-[14px] leading-relaxed text-neutral-300 sm:grid-cols-2">
							<GuideList title="Footage" items={style.guide.requires} />
							<GuideList title="Structure" items={style.guide.structure} ordered />
							<GuideList title="Direction" items={style.guide.directions} />
							<GuideList title="Review" items={style.guide.review} />
						</div>
						{style.assetIds.length > 0 && <div className="mt-5 text-[13px] text-muted">Try it with <span className="text-neutral-200">{style.assetIds.length} library assets:</span> <span className="inline-flex flex-wrap gap-x-2 gap-y-1">{style.assetIds.map((id) => <a key={id} href={`/assets#${id}`} className="underline underline-offset-4 hover:text-white">{id.replaceAll("-", " ")}</a>)}</span></div>}
						<p className="mt-3 text-[12px] text-muted">Visual research: {style.references.map((ref, index) => <span key={ref.url}>{index > 0 && " · "}<a href={ref.url} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-white">{ref.label}</a></span>)}</p>
					</details>
				</article>)}
			</div>}
	</>;
}

function StylePreview({ style }: { style: StyleEntry }) {
	const video = useRef<HTMLVideoElement>(null);
	const [playing, setPlaying] = useState(false);
	const start = () => {
		const media = video.current;
		if (!media) return;
		void media.play().then(() => setPlaying(true)).catch(() => {});
	};
	const stop = () => {
		const media = video.current;
		if (!media) return;
		media.pause();
		media.currentTime = 0;
		setPlaying(false);
	};
	return <div className="group relative aspect-video overflow-hidden rounded-[10px] bg-[#242424]" onMouseEnter={() => {
		if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) start();
	}} onMouseLeave={stop}>
		<video ref={video} src={`/styles/${style.preview.video}`} poster={`/styles/${style.preview.poster}`} muted loop playsInline preload="none" className="size-full object-cover" aria-label={`${style.name} video study`} />
		<button type="button" onClick={() => playing ? stop() : start()} aria-label={`${playing ? "Pause" : "Play"} ${style.name} preview`} className="absolute right-4 bottom-4 flex size-10 items-center justify-center rounded-full border border-white/40 bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-accent">
			{playing ? <Pause weight="fill" size={17} /> : <Play weight="fill" size={17} />}
		</button>
		<span className="pointer-events-none absolute top-4 left-4 rounded-full bg-black/55 px-2.5 py-1 text-[11px] font-semibold tracking-[.1em] text-white/90 backdrop-blur-sm">CUE / STYLE STUDY</span>
	</div>;
}

function GuideList({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
	return <div><h3 className="mb-2 text-[12px] font-semibold tracking-wide text-white uppercase">{title}</h3>{ordered ? <ol className="list-decimal space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ol> : <ul className="list-disc space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>;
}
