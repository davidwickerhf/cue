import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Screen recording through cue-capture (native/cue-capture.swift,
 * ScreenCaptureKit), as dedicated recorders do: full resolution, and the
 * pointer can be left out (the browser's screen sharing always draws it in;
 * the studio look draws its own instead).
 */

export function captureBinary(): string | null {
	if (process.platform !== "darwin") return null;
	const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
	const candidates = [
		process.env.CUE_CAPTURE,
		resources && path.join(resources, "native", "cue-capture"),
		typeof __dirname === "string" && path.join(__dirname, "..", "build", "native", "cue-capture"),
		path.join(process.cwd(), "build", "native", "cue-capture"),
	].filter((p): p is string => !!p);
	return candidates.find((p) => existsSync(p)) ?? null;
}

export interface NativeCapture {
	/** Unix time (ms) of the first frame: the movie's time zero. */
	startedAt: number;
	file: string;
	pause: () => void;
	resume: () => void;
	/** Finishes the movie. */
	stop: () => Promise<void>;
	/** Gives up without a movie. */
	kill: () => void;
}

/** Starts recording a screen or window into `file` (a .mov); resolves once the first frame is in. */
export function startNativeCapture(
	target: { displayId?: number; windowId?: number; showCursor?: boolean },
	file: string,
	fps: number,
): Promise<NativeCapture> {
	const bin = captureBinary();
	if (!bin) return Promise.reject(new Error("Native screen recording is not available here."));
	const args = [
		...(target.windowId ? ["--window", String(target.windowId)] : []),
		...(target.displayId ? ["--display", String(target.displayId)] : []),
		...(target.showCursor ? ["--cursor"] : []),
		"--out",
		file,
		"--fps",
		String(Math.max(1, Math.round(fps))),
	];
	const child = spawn(bin, args, { stdio: ["pipe", "pipe", "pipe"] });
	let error = "";
	child.stderr.on("data", (d: Buffer) => {
		error += d.toString("utf8");
	});
	const closed = new Promise<void>((resolve) => child.on("close", () => resolve()));
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error("The screen recording did not start. Is screen recording allowed for Cue?"));
		}, 8000);
		let rest = "";
		child.stdout.on("data", (d: Buffer) => {
			const lines = (rest + d.toString("utf8")).split("\n");
			rest = lines.pop() ?? "";
			for (const line of lines) {
				let event: { k: string; t?: number; message?: string };
				try {
					event = JSON.parse(line);
				} catch {
					continue;
				}
				if (event.k === "started" && event.t) {
					clearTimeout(timer);
					const send = (command: string) => {
						if (child.stdin.writable) child.stdin.write(`${command}\n`);
					};
					resolve({
						startedAt: event.t,
						file,
						pause: () => send("pause"),
						resume: () => send("resume"),
						stop: async () => {
							send("stop");
							child.stdin.end();
							const timeout = setTimeout(() => child.kill(), 15000);
							await closed;
							clearTimeout(timeout);
						},
						kill: () => child.kill(),
					});
				}
				if (event.k === "error") {
					clearTimeout(timer);
					reject(new Error(event.message || "The screen recording failed."));
				}
			}
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			reject(e);
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code) reject(new Error(error.trim() || `cue-capture exited with ${code}`));
		});
	});
}

/**
 * ffmpeg arguments that turn the pointer-less movie and the microphone (a WebM
 * the window recorded) into the recording's MP4: the movie is trimmed so it
 * starts when the window started recording (`trimMs`), the same way as the
 * camera, at a constant frame rate.
 */
export function nativeMp4Args(input: {
	video: string;
	audio?: string;
	trimMs: number;
	output: string;
	fps: number;
	hardware: boolean;
}): string[] {
	const fps = Math.max(1, Math.round(input.fps));
	const video = input.hardware
		? ["-c:v", "h264_videotoolbox", "-q:v", "70"]
		: ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20"];
	const trim = Math.max(0, input.trimMs) / 1000;
	const late = Math.max(0, -input.trimMs) / 1000;
	return [
		...(trim ? ["-ss", trim.toFixed(3)] : []),
		"-i",
		input.video,
		...(input.audio ? [...(late ? ["-itsoffset", late.toFixed(3)] : []), "-i", input.audio] : []),
		"-map",
		"0:v",
		...(input.audio ? ["-map", "1:a"] : []),
		"-vf",
		`scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${fps}`,
		...video,
		"-pix_fmt",
		"yuv420p",
		"-g",
		String(fps),
		...(input.audio ? ["-c:a", "aac", "-b:a", "160k"] : []),
		"-movflags",
		"+faststart",
		"-y",
		input.output,
	];
}
