import Link from "next/link";
import type { ReactNode } from "react";
import { AutoVideo } from "@/components/AutoVideo";
import { DownloadCta, Footer, Header } from "@/components/Chrome";
import { JsonLd } from "@/components/JsonLd";
import { Reveal } from "@/components/Reveal";
import { type Demo, SITE_URL, USE_CASES } from "@/lib/site";

export type UseCase = {
	path: string;
	/** Short name, used in the breadcrumb. */
	name: string;
	h1: string;
	intro: string;
	video: Demo;
	videoLabel: string;
	sections: { title: string; body: ReactNode }[];
};

/** Breadcrumb structured data: Cue → this page. */
function breadcrumbs({ path, name }: UseCase) {
	return {
		"@context": "https://schema.org",
		"@type": "BreadcrumbList",
		itemListElement: [
			{ "@type": "ListItem", position: 1, name: "Cue", item: SITE_URL },
			{ "@type": "ListItem", position: 2, name, item: `${SITE_URL}${path}` },
		],
	};
}

/** A landing page for one thing people search for, in the style of the home page. */
export function UseCasePage(page: UseCase) {
	return (
		<>
			<JsonLd data={breadcrumbs(page)} />
			<Header />
			<main>
				<section className="mx-auto max-w-[1080px] px-5 pt-14 text-center">
					<Reveal as="h1" className="mx-auto max-w-[860px] text-[38px] leading-[1.08] font-bold tracking-[-0.035em] sm:text-[52px]">
						{page.h1}
					</Reveal>
					<Reveal delay={200} as="p" className="mx-auto mt-5 max-w-[720px] text-[17px] leading-relaxed text-muted sm:text-[19px]">
						{page.intro}
					</Reveal>
					<Reveal delay={350} className="mt-8">
						<DownloadCta />
					</Reveal>
					<Reveal delay={500} y={60} scale={0.96} duration={1200} className="mt-14 overflow-hidden rounded-2xl border border-line bg-card shadow-2xl shadow-black/60">
						<AutoVideo name={page.video} label={page.videoLabel} priority />
					</Reveal>
				</section>

				<section className="mx-auto mt-20 grid max-w-[1080px] gap-3 px-5 md:grid-cols-2">
					{page.sections.map((s, i) => (
						<Reveal key={s.title} as="article" delay={(i % 2) * 90} y={32} className="rounded-2xl bg-card p-6 sm:p-7">
							<h2 className="text-[22px] leading-tight font-bold tracking-[-0.025em]">{s.title}</h2>
							<div className="mt-3 flex flex-col gap-3 text-[15px] leading-relaxed text-muted">{s.body}</div>
						</Reveal>
					))}
				</section>

				<section className="mx-auto mt-20 max-w-[1080px] px-5 pb-28 text-center">
					<Reveal as="h2" className="text-[28px] font-bold tracking-[-0.03em] sm:text-[34px]">
						Try Cue on your Mac
					</Reveal>
					<Reveal delay={150} className="mt-6">
						<DownloadCta />
					</Reveal>
					<Reveal delay={250} className="mt-12">
						<nav aria-label="More about Cue" className="flex flex-wrap justify-center gap-x-6 gap-y-3 text-[14px]">
							<Link href="/" className="text-neutral-300 underline underline-offset-4 hover:text-white">
								Cue home
							</Link>
							{USE_CASES.filter((u) => u.href !== page.path).map((u) => (
								<Link key={u.href} href={u.href} className="text-muted hover:text-white">
									{u.label}
								</Link>
							))}
							<Link href="/changelog" className="text-muted hover:text-white">
								Changelog
							</Link>
						</nav>
					</Reveal>
				</section>
			</main>
			<Footer />
		</>
	);
}

/** A command shown in a selectable code box. */
export function Command({ children }: { children: string }) {
	return (
		<code className="block w-full overflow-x-auto rounded-xl border border-line bg-page px-4 py-3 font-mono text-[13px] whitespace-nowrap text-neutral-300 select-all">
			{children}
		</code>
	);
}
