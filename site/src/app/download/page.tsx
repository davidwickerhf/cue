import { AppleLogo, LinuxLogo, WindowsLogo } from "@phosphor-icons/react/dist/ssr";
import Link from "next/link";
import type { ReactNode } from "react";
import { Footer, Header } from "@/components/Chrome";
import { Reveal } from "@/components/Reveal";
import { CHANGELOG } from "@/content/changelog";
import { pageMetadata } from "@/lib/metadata";
import { DOWNLOADS, REPO } from "@/lib/site";

export const metadata = pageMetadata({
	title: "Download Cue for Mac, Windows and Linux",
	description:
		"Download Cue, the free and open-source video editor your AI agent can drive, for macOS (Apple Silicon and Intel), Windows 10 and 11, and Linux (AppImage and .deb).",
	path: "/download",
});

const latest = CHANGELOG.find((r) => r.version !== "Unreleased" && r.date);

function File({ href, label, detail }: { href: string; label: string; detail: string }) {
	return (
		<a
			href={href}
			className="flex items-center justify-between gap-4 rounded-xl bg-white/[0.04] px-4 py-3 transition hover:bg-white/[0.08]"
		>
			<span className="font-semibold">{label}</span>
			<span className="text-[13px] text-muted">{detail}</span>
		</a>
	);
}

function Platform({
	icon,
	name,
	requirements,
	files,
	steps,
	notes,
	id,
}: {
	icon: ReactNode;
	name: string;
	requirements: string;
	files: ReactNode;
	steps: ReactNode[];
	notes?: ReactNode;
	id: string;
}) {
	return (
		<Reveal as="section" y={28} className="rounded-2xl bg-card p-6 sm:p-7" id={id}>
			<header className="flex items-center gap-3">
				{icon}
				<div>
					<h2 className="text-[24px] font-bold tracking-[-0.025em]">{name}</h2>
					<p className="text-[14px] text-muted">{requirements}</p>
				</div>
			</header>
			<div className="mt-5 flex flex-col gap-2">{files}</div>
			<ol className="mt-5 list-decimal space-y-1.5 pl-5 text-[15px] leading-relaxed text-white/85">
				{steps.map((s, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: a fixed list of steps
					<li key={i}>{s}</li>
				))}
			</ol>
			{notes && <p className="mt-4 text-[14px] leading-relaxed text-muted">{notes}</p>}
		</Reveal>
	);
}

export default function Download() {
	return (
		<>
			<Header />
			<main className="mx-auto max-w-[760px] px-5 pt-14 pb-28">
				<Reveal as="h1" className="text-[40px] leading-[1.05] font-bold tracking-[-0.035em] sm:text-[52px]">
					Download Cue
				</Reveal>
				<Reveal delay={150} as="p" className="mt-4 text-[17px] leading-relaxed text-muted">
					Free and open source, for Mac, Windows and Linux.
					{latest ? ` The latest version is ${latest.version} (` : " "}
					{latest && (
						<>
							<Link href={`/changelog#v${latest.version}`} className="underline underline-offset-4 hover:text-white">
								what's new
							</Link>
							).
						</>
					)}{" "}
					Every version is also on{" "}
					<a href={`${REPO}/releases`} className="underline underline-offset-4 hover:text-white">
						GitHub Releases
					</a>
					.
				</Reveal>

				<div className="mt-12 flex flex-col gap-4">
					<Platform
						id="mac"
						icon={<AppleLogo size={34} weight="fill" />}
						name="macOS"
						requirements="macOS 12 or later"
						files={
							<>
								<File href={DOWNLOADS.macArm} label="Apple Silicon (M1 and later)" detail=".dmg" />
								<File href={DOWNLOADS.macIntel} label="Intel" detail=".dmg" />
							</>
						}
						steps={[
							"Open the disk image and drag Cue to Applications.",
							"Open Cue. It is signed and notarised by Apple, so it opens like any other app.",
							"Cue updates itself: it checks for new versions and asks before installing one.",
						]}
						notes={
							<>
								Prefer a zip?{" "}
								<a href={DOWNLOADS.macArmZip} className="underline underline-offset-4 hover:text-white">
									Apple Silicon
								</a>{" "}
								·{" "}
								<a href={DOWNLOADS.macIntelZip} className="underline underline-offset-4 hover:text-white">
									Intel
								</a>
							</>
						}
					/>
					<Platform
						id="windows"
						icon={<WindowsLogo size={34} weight="fill" />}
						name="Windows"
						requirements="Windows 10 or 11, 64-bit"
						files={<File href={DOWNLOADS.windows} label="Installer" detail=".exe" />}
						steps={[
							"Run the installer. It installs for your user account (no administrator needed) and starts Cue.",
							<>
								Windows may show "Windows protected your PC", because the installer isn't code-signed yet: choose{" "}
								<strong className="text-white">More info</strong> then <strong className="text-white">Run anyway</strong>.
							</>,
							"Cue updates itself from then on.",
						]}
					/>
					<Platform
						id="linux"
						icon={<LinuxLogo size={34} weight="fill" />}
						name="Linux"
						requirements="64-bit (x86_64): Ubuntu 22.04 or later, Debian 12, Fedora and most others"
						files={
							<>
								<File href={DOWNLOADS.linuxAppImage} label="AppImage (any distribution)" detail=".AppImage" />
								<File href={DOWNLOADS.linuxDeb} label="Debian and Ubuntu" detail=".deb" />
							</>
						}
						steps={[
							<>
								AppImage: make it executable (<code className="rounded bg-white/10 px-1.5 font-mono text-[13px]">chmod +x Cue-linux-x86_64.AppImage</code>) and
								run it. It updates itself.
							</>,
							<>
								.deb: <code className="rounded bg-white/10 px-1.5 font-mono text-[13px]">sudo apt install ./Cue-linux-amd64.deb</code>, then open
								Cue from your apps. Download new versions from this page.
							</>,
						]}
					/>
				</div>

				<Reveal as="section" y={24} className="mt-10 rounded-2xl border border-white/10 p-6 text-[15px] leading-relaxed text-muted">
					<h2 className="text-[18px] font-semibold text-white">Mac, Windows and Linux differences</h2>
					<p className="mt-2">
						Editing, graphics, captions, voice, music, export and the agent tools work the same everywhere. A few features use
						macOS frameworks and are Mac-only for now: cutting people and objects out of pictures, searching shots by what they
						show (on-device vision), and the pointer effects on screen recordings made in Cue.
					</p>
				</Reveal>
			</main>
			<Footer />
		</>
	);
}
