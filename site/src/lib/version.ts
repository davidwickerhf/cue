import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CHANGELOG } from "@/content/changelog";

/**
 * The app version, read at build time from the repository's package.json (the site lives in
 * site/ of the Cue repo). Falls back to the newest released changelog entry if the file is
 * not available to the build.
 */
export const APP_VERSION: string = (() => {
	try {
		const pkg = JSON.parse(readFileSync(join(process.cwd(), "..", "package.json"), "utf8")) as { name?: string; version?: string };
		if (pkg.name === "cue" && pkg.version) return pkg.version;
	} catch {}
	return CHANGELOG.find((r) => r.version !== "Unreleased")?.version ?? "0.1.1";
})();
