import Link from "next/link";
import { ChangelogViewed } from "@/components/Analytics";
import { Footer, Header } from "@/components/Chrome";
import { Reveal } from "@/components/Reveal";
import { CHANGELOG } from "@/content/changelog";
import { pageMetadata } from "@/lib/metadata";
import { REPO } from "@/lib/site";

export const metadata = pageMetadata({
	title: "Changelog",
	description: "What is new in Cue, the open-source video editor for macOS that AI agents can drive, release by release.",
	path: "/changelog",
});

function formatDate(iso: string) {
	return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

export default function Changelog() {
	return (
		<>
			<Header />
			<ChangelogViewed latest={CHANGELOG.find((r) => r.version !== "Unreleased")?.version ?? ""} />
			<main className="mx-auto max-w-[760px] px-5 pt-14 pb-28">
				<Reveal as="h1" className="text-[40px] leading-[1.05] font-bold tracking-[-0.035em] sm:text-[52px]">
					Changelog
				</Reveal>
				<Reveal delay={150} as="p" className="mt-4 text-[17px] leading-relaxed text-muted">
					What changed in each version of Cue. Downloads and full notes are on{" "}
					<a href={`${REPO}/releases`} className="underline underline-offset-4 hover:text-white">
						GitHub Releases
					</a>
					.
				</Reveal>
				<div className="mt-14 flex flex-col gap-4">
					{CHANGELOG.map((r) => {
						const released = r.version !== "Unreleased";
						return (
							<Reveal key={r.version} as="article" y={32} className="rounded-2xl bg-card p-6 sm:p-7" id={released ? `v${r.version}` : "unreleased"}>
								<header className="flex flex-wrap items-baseline justify-between gap-2">
									<h2 className="text-[24px] font-bold tracking-[-0.025em]">{released ? `Cue ${r.version}` : "Unreleased"}</h2>
									{r.date ? (
										<time dateTime={r.date} className="text-[14px] text-muted">
											{formatDate(r.date)}
										</time>
									) : (
										<span className="text-[14px] text-muted">On the main branch, in the next release</span>
									)}
								</header>
								<p className="mt-2 text-[15px] text-neutral-300">{r.summary}</p>
								<ul className="mt-4 flex list-disc flex-col gap-2 pl-5 text-[15px] leading-relaxed text-muted">
									{r.changes.map((c) => (
										<li key={c}>{c}</li>
									))}
								</ul>
							</Reveal>
						);
					})}
				</div>
				<p className="mt-12 text-[14px]">
					<Link href="/" className="text-neutral-300 underline underline-offset-4 hover:text-white">
						Back to Cue
					</Link>
				</p>
			</main>
			<Footer />
		</>
	);
}
