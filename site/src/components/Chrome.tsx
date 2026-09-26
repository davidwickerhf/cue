import { AppleLogo, GithubLogo } from "@phosphor-icons/react/dist/ssr";
import Image from "next/image";
import Link from "next/link";
import { Reveal } from "@/components/Reveal";
import { AUTHOR, DOWNLOAD, REPO, USE_CASES } from "@/lib/site";

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

/** The blue "Download for Mac" button with its small print. */
export function DownloadCta({ className = "" }: { className?: string }) {
	return (
		<div className={`flex flex-col items-center gap-3 ${className}`}>
			<a
				href={DOWNLOAD}
				className="flex items-center gap-2.5 rounded-xl bg-accent px-6 py-3.5 text-[17px] font-semibold text-white shadow-[0_8px_30px_-8px_rgba(10,108,255,0.7)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_14px_40px_-8px_rgba(10,108,255,0.85)] active:translate-y-0"
			>
				<AppleLogo size={20} weight="fill" /> Download for Mac
			</a>
			<p className="text-[13px] text-muted">
				Free and open source · Apple Silicon ·{" "}
				<a href={REPO} className="underline underline-offset-4 hover:text-white">
					View the source
				</a>
			</p>
		</div>
	);
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
				<a href={`${REPO}#readme`} className="hover:text-white">
					Docs
				</a>
				<Link href="/changelog" className="hover:text-white">
					Changelog
				</Link>
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
						<Link href="/changelog" className="text-muted hover:text-white">
							Changelog
						</Link>
						<a href={DOWNLOAD} className="text-muted hover:text-white">
							Download
						</a>
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
