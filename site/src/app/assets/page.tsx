import { Footer, Header } from "@/components/Chrome";
import { AssetGallery } from "@/components/AssetGallery";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
	title: "Asset library",
	description: "Browse stock footage and original graphics for Cue projects, with clear sources and licenses.",
	path: "/assets",
});

export default function AssetsPage() {
	return <><Header /><main className="mx-auto max-w-[1180px] px-5 pb-24 pt-12 sm:pt-20">
		<p className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Cue asset library</p>
		<h1 className="mt-5 max-w-[850px] text-[clamp(3rem,7vw,6rem)] font-semibold leading-[.98] tracking-[-0.04em]">Build the world around your story.</h1>
		<p className="mt-7 max-w-[740px] text-[17px] leading-relaxed text-neutral-300 sm:text-[19px]">Footage for the places, people, and details between your main shots. Search by subject, preview motion, then bring a licensed clip into Cue.</p>
		<AssetGallery />
		<p className="mt-10 max-w-[760px] text-[13px] leading-relaxed text-muted">Stock videos download from Mixkit when imported into Cue. Check the linked source and license before publishing. Cue graphics are editable starting points; replace illustrative marks with verified facts.</p>
	</main><Footer /></>;
}
