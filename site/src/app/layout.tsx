import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { SmoothScroll } from "@/components/SmoothScroll";
import { AUTHOR, DESCRIPTION, SITE_URL, TAGLINE } from "@/lib/site";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"], display: "swap" });

const title = `Cue · ${TAGLINE}`;

export const metadata: Metadata = {
	metadataBase: new URL(SITE_URL),
	title: { default: title, template: "%s · Cue" },
	description: DESCRIPTION,
	applicationName: "Cue",
	keywords: [
		"video editor",
		"AI video editor",
		"AI video editor for Mac",
		"open-source video editor",
		"macOS video editor",
		"Apple Silicon video editor",
		"Premiere Pro alternative",
		"free video editor",
		"MCP",
		"MCP server",
		"Claude Code",
		"Codex",
		"Gemini CLI",
		"text-based video editing",
		"transcript editing",
		"Whisper",
	],
	authors: [{ name: AUTHOR.name, url: AUTHOR.url }],
	creator: AUTHOR.name,
	publisher: AUTHOR.name,
	category: "technology",
	alternates: { canonical: "/" },
	openGraph: { title, description: DESCRIPTION, url: SITE_URL, siteName: "Cue", type: "website", locale: "en_US" },
	twitter: { card: "summary_large_image", title, description: DESCRIPTION },
	robots: { index: true, follow: true },
};

export const viewport: Viewport = { themeColor: "#0a0a0a", colorScheme: "dark" };

/**
 * Reveal animations start hidden and are shown by JavaScript. Without JavaScript,
 * show everything straight away.
 */
const noScriptReveal = "[style*='opacity:0']{opacity:1!important;transform:none!important;filter:none!important}";

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${inter.variable} antialiased`}>
			<body className="min-h-screen font-sans">
				<noscript>
					<style>{noScriptReveal}</style>
				</noscript>
				<SmoothScroll />
				{children}
			</body>
		</html>
	);
}
