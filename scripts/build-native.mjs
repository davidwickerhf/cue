// Compiles the native helpers (macOS only). Without a Swift compiler the app still works;
// the features that need it say so.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
if (process.platform !== "darwin") process.exit(0);
mkdirSync(path.join(root, "build", "native"), { recursive: true });
// cue-vision: faces, labels and text; cue-cursor: the pointer during screen recordings.
for (const name of ["cue-vision", "cue-cursor"]) {
	try {
		execFileSync(
			"swiftc",
			["-O", path.join(root, "native", `${name}.swift`), "-o", path.join(root, "build", "native", name)],
			{ stdio: "inherit" },
		);
		console.log(`Built build/native/${name}`);
	} catch {
		console.warn(`swiftc is not available: skipping ${name} (install the Xcode command line tools).`);
	}
}
