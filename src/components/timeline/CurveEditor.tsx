import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE_CURVES } from "../../../electron/core/anim";
import type { Curve } from "../../../electron/core/types";
import { cn } from "../../lib/utils";

export const CURVE_PRESETS: { label: string; curve: Curve }[] = [
	{ label: "Ease", curve: EASE_CURVES.ease },
	{ label: "Ease in", curve: EASE_CURVES["ease-in"] },
	{ label: "Ease out", curve: EASE_CURVES["ease-out"] },
	{ label: "Back", curve: [0.34, 1.56, 0.64, 1] },
	{ label: "Anticipate", curve: [0.36, 0, 0.66, -0.56] },
];

// The graph shows time 0–1 across and progress from Y0 to Y1 up, so handles can overshoot.
const W = 200;
const H = 250;
const M = 14;
const Y0 = -0.6;
const Y1 = 1.6;
const gx = (v: number) => M + v * (W - 2 * M);
const gy = (v: number) => M + ((Y1 - v) / (Y1 - Y0)) * (H - 2 * M);
const round = (v: number) => Math.round(v * 100) / 100;
const same = (a: Curve, b: Curve) => a.every((v, i) => Math.abs(v - b[i]) < 0.005);

/** A point of the curve at parameter s (not time), for drawing. */
function point(c: Curve, s: number): [number, number] {
	const u = 1 - s;
	const a = 3 * u * u * s;
	const b = 3 * u * s * s;
	const d = s * s * s;
	return [a * c[0] + b * c[2] + d, a * c[1] + b * c[3] + d];
}

/**
 * A small graph editor for a custom ease: drag the two bezier handles, or
 * start from a preset. Nothing changes until Apply, so Esc leaves it as it was.
 */
export function CurveEditor({
	x,
	y,
	initial,
	onApply,
	onClose,
}: {
	x: number;
	y: number;
	initial: Curve;
	onApply: (curve: Curve) => void;
	onClose: () => void;
}) {
	const [curve, setCurve] = useState<Curve>(initial);
	const ref = useRef<HTMLDivElement>(null);
	const svg = useRef<SVGSVGElement>(null);
	const [pos, setPos] = useState({ left: x, top: y, ready: false });
	const apply = () => {
		onApply(curve.map(round) as Curve);
		onClose();
	};
	const applyRef = useRef(apply);
	applyRef.current = apply;

	useLayoutEffect(() => {
		const el = ref.current;
		if (!el) return;
		const { width, height } = el.getBoundingClientRect();
		setPos({
			left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
			top: y + height > window.innerHeight - 8 ? Math.max(8, y - height) : y,
			ready: true,
		});
	}, [x, y]);

	useEffect(() => {
		const onDown = (e: PointerEvent) => {
			if (!ref.current?.contains(e.target as Node)) onClose();
		};
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
			else if (e.key === "Enter") applyRef.current();
			else return;
			e.preventDefault();
			e.stopPropagation();
		};
		window.addEventListener("pointerdown", onDown);
		window.addEventListener("keydown", onKey, true);
		return () => {
			window.removeEventListener("pointerdown", onDown);
			window.removeEventListener("keydown", onKey, true);
		};
	}, [onClose]);

	const dragHandle = (which: 0 | 1, e: React.PointerEvent) => {
		e.preventDefault();
		const move = (m: PointerEvent) => {
			const r = svg.current?.getBoundingClientRect();
			if (!r) return;
			const hx = round(Math.min(1, Math.max(0, (m.clientX - r.left - M) / (W - 2 * M))));
			const hy = round(
				Math.min(Y1, Math.max(Y0, Y1 - ((m.clientY - r.top - M) / (H - 2 * M)) * (Y1 - Y0))),
			);
			setCurve((c) => (which === 0 ? [hx, hy, c[2], c[3]] : [c[0], c[1], hx, hy]));
		};
		const up = () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", up);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", up);
	};

	const path = Array.from({ length: 49 }, (_, i) => point(curve, i / 48))
		.map(([px, py], i) => `${i ? "L" : "M"}${gx(px).toFixed(1)},${gy(py).toFixed(1)}`)
		.join("");
	const h1 = [gx(curve[0]), gy(curve[1])];
	const h2 = [gx(curve[2]), gy(curve[3])];
	return (
		<div
			ref={ref}
			role="dialog"
			aria-label="Custom curve"
			className="fixed z-[110] w-[232px] rounded-lg border border-border bg-overlay p-3 text-[12px] shadow-xl shadow-black/30"
			style={{ left: pos.left, top: pos.top, visibility: pos.ready ? "visible" : "hidden" }}
			// It is drawn inside the timeline, which would otherwise start a selection rectangle.
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div className="mb-2 font-medium">Custom curve</div>
			<svg
				ref={svg}
				width={W}
				height={H}
				className="block rounded-md bg-background"
				role="img"
				aria-label="Curve graph: time across, value up"
			>
				{/* The unit square: start of the segment bottom left, end top right. */}
				<rect
					x={gx(0)}
					y={gy(1)}
					width={gx(1) - gx(0)}
					height={gy(0) - gy(1)}
					fill="none"
					stroke="currentColor"
					strokeOpacity={0.15}
				/>
				<line
					x1={gx(0)}
					y1={gy(0)}
					x2={gx(1)}
					y2={gy(1)}
					stroke="currentColor"
					strokeOpacity={0.12}
					strokeDasharray="3 3"
				/>
				<line x1={gx(0)} y1={gy(0)} x2={h1[0]} y2={h1[1]} stroke="var(--accent)" strokeWidth={1} />
				<line x1={gx(1)} y1={gy(1)} x2={h2[0]} y2={h2[1]} stroke="var(--accent)" strokeWidth={1} />
				<path d={path} fill="none" stroke="rgb(252,211,77)" strokeWidth={2} />
				<circle cx={gx(0)} cy={gy(0)} r={3} fill="currentColor" fillOpacity={0.5} />
				<circle cx={gx(1)} cy={gy(1)} r={3} fill="currentColor" fillOpacity={0.5} />
				{[h1, h2].map(([cx, cy], i) => (
					<circle
						// biome-ignore lint/suspicious/noArrayIndexKey: the two handles never reorder
						key={i}
						cx={cx}
						cy={cy}
						r={6}
						fill="var(--accent)"
						stroke="white"
						strokeWidth={1.5}
						className="cursor-grab active:cursor-grabbing"
						onPointerDown={(e) => dragHandle(i as 0 | 1, e)}
					/>
				))}
			</svg>
			<div className="mt-1.5 text-center font-mono text-[10.5px] text-muted tabular-nums">
				cubic-bezier({curve.map(round).join(", ")})
			</div>
			<div className="mt-2 flex flex-wrap gap-1">
				{CURVE_PRESETS.map((p) => (
					<button
						key={p.label}
						type="button"
						onClick={() => setCurve(p.curve)}
						className={cn(
							"h-6 rounded-md border border-border px-1.5 text-[11px] hover:bg-default",
							same(curve, p.curve) && "border-accent text-foreground",
						)}
					>
						{p.label}
					</button>
				))}
			</div>
			<div className="mt-3 flex justify-end gap-1.5">
				<button
					type="button"
					onClick={onClose}
					className="h-7 rounded-md px-2.5 text-muted hover:bg-default"
				>
					Cancel
				</button>
				<button
					type="button"
					onClick={apply}
					className="h-7 rounded-md bg-accent px-2.5 font-medium text-accent-foreground hover:opacity-90"
				>
					Apply
				</button>
			</div>
		</div>
	);
}
