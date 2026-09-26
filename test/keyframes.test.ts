import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
	bezierAt,
	EASE_CURVES,
	easeAt,
	keyframeExpr,
	splitKeyframes,
	valueAt,
} from "../electron/core/anim";
import { ffmpeg, ffmpegPath } from "../electron/core/media";
import { applyOp } from "../electron/core/ops";
import { emptyProject } from "../electron/core/project";
import { ProjectStore } from "../electron/core/store";
import type { Asset, Curve, Ease, Keyframe, MediaClip, ProjectData } from "../electron/core/types";

/**
 * Evaluates the subset of ffmpeg's expression language keyframeExpr writes:
 * numbers, + - * /, unary minus, brackets, `;` (sequence) and the functions
 * if, lt, clip, max, st and ld, with one variable.
 */
function ffEval(expr: string, vars: Record<string, number>): number {
	const regs = new Array(10).fill(0);
	let i = 0;
	const peek = () => expr[i];
	const eat = (c: string) => {
		if (expr[i] !== c) throw new Error(`Expected ${c} at ${i} in ${expr.slice(i, i + 20)}`);
		i++;
	};
	// Parsed into closures so `if` only evaluates the branch it takes, like ffmpeg.
	type Node = () => number;
	const seq = (): Node => {
		const parts = [sum()];
		while (peek() === ";") {
			i++;
			parts.push(sum());
		}
		return () => {
			let v = 0;
			for (const p of parts) v = p();
			return v;
		};
	};
	const sum = (): Node => {
		let left = product();
		while (peek() === "+" || peek() === "-") {
			const op = expr[i++];
			const a = left;
			const b = product();
			left = op === "+" ? () => a() + b() : () => a() - b();
		}
		return left;
	};
	const product = (): Node => {
		let left = unary();
		while (peek() === "*" || peek() === "/") {
			const op = expr[i++];
			const a = left;
			const b = unary();
			left = op === "*" ? () => a() * b() : () => a() / b();
		}
		return left;
	};
	const unary = (): Node => {
		if (peek() === "-") {
			i++;
			const a = unary();
			return () => -a();
		}
		return primary();
	};
	const primary = (): Node => {
		if (peek() === "(") {
			i++;
			const inner = seq();
			eat(")");
			return inner;
		}
		const number = /^\d+(\.\d+)?(e-?\d+)?/.exec(expr.slice(i));
		if (number) {
			i += number[0].length;
			const v = Number(number[0]);
			return () => v;
		}
		const name = /^[a-zA-Z_]+/.exec(expr.slice(i));
		if (!name) throw new Error(`Unexpected ${expr.slice(i, i + 20)}`);
		i += name[0].length;
		if (peek() !== "(") {
			const v = vars[name[0]];
			if (v === undefined) throw new Error(`Unknown variable ${name[0]}`);
			return () => v;
		}
		i++;
		const args = [seq()];
		while (peek() === ",") {
			i++;
			args.push(seq());
		}
		eat(")");
		const [a, b, c] = args;
		switch (name[0]) {
			case "if":
				return () => (a() ? b() : c ? c() : 0);
			case "lt":
				return () => (a() < b() ? 1 : 0);
			case "clip":
				return () => Math.min(c(), Math.max(b(), a()));
			case "max":
				return () => Math.max(a(), b());
			case "st":
				return () => {
					const v = b();
					regs[a()] = v;
					return v;
				};
			case "ld":
				return () => regs[a()];
			default:
				throw new Error(`Unknown function ${name[0]}`);
		}
	};
	const tree = seq();
	if (i !== expr.length) throw new Error(`Trailing ${expr.slice(i, i + 20)}`);
	return tree();
}

const OVERSHOOT: Curve = [0.34, 1.56, 0.64, 1];

const keys = (ease: Ease, curve?: Curve): Keyframe[] => [
	{ atMs: 500, value: 2, ease, ...(curve ? { curve } : {}) },
	{ atMs: 2500, value: 10, ease: "linear" },
];

describe("keyframe eases", () => {
	it("each ease starts and ends on the keyframes and bends the right way", () => {
		for (const ease of ["linear", "ease", "ease-in", "ease-out", "bezier"] as const) {
			const k = keys(ease, ease === "bezier" ? OVERSHOOT : undefined);
			expect(valueAt(k, 0, 0)).toBe(2);
			expect(valueAt(k, 500, 0)).toBeCloseTo(2, 5);
			expect(valueAt(k, 2499, 0)).toBeCloseTo(10, 1);
			expect(valueAt(k, 3000, 0)).toBe(10);
		}
		const quarter = (ease: Ease, curve?: Curve) => valueAt(keys(ease, curve), 1000, 0);
		expect(quarter("linear")).toBeCloseTo(4);
		expect(quarter("ease-in")).toBeCloseTo(2 + 8 * 0.25 ** 3);
		expect(quarter("ease-out")).toBeCloseTo(2 + 8 * (1 - 0.75 ** 3));
		expect(quarter("ease")).toBeCloseTo(2 + 8 * (0.25 * 0.25 * 2.5));
		expect(quarter("hold")).toBe(2);
		// The overshoot curve passes the end value before settling on it.
		const k = keys("bezier", OVERSHOOT);
		expect(Math.max(...[1800, 2000, 2200].map((t) => valueAt(k, t, 0)))).toBeGreaterThan(10);
	});

	it("solves a bezier like CSS cubic-bezier", () => {
		// Known points of CSS ease-in-out (0.42, 0, 0.58, 1): symmetric, half-way at 0.5.
		const inOut: Curve = [0.42, 0, 0.58, 1];
		expect(bezierAt(inOut, 0.5)).toBeCloseTo(0.5, 4);
		expect(bezierAt(inOut, 0.25) + bezierAt(inOut, 0.75)).toBeCloseTo(1, 4);
		// Each named ease equals its bezier.
		for (const [ease, curve] of Object.entries(EASE_CURVES)) {
			const k = { atMs: 0, value: 0, ease: ease as Ease };
			for (const p of [0.1, 0.3, 0.5, 0.8, 0.95])
				expect(bezierAt(curve, p)).toBeCloseTo(easeAt(k, p), 4);
		}
	});

	it("the ffmpeg expression matches valueAt for every ease", () => {
		const cases: [Ease, Curve?][] = [
			["linear"],
			["ease"],
			["ease-in"],
			["ease-out"],
			["hold"],
			["bezier", OVERSHOOT],
			["bezier", [0.9, 0, 0.1, 1]],
			["bezier", [0, 0, 1, 1]],
			["bezier", [0.42, 0, 1, 1]],
		];
		for (const [ease, curve] of cases) {
			const k: Keyframe[] = [
				{ atMs: 0, value: -1, ease: "linear" },
				...keys(ease, curve),
				{ atMs: 4000, value: 3, ease: "linear" },
			];
			const expr = keyframeExpr(k, 0, "(t-1.2)");
			expect(expr.length).toBeLessThan(4000);
			for (let ms = 0; ms <= 4500; ms += 37) {
				const js = valueAt(k, ms, 0);
				const ff = ffEval(expr, { t: 1.2 + ms / 1000 });
				expect(Math.abs(ff - js), `${ease} at ${ms} ms`).toBeLessThan(0.002);
			}
		}
	});
});

describe("splitting animated clips", () => {
	it("cuts a curved segment into two that trace the same path", () => {
		for (const [ease, curve] of [
			["ease", undefined],
			["ease-in", undefined],
			["bezier", OVERSHOOT],
		] as [Ease, Curve?][]) {
			const k = keys(ease, curve);
			const cut = 1100;
			const [left, right] = splitKeyframes(k, cut);
			for (let t = 0; t <= 3000; t += 50) {
				const whole = valueAt(k, t, 0);
				const part = t < cut ? valueAt(left, t, 0) : valueAt(right, t - cut, 0);
				expect(Math.abs(part - whole), `${ease} at ${t}`).toBeLessThan(0.02);
			}
		}
	});
});

describe("editing keyframes", () => {
	const video: Asset = {
		id: "a_v",
		kind: "video",
		name: "v.mp4",
		path: "v.mp4",
		durationMs: 20000,
		width: 1920,
		height: 1080,
		hasAudio: true,
		origin: "import",
		createdAt: "",
		actor: "user",
	};
	function base(): { data: ProjectData; id: string } {
		let data = applyOp(emptyProject("T"), { type: "addAsset", asset: video }).data;
		data = applyOp(data, {
			type: "addClips",
			clips: [{ type: "media", trackId: "V1", assetId: "a_v", startMs: 0, durationMs: 5000 }],
		}).data;
		const id = data.clips[0].id;
		for (const [atMs, value] of [
			[0, 0.2],
			[2000, 0.5],
			[4000, 0.8],
		])
			data = applyOp(data, {
				type: "setKeyframe",
				clipId: id,
				prop: "x",
				keyframe: { atMs, value, ease: "ease" },
			}).data;
		return { data, id };
	}
	const xs = (d: ProjectData) => (d.clips[0] as MediaClip).keyframes?.x ?? [];

	it("moves several keyframes at once, clamped to the clip, past each other", () => {
		const { data, id } = base();
		const moved = applyOp(data, {
			type: "editKeyframes",
			clipId: id,
			edits: [
				{ prop: "x", atMs: 2000, toMs: 4500, value: 0.6 },
				{ prop: "x", atMs: 4000, toMs: 9000 },
			],
		});
		expect(moved.summary).toContain("Moved 2 keyframes");
		expect(xs(moved.data).map((k) => [k.atMs, k.value])).toEqual([
			[0, 0.2],
			[4500, 0.6],
			[5000, 0.8],
		]);
	});

	it("sets eases and curves, and removes keyframes", () => {
		const { data, id } = base();
		const curved = applyOp(data, {
			type: "editKeyframes",
			clipId: id,
			edits: [{ prop: "x", atMs: 0, ease: "bezier", curve: OVERSHOOT }],
		}).data;
		expect(xs(curved)[0]).toMatchObject({ ease: "bezier", curve: OVERSHOOT });
		// A named ease drops the custom curve.
		const plain = applyOp(curved, {
			type: "editKeyframes",
			clipId: id,
			edits: [{ prop: "x", atMs: 0, ease: "ease-out" }],
		}).data;
		expect(xs(plain)[0].curve).toBeUndefined();
		expect(xs(plain)[0].ease).toBe("ease-out");
		const removed = applyOp(plain, {
			type: "editKeyframes",
			clipId: id,
			edits: [
				{ prop: "x", atMs: 0, remove: true },
				{ prop: "x", atMs: 2000, remove: true },
				{ prop: "x", atMs: 4000, remove: true },
			],
		}).data;
		expect((removed.clips[0] as MediaClip).keyframes?.x).toBeUndefined();
		expect(() =>
			applyOp(data, {
				type: "editKeyframes",
				clipId: id,
				edits: [{ prop: "x", atMs: 1000, remove: true }],
			}),
		).toThrow(/No x keyframe/);
	});

	it("setKeyframe gives a bezier without handles a default curve", () => {
		const { data, id } = base();
		const next = applyOp(data, {
			type: "setKeyframe",
			clipId: id,
			prop: "scale",
			keyframe: { atMs: 100, value: 1, ease: "bezier" },
		}).data;
		expect((next.clips[0] as MediaClip).keyframes?.scale?.[0].curve).toHaveLength(4);
		const linear = applyOp(data, {
			type: "setKeyframe",
			clipId: id,
			prop: "scale",
			keyframe: { atMs: 100, value: 1, ease: "linear", curve: OVERSHOOT },
		}).data;
		expect((linear.clips[0] as MediaClip).keyframes?.scale?.[0].curve).toBeUndefined();
	});
});

const run = promisify(execFile);

/** Horizontal centre of the red pixels on row `y` of the frame at `sec`. */
async function redCentre(file: string, sec: number, y: number, w: number): Promise<number> {
	const { stdout } = await run(
		ffmpegPath(),
		["-v", "error", "-ss", String(sec), "-i", file, "-frames:v", "1"].concat([
			"-f",
			"rawvideo",
			"-pix_fmt",
			"rgb24",
			"-",
		]),
		{ encoding: "buffer", maxBuffer: 1 << 26 },
	);
	const xs: number[] = [];
	for (let x = 0; x < w; x++) {
		const i = (y * w + x) * 3;
		if (stdout[i] > 150 && stdout[i + 1] < 90 && stdout[i + 2] < 90) xs.push(x);
	}
	return xs.length ? (xs[0] + xs[xs.length - 1] + 1) / 2 : Number.NaN;
}

describe("exported curves", () => {
	it("moves the picture along the same bezier as the preview", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cue-curve-"));
		const box = path.join(dir, "box.mp4");
		await ffmpeg(["-f", "lavfi", "-i", "color=c=red:s=40x40:r=30:d=4", "-pix_fmt", "yuv420p", box]);
		const store = new ProjectStore({
			mediaUrl: (f) => f,
			recentFile: path.join(dir, "recent.json"),
			autoProxies: () => false,
		});
		await store.create({ path: dir, name: "Curves" });
		store.apply({ type: "setCanvas", canvas: { width: 320, height: 180 } }, "user");
		const [pic] = await store.importMedia([box], "user");
		store.apply(
			{
				type: "addClips",
				clips: [{ type: "media", trackId: "V1", assetId: pic.id, startMs: 0, durationMs: 4000 }],
			},
			"user",
		);
		const clip = store.current.clips[0] as MediaClip;
		store.apply({ type: "updateClip", id: clip.id, patch: { transform: { scale: 0.1 } } }, "user");
		const x: Keyframe[] = [
			{ atMs: 0, value: 0.15, ease: "bezier", curve: OVERSHOOT },
			{ atMs: 3000, value: 0.7, ease: "linear" },
		];
		for (const keyframe of x)
			store.apply({ type: "setKeyframe", clipId: clip.id, prop: "x", keyframe }, "user");
		store.apply(
			{ type: "updateExport", export: { hardware: false, videoQuality: "high" } },
			"user",
		);
		const out = (await store.export("video", "curve.mp4", "user")).outputs[0];
		// Frame times (30 fps) where the curve is steep, overshooting and settling.
		for (const sec of [0.5, 1, 1.5, 2, 2.5]) {
			const expected = 320 * valueAt(x, sec * 1000, 0);
			const found = await redCentre(out, sec, 90, 320);
			expect(Math.abs(found - expected), `at ${sec} s`).toBeLessThan(3);
		}
	}, 90000);
});
