import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * On-device image analysis through cue-vision (native/cue-vision.swift, Apple's
 * Vision framework): faces, what is in the picture, and text on screen.
 */

export interface VisionResult {
	file: string;
	/** Face boxes as shares of the image, origin top left. */
	faces?: { x: number; y: number; w: number; h: number; confidence: number }[];
	/** What the picture shows (Vision's classifier), most likely first. */
	labels?: { id: string; confidence: number }[];
	/** Text read from the picture. */
	text?: string[];
	error?: string;
}

/** Where the helper is: an override, inside the app, or built in the repo. */
export function visionBinary(): string | null {
	const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	const candidates = [
		process.env.CUE_VISION,
		resources && path.join(resources, "native", "cue-vision"),
		typeof __dirname === "string" && path.join(__dirname, "..", "build", "native", "cue-vision"),
		path.join(process.cwd(), "build", "native", "cue-vision"),
	].filter((p): p is string => !!p);
	return candidates.find((p) => existsSync(p)) ?? null;
}

export function visionAvailable(): boolean {
	return process.platform === "darwin" && visionBinary() !== null;
}

/**
 * Cuts the subject out of a picture into a PNG with transparency, cropped to it,
 * with an optional paper-white outline (pixels) and soft shadow (0–1): the
 * collage look of explainer videos. Every foreground object on macOS 14 and
 * later, people only on older systems.
 */
export function cutOut(
	input: string,
	output: string,
	options: { outline?: number; shadow?: number } = {},
): Promise<{ file: string; width: number; height: number }> {
	const bin = visionBinary();
	if (!bin) return Promise.reject(new Error("Cutting out needs on-device vision (macOS)."));
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", (d: Buffer) => {
			out += d.toString("utf8");
		});
		child.stderr.on("data", (d: Buffer) => {
			err += d.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) return reject(new Error(err.trim() || `cue-vision exited with ${code}`));
			const result = JSON.parse(out.trim().split("\n").pop() ?? "{}") as {
				file?: string;
				width?: number;
				height?: number;
				error?: string;
			};
			if (result.error || !result.file)
				return reject(new Error(result.error ?? "No cut-out made."));
			resolve({ file: result.file, width: result.width ?? 0, height: result.height ?? 0 });
		});
		child.stdin.end(JSON.stringify({ cutout: { input, output, ...options } }));
	});
}

/** Analyses images (JPEG/PNG paths); one result per image, in order. */
export function analyseImages(
	images: string[],
	want: { faces?: boolean; labels?: boolean; text?: boolean },
): Promise<VisionResult[]> {
	const bin = visionBinary();
	if (!bin)
		return Promise.reject(
			new Error("On-device vision is not available (cue-vision was not built; macOS only)."),
		);
	return new Promise((resolve, reject) => {
		const child = spawn(bin, [], { stdio: ["pipe", "pipe", "pipe"] });
		let out = "";
		let err = "";
		child.stdout.on("data", (d: Buffer) => {
			out += d.toString("utf8");
		});
		child.stderr.on("data", (d: Buffer) => {
			err += d.toString("utf8");
		});
		child.on("error", reject);
		child.on("close", (code) => {
			if (code !== 0) return reject(new Error(err.trim() || `cue-vision exited with ${code}`));
			resolve(
				out
					.split("\n")
					.filter((l) => l.trim().startsWith("{"))
					.map((l) => JSON.parse(l) as VisionResult),
			);
		});
		child.stdin.end(
			JSON.stringify({
				images,
				faces: want.faces ?? false,
				labels: want.labels ?? false,
				text: want.text ?? false,
			}),
		);
	});
}

/**
 * Keyframes that keep the main face in the middle of a frame the clip overfills
 * horizontally: `samples` are face centres (shares of the source width, null
 * when there is no face) at clip-local times. `span` is how much wider than the
 * frame the picture is (2 means twice as wide). Movement is smoothed and small
 * wobbles are ignored, like a steady camera operator.
 */
export function followKeyframes(
	samples: { atMs: number; cx: number | null }[],
	span: number,
): { atMs: number; value: number }[] {
	if (span <= 1.001 || samples.length === 0) return [];
	// Hold the last known face through gaps; start centred.
	let last = 0.5;
	const filled = samples.map((s) => {
		if (s.cx !== null) last = s.cx;
		return { atMs: s.atMs, cx: last };
	});
	// Smooth with a small moving average.
	const smooth = filled.map((s, i) => {
		const window = filled.slice(Math.max(0, i - 2), i + 3);
		return { atMs: s.atMs, cx: window.reduce((n, w) => n + w.cx, 0) / window.length };
	});
	// Picture centre that puts cx in the middle of the frame, kept so the picture still covers it.
	const limit = (span - 1) / 2 / span;
	const toX = (cx: number) => 0.5 + span * Math.max(-limit, Math.min(limit, 0.5 - cx));
	const keys: { atMs: number; value: number }[] = [];
	for (const s of smooth) {
		const value = Math.round(toX(s.cx) * 1000) / 1000;
		const prev = keys.at(-1);
		// A dead zone: only move for real changes (about 4% of the frame).
		if (!prev || Math.abs(prev.value - value) > 0.04) keys.push({ atMs: s.atMs, value });
	}
	const end = smooth.at(-1);
	if (end && keys.at(-1)?.atMs !== end.atMs)
		keys.push({ atMs: end.atMs, value: keys.at(-1)?.value ?? 0.5 });
	return keys;
}

/** A moment of a video (or a still) as the shot index knows it. */
export interface ShotSample {
	/** Source time. */
	atMs: number;
	labels: { id: string; confidence: number }[];
	text: string[];
	faces: number;
	/** A sentence describing the frame (optional, from a vision model). */
	caption?: string;
}

let vocabulary: Promise<string[]> | null = null;

/** Every label the classifier knows (about 1,300), for widening a search. */
export function visionVocabulary(): Promise<string[]> {
	const bin = visionBinary();
	if (!bin) return Promise.resolve([]);
	vocabulary ??= new Promise<string[]>((resolve) => {
		const child = spawn(bin, [], { stdio: ["pipe", "pipe", "ignore"] });
		let out = "";
		child.stdout.on("data", (d: Buffer) => {
			out += d.toString("utf8");
		});
		child.on("close", () => {
			try {
				resolve(JSON.parse(out) as string[]);
			} catch {
				resolve([]);
			}
		});
		child.on("error", () => resolve([]));
		child.stdin.end(JSON.stringify({ images: [], vocabulary: true }));
	});
	return vocabulary;
}

/** Labels whose words include a word of the query ("snow" → snow, snowball, snowman…). */
export function labelsFor(query: string, vocab: string[]): string[] {
	const q = new Set(words(query));
	return vocab.filter((label) => words(label.replace(/_/g, " ")).some((w) => q.has(w)));
}

/** Words that say nothing about a picture. */
const STOP = new Set(
	"a an the of on in at to and or with for from by is are was be this that it its some any shot shots clip clips scene where".split(
		" ",
	),
);

const words = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9\s_-]/g, " ")
		.split(/[\s_-]+/)
		.filter((w) => w.length > 1 && !STOP.has(w))
		// Crude stemming, so "dogs" finds "dog", "snowy" finds "snow" and "walking" finds "walk".
		.map(stem);

function stem(w: string): string {
	if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
	if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
	if (w.length > 4 && w.endsWith("y") && !/[aeiou]y$/.test(w)) return w.slice(0, -1);
	if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss")) return w.slice(0, -1);
	return w;
}

/**
 * How well a moment matches a search: what is in the picture, text on screen,
 * people ("person", "face", "people") and what is said around it.
 */
export function scoreShot(
	query: string,
	sample: ShotSample,
	speech: string,
	/** Labels that mean the same as the query (from the vocabulary or a model). */
	related: string[] = [],
): number {
	const q = words(query);
	if (!q.length) return 0;
	const relatedSet = new Set(related);
	const relatedHit = Math.max(
		0,
		...sample.labels.filter((l) => relatedSet.has(l.id)).map((l) => Math.min(1, l.confidence * 2)),
	);
	const caption = words(sample.caption ?? "");
	const labels = sample.labels.map((l) => ({ words: words(l.id), confidence: l.confidence }));
	const text = words(sample.text.join(" "));
	const said = words(speech);
	let score = 0;
	for (const w of q) {
		const label = Math.max(
			0,
			...labels.filter((l) => l.words.includes(w)).map((l) => l.confidence),
		);
		score += label * 2;
		if (text.includes(w)) score += 1.5;
		if (said.includes(w)) score += 1;
		if (["person", "people", "face", "someone", "man", "woman"].includes(w) && sample.faces > 0)
			score += 1;
		if (caption.includes(w)) score += 2;
	}
	// A related label counts once for the whole query.
	return score / q.length + relatedHit;
}
