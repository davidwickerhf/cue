import {
	ArrowsLeftRight,
	ClockCounterClockwise,
	Cpu,
	GithubLogo,
	Keyboard,
	Lightning,
	Microphone,
	Plugs,
} from "@phosphor-icons/react/dist/ssr";
import type { ReactNode } from "react";
import { AutoVideo } from "@/components/AutoVideo";
import { DownloadCta, Footer, Header } from "@/components/Chrome";
import { Faq } from "@/components/Faq";
import { JsonLd } from "@/components/JsonLd";
import { Reveal, Words } from "@/components/Reveal";
import { FAQ } from "@/content/faq";
import { REPO } from "@/lib/site";
import { AgentConnect } from "@/components/AgentConnect";
import { faqPage, softwareApplication } from "@/lib/structured-data";

const FEATURES: { video: string; title: string; body: string }[] = [
	{
		video: "agent",
		title: "Your agent edits right alongside you",
		body: "Ask Claude Code, Codex or Gemini in the Agent panel, or connect any MCP client. It sees your playhead and selection, works with 110+ editing tools, and every change it makes is yours to undo.",
	},
	{
		video: "transcript",
		title: "Edit speech like a document",
		body: "Transcribe on your Mac with Whisper, then delete words to cut them from every track at once. Filler words go in one click, and you can search the footage by what is said.",
	},
	{
		video: "titles",
		title: "Titles that look designed",
		body: "Eleven templates, every font on your Mac, outlines, gradients and motion. Double-click a title in the viewer and type straight into it.",
	},
	{
		video: "look",
		title: "Colour, masks and adjustment layers",
		body: "Grade a shot or everything under an adjustment layer, spotlight with feathered masks, key out a green screen, and push in with zooms and keyframes. The preview matches the export.",
	},
	{
		video: "audio",
		title: "A real mixer, and cuts on the beat",
		body: "Level, pan, solo and live meters per track, music that ducks under the voice, and beat detection that drops markers and snaps your cuts to the music.",
	},
	{
		video: "nest",
		title: "Sequences and nesting",
		body: "Keep several timelines in one project and nest clips into their own sequence, like in Premiere. Open it, change it, and the nested clip follows.",
	},
	{
		video: "projects",
		title: "Every project at a glance",
		body: "Projects are plain .cueproj files with a complete history of every change, and Cue finds your media again when it moves.",
	},
];

const GRID: { icon: ReactNode; title: string; body: string }[] = [
	{
		icon: <Keyboard size={22} />,
		title: "Shortcuts you already know",
		body: "J/K/L, blade, slip, roll, ripple, insert and overwrite, lift and extract: Premiere's keys, so nothing is new.",
	},
	{
		icon: <Lightning size={22} />,
		title: "Fast and light",
		body: "Proxies, frame-accurate playback and hardware encoding keep it snappy on a laptop.",
	},
	{
		icon: <Cpu size={22} />,
		title: "AI on your Mac, or in the cloud",
		body: "Local Whisper, macOS voices, Ollama and LM Studio, or OpenAI with your own key.",
	},
	{
		icon: <Plugs size={22} />,
		title: "Built for agents",
		body: "One contract powers the UI and the MCP server, with a written guide every agent receives.",
	},
	{
		icon: <ArrowsLeftRight size={22} />,
		title: "Works with other editors",
		body: "Round-trip OpenTimelineIO, and export FCPXML, Shotcut MLT and EDL for Resolve, Final Cut and more.",
	},
	{
		icon: <ClockCounterClockwise size={22} />,
		title: "Complete history",
		body: "Every change is kept across sessions, with who made it. Go back to any point at any time.",
	},
	{
		icon: <Microphone size={22} />,
		title: "Voiceover booth",
		body: "Record takes against a teleprompter line by line, or generate a voice, and keep the best take.",
	},
	{
		icon: <GithubLogo size={22} />,
		title: "Free and open source",
		body: "MIT licensed, no accounts and no watermarks. Your footage never leaves your Mac unless you choose a cloud model.",
	},
];

export default function Home() {
	return (
		<>
			<JsonLd data={softwareApplication} />
			<JsonLd data={faqPage} />
			<Header home />

			<main id="top">
				<section className="mx-auto max-w-[1080px] px-5 pt-14 text-center">
					<Words
						as="h1"
						text="The video editor your agent can drive"
						step={70}
						className="text-[44px] leading-[1.05] font-bold tracking-[-0.035em] sm:text-[60px]"
					/>
					<Reveal delay={420} as="p" className="mx-auto mt-5 max-w-[720px] text-[17px] leading-relaxed text-muted sm:text-[19px]">
						Cue is a fast, open-source video editor for macOS. Cut by hand with the shortcuts you already know, or let Claude
						Code, Codex or any MCP agent edit right alongside you.
					</Reveal>
					<Reveal delay={600} className="mt-8">
						<DownloadCta />
					</Reveal>
					<Reveal delay={780} y={60} scale={0.96} duration={1200} className="mt-14 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/60">
						<AutoVideo name="edit" label="Cutting, splitting and playing back an edit in Cue" priority />
					</Reveal>
					<Reveal delay={950} as="p" className="mt-4 text-[13px] text-muted">
						Every demo on this page was recorded in Cue and rendered with Recordly.
					</Reveal>
				</section>

				<section id="features" className="mx-auto mt-28 flex max-w-[1080px] flex-col gap-8 px-5">
					{FEATURES.map((f, i) => (
						<Reveal
							key={f.video}
							as="article"
							y={48}
							blur={0}
							duration={1000}
							className={`grid items-center gap-8 rounded-2xl bg-card p-4 sm:p-5 md:grid-cols-[1.35fr_1fr] md:gap-10 ${i % 2 ? "md:grid-cols-[1fr_1.35fr]" : ""}`}
						>
							<div className={`overflow-hidden rounded-xl border border-line ${i % 2 ? "md:order-2" : ""}`}>
								<AutoVideo name={f.video} label={f.title} />
							</div>
							<div className={`px-2 pb-3 md:px-4 md:pb-0 ${i % 2 ? "md:order-1" : ""}`}>
								<Words text={f.title} delay={150} className="text-[28px] leading-[1.1] font-bold tracking-[-0.03em] sm:text-[34px]" />
								<Reveal delay={380} as="p" className="mt-4 text-[15px] leading-relaxed text-muted">
									{f.body}
								</Reveal>
							</div>
						</Reveal>
					))}
				</section>

				<section className="mx-auto mt-24 grid max-w-[1080px] gap-3 px-5 sm:grid-cols-2 lg:grid-cols-4">
					{GRID.map((g, i) => (
						<Reveal
							key={g.title}
							delay={(i % 4) * 90}
							className="rounded-2xl bg-card p-5 transition-[background-color,translate] duration-300 hover:-translate-y-1 hover:bg-[#1a1a1a]"
						>
							<span className="flex size-12 items-center justify-center rounded-full bg-[#1f1f1f] text-neutral-200">{g.icon}</span>
							<h3 className="mt-5 text-[16px] font-semibold">{g.title}</h3>
							<p className="mt-2 text-[14px] leading-relaxed text-muted">{g.body}</p>
						</Reveal>
					))}
				</section>

				<section className="mx-auto mt-24 max-w-[1080px] px-5">
					<Reveal y={40} blur={0} className="flex flex-col gap-5 rounded-2xl bg-card p-8">
						<div>
							<h2 className="text-[26px] font-bold tracking-[-0.03em]">Connect your agent in one line</h2>
							<p className="mt-2 text-[15px] text-muted">
								Pick your agent. Or skip it: the Agent panel inside Cue runs the CLIs you already have.
							</p>
						</div>
						<AgentConnect />
					</Reveal>
				</section>

				<section id="faq" className="mx-auto mt-28 grid max-w-[1080px] gap-10 px-5 pb-28 md:grid-cols-2">
					<div>
						<Reveal as="p" className="text-[14px] text-muted">
							{"// FAQ"}
						</Reveal>
						<Words
							text="Questions?"
							muted="We've got answers."
							delay={100}
							className="mt-2 text-[34px] leading-tight font-medium tracking-[-0.03em] sm:text-[38px]"
						/>
						<Reveal delay={450} as="p" className="mt-3 text-[15px] text-neutral-300">
							For support, please open an issue on{" "}
							<a href={`${REPO}/issues`} className="underline underline-offset-4 hover:text-white">
								GitHub
							</a>
							.
						</Reveal>
					</div>
					<Faq items={FAQ} />
				</section>
			</main>

			<Footer home />
		</>
	);
}
