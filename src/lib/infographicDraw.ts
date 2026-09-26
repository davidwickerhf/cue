import type { Infographic } from "../../electron/core/types";
import type { TextFrame } from "./textDraw";

/** A documentary graphic frame. Coordinates are in a 1600 × 900 design space. */
export function drawInfographic(
	ctx: CanvasRenderingContext2D,
	chart: Infographic,
	width: number,
	height: number,
	frame: TextFrame,
) {
	const motion = 1 - (1 - (frame.chartP ?? 1)) ** 3;
	const palette =
		chart.palette === "electric"
			? {
					paper: "#10212b",
					ink: "#f2f5e9",
					quiet: "#a9b9b4",
					rule: "#49616a",
					accent: "#d6ff38",
					second: "#69bcc0",
					shade: "rgba(3,12,19,.76)",
				}
			: chart.palette === "mono"
				? {
						paper: "#f2efe7",
						ink: "#161b19",
						quiet: "#5e6661",
						rule: "#acb3aa",
						accent: "#161b19",
						second: "#7d8981",
						shade: "rgba(9,12,11,.72)",
					}
				: {
						paper: "#efe9db",
						ink: "#1b2822",
						quiet: "#64736b",
						rule: "#b8c0b5",
						accent: "#d65337",
						second: "#507f70",
						shade: "rgba(11,22,18,.72)",
					};
	const s = Math.min(width / 1600, height / 900) * 0.96;
	const ox = (width - 1600 * s) / 2;
	const oy = (height - 900 * s) / 2;
	const items = chart.items;
	const max = Math.max(1, ...items.map((item) => item.value));
	const n = (value: number) => {
		const rounded = Math.round(value * 10) / 10;
		return rounded.toLocaleString(undefined, { maximumFractionDigits: 1 });
	};
	const value = (v: number) => `${n(v)}${chart.unit ? ` ${chart.unit}` : ""}`;
	const line = (
		x1: number,
		y1: number,
		x2: number,
		y2: number,
		color = palette.rule,
		weight = 1,
	) => {
		ctx.strokeStyle = color;
		ctx.lineWidth = weight;
		ctx.beginPath();
		ctx.moveTo(x1, y1);
		ctx.lineTo(x2, y2);
		ctx.stroke();
	};
	const label = (text: string, x: number, y: number, size = 24, maxWidth?: number) => {
		ctx.font = `600 ${size}px Menlo, "SFMono-Regular", monospace`;
		ctx.fillText(text.toUpperCase(), x, y, maxWidth);
	};
	ctx.save();
	ctx.globalAlpha *= frame.alpha;
	ctx.translate(ox, oy);
	ctx.scale(s, s);
	ctx.textBaseline = "top";
	ctx.textAlign = "left";

	// The picture remains visible above and around a deliberately square printed sheet.
	ctx.fillStyle = palette.shade;
	ctx.fillRect(0, 0, 1600, 213);
	ctx.fillStyle = "#f8f6ee";
	label("FIELD NOTE  /  DATA", 77, 43, 22);
	ctx.fillStyle = "#fffaf0";
	ctx.font = `700 ${chart.title.length > 32 ? 64 : 79}px Georgia, "Times New Roman", serif`;
	ctx.fillText(chart.title, 76, 81, 1445);
	ctx.fillStyle = palette.ink;
	ctx.fillRect(68, 231, 1464, 603);
	ctx.fillStyle = palette.paper;
	ctx.fillRect(76, 222, 1448, 604);
	ctx.fillStyle = palette.accent;
	ctx.fillRect(76, 222, 88, 10);
	ctx.fillStyle = palette.quiet;
	label(
		`FIG. 01   /   ${chart.kind === "cards" ? "KEY FIGURES" : chart.kind === "donut" ? "SHARE OF WHOLE" : chart.kind === "line" ? "TREND" : chart.kind === "timeline" ? "MILESTONES" : "COMPARISON"}`,
		164,
		253,
		20,
	);
	ctx.textAlign = "right";
	label(chart.unit || "", 1437, 253, 20, 350);
	ctx.textAlign = "left";
	line(164, 295, 1436, 295);
	line(164, 745, 1436, 745);
	ctx.fillStyle = palette.quiet;
	label(chart.source ? `SOURCE  ${chart.source}` : "SOURCE  —", 164, 770, 19, 1180);

	if (chart.kind === "bars") {
		const top = 325;
		const rowH = 408 / items.length;
		items.forEach((item, i) => {
			const y = top + i * rowH;
			const h = Math.min(35, rowH * 0.32);
			ctx.fillStyle = i === 0 ? palette.accent : palette.ink;
			ctx.fillRect(544, y + rowH * 0.48, Math.max(2, ((630 * item.value) / max) * motion), h);
			ctx.fillStyle = palette.quiet;
			label(String(i + 1).padStart(2, "0"), 166, y + rowH * 0.28, 17);
			ctx.fillStyle = palette.ink;
			ctx.font = `700 ${Math.min(36, rowH * 0.37)}px "DM Sans Variable", sans-serif`;
			ctx.fillText(item.label, 227, y + rowH * 0.19, 290);
			ctx.textAlign = "right";
			ctx.font = `700 ${Math.min(57, rowH * 0.58)}px "DM Sans Variable", sans-serif`;
			ctx.fillText(value(item.value * motion), 1436, y + rowH * 0.13, 245);
			ctx.textAlign = "left";
			if (i < items.length - 1) line(164, y + rowH - 4, 1436, y + rowH - 4);
		});
	} else if (chart.kind === "donut") {
		const total = items.reduce((sum, item) => sum + item.value, 0);
		const colors =
			chart.palette === "electric"
				? [palette.accent, palette.ink, palette.second, "#78958c", "#4e7680", "#7eaa9c"]
				: chart.palette === "mono"
					? [palette.ink, "#6a726a", "#a3aaa0", "#414b44", "#c4c9bf", "#858d84"]
					: [palette.accent, palette.ink, palette.second, palette.quiet, "#bea57e", "#7d9478"];
		const cx = 416,
			cy = 520,
			radius = 164;
		let angle = -Math.PI / 2;
		items.forEach((item, i) => {
			const sweep = total ? (item.value / total) * Math.PI * 2 * motion : 0;
			ctx.beginPath();
			ctx.arc(cx, cy, radius, angle + 0.018, angle + Math.max(0.019, sweep - 0.018));
			ctx.strokeStyle = colors[i];
			ctx.lineWidth = 65;
			ctx.stroke();
			angle += sweep;
		});
		ctx.fillStyle = palette.ink;
		ctx.textAlign = "center";
		ctx.font = '700 68px "DM Sans Variable", sans-serif';
		ctx.fillText(n(total * motion), cx, 474, 230);
		ctx.fillStyle = palette.quiet;
		label("TOTAL", cx, 551, 19);
		ctx.textAlign = "left";
		const rowH = 405 / items.length;
		items.forEach((item, i) => {
			const y = 328 + i * rowH;
			ctx.fillStyle = colors[i];
			ctx.fillRect(758, y + rowH * 0.4, 38, 7);
			ctx.fillStyle = palette.ink;
			ctx.font = `600 ${Math.min(32, rowH * 0.42)}px "DM Sans Variable", sans-serif`;
			ctx.fillText(item.label, 820, y + rowH * 0.24, 340);
			ctx.textAlign = "right";
			ctx.font = `700 ${Math.min(52, rowH * 0.6)}px "DM Sans Variable", sans-serif`;
			ctx.fillText(`${total ? Math.round((item.value / total) * 100) : 0}%`, 1436, y + rowH * 0.14);
			ctx.textAlign = "left";
			if (i < items.length - 1) line(758, y + rowH - 3, 1436, y + rowH - 3);
		});
	} else if (chart.kind === "cards") {
		const columns = Math.min(3, items.length);
		const rows = Math.ceil(items.length / columns);
		const cellW = 1272 / columns;
		const cellH = 414 / rows;
		items.forEach((item, i) => {
			const col = i % columns,
				row = Math.floor(i / columns);
			const x = 164 + col * cellW,
				y = 322 + row * cellH;
			if (col > 0) line(x, y, x, y + cellH - 10);
			if (row > 0) line(x, y, x + cellW, y);
			ctx.fillStyle = i === 0 ? palette.accent : palette.ink;
			ctx.font = `700 ${Math.min(105, cellH * 0.43)}px "DM Sans Variable", sans-serif`;
			ctx.fillText(value(item.value * motion), x + 22, y + cellH * 0.18, cellW - 45);
			ctx.fillStyle = palette.quiet;
			label(item.label, x + 25, y + cellH * 0.72, Math.min(24, cellH * 0.13), cellW - 48);
		});
	} else if (chart.kind === "line") {
		const left = 205,
			right = 1390,
			top = 357,
			bottom = 668;
		line(left, bottom, right, bottom, palette.ink, 2);
		line(left, top, right, top, palette.rule, 1);
		const point = (i: number) => ({
			x: left + ((right - left) * i) / Math.max(1, items.length - 1),
			y: bottom - ((bottom - top) * items[i].value) / max,
		});
		const visible = (items.length - 1) * motion;
		ctx.beginPath();
		items.forEach((_, i) => {
			if (i > visible) return;
			const p = point(i);
			if (i === 0) ctx.moveTo(p.x, p.y);
			else ctx.lineTo(p.x, p.y);
		});
		if (visible < items.length - 1) {
			const i = Math.floor(visible),
				a = point(i),
				b = point(Math.min(items.length - 1, i + 1));
			ctx.lineTo(a.x + (b.x - a.x) * (visible - i), a.y + (b.y - a.y) * (visible - i));
		}
		ctx.lineWidth = 8;
		ctx.lineJoin = "round";
		ctx.strokeStyle = palette.accent;
		ctx.stroke();
		items.forEach((item, i) => {
			if (i > visible) return;
			const p = point(i);
			ctx.fillStyle = palette.paper;
			ctx.beginPath();
			ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
			ctx.fill();
			ctx.strokeStyle = palette.accent;
			ctx.lineWidth = 5;
			ctx.stroke();
			ctx.textAlign = "center";
			ctx.fillStyle = palette.ink;
			ctx.font = '700 33px "DM Sans Variable", sans-serif';
			ctx.fillText(value(item.value), p.x, Math.max(top + 8, p.y - 58), 210);
			ctx.fillStyle = palette.quiet;
			label(item.label, p.x, 690, 18, 175);
		});
		ctx.textAlign = "left";
	} else {
		const left = 195,
			right = 1405,
			cy = 529;
		line(left, cy, right, cy, palette.rule, 5);
		line(left, cy, left + (right - left) * motion, cy, palette.accent, 5);
		items.forEach((item, i) => {
			const step = i / Math.max(1, items.length - 1);
			const x = left + (right - left) * step;
			ctx.fillStyle = motion >= step ? palette.accent : palette.rule;
			ctx.beginPath();
			ctx.arc(x, cy, 14, 0, Math.PI * 2);
			ctx.fill();
			ctx.textAlign = "center";
			ctx.fillStyle = palette.ink;
			ctx.font = '700 49px "DM Sans Variable", sans-serif';
			ctx.fillText(motion >= step ? value(item.value) : "", x, 402, 230);
			ctx.fillStyle = palette.quiet;
			label(item.label, x, 565, 21, 215);
		});
		ctx.textAlign = "left";
	}
	ctx.restore();
}
