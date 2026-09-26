import { Footer, Header } from "@/components/Chrome";
import { StyleGallery } from "@/components/StyleGallery";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
	title: "Style library",
	description: "Browse editing styles, transitions, montage structures and motion ideas that Cue's AI agent can adapt to your footage.",
	path: "/styles",
});

export default function StylesPage() {
	return <><Header /><main className="mx-auto max-w-[1080px] px-5 pt-12 sm:pt-20">
		<h1 className="max-w-[850px] text-[clamp(3rem,7vw,6rem)] leading-[.98] font-semibold tracking-[-0.04em]">A library of ways to edit.</h1>
		<p className="mt-7 max-w-[690px] text-[17px] leading-relaxed text-neutral-300 sm:text-[19px]">Explore transitions, montages, text treatments and screen stories. Each guide has a visual idea, a structure and editing directions that Cue’s agent can adapt to the footage in your project.</p>
		<p className="mt-4 text-[14px] text-muted">Open Cue → Generate → Style library, then choose a style and ask your agent to make it.</p>
		<StyleGallery />
	</main><Footer /></>;
}
