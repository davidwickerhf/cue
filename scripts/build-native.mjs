// Compiles the native helpers (macOS only): cue-vision, on-device image analysis
// with Apple's Vision framework. Without a Swift compiler the app still works;
// the features that need it say so.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") process.exit(0);
mkdirSync(path.join(root, "build", "native"), { recursive: true });
try {
	execFileSync(
		"swiftc",
		["-O", path.join(root, "native", "cue-vision.swift"), "-o", path.join(root, "build", "native", "cue-vision")],
		{ stdio: "inherit" },
	);
	console.log("Built build/native/cue-vision");
} catch {
	console.warn("swiftc is not available: skipping cue-vision (install the Xcode command line tools).");
}
