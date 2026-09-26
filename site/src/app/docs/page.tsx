import Link from "next/link";
import { A, DocPage } from "@/components/docs/Prose";
import { DOCS_GROUPS } from "@/content/docs";
import { pageMetadata } from "@/lib/metadata";
import { REPO } from "@/lib/site";

export const metadata = pageMetadata({
	title: "Docs",
	description:
		"Documentation for Cue, the free, open-source video editor for macOS that AI agents can drive: editing, colour, titles, audio, agents, export and the full MCP tool reference.",
	path: "/docs",
});

export default function DocsHome() {
	return (
		<DocPage
			href="/docs"
			intro={
				<p>
					Cue is a free, open-source (MIT) video editor for macOS on Apple Silicon. You edit by hand with the shortcuts you know
					from Premiere, and an AI agent can edit the same project through the same set of tools. These pages cover what the app
					does today.
				</p>
			}
		>
			<p>
				New to Cue? Start with <A href="/docs/getting-started">Getting started</A>. If you want an agent to do the work, read{" "}
				<A href="/docs/ai-and-agents">AI and agents</A>.
			</p>
			<div className="mt-4 flex flex-col gap-8">
				{DOCS_GROUPS.map((g) => (
					<section key={g.title}>
						<h2 className="text-[13px] font-medium tracking-wide text-[#6f6f6f] uppercase">{g.title}</h2>
						<ul className="mt-3 grid gap-3 sm:grid-cols-2">
							{g.pages
								.filter((p) => p.href !== "/docs")
								.map((p) => (
									<li key={p.href}>
										<Link href={p.href} className="block h-full rounded-xl bg-card p-4 transition-colors hover:bg-[#1a1a1a]">
											<span className="block text-[16px] font-semibold text-white">{p.title}</span>
											<span className="mt-1 block text-[14px] leading-relaxed text-muted">{p.description}</span>
										</Link>
									</li>
								))}
						</ul>
					</section>
				))}
			</div>
			<p className="mt-4 text-[14px] text-muted">
				Something missing or wrong? Open an issue on <A href={`${REPO}/issues`}>GitHub</A>. The source of these pages is in{" "}
				<A href={`${REPO}/tree/main/site`}>site/</A>.
			</p>
		</DocPage>
	);
}
