import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { SmoothScroll } from "@/components/SmoothScroll";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });

const description =
	"Cue is a fast, open-source video editor for macOS that you and your AI agent edit together. Cut by hand with the shortcuts you know, or let Claude Code, Codex or any MCP agent do it.";

export const metadata: Metadata = {
	metadataBase: new URL("https://cue.wicker.life"),
	title: "Cue · The video editor your AI agent can drive",
	description,
	openGraph: {
		title: "Cue · The video editor your AI agent can drive",
		description,
		url: "https://cue.wicker.life",
		siteName: "Cue",
		images: [{ url: "/videos/edit.jpg", width: 1280, height: 720 }],
		type: "website",
	},
	twitter: { card: "summary_large_image", images: ["/videos/edit.jpg"] },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
	return (
		<html lang="en" className={`${inter.variable} antialiased`}>
			<body className="min-h-screen font-sans">
				<SmoothScroll />
				{children}
			</body>
		</html>
	);
}
