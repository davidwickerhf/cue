import { DownloadSimple, FilmStrip, Robot } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import { DownloadCta, Footer, Header } from "@/components/Chrome";
import { AgentConnect } from "@/components/AgentConnect";
import { CopyBlock } from "@/components/CopyBlock";
import { JsonLd } from "@/components/JsonLd";
import { Reveal } from "@/components/Reveal";
import type { Example } from "@/content/examples";
import { SITE_URL } from "@/lib/site";

/** Structured data: the example as a VideoObject. */
function videoObject(e: Example) {
	return {
		"@context": "https://schema.org",
		"@type": "VideoObject",
		name: e.title,
		description: e.summary,
		thumbnailUrl: `${SITE_URL}${e.poster}`,
		contentUrl: `${SITE_URL}${e.video}`,
		duration: `PT${Math.round(e.durationS)}S`,
		uploadDate: "2026-09-27",
	};
}

/** One example: the video, its project to download, how it was made, and the prompt to make it again. */
export function ExamplePage({ example: e }: { example: Example }) {
	return (
		<>
			<JsonLd data={videoObject(e)} />
			<Header />
			<main className="mx-auto max-w-[1080px] px-5 pt-10 pb-28 sm:pt-16">
				<Reveal as="p" className="text-[14px] text-muted">
					<Link href="/examples" className="hover:text-white">
						Examples
					</Link>{" "}
					· {e.style}
				</Reveal>
				<Reveal delay={80} as="h1" className="mt-2 text-[clamp(2.6rem,6vw,4.5rem)] leading-[1] font-semibold tracking-[-0.04em]">
					{e.title}
				</Reveal>
				<Reveal delay={160} as="p" className="mt-5 max-w-[760px] text-[17px] leading-relaxed text-neutral-300 sm:text-[19px]">
					{e.summary}
				</Reveal>

				{e.original ? (
					<Reveal delay={200} className="mt-6 max-w-[760px] rounded-2xl border border-line bg-card p-5">
						<p className="text-[13px] font-medium text-neutral-200">
							Original:{" "}
							<a href={e.original.href} className="underline underline-offset-4 hover:text-white">
								{e.original.title}
							</a>{" "}
							by {e.original.by}
						</p>
						<p className="mt-1.5 text-[14px] leading-relaxed text-muted">{e.original.note}</p>
					</Reveal>
				) : null}

				<Reveal delay={260} y={50} scale={0.97} duration={1100} className="mt-10 overflow-hidden rounded-2xl border border-line bg-black shadow-2xl shadow-black/60">
					{/* biome-ignore lint/a11y/useMediaCaption: narrated explainer; the script is on this page */}
					<video
						src={e.video}
						poster={e.poster}
						controls
						playsInline
						preload="metadata"
						width={1280}
						height={720}
						className="block aspect-video h-auto w-full"
					/>
				</Reveal>

				<Reveal delay={340} className="mt-6 flex flex-wrap gap-3">
					<a
						href={e.project.url}
						className="flex items-center gap-2.5 rounded-xl bg-accent px-5 py-3 text-[15px] font-semibold text-white shadow-[0_8px_30px_-8px_rgba(10,108,255,0.7)] transition hover:-translate-y-0.5 hover:brightness-110"
					>
						<DownloadSimple size={18} weight="bold" /> Download the project ({e.project.sizeMb} MB)
					</a>
					<a href={e.fullVideo} className="flex items-center gap-2.5 rounded-xl bg-card px-5 py-3 text-[15px] font-semibold text-neutral-100 hover:bg-[#1f1f1f]">
						<FilmStrip size={18} /> Video in 1080p
					</a>
					<a href="#prompt" className="flex items-center gap-2.5 rounded-xl bg-card px-5 py-3 text-[15px] font-semibold text-neutral-100 hover:bg-[#1f1f1f]">
						<Robot size={18} /> Make it with your agent
					</a>
				</Reveal>
				<p className="mt-3 text-[13px] text-muted">
					The project opens in Cue 0.2 or later: unzip it and double-click the .cueproj. Every picture, film and sound in it is public
					domain or CC0; the sources are listed below and in its README.
				</p>

				<section className="mt-16 grid grid-cols-2 gap-3 sm:grid-cols-4">
					{e.numbers.map((n) => (
						<Reveal key={n.label} y={20} className="rounded-2xl bg-card p-5">
							<p className="text-[28px] font-bold tracking-[-0.03em]">{n.value}</p>
							<p className="mt-1 text-[13px] text-muted">{n.label}</p>
						</Reveal>
					))}
				</section>

				<section className="mt-16">
					<Reveal as="h2" className="text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
						How it was made
					</Reveal>
					<Reveal delay={80} as="p" className="mt-3 max-w-[720px] text-[16px] leading-relaxed text-muted">
						An agent built the whole video through Cue&apos;s MCP tools, following the Vox playbook. The full build, scene by scene, is the
						playbook <code className="rounded bg-card px-1.5 py-0.5 text-[14px] text-neutral-200">example-why-we-say-ok</code> that every
						agent connected to Cue can read.
					</Reveal>
					<ol className="mt-8 grid gap-3 md:grid-cols-2">
						{e.steps.map((s, i) => (
							<Reveal key={s.title} as="li" delay={(i % 2) * 80} y={28} className="rounded-2xl bg-card p-6">
								<p className="text-[13px] font-medium text-accent">Step {i + 1}</p>
								<h3 className="mt-1 text-[19px] font-bold tracking-[-0.02em]">{s.title}</h3>
								<p className="mt-2 text-[15px] leading-relaxed text-muted">{s.body}</p>
							</Reveal>
						))}
					</ol>
					<Reveal y={30} className="mt-6 overflow-hidden rounded-2xl border border-line">
						<Image
							src={`/examples/${e.slug}-frames.jpg`}
							alt={`Frames every three seconds from ${e.title}`}
							width={1600}
							height={900}
							className="h-auto w-full"
						/>
					</Reveal>
				</section>

				<section id="prompt" className="mt-16 scroll-mt-8">
					<Reveal as="h2" className="text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
						Make it again from scratch
					</Reveal>
					<Reveal delay={80} as="p" className="mt-3 max-w-[720px] text-[16px] leading-relaxed text-muted">
						Connect your agent to Cue, open Cue, and paste this prompt into Claude Code, Codex, Gemini CLI or any MCP client. It takes an
						agent about an hour and uses text-to-speech for the voice (an OpenAI key in Cue&apos;s AI settings, or record the lines
						yourself).
					</Reveal>
					<Reveal delay={120} className="mt-5">
						<AgentConnect />
					</Reveal>
					<Reveal delay={160} className="mt-5">
						<CopyBlock text={e.prompt} label="Copy prompt" analytics={{ event: "prompt_copied", example: e.slug }} />
					</Reveal>
				</section>

				<section className="mt-16">
					<Reveal as="h2" className="text-[24px] font-bold tracking-[-0.03em]">
						Sources
					</Reveal>
					<ul className="mt-4 flex flex-col gap-2 text-[15px]">
						{e.credits.map((c) => (
							<li key={c.href} className="text-muted">
								<a href={c.href} className="text-neutral-200 underline underline-offset-4 hover:text-white">
									{c.label}
								</a>{" "}
								· {c.licence}
							</li>
						))}
					</ul>
					<p className="mt-4 max-w-[760px] text-[13px] leading-relaxed text-muted">
						A remake of Vox&apos;s &ldquo;Why we say OK&rdquo;, made as a test of what Cue can do: the idea, story and editing style are
						Vox&apos;s; the material and the build are new. Not affiliated with or endorsed by Vox Media. The Boston Morning Post
						clipping is re-set in type from its 1839 text.
					</p>
				</section>

				<section className="mt-20 text-center">
					<Reveal as="h2" className="text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
						Make your own
					</Reveal>
					<Reveal delay={150} className="mt-6">
						<DownloadCta location="example-bottom" />
					</Reveal>
				</section>
			</main>
			<Footer />
		</>
	);
}
