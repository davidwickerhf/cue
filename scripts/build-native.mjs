// Compiles the native helpers (macOS only): cue-vision, on-device image analysis
// with Apple's Vision framework. Without a Swift compiler the app still works;
// the features that need it say so.
//
// The helper is built for both Apple Silicon and Intel and joined into one
// universal binary, so the arm64 and x64 app builds can share it. It targets
// macOS 12 (Electron's minimum), not the version of the Mac building it.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") process.exit(0);
const outDir = path.join(root, "build", "native");
const source = path.join(root, "native", "cue-vision.swift");
const output = path.join(outDir, "cue-vision");
mkdirSync(outDir, { recursive: true });

const swiftc = (target, out) =>
	execFileSync("swiftc", ["-O", "-target", target, source, "-o", out], { stdio: "inherit" });

try {
	const slices = [];
	for (const arch of ["arm64", "x86_64"]) {
		const slice = `${output}-${arch}`;
		try {
			swiftc(`${arch}-apple-macos12`, slice);
			slices.push(slice);
		} catch {
			console.warn(`Could not build cue-vision for ${arch}.`);
		}
	}
	if (slices.length === 0) throw new Error("no slices");
	execFileSync("lipo", ["-create", ...slices, "-output", output], { stdio: "inherit" });
	for (const slice of slices) rmSync(slice, { force: true });
	console.log(
		`Built build/native/cue-vision (${slices.map((s) => s.split("-").pop()).join(" + ")})`,
	);
} catch {
	console.warn("swiftc is not available: skipping cue-vision (install the Xcode command line tools).");
}
