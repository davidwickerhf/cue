import { Footer, Header } from "@/components/Chrome";
import { pageMetadata } from "@/lib/metadata";
import Image from "next/image";
import assets from "../../../../resources/assets/catalog.json";

export const metadata = pageMetadata({
	title: "Asset library",
	description: "Browse stock footage and original graphics for Cue projects, with clear sources and licenses.",
	path: "/assets",
});

export default function AssetsPage() {
	return <><Header /><main className="mx-auto max-w-[1080px] px-5 pb-24 pt-12 sm:pt-20">
		<p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Cue asset library</p>
		<h1 className="mt-5 max-w-[850px] text-[clamp(3rem,7vw,6rem)] font-semibold leading-[.98] tracking-[-0.04em]">The material behind the edit.</h1>
		<p className="mt-7 max-w-[680px] text-[17px] leading-relaxed text-neutral-300 sm:text-[19px]">Start with moving footage, then add a map or document graphic for context. Every asset has a source and usage details. Open Cue → Asset library to bring one into your project.</p>
		<div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
			{assets.map((asset) => <article id={asset.id} key={asset.id} className="overflow-hidden rounded-2xl border border-white/10 bg-card">
				{"downloadUrl" in asset ? <video src={asset.downloadUrl} poster={`/assets/${asset.id}.jpg`} controls muted playsInline preload="none" className="aspect-video w-full bg-black object-cover" aria-label={`${asset.name} stock footage preview`} /> : <Image src={`/assets/${asset.id}.jpg`} alt="" width={640} height={360} className="aspect-video w-full object-cover" />}
				<div className="p-5">
					<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-accent">{asset.category}</p>
					<h2 className="mt-2 text-[21px] font-semibold">{asset.name}</h2>
					<p className="mt-2 min-h-[3.5rem] text-[14px] leading-relaxed text-neutral-300">{asset.description}</p>
					<p className="mt-4 text-[12px] text-muted">{asset.tags.join(" · ")}</p>
					<div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 border-t border-white/10 pt-4 text-[12px]">
						{"sourcePage" in asset && <a className="text-neutral-200 underline underline-offset-4 hover:text-white" href={asset.sourcePage} target="_blank" rel="noreferrer">Source ↗</a>}
						<a className="text-neutral-200 underline underline-offset-4 hover:text-white" href={asset.licenseUrl} target="_blank" rel="noreferrer">{asset.license} ↗</a>
					</div>
				</div>
			</article>)}
		</div>
		<p className="mt-8 max-w-[760px] text-[13px] leading-relaxed text-muted">Stock videos are served by Mixkit when imported into Cue. Check the linked license and source before publishing. The two Cue graphics are editable starting points; replace any placeholder marks with verified facts.</p>
	</main><Footer /></>;
}
