// Compiles the native helpers (macOS only). Without a Swift compiler the app still works;
// the features that need it say so.
//
// Each helper is built for both Apple Silicon and Intel and joined into one
// universal binary, so the arm64 and x64 app builds can share it. It targets
// macOS 12 (Electron's minimum), not the version of the Mac building it.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") process.exit(0);
const outDir = path.join(root, "build", "native");
mkdirSync(outDir, { recursive: true });

// cue-vision: faces, labels and text; cue-cursor: the pointer during screen recordings;
// cue-capture: screen recording without the pointer (for the studio look; ScreenCaptureKit
// needs macOS 12.3, so it alone targets that).
for (const name of ["cue-vision", "cue-cursor", "cue-capture"]) {
	const source = path.join(root, "native", `${name}.swift`);
	const output = path.join(outDir, name);
	try {
		const slices = [];
		for (const arch of ["arm64", "x86_64"]) {
			const slice = `${output}-${arch}`;
			try {
				execFileSync(
					"swiftc",
					[
						"-O",
						"-target",
						`${arch}-apple-macos${name === "cue-capture" ? "12.3" : "12"}`,
						source,
						"-o",
						slice,
					],
					{
						stdio: "inherit",
					},
				);
				slices.push(slice);
			} catch {
				console.warn(`Could not build ${name} for ${arch}.`);
			}
		}
		if (slices.length === 0) throw new Error("no slices");
		execFileSync("lipo", ["-create", ...slices, "-output", output], { stdio: "inherit" });
		for (const slice of slices) rmSync(slice, { force: true });
		console.log(
			`Built build/native/${name} (${slices.map((s) => s.split("-").pop()).join(" + ")})`,
		);
	} catch {
		console.warn(
			`swiftc is not available: skipping ${name} (install the Xcode command line tools).`,
		);
	}
}
