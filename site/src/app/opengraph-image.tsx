import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { OG_IMAGE } from "@/lib/site";

export const alt = OG_IMAGE.alt;
export const size = { width: OG_IMAGE.width, height: OG_IMAGE.height };
export const contentType = "image/png";

/** The shared preview image: the hero headline over a screenshot of the editor. */
export default async function Image() {
	const [bold, regular, icon, shot] = await Promise.all([
		readFile(join(process.cwd(), "assets", "Inter-Bold.ttf")),
		readFile(join(process.cwd(), "assets", "Inter-Regular.ttf")),
		readFile(join(process.cwd(), "public", "icon.png")),
		readFile(join(process.cwd(), "public", "videos", "edit.jpg")),
	]);
	const iconSrc = `data:image/png;base64,${icon.toString("base64")}`;
	const shotSrc = `data:image/jpeg;base64,${shot.toString("base64")}`;
	return new ImageResponse(
		<div
			style={{
				width: "100%",
				height: "100%",
				display: "flex",
				flexDirection: "column",
				alignItems: "center",
				background: "#0a0a0a",
				color: "#fafafa",
				fontFamily: "Inter",
			}}
		>
			<div style={{ display: "flex", flexShrink: 0, alignItems: "center", gap: 14, marginTop: 48 }}>
				<img src={iconSrc} width={52} height={52} style={{ borderRadius: 12 }} alt="" />
				<span style={{ fontSize: 36, fontWeight: 700, letterSpacing: -1 }}>Cue</span>
			</div>
			<div style={{ display: "flex", flexShrink: 0, marginTop: 24, fontSize: 62, fontWeight: 700, letterSpacing: -2.5, lineHeight: 1.05 }}>
				The video editor your agent can drive
			</div>
			<div style={{ display: "flex", flexShrink: 0, marginTop: 16, fontSize: 26, color: "#8a8a8a" }}>
				Free and open source for macOS · Claude Code, Codex and any MCP client
			</div>
			<div
				style={{
					marginTop: 36,
					display: "flex",
					flexShrink: 0,
					borderRadius: 18,
					border: "1px solid #242424",
					overflow: "hidden",
					boxShadow: "0 30px 80px rgba(10,108,255,0.25)",
				}}
			>
				<img src={shotSrc} width={1000} height={562} alt="" />
			</div>
		</div>,
		{
			...size,
			fonts: [
				{ name: "Inter", data: bold, style: "normal", weight: 700 },
				{ name: "Inter", data: regular, style: "normal", weight: 400 },
			],
		},
	);
}
