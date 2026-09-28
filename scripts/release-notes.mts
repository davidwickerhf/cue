// The release notes of a version, from the site's changelog: node --experimental-strip-types scripts/release-notes.mts v0.2.8
import { CHANGELOG } from "../site/src/content/changelog.ts";

const version = (process.argv[2] ?? "").replace(/^v/, "");
const release = CHANGELOG.find((r) => r.version === version);
if (!release) {
	console.error(`No changelog entry for ${version}.`);
	process.exit(1);
}
console.log([release.summary, "", ...release.changes.map((c) => `- ${c}`)].join("\n"));
