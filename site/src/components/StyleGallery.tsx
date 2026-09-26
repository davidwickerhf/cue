"use client";

import { ArrowRight, MagnifyingGlass } from "@phosphor-icons/react";
import { useState } from "react";
import { STYLES, type StyleEntry } from "@/content/styles";

const categories = ["All", ...new Set(STYLES.map((style) => style.category))];

export function StyleGallery() {
	const [category, setCategory] = useState("All");
	const [query, setQuery] = useState("");
	const visible = STYLES.filter((style) =>
		(category === "All" || style.category === category) &&
		`${style.name} ${style.description} ${style.category}`.toLowerCase().includes(query.toLowerCase()),
	);
	return <>
		<div className="mt-12 flex flex-col gap-5 border-y border-line py-5 sm:flex-row sm:items-center sm:justify-between">
			<div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter styles by category">
				{categories.map((name) => <button key={name} type="button" aria-pressed={category === name} onClick={() => setCategory(name)} className={`rounded-full px-3 py-1.5 text-[13px] transition-colors ${category === name ? "bg-white text-black" : "text-neutral-300 hover:bg-card hover:text-white"}`}>{name}</button>)}
			</div>
			<label className="flex shrink-0 items-center gap-2 rounded-lg border border-line bg-card px-3 py-2 text-muted focus-within:border-accent">
				<MagnifyingGlass size={17} aria-hidden="true" />
				<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a style" aria-label="Find a style" className="w-full bg-transparent text-[14px] text-white outline-none placeholder:text-muted sm:w-32" />
			</label>
		</div>
		{visible.length === 0 ? <p className="py-20 text-center text-muted">No styles match. Try another term or category.</p> :
			<div className="grid gap-x-7 gap-y-12 pt-9 pb-24 md:grid-cols-2">
				{visible.map((style) => <article key={style.id} id={style.id} className="scroll-mt-8 min-w-0">
					<StyleArt style={style} />
					<div className="mt-4 flex items-start justify-between gap-3"><div><p className="text-[12px] font-medium text-[#a4a4a4]">{style.category}</p><h2 className="mt-1 text-[25px] font-semibold tracking-[-0.025em]">{style.name}</h2></div><span aria-hidden="true" className="text-[13px] text-[#a4a4a4]">CUE / {style.id.slice(-2).toUpperCase()}</span></div>
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
					</details>
				</article>)}
			</div>}
	</>;
}

function GuideList({ title, items, ordered = false }: { title: string; items: string[]; ordered?: boolean }) {
	return <div><h3 className="mb-2 text-[12px] font-semibold tracking-wide text-white uppercase">{title}</h3>{ordered ? <ol className="list-decimal space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ol> : <ul className="list-disc space-y-1 pl-4">{items.map((item) => <li key={item}>{item}</li>)}</ul>}</div>;
}

const palette: Record<string, { background: string; foreground: string; accent: string; label: string }> = {
	"style-kinetic-quote": { background: "#d7c9ae", foreground: "#2b211d", accent: "#f36b3c", label: "SAY IT\nLIKE THIS" },
	"style-beat-grid": { background: "#372958", foreground: "#f5efdc", accent: "#edbc5d", label: "ONE / TWO\nTHREE / FOUR" },
	"style-match-motion": { background: "#c35335", foreground: "#fcf1da", accent: "#422d30", label: "MOVE →" },
	"style-paper-collage": { background: "#d7d0bd", foreground: "#34372e", accent: "#d66b56", label: "CUT.\nPASTE." },
	"style-light-leak": { background: "#793a29", foreground: "#ffe6b8", accent: "#e89a47", label: "AFTER\nTHE LIGHT" },
	"style-screen-focus": { background: "#2e4759", foreground: "#e9eef0", accent: "#edac6d", label: "FOCUS\nHERE" },
	"style-split-reveal": { background: "#455c4a", foreground: "#f0eee2", accent: "#c2d4aa", label: "BEFORE / AFTER" },
	"style-quiet-portrait": { background: "#565a66", foreground: "#f4eee5", accent: "#adbac3", label: "A MOMENT\nTO STAY" },
};

function StyleArt({ style }: { style: StyleEntry }) {
	const p = palette[style.id] ?? palette["style-quiet-portrait"];
	return <div aria-hidden="true" className="relative aspect-[16/10] overflow-hidden rounded-[10px]" style={{ background: p.background, color: p.foreground }}>
		{style.id === "style-beat-grid" && <div className="absolute inset-0 grid grid-cols-4 gap-2 p-5 opacity-45">{[0,1,2,3].map((i) => <div key={i} className="rounded-sm" style={{ background: i % 2 ? p.accent : p.foreground, transform: `translateY(${i % 2 ? 16 : -16}px)` }} />)}</div>}
		{style.id === "style-paper-collage" && <><div className="absolute top-[8%] right-[16%] h-[66%] w-[40%] -rotate-8 bg-[#748c81] shadow-[8px_12px_28px_rgba(0,0,0,.24)]" /><div className="absolute top-[15%] right-[5%] h-[58%] w-[36%] rotate-7 bg-[#bd745c] shadow-[8px_12px_28px_rgba(0,0,0,.24)]" /></>}
		{style.id === "style-split-reveal" && <div className="absolute inset-y-0 right-0 w-1/2 border-l-2 border-white/70 bg-[#aec1a6]" />}
		{style.id === "style-light-leak" && <div className="absolute -right-[20%] -top-[40%] size-[110%] rounded-full bg-[#ffb858] blur-[45px] opacity-65" />}
		{style.id === "style-screen-focus" && <div className="absolute inset-[13%] rounded-lg border border-white/60 p-3"><div className="h-2 w-20 rounded-full bg-white/55" /><div className="mt-8 ml-auto h-[42%] w-[52%] rounded-md border-2 border-[#edac6d] bg-white/10" /></div>}
		{style.id === "style-quiet-portrait" && <div className="absolute right-[10%] bottom-[-36%] h-[110%] w-[48%] rounded-[50%_50%_0_0] bg-[#242d36]" />}
		{style.id === "style-match-motion" && <div className="absolute top-[28%] right-[9%] text-[11rem] leading-none font-black opacity-35 sm:text-[14rem]">→</div>}
		{style.id === "style-kinetic-quote" && <div className="absolute top-0 right-[11%] h-full w-[3%] rotate-12" style={{ background: p.accent }} />}
		<div className="absolute inset-x-[7%] bottom-[9%] z-10 whitespace-pre-line text-[clamp(2.1rem,6vw,5.8rem)] leading-[0.9] font-black tracking-[-0.065em]" style={{ textShadow: style.id === "style-light-leak" ? "0 2px 25px rgba(0,0,0,.3)" : undefined }}>{p.label}</div>
		<div className="absolute top-[7%] left-[7%] text-[11px] font-bold tracking-[.17em]">CUE / STYLE STUDY</div>
	</div>;
}
