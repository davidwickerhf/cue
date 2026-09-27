"use client";

import { AppleLogo, LinuxLogo, WindowsLogo } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DOWNLOADS, REPO } from "@/lib/site";

type Os = "mac" | "windows" | "linux";

/** The visitor's system, from the browser (Mac until known, so the page renders the same on the server). */
function detectOs(): Os {
	const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
	const platform = (nav.userAgentData?.platform ?? navigator.platform ?? "").toLowerCase();
	const agent = navigator.userAgent.toLowerCase();
	if (platform.includes("win") || agent.includes("windows")) return "windows";
	if ((platform.includes("linux") || agent.includes("linux")) && !agent.includes("android")) return "linux";
	return "mac";
}

const BUTTONS: Record<Os, { label: string; href: string; Icon: typeof AppleLogo; note: string }> = {
	mac: { label: "Download for Mac", href: DOWNLOADS.macArmZip, Icon: AppleLogo, note: "Apple Silicon" },
	windows: { label: "Download for Windows", href: DOWNLOADS.windows, Icon: WindowsLogo, note: "Windows 10 and 11" },
	linux: { label: "Download for Linux", href: DOWNLOADS.linuxAppImage, Icon: LinuxLogo, note: "AppImage" },
};

/** The blue download button for the visitor's system, with links to the other builds. */
export function DownloadButton({ className = "" }: { className?: string }) {
	const [os, setOs] = useState<Os>("mac");
	useEffect(() => setOs(detectOs()), []);
	const b = BUTTONS[os];
	return (
		<div className={`flex flex-col items-center gap-3 ${className}`}>
			<a
				href={b.href}
				className="flex items-center gap-2.5 rounded-xl bg-accent px-6 py-3.5 text-[17px] font-semibold text-white shadow-[0_8px_30px_-8px_rgba(10,108,255,0.7)] transition duration-300 hover:-translate-y-0.5 hover:brightness-110 hover:shadow-[0_14px_40px_-8px_rgba(10,108,255,0.85)] active:translate-y-0"
			>
				<b.Icon size={20} weight="fill" /> {b.label}
			</a>
			<p className="text-[13px] text-muted">
				Free and open source · {b.note} ·{" "}
				<Link href="/download" className="underline underline-offset-4 hover:text-white">
					Other platforms
				</Link>{" "}
				·{" "}
				<a href={REPO} className="underline underline-offset-4 hover:text-white">
					Source
				</a>
			</p>
		</div>
	);
}
