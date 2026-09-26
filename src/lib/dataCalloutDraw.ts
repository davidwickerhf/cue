import type { DataCallout } from "../../electron/core/types";
import type { TextFrame } from "./textDraw";

/** Draws a timed annotation over footage. Every position is a share of the output frame. */
export function drawDataCallout(
	ctx: CanvasRenderingContext2D,
	callout: DataCallout,
	width: number,
	height: number,
	frame: TextFrame,
) {
	const unit = Math.min(width / 1920, height / 1080);
	const progress = 1 - (1 - (frame.chartP ?? 1)) ** 3;
	const colors =
		callout.palette === "electric"
			? { paper: "#10212b", ink: "#f2f5e9", quiet: "#a9b9b4", accent: "#d6ff38" }
			: callout.palette === "mono"
				? { paper: "#f2efe7", ink: "#161b19", quiet: "#5e6661", accent: "#161b19" }
				: { paper: "#efe9db", ink: "#1b2822", quiet: "#64736b", accent: "#d65337" };
	const cardW = Math.min(width * 0.42, 560 * unit);
	const cardH = (callout.value ? 160 : 123) * unit;
	const cx = Math.max(
		cardW / 2 + 20 * unit,
		Math.min(width - cardW / 2 - 20 * unit, callout.x * width),
	);
	const cy = Math.max(
		cardH / 2 + 20 * unit,
		Math.min(height - cardH / 2 - 20 * unit, callout.y * height),
	);
	const left = cx - cardW / 2;
	const top = cy - cardH / 2;
	const tx = callout.targetX * width;
	const ty = callout.targetY * height;
	const toRight = tx > cx;
	const attachX = toRight ? left + cardW : left;
	const attachY = cy;
	const elbowX = tx + (attachX - tx) * 0.4;
	ctx.save();
	ctx.globalAlpha *= frame.alpha;
	ctx.strokeStyle = colors.accent;
	ctx.lineWidth = Math.max(2, 4 * unit);
	ctx.lineJoin = "miter";
	ctx.beginPath();
	ctx.arc(tx, ty, 15 * unit, 0, Math.PI * 2);
	ctx.stroke();
	ctx.fillStyle = colors.accent;
	ctx.beginPath();
	ctx.arc(tx, ty, 4 * unit, 0, Math.PI * 2);
	ctx.fill();
	ctx.beginPath();
	ctx.moveTo(tx, ty);
	if (progress < 0.4) ctx.lineTo(tx + ((elbowX - tx) * progress) / 0.4, ty);
	else {
		ctx.lineTo(elbowX, ty);
		if (progress < 0.7) ctx.lineTo(elbowX, ty + ((attachY - ty) * (progress - 0.4)) / 0.3);
		else {
			ctx.lineTo(elbowX, attachY);
			ctx.lineTo(elbowX + ((attachX - elbowX) * (progress - 0.7)) / 0.3, attachY);
		}
	}
	ctx.stroke();
	if (progress > 0.65) {
		ctx.globalAlpha *= Math.min(1, (progress - 0.65) / 0.35);
		ctx.fillStyle = "rgba(0,0,0,.35)";
		ctx.fillRect(left + 10 * unit, top + 10 * unit, cardW, cardH);
		ctx.fillStyle = colors.paper;
		ctx.fillRect(left, top, cardW, cardH);
		ctx.fillStyle = colors.accent;
		ctx.fillRect(left, top, 8 * unit, cardH);
		ctx.textAlign = "left";
		ctx.textBaseline = "top";
		ctx.fillStyle = colors.quiet;
		ctx.font = `600 ${17 * unit}px Menlo, monospace`;
		ctx.fillText("FIELD NOTE", left + 28 * unit, top + 18 * unit, cardW - 48 * unit);
		ctx.fillStyle = colors.ink;
		ctx.font = `700 ${(callout.value ? 29 : 36) * unit}px "DM Sans Variable", sans-serif`;
		ctx.fillText(callout.label, left + 28 * unit, top + 46 * unit, cardW - 50 * unit);
		if (callout.value) {
			ctx.fillStyle = colors.accent;
			ctx.font = `700 ${45 * unit}px "DM Sans Variable", sans-serif`;
			ctx.fillText(callout.value, left + 28 * unit, top + 80 * unit, cardW - 50 * unit);
		}
		if (callout.source) {
			ctx.fillStyle = colors.quiet;
			ctx.font = `500 ${14 * unit}px Menlo, monospace`;
			ctx.fillText(callout.source, left + 28 * unit, top + cardH - 24 * unit, cardW - 50 * unit);
		}
	}
	ctx.restore();
}
