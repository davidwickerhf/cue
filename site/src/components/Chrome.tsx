import { AppleLogo, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { DownloadButton } from "@/components/DownloadButton";
import { KOFI, AUTHOR, REPO, USE_CASES } from "@/lib/site";

/** Star count for the GitHub button (refreshed hourly, hidden while it is zero). */
async function stars(): Promise<number> {
	try {
		const res = await fetch("https://api.github.com/repos/davidwickerhf/cue", { next: { revalidate: 3600 } });
		if (!res.ok) return 0;
		return ((await res.json()) as { stargazers_count?: number }).stargazers_count ?? 0;
	} catch {
		return 0;
	}
}

export function Logo({ size = 28, eager = false }: { size?: number; eager?: boolean }) {
	return (
		<span className="flex items-center gap-2">
			<Image src="/icon.png" alt="" width={size} height={size} className="rounded-[7px]" loading={eager ? "eager" : "lazy"} />
			<span className="text-[19px] font-semibold tracking-tight">Cue</span>
		</span>
	);
}

/** The blue download button for the visitor's system (see DownloadButton). */
export function DownloadCta({ className = "" }: { className?: string }) {
	return <DownloadButton className={className} />;
}

/** Site header. On the home page the section links are in-page anchors. */
export async function Header({ home = false }: { home?: boolean }) {
	const starCount = await stars();
	const base = home ? "" : "/";
	return (
		<Reveal as="header" y={-12} blur={6} duration={800} className="mx-auto flex max-w-[1080px] items-center justify-between px-5 py-4">
			{home ? (
				<a href="#top" aria-label="Cue home">
					<Logo eager />
				</a>
			) : (
				<Link href="/" aria-label="Cue home">
					<Logo eager />
				</Link>
			)}
			<nav className="hidden items-center gap-6 text-[15px] text-neutral-300 sm:flex">
				<a href={`${base}#features`} className="hover:text-white">
					Features
				</a>
				<a href={`${base}#faq`} className="hover:text-white">
					FAQ
				</a>
				<Link href="/docs" className="hover:text-white">
					Docs
				</Link>
				<Link href="/examples" className="hover:text-white">
					Examples
				</Link>
				<Link href="/styles" className="hover:text-white">
					Styles
				</Link>
				<Link href="/assets" className="hover:text-white">Assets</Link>
				<Link href="/changelog" className="hover:text-white">
					Changelog
				</Link>
				<a href={KOFI} className="hover:text-white">
					Support
				</a>
			</nav>
			<a
				href={REPO}
				className="flex items-center gap-2 rounded-xl bg-card px-3.5 py-2.5 text-[13px] font-semibold text-neutral-100 hover:bg-[#1f1f1f]"
			>
				<GithubLogo size={16} weight="fill" /> GitHub
				{starCount > 0 ? ` (${starCount >= 1000 ? `${(starCount / 1000).toFixed(1)}k` : starCount})` : ""}
			</a>
		</Reveal>
	);
}

export function Footer({ home = false }: { home?: boolean }) {
	const base = home ? "" : "/";
	return (
		<footer className="bg-card">
			<Reveal y={30} className="mx-auto flex max-w-[1080px] flex-col justify-between gap-10 px-5 py-12 lg:flex-row">
				<div className="max-w-[340px]">
					<Logo size={24} />
					<p className="mt-3 text-[14px] leading-relaxed text-muted">The open-source video editor that you and your AI agent edit together.</p>
					<a href={REPO} aria-label="Cue on GitHub" className="mt-5 inline-flex text-neutral-300 hover:text-white">
						<GithubLogo size={22} />
					</a>
				</div>
				<div className="grid grid-cols-2 gap-x-16 gap-y-10 text-[14px] sm:flex">
					<div className="flex flex-col gap-3">
						<p className="font-medium">Navigation</p>
						<a href={`${base}#features`} className="text-muted hover:text-white">
							Features
						</a>
						<a href={`${base}#faq`} className="text-muted hover:text-white">
							FAQ
						</a>
						<Link href="/docs" className="text-muted hover:text-white">
							Docs
						</Link>
						<Link href="/examples" className="text-muted hover:text-white">
							Examples
						</Link>
						<Link href="/styles" className="text-muted hover:text-white">
							Style library
						</Link>
						<Link href="/assets" className="text-muted hover:text-white">Asset library</Link>
						<Link href="/changelog" className="text-muted hover:text-white">
							Changelog
						</Link>
						<Link href="/download" className="text-muted hover:text-white">
							Download
						</Link>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-medium">Use cases</p>
						{USE_CASES.map((u) => (
							<Link key={u.href} href={u.href} className="text-muted hover:text-white">
								{u.label}
							</Link>
						))}
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-medium">Project</p>
						<a href={REPO} className="text-muted hover:text-white">
							Source
						</a>
						<a href={`${REPO}/releases`} className="text-muted hover:text-white">
							Releases
						</a>
						<a href={`${REPO}/blob/main/LICENSE`} className="text-muted hover:text-white">
							MIT license
						</a>
					</div>
					<div className="flex flex-col gap-3">
						<p className="font-medium">Author</p>
						<a href={AUTHOR.url} className="text-muted hover:text-white">
							wicker.life
						</a>
						<a href={AUTHOR.github} className="text-muted hover:text-white">
							GitHub
						</a>
						<a href={KOFI} className="text-muted hover:text-white">
							Buy me a coffee
						</a>
					</div>
				</div>
			</Reveal>
			<p className="mx-auto max-w-[1080px] px-5 pb-2 text-[12px] leading-relaxed text-[#8a8a8a]">
				© {new Date().getFullYear()} {AUTHOR.name} ·{" "}
				<a href={AUTHOR.url} className="underline underline-offset-4 hover:text-white">
					wicker.life
				</a>
			</p>
			<p className="mx-auto max-w-[1080px] px-5 pb-10 text-[12px] leading-relaxed text-[#5f5f5f]">
				Demo footage: Sintel and Big Buck Bunny © Blender Foundation (durian.blender.org, peach.blender.org), CC BY 3.0. Demos
				recorded with{" "}
				<a href="https://recordly.dev" className="underline underline-offset-4 hover:text-muted">
					Recordly
				</a>
				.
			</p>
		</footer>
	);
}
