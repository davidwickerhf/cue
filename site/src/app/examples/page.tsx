import Image from "next/image";
import Link from "next/link";
import { Footer, Header } from "@/components/Chrome";
import { Reveal } from "@/components/Reveal";
import { EXAMPLES } from "@/content/examples";
import { pageMetadata } from "@/lib/metadata";

export const metadata = pageMetadata({
	title: "Examples",
	description:
		"Videos made in Cue by an AI agent, with the project files to download and the prompt to make them again from scratch.",
	path: "/examples",
});

export default function ExamplesPage() {
	return (
		<>
			<Header />
			<main className="mx-auto max-w-[1080px] px-5 pt-12 pb-28 sm:pt-20">
				<Reveal as="h1" className="max-w-[850px] text-[clamp(3rem,7vw,6rem)] leading-[.98] font-semibold tracking-[-0.04em]">
					Made in Cue.
				</Reveal>
				<Reveal delay={150} as="p" className="mt-7 max-w-[690px] text-[17px] leading-relaxed text-neutral-300 sm:text-[19px]">
					Videos an agent made by driving Cue. Each one comes with its project, ready to open and take apart, and the prompt to make
					it again from scratch with your own agent.
				</Reveal>
				<div className="mt-14 grid gap-5 md:grid-cols-2">
					{EXAMPLES.map((e, i) => (
						<Reveal key={e.slug} delay={i * 90} y={32}>
							<Link href={`/examples/${e.slug}`} className="group block overflow-hidden rounded-2xl border border-line bg-card transition hover:border-neutral-600">
								<Image
									src={e.poster}
									alt={`A frame from ${e.title}`}
									width={1280}
									height={720}
									className="aspect-video w-full object-cover transition duration-500 group-hover:scale-[1.02]"
								/>
								<div className="p-6">
									<p className="text-[13px] text-muted">
										{e.style} · {Math.floor(e.durationS)} s
									</p>
									<h2 className="mt-1 text-[24px] font-bold tracking-[-0.025em]">{e.title}</h2>
									<p className="mt-2 text-[15px] leading-relaxed text-muted">{e.summary}</p>
								</div>
							</Link>
						</Reveal>
					))}
				</div>
			</main>
			<Footer />
		</>
	);
}
